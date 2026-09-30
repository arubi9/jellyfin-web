import { getLyricApi } from '@jellyfin/sdk/lib/utils/api/lyric-api';
import escapeHtml from 'escape-html';

import { AutoScroll } from 'apps/legacy/features/lyrics/constants/autoScroll';
import autoFocuser from 'components/autoFocuser';
import { appRouter } from 'components/router/appRouter';
import layoutManager from 'components/layoutManager';
import { playbackManager } from 'components/playback/playbackmanager';
import scrollManager from 'components/scrollManager';
import focusManager from 'components/focusManager';
import globalize from 'lib/globalize';
import { ServerConnections } from 'lib/jellyfin-apiclient';
import keyboardNavigation from 'scripts/keyboardNavigation';
import LibraryMenu from 'scripts/libraryMenu';
import Events from 'utils/events';

import 'styles/lyrics.scss';

let currentPlayer;
let currentItem;

let savedLyrics;
let isDynamicLyric = false;
let autoScroll = AutoScroll.Instant;

function lyricHtmlReducer(htmlAccumulator, lyric, index) {
    const elem = layoutManager.tv ? 'button' : 'div';
    const classes = [];
    if (isDynamicLyric) classes.push('dynamicLyric');
    if (layoutManager.tv) classes.push('listItem', 'show-focus');
    const lyricTime = typeof lyric.Start !== 'undefined' ? `data-lyrictime="${lyric.Start}"` : '';

    htmlAccumulator += `<${elem} class="lyricsLine ${classes.join(' ')}" id="lyricPosition${index}" ${lyricTime}>
    ${escapeHtml(lyric.Text)}
</${elem}>`;

    return htmlAccumulator;
}

function getLyricIndex(time, lyrics) {
    return lyrics.findLastIndex(lyric => lyric.Start <= time);
}

function getCurrentPlayTime() {
    let currentTime = playbackManager.currentTime();
    if (currentTime === undefined) currentTime = 0;
    //convert to ticks
    return currentTime * 10000;
}

export default function (view) {
    /** Lyric line elements of the rendered lyrics, indexed by line. */
    let lyricLineElements = [];
    /** Index of the current lyric line, undefined if the lines were never updated. */
    let currentLyricIndex;

    function setPastLyricClassOnLine(line) {
        const lyric = lyricLineElements[line];
        if (lyric) {
            lyric.classList.remove('futureLyric');
            lyric.classList.add('pastLyric');
        }
    }

    function setFutureLyricClassOnLine(line) {
        const lyric = lyricLineElements[line];
        if (lyric) {
            lyric.classList.remove('pastLyric');
            lyric.classList.add('futureLyric');
        }
    }

    function setCurrentLyricClassOnLine(line) {
        const lyric = lyricLineElements[line];
        if (lyric) {
            lyric.classList.remove('pastLyric');
            lyric.classList.remove('futureLyric');
            if (autoScroll !== AutoScroll.NoScroll) {
                // instant scroll is used when the view is first loaded
                scrollManager.scrollToElement(lyric, autoScroll === AutoScroll.Smooth);
                focusManager.focus(lyric);
                autoScroll = AutoScroll.Smooth;
            }
        }
    }

    function updateAllLyricLines(currentLine) {
        if (currentLine === currentLyricIndex) return;

        // Only update the lines whose state changed since the last update (the setters ignore out-of-range lines)
        const [from, to] = currentLyricIndex === undefined ?
            [0, lyricLineElements.length - 1] :
            [Math.min(currentLyricIndex, currentLine), Math.max(currentLyricIndex, currentLine)];
        currentLyricIndex = currentLine;

        for (let lyricIndex = from; lyricIndex <= to; lyricIndex++) {
            if (lyricIndex < currentLine) {
                setPastLyricClassOnLine(lyricIndex);
            } else if (lyricIndex === currentLine) {
                setCurrentLyricClassOnLine(lyricIndex);
            } else if (lyricIndex > currentLine) {
                setFutureLyricClassOnLine(lyricIndex);
            }
        }
    }

    function renderNoLyricMessage() {
        const itemsContainer = view.querySelector('.lyricsContainer');
        if (itemsContainer) {
            const html = `<h1>${globalize.translate('HeaderNoLyrics')}</h1>`;
            itemsContainer.innerHTML = html;
        }
        autoFocuser.autoFocus();
    }

    function resetLyricLines() {
        lyricLineElements = [];
        currentLyricIndex = undefined;
    }

    function renderLyrics(lyrics) {
        resetLyricLines();

        const itemsContainer = view.querySelector('.lyricsContainer');
        if (itemsContainer) {
            const html = lyrics.reduce(lyricHtmlReducer, '');
            itemsContainer.innerHTML = html;
        }

        if (isDynamicLyric) {
            const lyricLineArray = itemsContainer.querySelectorAll('.lyricsLine');
            lyricLineElements = Array.from(lyricLineArray);

            // attaches click event listener to change playtime to lyric start
            lyricLineArray.forEach(element => {
                element.addEventListener('click', () => onLyricClick(element.getAttribute('data-lyrictime')));
            });

            const currentIndex = getLyricIndex(getCurrentPlayTime(), lyrics);
            updateAllLyricLines(currentIndex);
        }
    }

    function updateLyrics(lyrics) {
        savedLyrics = lyrics;

        isDynamicLyric = Object.prototype.hasOwnProperty.call(lyrics[0], 'Start');

        renderLyrics(savedLyrics);

        autoFocuser.autoFocus(view);
    }

    function getLyrics(serverId, itemId) {
        const api = ServerConnections.getApi(serverId);
        if (!api) {
            console.error('[Lyrics] no Api instance available for server', serverId);
            return;
        }

        return getLyricApi(api).getLyrics({ itemId })
            .then(({ data }) => {
                if (!data.Lyrics?.length) {
                    throw new Error('No lyrics returned');
                }
                return data.Lyrics;
            });
    }

    function bindToPlayer(player) {
        if (player === currentPlayer) {
            return;
        }

        releaseCurrentPlayer();

        currentPlayer = player;

        if (!player) {
            return;
        }

        Events.on(player, 'timeupdate', onTimeUpdate);
        Events.on(player, 'playbackstart', onPlaybackStart);
        Events.on(player, 'playbackstop', onPlaybackStop);
    }

    function releaseCurrentPlayer() {
        const player = currentPlayer;

        if (player) {
            Events.off(player, 'timeupdate', onTimeUpdate);
            Events.off(player, 'playbackstart', onPlaybackStart);
            Events.off(player, 'playbackstop', onPlaybackStop);
            currentPlayer = null;
        }
    }

    function onLyricClick(lyricTime) {
        autoScroll = AutoScroll.Smooth;
        // Force a full update (and scroll) on the next time update, even if the clicked line is the current one
        currentLyricIndex = undefined;
        playbackManager.seek(lyricTime);
        if (playbackManager.paused()) {
            playbackManager.playPause(currentPlayer);
        }
    }

    function onTimeUpdate() {
        if (isDynamicLyric) {
            const currentIndex = getLyricIndex(getCurrentPlayTime(), savedLyrics);
            updateAllLyricLines(currentIndex);
        }
    }

    function onPlaybackStart(event, state) {
        if (currentItem.Id !== state.NowPlayingItem.Id) {
            onLoad();
        }
    }

    function onPlaybackStop(_, state) {
        // TODO: switch to appRouter.back(), with fix to navigation to /#/queue. Which is broken when it has nothing playing
        if (!state.NextMediaType) {
            appRouter.goHome();
        }
    }

    function onPlayerChange() {
        const player = playbackManager.getCurrentPlayer();
        bindToPlayer(player);
    }

    function onLoad() {
        savedLyrics = null;
        currentItem = null;
        isDynamicLyric = false;
        resetLyricLines();

        LibraryMenu.setTitle(globalize.translate('Lyrics'));

        const player = playbackManager.getCurrentPlayer();

        if (player) {
            bindToPlayer(player);

            const state = playbackManager.getPlayerState(player);
            currentItem = state.NowPlayingItem;

            const serverId = state.NowPlayingItem.ServerId;
            const itemId = state.NowPlayingItem.Id;

            getLyrics(serverId, itemId).then(updateLyrics).catch(renderNoLyricMessage);
        } else {
            // if nothing is currently playing, no lyrics to display redirect to home
            appRouter.goHome();
        }
    }

    function onWheelOrTouchMove() {
        autoScroll = AutoScroll.NoScroll;
    }

    function onKeyDown(e) {
        const key = keyboardNavigation.getKeyName(e);
        if (key === 'ArrowUp' || key === 'ArrowDown') {
            autoScroll = AutoScroll.NoScroll;
        }
    }

    view.addEventListener('viewshow', function () {
        Events.on(playbackManager, 'playerchange', onPlayerChange);
        autoScroll = AutoScroll.Instant;
        document.addEventListener('wheel', onWheelOrTouchMove);
        document.addEventListener('touchmove', onWheelOrTouchMove);
        document.addEventListener('keydown', onKeyDown);
        try {
            onLoad();
        } catch {
            appRouter.goHome();
        }
    });

    view.addEventListener('viewbeforehide', function () {
        Events.off(playbackManager, 'playerchange', onPlayerChange);
        document.removeEventListener('wheel', onWheelOrTouchMove);
        document.removeEventListener('touchmove', onWheelOrTouchMove);
        document.removeEventListener('keydown', onKeyDown);
        releaseCurrentPlayer();
    });
}
