import type {OverscaledTileID} from './tile_id';
import type {Tile} from './tile';

export class BoundedLRUTileCache {
    private cache: BoundedLRUCache<string, Tile>;

    constructor(maxEntries: number, onRemove?: (tile: Tile) => void) {
        this.cache = new BoundedLRUCache(maxEntries, onRemove);
    }

    private getKey(tileID: OverscaledTileID): string {
        return tileID.wrapped().key;
    }

    get(tileID: OverscaledTileID): Tile | undefined {
        const tile = this.cache.get(this.getKey(tileID));
        // set the tileID because the cached tile could have had a different wrap value
        if (tile) tile.tileID = tileID;
        return tile;
    }

    set(tileID: OverscaledTileID, tile: Tile) {
        this.cache.set(this.getKey(tileID), tile);
    }

    remove(tileID: OverscaledTileID) {
        this.cache.remove(this.getKey(tileID));
    }

    setMaxSize(maxEntries: number) {
        this.cache.setMaxSize(maxEntries);
    }

    filter(func: (tile: Tile) => boolean) {
        this.cache.filter(func);
    }

    clear() {
        this.cache.clear();
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

    set(key: K, value: V) {
        if (this.map.has(key)) {
            this.remove(key);
        } else if (this.map.size >= this.maxEntries) {
            // Remove oldest
            const oldestKey = this.map.keys().next().value;
            this.remove(oldestKey);
        }
        this.map.set(key, value);
    }

    remove(key: K) {
        const value = this.map.get(key);
        if (!value) return;
        this.map.delete(key);
        this.onRemove?.(value);
    }

    setMaxSize(maxEntries: number) {
        this.maxEntries = maxEntries;
    }

    filter(func: (value: V) => boolean) {
        for (const [key, value] of this.map.entries()) {
            if (!func(value)) {
                this.remove(key);
            }
        }
    }

    clear() {
        this.map.clear();
    }
}
