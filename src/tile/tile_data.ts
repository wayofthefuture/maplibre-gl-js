import Protobuf from 'pbf';
import type {VectorTileLayerLike, VectorTileLike} from '@maplibre/vt-pbf';
import {MLTVectorTile} from '../source/vector_tile_mlt';
import {VectorTile} from '@mapbox/vector-tile';

export type TileDataParameters = {
    rawData?: ArrayBuffer;
    vectorData?: VectorTileLike;
};

export class TileData {
    rawData?: ArrayBuffer;
    vectorData?: VectorTileLike;
    private rawDataLayers?: Record<string, VectorTileLayerLike>;

    constructor(params: TileDataParameters = {}) {
        this.rawData = params.rawData;
        this.vectorData = params.vectorData;
    }

    public hasData(): boolean {
        return this.rawData !== undefined || this.vectorData !== undefined;
    }

    /**
     * Get the vector tile layers. Tile data is stored as either raw arraybuffer data for MLT/MVT vector
     * tiles or stored as a vector tile object for GeoJSON tiles which do not use arraybuffer.
     * @param encoding - The encoding of the tile data for arraybuffer types (i.e. mlt, mvt)
     */
    public getVectorTileLayers(encoding: string): Record<string, VectorTileLayerLike> {
        if (this.rawData) {
            return this.getRawDataLayers(encoding);
        }
        if (this.vectorData) {
            return this.vectorData.layers;
        }
        return null;
    }

    /**
     * Get the raw data layers from the raw data arraybuffer.
     * This is used for MLT/MVT tiles which are stored as raw arraybuffer data.
     * @param encoding - The encoding of the tile data for arraybuffer types (i.e. mlt, mvt)
     */
    private getRawDataLayers(encoding: string): Record<string, VectorTileLayerLike> {
        if (this.rawDataLayers) return this.rawDataLayers;

        if (encoding === 'mlt') {
            this.rawDataLayers = new MLTVectorTile(this.rawData).layers;
        } else {
            this.rawDataLayers = new VectorTile(new Protobuf(this.rawData)).layers;
        }

        return this.rawDataLayers;
    }
}
