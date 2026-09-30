import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getEpisodeHtml, showEpisodesPanel } from './episodesPanel';

const mocks = vi.hoisted(() => ({
    apiClient: {} as Record<string, unknown>,
    lazyChildren: (() => { /* replaced in tests */ }) as (elem: Element) => void,
    closeDialog: undefined as ((dlg: HTMLElement) => void) | undefined
}));

vi.mock('components/dialogHelper/dialogHelper', () => {
    const resolvers = new Map<HTMLElement, () => void>();
    const close = (dlg: HTMLElement) => {
        dlg.remove();
        resolvers.get(dlg)?.();
        resolvers.delete(dlg);
    };
    mocks.closeDialog = close;
    return {
        default: {
            createDialog: () => {
                const dlg = document.createElement('div');
                dlg.classList.add('dialog');
                return dlg;
            },
            open: (dlg: HTMLElement) => {
                document.body.appendChild(dlg);
                dlg.classList.add('opened');
                return new Promise<void>(resolve => resolvers.set(dlg, resolve));
            },
            close
        }
    };
});
vi.mock('components/images/imageLoader', () => ({
    default: { lazyChildren: (elem: Element) => mocks.lazyChildren(elem) }
}));
vi.mock('components/playback/playbackmanager', () => ({ playbackManager: {} }));
vi.mock('lib/jellyfin-apiclient', () => ({ ServerConnections: { getApiClient: () => mocks.apiClient } }));
vi.mock('lib/globalize', () => ({ default: { translate: (key: string) => key } }));
vi.mock('elements/emby-button/paper-icon-button-light', () => ({}));

const apiClient = { getScaledImageUrl: (id: string) => `/Items/${id}/Images/Primary` };

describe('getEpisodeHtml', () => {
    it('escapes episode text and marks the playing episode', () => {
        const episode = {
            Id: 'ep1',
            IndexNumber: 3,
            Name: '<img src=x onerror=alert(1)>',
            Overview: 'a & b',
            RunTimeTicks: 42 * 600000000,
            ImageTags: { Primary: 'tag' },
            UserData: { PlayedPercentage: 40 }
        };

        const current = getEpisodeHtml(apiClient, episode, 'ep1');
        expect(current).not.toContain('<img');
        expect(current).toContain('3. &lt;img');
        expect(current).toContain('a &amp; b');
        expect(current).toContain('42m');
        expect(current).toContain('width:40%');
        expect(current).toContain('aria-current="true"');

        expect(getEpisodeHtml(apiClient, episode, 'other')).not.toContain('aria-current');
    });

    it('lazy loads the thumbnail', () => {
        const withThumb = getEpisodeHtml(apiClient, { Id: 'ep1', ImageTags: { Primary: 'tag' } }, 'ep1');
        expect(withThumb).toContain('episodesPanel-thumb lazy');
        expect(withThumb).toContain('data-src="/Items/ep1/Images/Primary"');
        expect(withThumb).not.toContain('background-image');

        const withoutThumb = getEpisodeHtml(apiClient, { Id: 'ep2' }, 'ep1');
        expect(withoutThumb).not.toContain('lazy');
        expect(withoutThumb).not.toContain('data-src');
    });
});

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(r => {
        resolve = r;
    });
    return { promise, resolve };
}

// Let pending promise callbacks run
const flush = () => new Promise(resolve => setTimeout(resolve, 0));

describe('showEpisodesPanel', () => {
    const item = { Id: 'ep1', SeriesId: 'series', SeasonId: 's1', ServerId: 'server', SeriesName: 'Show' };
    let seasons: ReturnType<typeof deferred<{ Items: { Id: string, Name: string }[] }>>;
    let episodeRequests: { seasonId: string, request: ReturnType<typeof deferred<{ Items: { Id: string, Name: string }[] }>> }[];
    let lazyChildren: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        seasons = deferred();
        episodeRequests = [];
        lazyChildren = vi.fn();
        mocks.lazyChildren = lazyChildren;
        mocks.apiClient = {
            getCurrentUserId: () => 'user',
            getScaledImageUrl: (id: string) => `/Items/${id}/Images/Primary`,
            getSeasons: vi.fn(() => seasons.promise),
            getEpisodes: vi.fn((_seriesId: string, query: { SeasonId: string }) => {
                const request = deferred<{ Items: { Id: string, Name: string }[] }>();
                episodeRequests.push({ seasonId: query.SeasonId, request });
                return request.promise;
            })
        };
    });

    afterEach(() => {
        for (const dlg of document.querySelectorAll<HTMLElement>('.episodesPanel')) {
            mocks.closeDialog?.(dlg);
        }
    });

    it('opens immediately with a loading state and ignores re-entry', async () => {
        const first = showEpisodesPanel(item, {});

        const dlg = document.querySelector('.episodesPanel');
        expect(dlg).not.toBeNull();
        expect(dlg?.querySelector('.episodesPanel-loading')).not.toBeNull();
        expect(dlg?.querySelector('.episodesPanel-list')?.getAttribute('aria-busy')).toBe('true');

        // The known season is loaded in parallel with the season list
        expect(mocks.apiClient.getSeasons).toHaveBeenCalledTimes(1);
        expect(mocks.apiClient.getEpisodes).toHaveBeenCalledTimes(1);

        // Double click: no second panel, no second request
        const second = showEpisodesPanel(item, {});
        expect(document.querySelectorAll('.episodesPanel')).toHaveLength(1);
        expect(mocks.apiClient.getSeasons).toHaveBeenCalledTimes(1);

        seasons.resolve({ Items: [{ Id: 's1', Name: 'Season 1' }, { Id: 's2', Name: 'Season 2' }] });
        episodeRequests[0].request.resolve({ Items: [{ Id: 'ep1', Name: 'Pilot' }] });
        await flush();

        expect(dlg?.querySelector('.episodesPanel-loading')).toBeNull();
        expect(dlg?.querySelector('.episodesPanel-list')?.hasAttribute('aria-busy')).toBe(false);
        expect(dlg?.querySelector('.episodesPanel-episode-current')?.textContent).toContain('Pilot');
        expect(lazyChildren).toHaveBeenCalledTimes(1);

        const select = dlg?.querySelector<HTMLSelectElement>('.episodesPanel-season');
        expect(select?.hidden).toBe(false);
        expect(select?.value).toBe('s1');

        mocks.closeDialog?.(dlg as HTMLElement);
        await Promise.all([first, second]);

        // Can be opened again once closed
        const third = showEpisodesPanel(item, {});
        expect(document.querySelectorAll('.episodesPanel')).toHaveLength(1);
        mocks.closeDialog?.(document.querySelector('.episodesPanel') as HTMLElement);
        seasons.resolve({ Items: [] });
        episodeRequests[1].request.resolve({ Items: [] });
        await third;
    });

    it('ignores a season response that arrives after a newer one', async () => {
        const opened = showEpisodesPanel(item, {});
        const dlg = document.querySelector('.episodesPanel') as HTMLElement;

        seasons.resolve({ Items: [{ Id: 's1', Name: 'Season 1' }, { Id: 's2', Name: 'Season 2' }] });
        await flush();

        // Switch to season 2 while season 1 is still loading
        const select = dlg.querySelector('.episodesPanel-season') as HTMLSelectElement;
        select.value = 's2';
        select.dispatchEvent(new Event('change'));
        expect(episodeRequests.map(r => r.seasonId)).toEqual(['s1', 's2']);

        episodeRequests[1].request.resolve({ Items: [{ Id: 'ep20', Name: 'Season 2 episode' }] });
        await flush();
        episodeRequests[0].request.resolve({ Items: [{ Id: 'ep1', Name: 'Season 1 episode' }] });
        await flush();

        const titles = [...dlg.querySelectorAll('.episodesPanel-title')].map(e => e.textContent);
        expect(titles).toEqual(['Season 2 episode']);

        mocks.closeDialog?.(dlg);
        await opened;
    });

    it('closes the panel when loading fails', async () => {
        mocks.apiClient.getEpisodes = vi.fn(() => Promise.reject(new Error('network')));

        const opened = showEpisodesPanel(item, {});
        expect(document.querySelector('.episodesPanel')).not.toBeNull();
        seasons.resolve({ Items: [] });

        await expect(opened).rejects.toThrow('network');
        expect(document.querySelector('.episodesPanel')).toBeNull();

        // The re-entry guard is released
        mocks.apiClient.getEpisodes = vi.fn(() => Promise.resolve({ Items: [] }));
        const again = showEpisodesPanel(item, {});
        expect(document.querySelector('.episodesPanel')).not.toBeNull();
        mocks.closeDialog?.(document.querySelector('.episodesPanel') as HTMLElement);
        await again;
    });
});
