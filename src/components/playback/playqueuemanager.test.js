import { describe, expect, it } from 'vitest';

import PlayQueueManager from './playqueuemanager';

const createItems = (...ids) => ids.map(Id => ({ Id }));
const getIds = items => items.map(i => i.Id);

describe('PlayQueueManager', () => {
    describe('setPlaylist', () => {
        it('resets the shuffle state of the previous queue', () => {
            const manager = new PlayQueueManager();
            manager.setPlaylist(createItems('a', 'b', 'c'));
            manager.setPlaylistIndex(0);
            manager.setShuffleMode('Shuffle');
            expect(manager.getShuffleMode()).toBe('Shuffle');

            manager.setPlaylist(createItems('x', 'y'));
            manager.setPlaylistIndex(0);

            expect(manager.getShuffleMode()).toBe('Sorted');
            expect(manager._sortedPlaylist).toEqual([]);

            // Shuffling and un-shuffling the new queue must not bring back the previous queue
            manager.setShuffleMode('Shuffle');
            manager.setShuffleMode('Sorted');
            expect(getIds(manager.getPlaylist())).toEqual(['x', 'y']);
        });

        it('assigns playlist item ids and resets the repeat mode', () => {
            const manager = new PlayQueueManager();
            manager.setRepeatMode('RepeatAll');

            manager.setPlaylist(createItems('a', 'b'));

            const playlist = manager.getPlaylist();
            expect(playlist.every(i => i.PlaylistItemId)).toBe(true);
            expect(new Set(playlist.map(i => i.PlaylistItemId)).size).toBe(2);
            expect(manager.getRepeatMode()).toBe('RepeatNone');
        });
    });

    describe('removeFromPlaylist', () => {
        it('removes the given items from the queue and the unshuffled queue', () => {
            const manager = new PlayQueueManager();
            manager.setPlaylist(createItems('a', 'b', 'c', 'd'));
            manager.setPlaylistIndex(0);
            manager.setShuffleMode('Shuffle');

            const playlist = manager.getPlaylist();
            const removedIds = playlist.filter(i => i.Id === 'b' || i.Id === 'd').map(i => i.PlaylistItemId);

            const result = manager.removeFromPlaylist(removedIds);

            expect(result).toEqual({ result: 'removed', isCurrentIndex: false });
            expect(getIds(manager.getPlaylist()).sort()).toEqual(['a', 'c']);

            manager.setShuffleMode('Sorted');
            expect(getIds(manager.getPlaylist())).toEqual(['a', 'c']);
        });

        it('reports when the current item is removed', () => {
            const manager = new PlayQueueManager();
            manager.setPlaylist(createItems('a', 'b', 'c'));
            manager.setPlaylistIndex(1);

            const current = manager.getCurrentPlaylistItemId();

            expect(manager.removeFromPlaylist([current])).toEqual({ result: 'removed', isCurrentIndex: true });
            expect(getIds(manager.getPlaylist())).toEqual(['a', 'c']);
        });

        it('reports an empty queue when removing everything', () => {
            const manager = new PlayQueueManager();
            manager.setPlaylist(createItems('a', 'b'));

            const ids = manager.getPlaylist().map(i => i.PlaylistItemId);

            expect(manager.removeFromPlaylist(ids)).toEqual({ result: 'empty' });
        });
    });
});
