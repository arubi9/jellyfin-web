import { describe, expect, it, vi } from 'vitest';

import { UserSettings } from './userSettings';

// Avoid initializing the api client and app globals on import
vi.mock('lib/jellyfin-apiclient', () => ({ ServerConnections: {} }));

const pageSizeFor = (stored: string | null) => {
    const settings = new UserSettings();
    vi.spyOn(settings, 'get').mockReturnValue(stored);
    return settings.libraryPageSize();
};

describe('libraryPageSize', () => {
    it('always paginates, capping at 1000', () => {
        expect(pageSizeFor(null)).toBe(100);
        expect(pageSizeFor('50')).toBe(50);
        expect(pageSizeFor('0')).toBe(1000);
        expect(pageSizeFor('100000')).toBe(1000);
        expect(pageSizeFor('-5')).toBe(100);
    });
});
