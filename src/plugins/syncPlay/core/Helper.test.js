import { afterEach, describe, expect, it, vi } from 'vitest';

import Events from '../../../utils/events.ts';
import { waitForEventOnce } from './Helper';

vi.mock('../../../utils/jellyfin-apiclient/getItems.ts', () => ({ getItems: vi.fn() }));

describe('SyncPlay Helper: waitForEventOnce', () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    it('resolves on event and removes its listeners', async () => {
        const emitter = {};
        const promise = waitForEventOnce(emitter, 'ready', 1000, ['error']);

        Events.trigger(emitter, 'ready');
        await promise;

        expect(emitter._callbacks.ready).toHaveLength(0);
        expect(emitter._callbacks.error).toHaveLength(0);
    });

    it('removes its listeners when timing out', async () => {
        vi.useFakeTimers();
        const emitter = {};
        const promise = waitForEventOnce(emitter, 'ready', 1000, ['error']);

        vi.advanceTimersByTime(1000);

        await expect(promise).rejects.toThrow('Timed out.');
        expect(emitter._callbacks.ready).toHaveLength(0);
        expect(emitter._callbacks.error).toHaveLength(0);
    });
});
