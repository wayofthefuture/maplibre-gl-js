import Protobuf from 'pbf';
import type {VectorTileLayerLike, VectorTileLike} from '@maplibre/vt-pbf';
import {MLTVectorTile} from '../source/vector_tile_mlt';
import {VectorTile} from '@mapbox/vector-tile';

export type TileDataParameters = {
    rawData?: ArrayBuffer;
    vectorTile?: VectorTileLike;
};

export class TileData {
    rawData: ArrayBuffer;
    vectorTile: VectorTileLike;

    constructor(params: TileDataParameters) {
        this.rawData = params.rawData;
        this.vectorTile = params.vectorTile;
    }

    /**
     * Get the vector tile layers. Tile data is stored as either raw arraybuffer data for MLT/MVT vector
     * tiles or stored as a vector tile object for GeoJSON tiles which do not use arraybuffer.
     * @param encoding The encoding of the tile data for arraybuffer types (i.e. mlt, mvt)
     */
    public getVectorTileLayers(encoding: string): Record<string, VectorTileLayerLike> {
        if (this.rawData) {
            return this.getRawDataLayers(encoding);
        }
        if (this.vectorTile) {
            return this.vectorTile.layers;
        }
        return null;
    }

    /**
     * Get the raw data layers from the raw data arraybuffer.
     * This is used for MLT/MVT tiles which are stored as raw arraybuffer data.
     * @param encoding The encoding of the tile data for arraybuffer types (i.e. mlt, mvt)
     */
    private getRawDataLayers(encoding: string): Record<string, VectorTileLayerLike> {
        if (encoding === 'mlt') {
            return new MLTVectorTile(this.rawData).layers;
        }
        return new VectorTile(new Protobuf(this.rawData)).layers;
    }
}
