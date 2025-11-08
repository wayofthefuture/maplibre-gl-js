
export class BoundedLRUCache<K, V> {
    private maxEntries: number;
    private onRemove: (value: V) => void;
    private map: Map<K, V>;

    constructor(maxEntries: number, onRemove?: (value: V) => void) {
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
            this.removeOldest();
        }
        this.map.set(key, value);
    }

    setMaxSize(maxEntries: number) {
        this.maxEntries = maxEntries;
        while (this.map.size > this.maxEntries) {
            this.removeOldest();
        }
    }

    filter(func: (value: V) => boolean) {
        for (const [key, value] of this.map.entries()) {
            if (!func(value)) {
                this.remove(key);
            }
        }
    }

    removeOldest() {
        const oldestKey = this.map.keys().next().value;
        this.remove(oldestKey);
    }

    remove(key: K) {
        const value = this.map.get(key);
        if (!value) return;
        this.map.delete(key);
        this.onRemove?.(value);
    }

    clear() {
        if (!this.onRemove) {
            this.map.clear();
            return;
        }

        const values = Array.from(this.map.values());
        this.map.clear();
        for (const value of values) {
            this.onRemove(value);
        }
    }

    getKeys(): K[] {
        return Array.from(this.map.keys());
    }
}
