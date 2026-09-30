import escapeHtml from 'escape-html';

import dialogHelper from 'components/dialogHelper/dialogHelper';
import imageLoader from 'components/images/imageLoader';
import { playbackManager } from 'components/playback/playbackmanager';
import globalize from 'lib/globalize';
import { ServerConnections } from 'lib/jellyfin-apiclient';
import { getDisplayDuration } from 'scripts/datetime';
import 'elements/emby-button/paper-icon-button-light';

import './episodesPanel.scss';

const THUMB_WIDTH = 320;

const LOADING_HTML = '<div class="episodesPanel-loading"><span class="material-icons autorenew" aria-hidden="true"></span></div>';

/** The dialog of the panel that is currently open (or opening). */
let openedPanel = null;

function getThumbUrl(apiClient, episode) {
    if (episode.ImageTags?.Primary) {
        return apiClient.getScaledImageUrl(episode.Id, { type: 'Primary', maxWidth: THUMB_WIDTH, tag: episode.ImageTags.Primary });
    }
    if (episode.ParentThumbItemId && episode.ParentThumbImageTag) {
        return apiClient.getScaledImageUrl(episode.ParentThumbItemId, { type: 'Thumb', maxWidth: THUMB_WIDTH, tag: episode.ParentThumbImageTag });
    }
    return null;
}

export function getEpisodeHtml(apiClient, episode, currentId) {
    const thumb = getThumbUrl(apiClient, episode);
    const progress = episode.UserData?.PlayedPercentage;
    const isCurrent = episode.Id === currentId;
    const number = episode.IndexNumber != null ? `${episode.IndexNumber}. ` : '';

    return `<button type="button" class="episodesPanel-episode${isCurrent ? ' episodesPanel-episode-current' : ''}" data-id="${escapeHtml(episode.Id)}"${isCurrent ? ' aria-current="true"' : ''}>
        <div class="episodesPanel-thumb${thumb ? ' lazy' : ''}"${thumb ? ` data-src="${escapeHtml(thumb)}"` : ''}>
            ${progress ? `<div class="episodesPanel-progress" style="width:${Math.min(100, progress)}%"></div>` : ''}
            ${episode.UserData?.Played ? '<span class="material-icons check episodesPanel-played" aria-hidden="true"></span>' : ''}
        </div>
        <div class="episodesPanel-info">
            <div class="episodesPanel-title">${escapeHtml(number + (episode.Name || ''))}</div>
            <div class="episodesPanel-runtime">${episode.RunTimeTicks ? getDisplayDuration(episode.RunTimeTicks) : ''}</div>
            <div class="episodesPanel-overview">${escapeHtml(episode.Overview || '')}</div>
        </div>
    </button>`;
}

async function renderSeason(dlg, apiClient, item, seasonId) {
    const list = dlg.querySelector('.episodesPanel-list');
    list.innerHTML = LOADING_HTML;
    list.setAttribute('aria-busy', 'true');

    // Ignore responses of a previous season selection that arrive after the current one
    const requestId = (dlg.episodesRequestId || 0) + 1;
    dlg.episodesRequestId = requestId;

    const result = await apiClient.getEpisodes(item.SeriesId, {
        SeasonId: seasonId,
        UserId: apiClient.getCurrentUserId(),
        IsMissing: false,
        IsVirtualUnaired: false,
        Fields: 'Overview'
    });

    if (dlg.episodesRequestId !== requestId || !dlg.isConnected) return;

    list.removeAttribute('aria-busy');
    list.innerHTML = result.Items.length ?
        result.Items.map(e => getEpisodeHtml(apiClient, e, item.Id)).join('') :
        `<p>${globalize.translate('MessageNoEpisodesFound')}</p>`;

    // Load the thumbnails when they are scrolled into view, not all at once (the video is buffering)
    imageLoader.lazyChildren(list);

    list.querySelector('.episodesPanel-episode-current')?.scrollIntoView?.({ block: 'center' });
}

function getSeasonOptionsHtml(seasons, item) {
    return seasons.map(s =>
        `<option value="${escapeHtml(s.Id)}"${s.Id === item.SeasonId ? ' selected' : ''}>${escapeHtml(s.Name || '')}</option>`
    ).join('');
}

/**
 * Shows the episodes of the current series in a side panel over the video player.
 * Picking an episode plays it; the rest of the series queues after it as usual.
 * The panel opens immediately and shows a loading state while seasons and episodes are fetched.
 * Resolves when the panel is closed.
 */
export async function showEpisodesPanel(item, player) {
    if (!item?.SeriesId) return;

    // Already open (e.g. double click): don't open a second panel
    if (openedPanel) return openedPanel.opened;

    const apiClient = ServerConnections.getApiClient(item.ServerId);

    const dlg = dialogHelper.createDialog({
        removeOnClose: true,
        scrollY: false,
        entryAnimation: 'fadein',
        entryAnimationDuration: 150
    });
    dlg.classList.add('episodesPanel');

    dlg.innerHTML = `<div class="episodesPanel-header">
            <h2 class="episodesPanel-heading">${escapeHtml(item.SeriesName || globalize.translate('Episodes'))}</h2>
            <button is="paper-icon-button-light" class="btnCloseEpisodes autoSize" title="${globalize.translate('ButtonClose')}" aria-label="${globalize.translate('ButtonClose')}">
                <span class="material-icons close" aria-hidden="true"></span>
            </button>
        </div>
        <select class="episodesPanel-season" aria-label="${globalize.translate('Season')}" hidden></select>
        <div class="episodesPanel-list" aria-busy="true">${LOADING_HTML}</div>`;

    dlg.querySelector('.btnCloseEpisodes').addEventListener('click', () => dialogHelper.close(dlg));
    dlg.querySelector('.episodesPanel-season').addEventListener('change', e => {
        renderSeason(dlg, apiClient, item, e.target.value).catch(err => console.error('[episodesPanel] failed to load episodes', err));
    });
    dlg.querySelector('.episodesPanel-list').addEventListener('click', e => {
        const id = e.target.closest('.episodesPanel-episode')?.dataset.id;
        if (!id) return;
        dialogHelper.close(dlg);
        if (id !== item.Id) {
            playbackManager.play({ ids: [id], serverId: item.ServerId }, player);
        }
    });

    const panel = {
        opened: dialogHelper.open(dlg).finally(() => {
            if (openedPanel === panel) openedPanel = null;
        })
    };
    openedPanel = panel;

    const seasonsRequest = apiClient.getSeasons(item.SeriesId, { UserId: apiClient.getCurrentUserId() })
        .then(result => {
            const seasons = result.Items;
            if (dlg.isConnected) {
                const select = dlg.querySelector('.episodesPanel-season');
                select.innerHTML = getSeasonOptionsHtml(seasons, item);
                select.hidden = seasons.length <= 1;
            }
            return seasons;
        });

    try {
        if (item.SeasonId) {
            // The season is known: load its episodes and the season list in parallel
            await Promise.all([seasonsRequest, renderSeason(dlg, apiClient, item, item.SeasonId)]);
        } else {
            const seasons = await seasonsRequest;
            await renderSeason(dlg, apiClient, item, seasons[0]?.Id);
        }
    } catch (err) {
        // Nothing to show: close the panel, unless the user already did
        if (dlg.isConnected) {
            dialogHelper.close(dlg);
            throw err;
        }
    }

    return panel.opened;
}
