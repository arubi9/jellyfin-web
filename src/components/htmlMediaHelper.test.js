import { describe, expect, it } from 'vitest';

import {
    cancelSeekOnPlaybackStart,
    findActiveTrackEvent,
    isHlsStreamUrl,
    seekOnPlaybackStart
} from './htmlMediaHelper';

function findActiveTrackEventNaive(trackEvents, ticks) {
    for (const trackEvent of trackEvents) {
        if (trackEvent.StartPositionTicks <= ticks && trackEvent.EndPositionTicks >= ticks) {
            return trackEvent;
        }
    }
    return undefined;
}

// Small deterministic PRNG so failures are reproducible
function createRandom(seed) {
    let state = seed;
    return () => {
        state = (state * 1664525 + 1013904223) % 4294967296;
        return state / 4294967296;
    };
}

function createTrackEvents(random, count, sorted) {
    const events = [];
    let start = 0;
    for (let i = 0; i < count; i++) {
        // Includes duplicate starts, overlaps, zero length and long events
        start += Math.floor(random() * 3) * 10000000;
        const duration = random() < 0.05 ? 600000000 : Math.floor(random() * 5) * 10000000;
        events.push({ StartPositionTicks: start, EndPositionTicks: start + duration, Text: `cue ${i}` });
    }
    if (!sorted) {
        events.sort(() => random() - 0.5);
    }
    return events;
}

describe('findActiveTrackEvent', () => {
    it('matches a linear scan for sorted and unsorted events', () => {
        const random = createRandom(42);
        for (const sorted of [true, false]) {
            for (let run = 0; run < 20; run++) {
                const events = createTrackEvents(random, 1 + Math.floor(random() * 200), sorted);
                const lastEnd = Math.max(...events.map(e => e.EndPositionTicks));
                for (let ticks = -10000000; ticks <= lastEnd + 10000000; ticks += 2500000) {
                    expect(findActiveTrackEvent(events, ticks)).toBe(findActiveTrackEventNaive(events, ticks));
                }
            }
        }
    });

    it('stays correct after an offset shifted all events', () => {
        const events = createTrackEvents(createRandom(7), 100, true);
        expect(findActiveTrackEvent(events, 0)).toBe(findActiveTrackEventNaive(events, 0));

        // Same array mutated in place, as setTrackEventsSubtitleOffset does
        events.forEach(e => {
            e.StartPositionTicks -= 35000000;
            e.EndPositionTicks -= 35000000;
        });

        for (let ticks = -50000000; ticks <= 3000000000; ticks += 5000000) {
            expect(findActiveTrackEvent(events, ticks)).toBe(findActiveTrackEventNaive(events, ticks));
        }
    });

    it('handles empty input', () => {
        expect(findActiveTrackEvent([], 0)).toBeUndefined();
        expect(findActiveTrackEvent(null, 0)).toBeUndefined();
    });
});

describe('isHlsStreamUrl', () => {
    it('detects HLS playlists', () => {
        expect(isHlsStreamUrl('https://srv/Audio/1/master.m3u8?ApiKey=x')).toBe(true);
        expect(isHlsStreamUrl('https://srv/Videos/1/live.m3u8')).toBe(true);
    });

    it('detects progressive streams', () => {
        expect(isHlsStreamUrl('https://srv/jf/Audio/abc/universal?UserId=1&TranscodingProtocol=http&Container=mp3')).toBe(false);
        expect(isHlsStreamUrl('https://srv/Audio/abc/stream.flac?Static=true&ApiKey=x')).toBe(false);
        expect(isHlsStreamUrl('https://srv/Audio/abc/stream?Static=true')).toBe(false);
    });

    it('leaves server side decisions to a HEAD request', () => {
        expect(isHlsStreamUrl('https://srv/Audio/abc/universal?UserId=1&TranscodingProtocol=hls&Container=mp3#t=10')).toBeNull();
        expect(isHlsStreamUrl('https://srv/Audio/abc/universal?UserId=1')).toBeNull();
        expect(isHlsStreamUrl('https://radio.example/stream')).toBeNull();
        expect(isHlsStreamUrl('')).toBeNull();
    });
});

describe('seekOnPlaybackStart', () => {
    function createMediaElement() {
        const elem = document.createElement('video');
        let currentTime = 0;
        let duration = NaN;
        Object.defineProperty(elem, 'currentTime', {
            get: () => currentTime,
            set: (v) => {
                currentTime = v;
            }
        });
        Object.defineProperty(elem, 'duration', { get: () => duration });
        return {
            elem,
            setDuration: (value) => {
                duration = value;
            }
        };
    }

    it('seeks once the media is ready', () => {
        const { elem, setDuration } = createMediaElement();
        seekOnPlaybackStart({}, elem, 600000000);

        setDuration(120);
        elem.dispatchEvent(new Event('durationchange'));
        expect(elem.currentTime).toBe(60);
    });

    it('does not seek after being cancelled', () => {
        const { elem, setDuration } = createMediaElement();
        seekOnPlaybackStart({}, elem, 600000000);
        cancelSeekOnPlaybackStart(elem);

        setDuration(120);
        elem.dispatchEvent(new Event('durationchange'));
        expect(elem.currentTime).toBe(0);
    });

    it('replaces the listeners of a previous playback', () => {
        const { elem, setDuration } = createMediaElement();
        seekOnPlaybackStart({}, elem, 600000000);
        seekOnPlaybackStart({}, elem, 300000000);

        setDuration(120);
        elem.dispatchEvent(new Event('loadedmetadata'));
        expect(elem.currentTime).toBe(30);
    });
});
