import {clamp} from '../util/util';

import {ImageSource} from '../source/image_source';
import {browser} from '../util/browser';
import {StencilMode} from '../gl/stencil_mode';
import {DepthMode} from '../gl/depth_mode';
import {CullFaceMode} from '../gl/cull_face_mode';
import {rasterUniformValues} from './program/raster_program';
import {EXTENT} from '../data/extent';
import type {Tile} from '../source/tile';
import {FadingRoles} from '../source/tile';
import Point from '@mapbox/point-geometry';

import type {Painter, RenderOptions} from './painter';
import type {SourceCache} from '../source/source_cache';
import type {RasterStyleLayer} from '../style/style_layer/raster_style_layer';
import type {OverscaledTileID} from '../source/tile_id';

const cornerCoords = [
    new Point(0, 0),
    new Point(EXTENT, 0),
    new Point(EXTENT, EXTENT),
    new Point(0, EXTENT),
];

export function drawRaster(painter: Painter, sourceCache: SourceCache, layer: RasterStyleLayer, tileIDs: Array<OverscaledTileID>, renderOptions: RenderOptions) {
    if (painter.renderPass !== 'translucent') return;
    if (layer.paint.get('raster-opacity') === 0) return;
    if (!tileIDs.length) return;

    const {isRenderingToTexture} = renderOptions;
    const source = sourceCache.getSource();

    const projection = painter.style.projection;
    const useSubdivision = projection.useSubdivision;

    // When rendering globe (or any other subdivided projection), two passes are needed.
    // Subdivided tiles with different granularities might have tiny gaps between them.
    // To combat this, tile meshes for globe have a slight border region.
    // However tiles borders will overlap, and a part of a tile often
    // gets hidden by its neighbour's border, which displays an ugly stretched texture.
    // To both hide the border stretch and avoid tiny gaps, tiles are first drawn without borders (with gaps),
    // and then any missing pixels (gaps, not marked in stencil) get overdrawn with tile borders.
    // This approach also avoids pixel shader overdraw, as any pixel is drawn at most once.

    // Stencil mask and two-pass is not used for ImageSource sources regardless of projection.
    if (source instanceof ImageSource) {
        // Image source - no stencil is used
        drawTiles(painter, sourceCache, layer, tileIDs, null, false, false, source.tileCoords, source.flippedWindingOrder, isRenderingToTexture);
    } else if (useSubdivision) {
        // Two-pass rendering
        const [stencilBorderless, stencilBorders, coords] = painter.stencilConfigForOverlapTwoPass(tileIDs);
        drawTiles(painter, sourceCache, layer, coords, stencilBorderless, false, true, cornerCoords, false, isRenderingToTexture); // draw without borders
        drawTiles(painter, sourceCache, layer, coords, stencilBorders, true, true, cornerCoords, false, isRenderingToTexture); // draw with borders
    } else {
        // Simple rendering
        const [stencil, coords] = painter.getStencilConfigForOverlapAndUpdateStencilID(tileIDs);
        drawTiles(painter, sourceCache, layer, coords, stencil, false, true, cornerCoords, false, isRenderingToTexture);
    }
}

function drawTiles(
    painter: Painter,
    sourceCache: SourceCache,
    layer: RasterStyleLayer,
    coords: Array<OverscaledTileID>,
    stencilModes: {[_: number]: Readonly<StencilMode>} | null,
    useBorder: boolean,
    allowPoles: boolean,
    corners: Array<Point>,
    flipCullfaceMode: boolean = false,
    isRenderingToTexture: boolean = false
) {
    const context = painter.context;
    const gl = context.gl;
    const program = painter.useProgram('raster');
    const transform = painter.transform;
    const projection = painter.style.projection;
    const colorMode = painter.colorModeForRenderPass();
    const align = !painter.options.moving;
    const rasterOpacity = layer.paint.get('raster-opacity');
    const rasterResampling = layer.paint.get('raster-resampling');
    const fadeDuration = layer.paint.get('raster-fade-duration');
    const isTerrain = !!painter.style.map.terrain;
    const minTileZ = coords[coords.length - 1].overscaledZ;
    const now = browser.now();

    // update raster fade duration with newest paint property so source cache knows whether to retain tiles for fading
    sourceCache.setRasterFadeDuration(fadeDuration);

    // Draw all tiles
    for (const coord of coords) {
        const tile = sourceCache.getTile(coord);

        // handle tile fading if enabled
        let fadeTile = null, fadeValues = null, fadeScaleBy = null, fadeTopLeft = null;
        if (fadeDuration > 0 && !isTerrain) {
            // first looking to cross-fade with a departing/incoming parent (the parent can be ideal or non-ideal)
            if (tile.fadingParent) {
                fadeTile = sourceCache._getLoadedTile(tile.fadingParent);
                if (fadeTile) {
                    fadeValues = getFadeValues(tile, fadeTile, fadeDuration);
                    fadeScaleBy = Math.pow(2, fadeTile.tileID.overscaledZ - tile.tileID.overscaledZ);
                    fadeTopLeft = [
                        tile.tileID.canonical.x * fadeScaleBy % 1,
                        tile.tileID.canonical.y * fadeScaleBy % 1
                    ];
                    if (!fadeTile.fadeEndTime) {
                        fadeTile.fadeEndTime = now + fadeDuration;
                    }
                }
            }
            // second looking to self fade in edge tiles that are not candidates for cross-fading above
            else if (tile.selfFading) {
                fadeValues = getFadeValues(tile, null, fadeDuration);
                fadeScaleBy = 1;
                fadeTopLeft = [0, 0];
                if (!tile.fadeEndTime) {
                    tile.fadeEndTime = now + fadeDuration;
                }
            }
        }

        // Set the lower zoom level to sublayer 0, and higher zoom levels to higher sublayers
        // Use gl.LESS to prevent double drawing in areas where tiles overlap.
        const depthMode = painter.getDepthModeForSublayer(coord.overscaledZ - minTileZ, rasterOpacity === 1 ? DepthMode.ReadWrite : DepthMode.ReadOnly, gl.LESS);
        const textureFilter = rasterResampling === 'nearest' ?  gl.NEAREST : gl.LINEAR;

        // bind first texture
        context.activeTexture.set(gl.TEXTURE0);
        tile.texture.bind(textureFilter, gl.CLAMP_TO_EDGE, gl.LINEAR_MIPMAP_NEAREST);
        // bind second texture - using either the current tile or the fade tile if available
        context.activeTexture.set(gl.TEXTURE1);
        (fadeTile || tile).texture.bind(textureFilter, gl.CLAMP_TO_EDGE, gl.LINEAR_MIPMAP_NEAREST);

        // Enable anisotropic filtering only when the pitch is greater than 20 degrees
        // to preserve image sharpness on flat or slightly tilted maps.
        if (tile.texture.useMipmap && context.extTextureFilterAnisotropic && painter.transform.pitch > 20) {
            gl.texParameterf(gl.TEXTURE_2D, context.extTextureFilterAnisotropic.TEXTURE_MAX_ANISOTROPY_EXT, context.extTextureFilterAnisotropicMax);
        }

        const terrainData = painter.style.map.terrain && painter.style.map.terrain.getTerrainData(coord);
        const projectionData = transform.getProjectionData({overscaledTileID: coord, aligned: align, applyGlobeMatrix: !isRenderingToTexture, applyTerrainMatrix: true});
        const uniformValues = rasterUniformValues(fadeTopLeft || [0, 0], fadeScaleBy || 1, fadeValues || {opacity: 1, mix: 0}, layer, corners);

        const mesh = projection.getMeshFromTileID(context, coord.canonical, useBorder, allowPoles, 'raster');
        const stencilMode = stencilModes ? stencilModes[coord.overscaledZ] : StencilMode.disabled;

        program.draw(context, gl.TRIANGLES, depthMode, stencilMode, colorMode, flipCullfaceMode ? CullFaceMode.frontCCW : CullFaceMode.backCCW,
            uniformValues, terrainData, projectionData, layer.id, mesh.vertexBuffer,
            mesh.indexBuffer, mesh.segments);
    }
}

function getFadeValues(tile: Tile, partnerTile: Tile, fadeDuration: number): {opacity: number; mix: number} {
    if (fadeDuration <= 0) return {opacity: 1, mix: 0};

    const now = browser.now();
    const timeSinceTile = (now - tile.timeAdded) / fadeDuration;

    // crossfading for partner
    if (partnerTile) {
        const timeSincePartner = (now - partnerTile.timeAdded) / fadeDuration;

        // fade in this tile if it’s closer to ideal zoom than partner, otherwise fade out
        const doFadeIn = (tile.fadingBaseRole === FadingRoles.Incoming);

        // set fading opacity based on current fade direction
        const opacities = [
            clamp(timeSinceTile, 0, 1),
            clamp(1 - timeSincePartner, 0, 1)
        ];
        tile.fadeOpacity = doFadeIn ? opacities[0] : opacities[1];
        partnerTile.fadeOpacity = doFadeIn ? opacities[1] : opacities[0];

        // console.log(tile.tileID.overscaledZ, tile.fadeOpacity);
        // console.log(partnerTile.tileID.overscaledZ, partnerTile.fadeOpacity);

        // when crossfading, this tile is drawn fully opaque, and mix controls partner visibility
        return {
            opacity: 1,
            mix: 1 - tile.fadeOpacity
        };
    }
    // simple fade-in for tile without partner
    else {
        const tileOpacity = clamp(timeSinceTile, 0, 1);

        // clear refresh flag once fade is complete
        if (tile.refreshedUponExpiration && timeSinceTile >= 1) {
            tile.refreshedUponExpiration = false;
        }

        return {
            opacity: tileOpacity,
            mix: 0
        };
    }
}
