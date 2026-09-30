import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import Manager from './Manager';

vi.mock('../../../components/toast/toast', () => ({ default: vi.fn() }));
vi.mock('../../../lib/globalize', () => ({ default: { translate: (key) => key } }));
vi.mock('../../../scripts/settings/appSettings', () => ({ default: { get: vi.fn(), set: vi.fn() } }));
vi.mock('../../../utils/jellyfin-apiclient/getItems.ts', () => ({ getItems: vi.fn() }));

function createApiClient() {
    return {
        getServerTime: vi.fn(() => new Promise(() => { /* never resolves */ })),
        sendSyncPlayPing: vi.fn()
    };
}

function createPlayerFactory() {
    return {
        getDefaultWrapper: vi.fn(() => ({
            bindToPlayer: vi.fn(),
            unbindFromPlayer: vi.fn()
        }))
    };
}

describe('SyncPlay Manager', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('initializes components and listeners only once', () => {
        const playerFactory = createPlayerFactory();
        const manager = new Manager(playerFactory);
        const apiClient = createApiClient();

        manager.init(apiClient);
        const timeSyncServer = manager.getTimeSyncCore().timeSyncServer;
        manager.init(apiClient);

        expect(playerFactory.getDefaultWrapper).toHaveBeenCalledTimes(1);
        expect(manager.getTimeSyncCore().timeSyncServer).toBe(timeSyncServer);
        expect(manager.getTimeSyncCore()._callbacks['time-sync-server-update']).toHaveLength(1);
    });

    it('switches to a new ApiClient on re-init', () => {
        const manager = new Manager(createPlayerFactory());
        const apiClient = createApiClient();
        const newApiClient = createApiClient();

        manager.init(apiClient);
        manager.init(newApiClient);

        expect(manager.getApiClient()).toBe(newApiClient);
    });

    it('pings the server only while SyncPlay is enabled', () => {
        const manager = new Manager(createPlayerFactory());
        const apiClient = createApiClient();
        manager.init(apiClient);

        vi.advanceTimersByTime(5000);
        expect(apiClient.getServerTime).not.toHaveBeenCalled();

        manager.enableSyncPlay(apiClient, { GroupId: 'group', LastUpdatedAt: new Date() });
        vi.advanceTimersByTime(1000);
        expect(apiClient.getServerTime).toHaveBeenCalledTimes(1);

        manager.disableSyncPlay();
        const timeSyncServer = manager.getTimeSyncCore().timeSyncServer;
        expect(timeSyncServer.pingStop).toBe(true);
        expect(timeSyncServer.poller).toBeNull();

        // A ping still in flight must not schedule a new one
        timeSyncServer.internalRequestPing();
        vi.advanceTimersByTime(120000);
        expect(apiClient.getServerTime).toHaveBeenCalledTimes(1);

        manager.enableSyncPlay(apiClient, { GroupId: 'group', LastUpdatedAt: new Date() });
        vi.advanceTimersByTime(1000);
        expect(apiClient.getServerTime).toHaveBeenCalledTimes(2);
    });
});
