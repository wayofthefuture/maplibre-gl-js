/**
 * A way to identify a feature, either by string or by number
 */
export type GeoJSONFeatureId = number | string;

/**
 * The geojson source diff object - processed in the following order: remove, add, update.
 */
export type GeoJSONSourceDiff = {
    /**
     * When set to `true` it will remove all features
     */
    removeAll?: boolean;
    /**
     * An array of features IDs to remove
     */
    remove?: Array<GeoJSONFeatureId>;
    /**
     * An array of features to add
     */
    add?: Array<GeoJSON.Feature>;
    /**
     * An array of update objects
     */
    update?: Array<GeoJSONFeatureDiff>;
};

/**
 * A geojson feature diff object - processed in the following order: new geometry, remove properties, add/update properties.
 */
export type GeoJSONFeatureDiff = {
    /**
     * The feature ID
     */
    id: GeoJSONFeatureId;
    /**
     * If it's a new geometry, place it here
     */
    newGeometry?: GeoJSON.Geometry;
    /**
     * Setting to `true` will remove all preperties
     */
    removeAllProperties?: boolean;
    /**
     * The properties keys to remove
     */
    removeProperties?: Array<string>;
    /**
     * The properties to add or update along side their values
     */
    addOrUpdateProperties?: Array<{key: string; value: any}>;
};

export type UpdateableGeoJSON = GeoJSON.Feature | GeoJSON.FeatureCollection | undefined;

function getFeatureId(feature: GeoJSON.Feature, promoteId?: string): GeoJSONFeatureId | undefined {
    return promoteId ? feature.properties[promoteId] : feature.id;
}

export function isUpdateableGeoJSON(data: GeoJSON.GeoJSON | undefined, promoteId?: string): data is UpdateableGeoJSON {
    // null can be updated
    if (data == null) {
        return true;
    }

    // a single feature with an id can be updated, need to explicitly check against null because 0 is a valid feature id that is falsy
    if (data.type === 'Feature') {
        return getFeatureId(data, promoteId) != null;
    }

    // a feature collection can be updated if every feature has an id, and the ids are all unique
    // this prevents us from silently dropping features if ids get reused
    if (data.type === 'FeatureCollection') {
        const seenIds = new Set<GeoJSONFeatureId>();
        for (const feature of data.features) {
            const id = getFeatureId(feature, promoteId);
            if (id == null) {
                return false;
            }

            if (seenIds.has(id)) {
                return false;
            }

            seenIds.add(id);
        }

        return true;
    }

    return false;
}

export function toUpdateable(data: UpdateableGeoJSON, promoteId?: string) {
    const result = new Map<GeoJSONFeatureId, GeoJSON.Feature>();
    if (data == null) {
        // empty result
    } else if (data.type === 'Feature') {
        result.set(getFeatureId(data, promoteId)!, data);
    } else {
        for (const feature of data.features) {
            result.set(getFeatureId(feature, promoteId)!, feature);
        }
    }

    return result;
}

// mutates updateable
export function applySourceDiff(updateable: Map<GeoJSONFeatureId, GeoJSON.Feature>, diff: GeoJSONSourceDiff, promoteId?: string): void {
    if (diff.removeAll) {
        updateable.clear();
    }

    if (diff.remove) {
        for (const id of diff.remove) {
            updateable.delete(id);
        }
    }

    if (diff.add) {
        for (const feature of diff.add) {
            const id = getFeatureId(feature, promoteId);

            if (id != null) {
                updateable.set(id, feature);
            }
        }
    }

    if (diff.update) {
        for (const update of diff.update) {
            let feature = updateable.get(update.id);
            if (!feature) continue;

            const changeGeometry = !!update.newGeometry;

            const changeProps =
                update.removeAllProperties ||
                update.removeProperties?.length > 0 ||
                update.addOrUpdateProperties?.length > 0;

            // nothing to do
            if (!changeGeometry && !changeProps) continue;

            // clone once since we'll mutate
            feature = {...feature};
            updateable.set(update.id, feature);

            if (changeGeometry) {
                feature.geometry = update.newGeometry;
            }

            if (changeProps) {
                if (update.removeAllProperties) {
                    feature.properties = {};
                } else {
                    feature.properties = {...feature.properties || {}};
                }

                if (update.removeProperties) {
                    for (const key of update.removeProperties) {
                        delete feature.properties[key];
                    }
                }

                if (update.addOrUpdateProperties) {
                    for (const {key, value} of update.addOrUpdateProperties) {
                        feature.properties[key] = value;
                    }
                }
            }
        }
    }
}

export function mergeSourceDiffs(
    prevDiff: GeoJSONSourceDiff | undefined,
    nextDiff: GeoJSONSourceDiff | undefined
): GeoJSONSourceDiff {
    if (!prevDiff) return nextDiff || {};
    if (!nextDiff) return prevDiff || {};

    // Hash for o(1) lookups while creating a mutatable copy of the collections
    const prev = diffToHashed(prevDiff);
    const next = diffToHashed(nextDiff);

    // Resolve merge conflict - removing all features with added or updated features in previous
    if (next.removeAll) {
        prev.add.clear();
        prev.update.clear();
    }

    // Resolve merge conflict - removing features that were added or updated in previous
    for (const id of next.remove) {
        prev.add.delete(id);
        prev.update.delete(id);
    }

    // Resolve merge conflict - updating features that were updated in previous
    for (const [id, nextUpdate] of next.update) {
        const prevUpdate = prev.update.get(id);
        if (!prevUpdate) continue;

        next.update.set(id, mergeFeatureDiffs(prevUpdate, nextUpdate));
        prev.update.delete(id);
    }

    const merged: GeoJSONSourceDiffHashed = {};

    merged.removeAll = prev.removeAll || next.removeAll;
    merged.remove = new Set([...prev.remove , ...next.remove]);
    merged.add    = new Map([...prev.add    , ...next.add]);
    merged.update = new Map([...prev.update , ...next.update]);

    // Resolve merge conflict - removing and adding the same feature
    if (merged.remove.size && merged.add.size) {
        for (const id of merged.add.keys()) {
            merged.remove.delete(id);
        }
    }

    return hashedToDiff(merged);
}

/**
 * Merge two feature diffs for the same feature ID.
 */
function mergeFeatureDiffs(prev: GeoJSONFeatureDiff, next: GeoJSONFeatureDiff): GeoJSONFeatureDiff {
    const merged: GeoJSONFeatureDiff = {...prev};

    if (next.newGeometry) {
        merged.newGeometry = next.newGeometry;
    }
    if (next.addOrUpdateProperties) {
        (merged.addOrUpdateProperties ??= []).push(...next.addOrUpdateProperties);
    }
    if (next.removeProperties) {
        (merged.removeProperties ??= []).push(...next.removeProperties);
    }
    if (next.removeAllProperties) {
        merged.removeAllProperties = true;
    }

    return merged;
}

/**
 * @internal
 * Internal representation of GeoJSONSourceDiff using Sets and Maps for efficient operations
 */
type GeoJSONSourceDiffHashed = {
    removeAll?: boolean;
    remove?: Set<GeoJSONFeatureId>;
    add?: Map<GeoJSONFeatureId, GeoJSON.Feature>;
    update?: Map<GeoJSONFeatureId, GeoJSONFeatureDiff>;
};

/**
 * @internal
 * Convert a GeoJSONSourceDiff to an idempotent hashed representation using Sets and Maps
 */
function diffToHashed(diff: GeoJSONSourceDiff | undefined): GeoJSONSourceDiffHashed {
    if (!diff) return {};

    const hashed: GeoJSONSourceDiffHashed = {};

    hashed.removeAll = diff.removeAll;
    hashed.remove = new Set(diff.remove || []);
    hashed.add    = new Map(diff.add?.map(feature => [feature.id!, feature]));
    hashed.update = new Map(diff.update?.map(update => [update.id, update]));

    return hashed;
}

/**
 * @internal
 * Convert a hashed GeoJSONSourceDiff back to the array-based representation
 */
function hashedToDiff(hashed: GeoJSONSourceDiffHashed): GeoJSONSourceDiff {
    const diff: GeoJSONSourceDiff = {};

    if (hashed.removeAll) {
        diff.removeAll = hashed.removeAll;
    }
    if (hashed.remove?.size) {
        diff.remove = Array.from(hashed.remove);
    }
    if (hashed.add?.size) {
        diff.add = Array.from(hashed.add.values());
    }
    if (hashed.update?.size) {
        diff.update = Array.from(hashed.update.values());
    }

    return diff;
}
