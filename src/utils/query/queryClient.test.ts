import type { PersistedClient } from '@tanstack/react-query-persist-client';
import { set } from 'idb-keyval';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { persister } from './queryClient';

vi.mock('idb-keyval', () => ({
    get: vi.fn(),
    set: vi.fn(() => Promise.resolve()),
    del: vi.fn(() => Promise.resolve())
}));

const client = (timestamp: number) => ({ timestamp }) as unknown as PersistedClient;

describe('query cache persister', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('throttles cache writes and keeps the latest state', async () => {
        for (let i = 1; i <= 50; i++) {
            await persister.persistClient(client(i));
        }
        vi.advanceTimersByTime(1000);

        expect(set).toHaveBeenCalledTimes(2);
        expect(set).toHaveBeenLastCalledWith('jellyfin-query-cache', client(50));
    });
});
