/**
 * Cache of the generated epub.js locations of books, stored in the localStorage.
 * Generating the locations requires parsing every chapter of the book, so it is only done once per book.
 */

const KEY_PREFIX = 'bookPlayerLocations-';
const INDEX_KEY = 'bookPlayerLocationsIndex';
/** Maximum number of books with cached locations. */
export const MAX_CACHED_BOOKS = 10;
/** Maximum size of the cached locations of a book, in characters. */
export const MAX_CACHED_LOCATIONS_LENGTH = 500000;

interface CachedLocations {
    version: string;
    locations: string;
}

function getStorage(): Storage | null {
    try {
        return window.localStorage;
    } catch {
        return null;
    }
}

function getIndex(storage: Storage): string[] {
    try {
        const index = JSON.parse(storage.getItem(INDEX_KEY) || '[]');
        return Array.isArray(index) ? index.filter(id => typeof id === 'string') : [];
    } catch {
        return [];
    }
}

function clearAll(storage: Storage) {
    for (const itemId of getIndex(storage)) {
        storage.removeItem(KEY_PREFIX + itemId);
    }
    storage.removeItem(INDEX_KEY);
}

/**
 * Gets the cached locations of a book.
 * @param itemId The id of the book.
 * @param version Identifies the book file and the location generation options, cached locations of another version are ignored.
 * @returns The locations, as saved by `Locations.save()`, or `null` if not cached.
 */
export function loadBookLocations(itemId: string, version: string): string | null {
    const storage = getStorage();
    if (!storage || !itemId) return null;

    try {
        const cached: CachedLocations | null = JSON.parse(storage.getItem(KEY_PREFIX + itemId) || 'null');
        if (cached?.version !== version || typeof cached.locations !== 'string') {
            return null;
        }

        const locations = JSON.parse(cached.locations);
        return Array.isArray(locations) && locations.length ? cached.locations : null;
    } catch {
        return null;
    }
}

/**
 * Caches the locations of a book. Only the most recently saved books are kept.
 * @param itemId The id of the book.
 * @param version Identifies the book file and the location generation options.
 * @param locations The locations, as returned by `Locations.save()`.
 * @returns Whether the locations were cached.
 */
export function saveBookLocations(itemId: string, version: string, locations: string): boolean {
    const storage = getStorage();
    if (!storage || !itemId || !locations || locations.length > MAX_CACHED_LOCATIONS_LENGTH) {
        return false;
    }

    const value = JSON.stringify({ version, locations } as CachedLocations);

    const write = () => {
        const index = getIndex(storage).filter(id => id !== itemId);
        index.unshift(itemId);

        for (const evictedId of index.splice(MAX_CACHED_BOOKS)) {
            storage.removeItem(KEY_PREFIX + evictedId);
        }

        storage.setItem(KEY_PREFIX + itemId, value);
        storage.setItem(INDEX_KEY, JSON.stringify(index));
    };

    try {
        write();
        return true;
    } catch (err) {
        // Most likely the storage quota is exceeded, drop the cached locations and try once more
        console.warn('[BookPlayer] failed to cache book locations', err);
        try {
            clearAll(storage);
            write();
            return true;
        } catch {
            try {
                clearAll(storage);
            } catch {
                // Ignore
            }
            return false;
        }
    }
}
