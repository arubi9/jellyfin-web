import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { loadBookLocations, MAX_CACHED_BOOKS, MAX_CACHED_LOCATIONS_LENGTH, saveBookLocations } from './locationsCache';

const LOCATIONS = JSON.stringify(['epubcfi(/6/2!/4/1:0)', 'epubcfi(/6/4!/4/1:0)']);

describe('Book player locations cache', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    afterEach(() => {
        localStorage.clear();
    });

    it('saves and loads the locations of a book', () => {
        expect(loadBookLocations('book', 'v1')).toBeNull();
        expect(saveBookLocations('book', 'v1', LOCATIONS)).toBe(true);
        expect(loadBookLocations('book', 'v1')).toBe(LOCATIONS);
    });

    it('ignores the locations of another version', () => {
        saveBookLocations('book', 'v1', LOCATIONS);
        expect(loadBookLocations('book', 'v2')).toBeNull();
    });

    it('ignores empty and invalid locations', () => {
        saveBookLocations('book', 'v1', '[]');
        expect(loadBookLocations('book', 'v1')).toBeNull();

        localStorage.setItem('bookPlayerLocations-book', '{not json');
        expect(loadBookLocations('book', 'v1')).toBeNull();
    });

    it('does not cache too large locations', () => {
        const locations = JSON.stringify(['x'.repeat(MAX_CACHED_LOCATIONS_LENGTH)]);
        expect(saveBookLocations('book', 'v1', locations)).toBe(false);
        expect(loadBookLocations('book', 'v1')).toBeNull();
    });

    it('only keeps the most recently saved books', () => {
        for (let i = 0; i <= MAX_CACHED_BOOKS; i++) {
            saveBookLocations(`book${i}`, 'v1', LOCATIONS);
        }

        expect(loadBookLocations('book0', 'v1')).toBeNull();
        expect(loadBookLocations('book1', 'v1')).toBe(LOCATIONS);
        expect(loadBookLocations(`book${MAX_CACHED_BOOKS}`, 'v1')).toBe(LOCATIONS);
    });

    it('drops the cache when the storage quota is exceeded', () => {
        saveBookLocations('old', 'v1', LOCATIONS);

        const setItem = Storage.prototype.setItem;
        let calls = 0;
        const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
            if (calls++ === 0) {
                throw new DOMException('Quota exceeded', 'QuotaExceededError');
            }
            setItem.call(this, key, value);
        });
        vi.spyOn(console, 'warn').mockImplementation(() => { /* no-op */ });

        expect(saveBookLocations('book', 'v1', LOCATIONS)).toBe(true);
        spy.mockRestore();

        expect(loadBookLocations('old', 'v1')).toBeNull();
        expect(loadBookLocations('book', 'v1')).toBe(LOCATIONS);
    });

    it('does not throw when the storage is unavailable', () => {
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
            throw new DOMException('Quota exceeded', 'QuotaExceededError');
        });
        vi.spyOn(console, 'warn').mockImplementation(() => { /* no-op */ });

        expect(saveBookLocations('book', 'v1', LOCATIONS)).toBe(false);
    });
});
