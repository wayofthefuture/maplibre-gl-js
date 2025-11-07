import type {OverscaledTileID} from './tile_id';
import type {Tile} from './tile';

export class BoundedLRUTileCache {
    private maxEntries: number;
    private onRemove: (value: Tile) => void;
    private map: Map<string, Tile>;

    constructor(maxEntries: number, onRemove?: (tile: Tile) => void) {
        this.maxEntries = maxEntries;
        this.onRemove = onRemove;
        this.map = new Map();
    }

    _getKey(tileID: OverscaledTileID): string {
        return tileID.wrapped().key;
    }

    get(tileID: OverscaledTileID): Tile | undefined {
        const key = this._getKey(tileID);

        const tile = this.map.get(key);
        if (tile !== undefined) {
            // Move key to end (most recently used)
            this.map.delete(key);
            this.map.set(key, tile);
        }

        // set the tileID because the cached tile could have had a different wrap value
        tile.tileID = tileID;

        return tile;
    }

    set(tileID: OverscaledTileID, tile: Tile) {
        const key = this._getKey(tileID);

        if (this.map.has(key)) {
            this.remove(tileID);
        } else if (this.map.size >= this.maxEntries) {
            // Remove oldest
            const oldestKey = this.map.keys().next().value;
            const oldestTile = this.map.get(oldestKey);
            this.remove(oldestTile.tileID);
        }

        this.map.set(key, tile);
    }

    remove(tileID: OverscaledTileID) {
        const key = this._getKey(tileID);
        const value = this.map.get(key);
        if (!value) return;

        this.map.delete(key);
        this.onRemove?.(value);
    }

    setMaxSize(maxEntries: number) {
        this.maxEntries = maxEntries;
    }

    filter(func: (tile: Tile) => boolean) {
        for (const tile of this.map.values()) {
            if (!func(tile)) {
                this.remove(tile.tileID);
            }
        }
    }

    clear() {
        this.map.clear();
    }
}

export class BoundedLRUCache<K, V> {
    private maxEntries: number;
    private onRemove: (value: V) => void;
    private map: Map<K, V>;

    constructor(maxEntries: number, onRemove: (value: V) => void) {
        this.maxEntries = maxEntries;
        this.onRemove = onRemove;
        this.map = new Map();
    }

    get(key: K): V | undefined {
        const value = this.map.get(key);
        if (value !== undefined) {
            // Move key to end (most recently used)
            this.map.delete(key);
            this.map.set(key, value);
        }
        return value;
    }

    set(key: K, value: V): void {
        if (this.map.has(key)) {
            this.remove(key);
        } else if (this.map.size >= this.maxEntries) {
            // Remove oldest
            const oldestKey = this.map.keys().next().value;
            this.remove(oldestKey);
        }
        this.map.set(key, value);
    }

    remove(key: K): void {
        const value = this.map.get(key);
        this.map.delete(key);
        this.onRemove?.(value);
    }

    setMaxSize(maxEntries: number): void {
        this.maxEntries = maxEntries;
    }

    filter(func: (value: V) => boolean) {
        for (const [key, value] of this.map.entries()) {
            if (!func(value)) {
                this.remove(key);
            }
        }
    }

    clear(): void {
        this.map.clear();
    }
}
