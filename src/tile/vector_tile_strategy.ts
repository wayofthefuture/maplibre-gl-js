import {EXTENT} from '../data/extent';
import {EXTENT_BOUNDS} from '../data/extent_bounds';
import {Bounds} from '../geo/bounds';
import {MercatorCoordinate} from '../geo/mercator_coordinate';
import {type OverscaledTileID, sortTileIDs} from './tile_id';
import type {Tile} from './tile';
import type {TileManagerStrategy} from './tile_manager';
import type {ITransform} from '../geo/transform_interface';
import type {Terrain} from '../render/terrain';
import type Point from '@mapbox/point-geometry';

export type TileResult = {
    tile: Tile;
    tileID: OverscaledTileID;
    queryGeometry: Array<Point>;
    cameraQueryGeometry: Array<Point>;
    scale: number;
};

export class VectorTileStrategy implements TileManagerStrategy {
    /**
     * Post-update processing for vector tiles. Handles symbol fade holding for retained tiles.
     * Returns a list of tile ids that should be removed.
     */
    onFinishUpdate(tiles: Record<string, Tile>, _idealTileIDs: Array<OverscaledTileID>, retain: Record<string, OverscaledTileID>, _sourceMinZoom: number, _sourceMaxZoom: number, fadeDuration: number): string[] {
        const removeIds = [];

        for (const key in tiles) {
            const tile = tiles[key];

            // retained - clear fade hold so if it's removed again fade timer starts fresh.
            if (retain[key]) {
                tile.clearSymbolFadeHold();
                continue;
            }

            // remove non-retained tiles without symbols
            if (!tile.hasSymbolBuckets) {
                removeIds.push(key);
                continue;
            }

            // for tile with symbols - hold for fade - then remove
            if (!tile.holdingForSymbolFade()) {
                tile.setSymbolHoldDuration(fadeDuration);
            } else if (tile.symbolFadeFinished()) {
                removeIds.push(key);
            }
        }

        return removeIds;
    }

    /**
     * Determine if a vector tile is renderable based on its data and current fade state.
     */
    isTileRenderable(tile: Tile, symbolLayer?: boolean): boolean {
        return (
            tile?.hasData() &&
            (symbolLayer || !tile.holdingForSymbolFade())
        );
    }

    /**
     * Returns a list of tile ids that are holding for symbol fade.
     */
    getTilesHoldingForSymbolFade(tiles: Record<string, Tile>): Array<string> {
        const ids = [];
        for (const id in tiles) {
            if (tiles[id].holdingForSymbolFade()) {
                ids.push(id);
            }
        }
        return ids;
    }

    /**
     * Search through our current tiles and attempt to find the tiles that cover the given bounds.
     * @param pointQueryGeometry - coordinates of the corners of bounding rectangle
     * @returns result items have `{tile, minX, maxX, minY, maxY}`, where min/max bounding values are the given bounds transformed in into the coordinate space of this tile.
     */
    tilesIn(tiles: Record<string, Tile>, pointQueryGeometry: Array<Point>, maxPitchScaleFactor: number, has3DLayer: boolean, transform: ITransform, terrain: Terrain): TileResult[] {
        const tileResults: TileResult[] = [];

        if (!transform) return tileResults;
        const allowWorldCopies = transform.getCoveringTilesDetailsProvider().allowWorldCopies();

        const cameraPointQueryGeometry = has3DLayer ?
            transform.getCameraQueryGeometry(pointQueryGeometry) :
            pointQueryGeometry;

        const project = (point: Point) => transform.screenPointToMercatorCoordinate(point, terrain);
        const queryGeometry = this._transformBbox(pointQueryGeometry, project, !allowWorldCopies);
        const cameraQueryGeometry = this._transformBbox(cameraPointQueryGeometry, project, !allowWorldCopies);
        const cameraBounds = Bounds.fromPoints(cameraQueryGeometry);

        // Assemble a list of sorted tiles
        const tileIDs = [];
        for (const id in tiles) tileIDs.push(tiles[id].tileID);
        const sortedTiles = sortTileIDs(tileIDs).map(tileID => tiles[tileID.key]);

        for (const tile of sortedTiles) {
            if (tile.holdingForSymbolFade()) {
                // Tiles held for fading are covered by tiles that are closer to ideal
                continue;
            }
            // if the projection does not render world copies then we need to explicitly check for the bounding box crossing the antimeridian
            const tileIDs = allowWorldCopies ? [tile.tileID] : [tile.tileID.unwrapTo(-1), tile.tileID.unwrapTo(0)];
            const scale = Math.pow(2, transform.zoom - tile.tileID.overscaledZ);
            const queryPadding = maxPitchScaleFactor * tile.queryPadding * EXTENT / tile.tileSize / scale;

            for (const tileID of tileIDs) {

                const tileSpaceBounds = cameraBounds.map(point => tileID.getTilePoint(new MercatorCoordinate(point.x, point.y)));
                tileSpaceBounds.expandBy(queryPadding);

                if (tileSpaceBounds.intersects(EXTENT_BOUNDS)) {

                    const tileSpaceQueryGeometry: Array<Point> = queryGeometry.map((c) => tileID.getTilePoint(c));
                    const tileSpaceCameraQueryGeometry = cameraQueryGeometry.map((c) => tileID.getTilePoint(c));

                    tileResults.push({
                        tile,
                        tileID: allowWorldCopies ? tileID : tileID.unwrapTo(0),
                        queryGeometry: tileSpaceQueryGeometry,
                        cameraQueryGeometry: tileSpaceCameraQueryGeometry,
                        scale
                    });
                }
            }
        }

        return tileResults;
    }

    /**
     * Transform a bounding box from screen coordinates to tile coordinates.
     */
    _transformBbox(geom: Point[], project: (point: Point) => MercatorCoordinate, checkWrap: boolean): MercatorCoordinate[] {
        let transformed = geom.map(project);
        if (checkWrap) {
            // If the projection does not allow world copies, then a bounding box may span the antimeridian and
            // instead of a bounding box going from 179°E to 179°W, it goes from 179°W to 179°E and covers the entire
            // planet except for what should be inside it.
            const bounds = Bounds.fromPoints(geom);
            bounds.shrinkBy(Math.min(bounds.width(), bounds.height()) * 0.001);
            const projected = bounds.map(project);

            const newBounds = Bounds.fromPoints(transformed);

            if (!newBounds.covers(projected)) {
                transformed = transformed.map((coord) => coord.x > 0.5 ?
                    new MercatorCoordinate(coord.x - 1, coord.y, coord.z) :
                    coord
                );
            }
        }
        return transformed;
    }
}
