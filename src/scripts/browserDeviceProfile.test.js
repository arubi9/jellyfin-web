import { describe, expect, it, vi } from 'vitest';

vi.mock('./settings/userSettings', () => ({
    allowedAudioChannels: () => '-1',
    limitSegmentLength: () => false,
    preferFmp4HlsContainer: () => false
}));

describe('browserDeviceProfile', () => {
    it('caches canPlayType results and reuses the test elements', async () => {
        const canPlayType = vi.spyOn(HTMLMediaElement.prototype, 'canPlayType')
            .mockImplementation((type) => (type.includes('mp4') ? 'probably' : ''));
        const createElement = vi.spyOn(document, 'createElement');

        const { default: profileBuilder } = await import('./browserDeviceProfile');

        const firstProfile = profileBuilder({});
        const callsAfterFirstBuild = canPlayType.mock.calls.length;
        const mediaElementsAfterFirstBuild = createElement.mock.calls.filter(([tag]) => tag === 'video' || tag === 'audio').length;
        expect(callsAfterFirstBuild).toBeGreaterThan(0);

        const secondProfile = profileBuilder({});

        // Identical result, without new canPlayType calls or new media elements
        expect(secondProfile).toEqual(firstProfile);
        expect(canPlayType.mock.calls.length).toBe(callsAfterFirstBuild);
        expect(createElement.mock.calls.filter(([tag]) => tag === 'video' || tag === 'audio').length)
            .toBe(mediaElementsAfterFirstBuild);

        // Each distinct type is only asked once
        const types = canPlayType.mock.calls.map(([type]) => type);
        expect(new Set(types).size).toBe(types.length);
    });
});
