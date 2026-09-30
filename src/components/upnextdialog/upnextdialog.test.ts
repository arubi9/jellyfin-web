import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import Events from 'utils/events';

import UpNextDialog from './upnextdialog';

const mocks = vi.hoisted(() => ({
    nextTrack: (() => { /* replaced in tests */ }) as (player: unknown) => void,
    currentTimeMs: 0
}));

vi.mock('../playback/playbackmanager', () => ({
    playbackManager: {
        nextTrack: (player: unknown) => mocks.nextTrack(player),
        duration: () => 60_000 * 10_000,
        currentTime: () => mocks.currentTimeMs
    }
}));
vi.mock('../mediainfo/mediainfo', () => ({ default: { getPrimaryMediaInfoHtml: () => '' } }));
vi.mock('../layoutManager', () => ({ default: {} }));
vi.mock('../focusManager', () => ({ default: { focus: vi.fn() } }));
vi.mock('../../lib/globalize', () => ({ default: { translate: (key: string, ...args: unknown[]) => [key, ...args].join(' ') } }));
vi.mock('lib/jellyfin-apiclient', () => ({
    ServerConnections: {
        getApiClient: () => ({
            getCurrentUser: () => Promise.resolve({ Configuration: { EnableNextEpisodeAutoPlay: true } })
        })
    }
}));
vi.mock('../itemHelper', () => ({ default: { getDisplayName: (item: { Name: string }) => item.Name } }));
vi.mock('./upnextdialog.scss', () => ({}));
vi.mock('../../elements/emby-button/emby-button', () => ({}));
vi.mock('../../styles/flexstyles.scss', () => ({}));

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

describe('UpNextDialog', () => {
    let parent: HTMLElement;
    let nextTrack: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        parent = document.createElement('div');
        document.body.appendChild(parent);
        nextTrack = vi.fn();
        mocks.nextTrack = nextTrack;
        mocks.currentTimeMs = 30_000;
    });

    afterEach(() => {
        vi.useRealTimers();
        parent.remove();
    });

    it('starts the next item immediately, without waiting for the hide animation', async () => {
        const player = {};
        const dialog = new UpNextDialog({ parent, player, nextItem: { Name: 'Next', Type: 'Episode' } });
        await flush();

        const onHide = vi.fn();
        Events.on(dialog, 'hide', onHide);

        parent.querySelector<HTMLButtonElement>('.btnStartNow')?.click();

        // No transitionend has fired (and it may never fire)
        expect(nextTrack).toHaveBeenCalledWith(player);
        expect(parent.classList.contains('upNextDialog-hidden')).toBe(true);
        expect(onHide).not.toHaveBeenCalled();

        // A transition of a child (button) does not complete the hide
        const button = parent.querySelector('.btnHide') as HTMLElement;
        button.dispatchEvent(new Event('transitionend', { bubbles: true }));
        expect(onHide).not.toHaveBeenCalled();
        expect(parent.classList.contains('hide')).toBe(false);

        parent.dispatchEvent(new Event('transitionend'));
        expect(onHide).toHaveBeenCalledTimes(1);
        expect(parent.classList.contains('hide')).toBe(true);

        dialog.destroy();
    });

    it('updates the countdown once per second, only when it changes', async () => {
        vi.useFakeTimers();
        const dialog = new UpNextDialog({ parent, player: {}, nextItem: { Name: 'Next', Type: 'Episode' } });
        await vi.runOnlyPendingTimersAsync();

        const text = parent.querySelector('.upNextDialog-nextVideoText') as HTMLElement;
        expect(text.textContent).toContain('HeaderSecondsValue 30');

        const setter = vi.spyOn(text, 'innerHTML', 'set');

        // Time did not move (e.g. paused): no DOM write
        vi.advanceTimersByTime(1000);
        expect(setter).not.toHaveBeenCalled();

        mocks.currentTimeMs = 31_000;
        vi.advanceTimersByTime(1000);
        expect(setter).toHaveBeenCalledTimes(1);
        expect(text.textContent).toContain('HeaderSecondsValue 29');

        dialog.destroy();
    });
});
