import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('webcomponents.js/webcomponents-lite', () => ({}));
vi.mock('../emby-input/emby-input', () => ({}));
vi.mock('./emby-slider.scss', () => ({}));
vi.mock('../../scripts/browser', () => ({ default: {} }));
vi.mock('../../components/layoutManager', () => ({ default: {} }));
vi.mock('../../scripts/keyboardNavigation', () => ({ default: {} }));
vi.mock('../../lib/globalize', () => ({ default: { getIsRTL: () => false, getIsElementRTL: () => false } }));

type MarkerInfo = { name: string, progress: number }[];

interface TestRange {
    min: string;
    max: string;
    step: string;
    markerContainerElement: HTMLElement;
    getMarkerInfo: () => MarkerInfo;
}

let updateMarkers: (range: TestRange, currentValue: number | string) => void;

beforeAll(async () => {
    // Registered by the webcomponents polyfill in the app
    (document as unknown as { registerElement: () => void }).registerElement = vi.fn();
    ({ updateMarkers } = await import('./emby-slider'));
});

function createRange(getMarkerInfo: () => MarkerInfo): TestRange {
    const markerContainerElement = document.createElement('div');
    return { min: '0', max: '100', step: '.01', markerContainerElement, getMarkerInfo };
}

describe('emby-slider markers', () => {
    it('positions markers once in percent and only toggles their state when crossed', () => {
        let markerInfo: MarkerInfo = [
            { name: 'Intro', progress: 0 },
            { name: 'Middle', progress: 0.5 },
            { name: 'Credits', progress: 0.9 }
        ];
        const range = createRange(() => markerInfo);

        const measure = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect');

        updateMarkers(range, 10);

        const markers = [...range.markerContainerElement.querySelectorAll<HTMLElement>('.sliderMarker')];
        expect(markers.map(m => m.style.left)).toEqual(['0%', '50%', '90%']);
        expect(markers.map(m => m.className)).toEqual([
            'sliderMarker watched',
            'sliderMarker unwatched',
            'sliderMarker unwatched'
        ]);
        // No layout reads
        expect(measure).not.toHaveBeenCalled();

        // Same marker info (same array): no rebuild, no class writes until a marker is crossed
        const toggle = vi.spyOn(DOMTokenList.prototype, 'toggle');
        updateMarkers(range, '20');
        expect(range.markerContainerElement.querySelectorAll('.sliderMarker')[0]).toBe(markers[0]);
        expect(toggle).not.toHaveBeenCalled();

        updateMarkers(range, '60');
        // one marker crossed: watched + unwatched toggled on that marker only
        expect(toggle).toHaveBeenCalledTimes(2);
        expect(markers[1].className).toBe('sliderMarker watched');

        // Seeking back
        updateMarkers(range, 5);
        expect(markers[1].className).toBe('sliderMarker unwatched');

        // Equal content in a new array: markers are kept
        markerInfo = markerInfo.map(m => ({ ...m }));
        updateMarkers(range, 5);
        expect(range.markerContainerElement.querySelectorAll('.sliderMarker')[1]).toBe(markers[1]);

        // Different markers (e.g. next item): rebuilt
        markerInfo = [{ name: 'Other', progress: 0.25 }];
        updateMarkers(range, 30);
        const newMarkers = [...range.markerContainerElement.querySelectorAll<HTMLElement>('.sliderMarker')];
        expect(newMarkers).toHaveLength(1);
        expect(newMarkers[0].style.left).toBe('25%');
        expect(newMarkers[0].className).toBe('sliderMarker watched');
    });

    it('renders nothing without markers', () => {
        const range = createRange(() => []);
        updateMarkers(range, 10);
        expect(range.markerContainerElement.innerHTML).toBe('');
    });
});
