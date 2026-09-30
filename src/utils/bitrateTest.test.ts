import type { Api } from '@jellyfin/sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const getEndpointInfo = vi.fn();

vi.mock('@jellyfin/sdk/lib/utils/api/system-api', () => ({
    getSystemApi: () => ({ getEndpointInfo })
}));

/** Downloads started by the speed test, pending until completed by the test */
const pending: FakeXhr[] = [];

const { HEADERS_RECEIVED } = XMLHttpRequest;

/** Fake XHR for the speed test downloads */
class FakeXhr {
    readyState = 0;
    status = 0;
    response: { size: number } | null = null;
    responseType = '';
    timeout = 0;
    size = 0;
    onreadystatechange: (() => void) | null = null;
    onload: (() => void) | null = null;
    onabort: (() => void) | null = null;
    onerror: (() => void) | null = null;
    ontimeout: (() => void) | null = null;

    open(_method: string, url: string) {
        this.size = Number(new URL(url, 'https://localhost').searchParams.get('Size'));
    }

    setRequestHeader() {
        // not needed
    }

    send() {
        pending.push(this);
    }

    complete() {
        this.readyState = HEADERS_RECEIVED;
        this.onreadystatechange?.();
        this.status = 200;
        this.response = { size: this.size };
        this.onload?.();
    }
}

// Keep the XMLHttpRequest constants (used by the speed test)
Object.setPrototypeOf(FakeXhr, XMLHttpRequest);

const api = { basePath: 'https://server', authorizationHeader: 'auth' } as unknown as Api;

const flush = () => new Promise(resolve => setTimeout(resolve));

/** Completes all speed test downloads, including the ones started by completed ones */
const completeDownloads = async () => {
    while (pending.length) {
        pending.shift()?.complete();
        // let the next download of the test series start
        await flush();
    }
};

describe('bitrateTest', () => {
    let now = 0;

    beforeEach(() => {
        vi.resetModules();
        pending.length = 0;
        getEndpointInfo.mockReset();
        getEndpointInfo.mockResolvedValue({ data: { IsInNetwork: false } });
        vi.stubGlobal('XMLHttpRequest', FakeXhr);
        // Every download takes half a second
        now = 0;
        vi.spyOn(performance, 'now').mockImplementation(() => {
            now += 500;
            return now;
        });
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    describe('getBitrate', () => {
        it('waits for the detection when no bitrate is known', async () => {
            const { getBitrate } = await import('./bitrateTest');
            const onDetected = vi.fn();

            let result: number | undefined;
            const promise = getBitrate(api, { IsInNetwork: false }, null, onDetected).then(bitrate => {
                result = bitrate;
                return bitrate;
            });

            await flush();
            expect(result).toBeUndefined();
            expect(pending).toHaveLength(1);

            await completeDownloads();
            const bitrate = await promise;

            expect(bitrate).toBeGreaterThan(0);
            expect(onDetected).toHaveBeenCalledWith(bitrate);
        });

        it('returns the saved bitrate right away and refreshes it in the background', async () => {
            const { getBitrate } = await import('./bitrateTest');
            const onDetected = vi.fn();

            const bitrate = await getBitrate(api, { IsInNetwork: false }, 1234, onDetected);

            expect(bitrate).toBe(1234);
            await flush();
            expect(pending).toHaveLength(1);
            expect(onDetected).not.toHaveBeenCalled();

            await completeDownloads();

            expect(onDetected).toHaveBeenCalledTimes(1);
            const detected = onDetected.mock.calls[0][0];
            expect(detected).toBeGreaterThan(0);

            // The detected bitrate is used from now on, without testing again
            const onDetectedAgain = vi.fn();
            await expect(getBitrate(api, { IsInNetwork: false }, 1234, onDetectedAgain)).resolves.toBe(detected);
            expect(pending).toHaveLength(0);
            expect(onDetectedAgain).not.toHaveBeenCalled();
        });

        it('shares a running detection', async () => {
            const { getBitrate } = await import('./bitrateTest');

            const first = getBitrate(api, { IsInNetwork: false }, null, vi.fn());
            const second = getBitrate(api, { IsInNetwork: false }, null, vi.fn());

            await flush();
            expect(pending).toHaveLength(1);

            await completeDownloads();
            expect(await first).toBe(await second);
        });

        it('uses the given endpoint info and applies the LAN minimum', async () => {
            const { getBitrate } = await import('./bitrateTest');

            const promise = getBitrate(api, { IsInNetwork: true }, null, vi.fn());
            await flush();
            await completeDownloads();

            expect(await promise).toBe(140000000);
            expect(getEndpointInfo).not.toHaveBeenCalled();
        });

        it('keeps the saved bitrate if the detection fails', async () => {
            const { getBitrate } = await import('./bitrateTest');
            const onDetected = vi.fn();

            await expect(getBitrate(api, { IsInNetwork: false }, 1234, onDetected)).resolves.toBe(1234);
            await flush();

            pending.shift()?.onerror?.();
            await flush();

            // A failed test reports 0, which the caller ignores
            expect(onDetected).toHaveBeenCalledWith(0);
        });
    });

    describe('detectBitrate', () => {
        it('requests the endpoint info when not given', async () => {
            const { detectBitrate } = await import('./bitrateTest');

            const promise = detectBitrate(api, true);
            await flush();
            await completeDownloads();

            expect(await promise).toBeGreaterThan(0);
            expect(getEndpointInfo).toHaveBeenCalledTimes(1);
        });
    });
});
