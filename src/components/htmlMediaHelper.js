import appSettings from '../scripts/settings/appSettings' ;
import browser from '../scripts/browser';
import Events from '../utils/events.ts';
import { MediaError } from 'types/mediaError';

export function getSavedVolume() {
    return appSettings.get('volume') || 1;
}

export function saveVolume(value) {
    if (value) {
        appSettings.set('volume', value);
    }
}

export function getCrossOriginValue(mediaSource) {
    if (mediaSource.IsRemote) {
        return null;
    }

    return 'anonymous';
}

let _canPlayNativeHls;
function canPlayNativeHls() {
    // canPlayType results do not change during a session
    if (_canPlayNativeHls == null) {
        const media = document.createElement('video');

        _canPlayNativeHls = !!(media.canPlayType('application/x-mpegURL').replace(/no/, '')
                || media.canPlayType('application/vnd.apple.mpegURL').replace(/no/, ''));
    }

    return _canPlayNativeHls;
}

let hlsJsPromise;
/**
 * Loads hls.js (once) and applies the default configuration.
 * @returns {Promise<any>} Promise resolving to the hls.js class.
 */
export function loadHlsJs() {
    if (!hlsJsPromise) {
        hlsJsPromise = import('hls.js/dist/hls.js').then(({ default: hls }) => {
            hls.DefaultConfig.lowLatencyMode = false;
            // A finite back buffer lets hls.js evict played media before the MSE quota is hit
            hls.DefaultConfig.backBufferLength = (browser.tv || browser.slow) ? 30 : 90;
            hls.DefaultConfig.liveBackBufferLength = 90;
            window.Hls = hls;
            return hls;
        }, (err) => {
            // Allow a retry on the next playback
            hlsJsPromise = null;
            throw err;
        });
    }

    return hlsJsPromise;
}

const UNIVERSAL_AUDIO_URL_REGEX = /\/audio\/[^/]+\/universal(\.[^/]*)?$/i;
const PROGRESSIVE_AUDIO_URL_REGEX = /\/audio\/[^/]+\/stream(\.[^/]*)?$/i;

/**
 * Decides from the URL alone whether a stream is HLS.
 * @param {string} url - The stream url.
 * @returns {boolean|null} _true_ if HLS, _false_ if not HLS, _null_ if the server decides at request time.
 */
export function isHlsStreamUrl(url) {
    if (!url) {
        return null;
    }

    if (url.indexOf('.m3u8') !== -1) {
        return true;
    }

    const [path, query = ''] = url.split('#')[0].split('?');

    // /Audio/{id}/stream is always a progressive (non HLS) response
    if (PROGRESSIVE_AUDIO_URL_REGEX.test(path)) {
        return false;
    }

    if (UNIVERSAL_AUDIO_URL_REGEX.test(path)) {
        const protocolParam = query.split('&').find(p => p.toLowerCase().startsWith('transcodingprotocol='));
        const protocol = protocolParam ? decodeURIComponent(protocolParam.split('=')[1] || '').toLowerCase() : '';

        // The universal endpoint only answers with HLS when transcoding over HLS.
        // With an explicit non-HLS protocol it is always a progressive response.
        // Otherwise the server decides between direct stream and HLS transcode (needs a HEAD request).
        if (protocol && protocol !== 'hls') {
            return false;
        }
    }

    return null;
}

export function enableHlsJsPlayerForCodecs(mediaSource, mediaType) {
    // Workaround for VP9 HLS support on desktop Safari
    // Force using HLS.js because desktop Safari's native HLS player does not play VP9 over HLS
    // browser.osx will return true on iPad, cannot use
    if (!browser.iOS && browser.safari && mediaSource.MediaStreams.some(x => x.Codec === 'vp9')) {
        return true;
    }
    return enableHlsJsPlayer(mediaSource.RunTimeTicks, mediaType);
}

export function enableHlsJsPlayer(runTimeTicks, mediaType) {
    if (window.MediaSource == null) {
        return false;
    }

    // hls.js is only in beta. needs more testing.
    if (browser.iOS) {
        return false;
    }

    // The native players on these devices support seeking live streams, no need to use hls.js here
    if (browser.tizen || browser.web0s) {
        return false;
    }

    if (canPlayNativeHls()) {
        // Android Webview's native HLS has performance and compatiblity issues
        if (browser.android && (mediaType === 'Audio' || mediaType === 'Video')) {
            return true;
        }

        // Chromium 141+ brings native HLS support that does not support switching HDR/SDR playlists.
        // Always use hls.js to avoid falling back to transcoding from remuxing and client side tone-mapping.
        if (browser.chrome || browser.edgeChromium || browser.opera) {
            return true;
        }

        // simple playback should use the native support
        if (runTimeTicks) {
            return false;
        }
    }

    return true;
}

let recoverDecodingErrorDate;
let recoverSwapAudioCodecDate;
export function handleHlsJsMediaError(instance, reject) {
    const hlsPlayer = instance._hlsPlayer;

    if (!hlsPlayer) {
        return;
    }

    let now = Date.now();

    if (window.performance?.now) {
        now = performance.now();
    }

    if (!recoverDecodingErrorDate || (now - recoverDecodingErrorDate) > 3000) {
        recoverDecodingErrorDate = now;
        console.debug('try to recover media Error ...');
        hlsPlayer.recoverMediaError();
    } else if (!recoverSwapAudioCodecDate || (now - recoverSwapAudioCodecDate) > 3000) {
        recoverSwapAudioCodecDate = now;
        console.debug('try to swap Audio Codec and recover media Error ...');
        hlsPlayer.swapAudioCodec();
        hlsPlayer.recoverMediaError();
    } else {
        console.error('cannot recover, last media error recovery failed ...');

        if (reject) {
            reject();
        } else {
            onErrorInternal(instance, MediaError.FATAL_HLS_ERROR);
        }
    }
}

export function onErrorInternal(instance, type) {
    // Needed for video
    if (instance.destroyCustomTrack) {
        instance.destroyCustomTrack(instance._mediaElement);
    }

    Events.trigger(instance, 'error', [{ type }]);
}

export function isValidDuration(duration) {
    return duration
            && !isNaN(duration)
            && duration !== Number.POSITIVE_INFINITY
            && duration !== Number.NEGATIVE_INFINITY;
}

const pendingSeekCleanups = new WeakMap();

/**
 * Removes the listeners registered by seekOnPlaybackStart that are still waiting for the media to be ready.
 * @param {HTMLMediaElement} element - The media element.
 */
export function cancelSeekOnPlaybackStart(element) {
    pendingSeekCleanups.get(element)?.();
}

function setCurrentTimeIfNeeded(element, seconds) {
    // If it's worth skipping (1 sec or less of a difference)
    if (Math.abs((element.currentTime || 0) - seconds) >= 1) {
        element.currentTime = seconds;
    }
}

export function seekOnPlaybackStart(instance, element, ticks, onMediaReady) {
    const seconds = (ticks || 0) / 10000000;

    // Never let listeners of a previous playback seek this one
    cancelSeekOnPlaybackStart(element);

    if (seconds) {
        // Appending #t=xxx to the query string doesn't seem to work with HLS
        // For plain video files, not all browsers support it either

        if (element.duration >= seconds) {
            // media is ready, seek immediately
            setCurrentTimeIfNeeded(element, seconds);
            if (onMediaReady) onMediaReady();
        } else {
            // update video player position when media is ready to be sought
            const events = ['durationchange', 'loadeddata', 'play', 'loadedmetadata'];
            const removeListeners = function () {
                events.forEach(name => {
                    element.removeEventListener(name, onMediaChange);
                });
                if (pendingSeekCleanups.get(element) === removeListeners) {
                    pendingSeekCleanups.delete(element);
                }
            };
            const onMediaChange = function(e) {
                if (element.currentTime === 0 && element.duration >= seconds) {
                    // seek only when video position is exactly zero,
                    // as this is true only if video hasn't started yet or
                    // user rewound to the very beginning
                    // (but rewinding cannot happen as the first event with media of non-empty duration)
                    console.debug(`seeking to ${seconds} on ${e.type} event`);
                    setCurrentTimeIfNeeded(element, seconds);
                    removeListeners();
                    if (onMediaReady) onMediaReady();
                }
            };
            events.forEach(name => {
                element.addEventListener(name, onMediaChange);
            });
            pendingSeekCleanups.set(element, removeListeners);
        }
    }
}

export function applySrc(elem, src, options) {
    if (window.Windows && options.mediaSource?.IsLocal) {
        return Windows.Storage.StorageFile.getFileFromPathAsync(options.url).then(function (file) {
            const playlist = new Windows.Media.Playback.MediaPlaybackList();

            const source1 = Windows.Media.Core.MediaSource.createFromStorageFile(file);
            const startTime = (options.playerStartPositionTicks || 0) / 10000;
            playlist.items.append(new Windows.Media.Playback.MediaPlaybackItem(source1, startTime));
            elem.src = URL.createObjectURL(playlist, { oneTimeOnly: true });
            return Promise.resolve();
        });
    } else {
        elem.src = src;
    }

    return Promise.resolve();
}

export function resetSrc(elem) {
    elem.src = '';
    elem.innerHTML = '';
    elem.removeAttribute('src');
}

function onSuccessfulPlay(elem, onErrorFn) {
    elem.addEventListener('error', onErrorFn);
}

export function playWithPromise(elem, onErrorFn) {
    try {
        return elem.play()
            .catch((e) => {
                const errorName = (e.name || '').toLowerCase();
                // safari uses aborterror
                if (errorName === 'notallowederror'
                        || errorName === 'aborterror') {
                    // swallow this error because the user can still click the play button on the video element
                    return Promise.resolve();
                }
                return Promise.reject(e);
            })
            .then(() => {
                onSuccessfulPlay(elem, onErrorFn);
                return Promise.resolve();
            });
    } catch (err) {
        console.error('error calling video.play: ' + err);
        return Promise.reject();
    }
}

export function destroyCastPlayer(instance) {
    const player = instance._castPlayer;
    if (player) {
        try {
            player.unload();
        } catch (err) {
            console.error(err);
        }

        instance._castPlayer = null;
    }
}

export function destroyHlsPlayer(instance) {
    const player = instance._hlsPlayer;
    if (player) {
        try {
            player.destroy();
        } catch (err) {
            console.error(err);
        }

        instance._hlsPlayer = null;
    }
}

export function destroyFlvPlayer(instance) {
    const player = instance._flvPlayer;
    if (player) {
        try {
            player.unload();
            player.detachMediaElement();
            player.destroy();
        } catch (err) {
            console.error(err);
        }

        instance._flvPlayer = null;
    }
}

export function bindEventsToHlsPlayer(instance, hls, elem, onErrorFn, resolve, reject) {
    hls.on(Hls.Events.MANIFEST_PARSED, function () {
        playWithPromise(elem, onErrorFn).then(resolve, function () {
            if (reject) {
                reject();
                reject = null;
            }
        });
    });

    hls.on(Hls.Events.ERROR, function (event, data) {
        console.error('HLS Error: Type: ' + data.type + ' Details: ' + (data.details || '') + ' Fatal: ' + (data.fatal || false));

        // try to recover network error
        if (data.type === Hls.ErrorTypes.NETWORK_ERROR
                && data.response?.code && data.response.code >= 400
        ) {
            console.debug('hls.js response error code: ' + data.response.code);

            // Trigger failure differently depending on whether this is prior to start of playback, or after
            hls.destroy();

            if (reject) {
                reject(MediaError.SERVER_ERROR);
                reject = null;
            } else {
                onErrorInternal(instance, MediaError.SERVER_ERROR);
            }

            return;
        }

        if (data.fatal) {
            switch (data.type) {
                case Hls.ErrorTypes.NETWORK_ERROR:

                    if (data.response && data.response.code === 0) {
                        // This could be a CORS error related to access control response headers

                        console.debug('hls.js response error code: ' + data.response.code);

                        // Trigger failure differently depending on whether this is prior to start of playback, or after
                        hls.destroy();

                        if (reject) {
                            reject(MediaError.NETWORK_ERROR);
                            reject = null;
                        } else {
                            onErrorInternal(instance, MediaError.NETWORK_ERROR);
                        }
                    } else {
                        console.debug('fatal network error encountered, try to recover');
                        hls.startLoad();
                    }

                    break;
                case Hls.ErrorTypes.MEDIA_ERROR:
                    console.debug('fatal media error encountered, try to recover');
                    handleHlsJsMediaError(instance, reject);
                    reject = null;
                    break;
                default:

                    console.debug('Cannot recover from hls error - destroy and trigger error');
                    // cannot recover
                    // Trigger failure differently depending on whether this is prior to start of playback, or after
                    hls.destroy();

                    if (reject) {
                        reject();
                        reject = null;
                    } else {
                        onErrorInternal(instance, MediaError.FATAL_HLS_ERROR);
                    }
                    break;
            }
        }
    });
}

export function onEndedInternal(instance, elem, onErrorFn) {
    elem.removeEventListener('error', onErrorFn);

    cancelSeekOnPlaybackStart(elem);

    resetSrc(elem);

    destroyHlsPlayer(instance);
    destroyFlvPlayer(instance);
    destroyCastPlayer(instance);

    const stopInfo = {
        src: instance._currentSrc
    };

    Events.trigger(instance, 'stopped', [stopInfo]);

    instance._currentTime = null;
    instance._currentSrc = null;
    instance._currentPlayOptions = null;
}

const trackEventsInfoCache = new WeakMap();

function getTrackEventsInfo(trackEvents) {
    let info = trackEventsInfoCache.get(trackEvents);
    if (!info) {
        let sorted = true;
        let maxDuration = 0;
        for (let i = 0; i < trackEvents.length; i++) {
            const { StartPositionTicks: start, EndPositionTicks: end } = trackEvents[i];
            if (!Number.isFinite(start) || !Number.isFinite(end)
                    || (i > 0 && start < trackEvents[i - 1].StartPositionTicks)) {
                sorted = false;
                break;
            }
            maxDuration = Math.max(maxDuration, end - start);
        }
        // Offsets shift all events equally, so these stay valid for the lifetime of the array
        info = { sorted, maxDuration };
        trackEventsInfoCache.set(trackEvents, info);
    }
    return info;
}

/**
 * Finds the first track event (in array order) that is active at the given position.
 * Uses a binary search when the events are sorted by start position.
 * @param {Array<{StartPositionTicks: number, EndPositionTicks: number}>} trackEvents - The track events.
 * @param {number} ticks - The position in ticks.
 * @returns {object|undefined} The active track event.
 */
export function findActiveTrackEvent(trackEvents, ticks) {
    if (!trackEvents?.length) {
        return undefined;
    }

    const { sorted, maxDuration } = getTrackEventsInfo(trackEvents);

    let start = 0;
    if (sorted) {
        // Events starting before this cannot still be active
        const lowerBound = ticks - maxDuration;
        let high = trackEvents.length;
        while (start < high) {
            const mid = (start + high) >>> 1;
            if (trackEvents[mid].StartPositionTicks < lowerBound) {
                start = mid + 1;
            } else {
                high = mid;
            }
        }
    }

    for (let i = start; i < trackEvents.length; i++) {
        const trackEvent = trackEvents[i];
        if (sorted && trackEvent.StartPositionTicks > ticks) {
            break;
        }
        if (trackEvent.StartPositionTicks <= ticks && trackEvent.EndPositionTicks >= ticks) {
            return trackEvent;
        }
    }

    return undefined;
}

export function getBufferedRanges(instance, elem) {
    const ranges = [];
    const seekable = elem.buffered || [];

    let offset;
    const currentPlayOptions = instance._currentPlayOptions;
    if (currentPlayOptions) {
        offset = currentPlayOptions.transcodingOffsetTicks;
    }

    offset = offset || 0;

    for (let i = 0, length = seekable.length; i < length; i++) {
        let start = seekable.start(i);
        let end = seekable.end(i);

        if (!isValidDuration(start)) {
            start = 0;
        }
        if (!isValidDuration(end)) {
            // eslint-disable-next-line sonarjs/no-dead-store
            end = 0;
            continue;
        }

        ranges.push({
            start: (start * 10000000) + offset,
            end: (end * 10000000) + offset
        });
    }

    return ranges;
}
