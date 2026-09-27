/* ACCA CBT — service worker terbatas untuk shell ujian siswa. */
'use strict';

const VERSION = 'acca-exam-shell-v1';
const EXAM_CACHE = `${VERSION}:exam`;
const ASSET_CACHE = `${VERSION}:assets`;
const OWNED_CACHE_PREFIX = 'acca-exam-shell-';

function isExamPath(pathname) {
    return /^\/dashboard\/siswa\/exam\/[^/]+\/?$/.test(pathname);
}

function canonicalExamRequest(input) {
    const url = new URL(typeof input === 'string' ? input : input.url, self.location.origin);
    url.search = '';
    url.hash = '';
    return new Request(url.toString(), {
        method: 'GET',
        credentials: 'include',
        headers: { Accept: 'text/html' },
    });
}

async function cacheSafe(cacheName, request, response) {
    if (!response || !response.ok || response.type === 'opaque') return response;
    const cache = await caches.open(cacheName);
    await cache.put(request, response.clone());
    return response;
}

function isCacheableExamResponse(response) {
    if (!response || !response.ok || response.redirected) return false;
    const finalUrl = new URL(response.url);
    return finalUrl.origin === self.location.origin &&
        isExamPath(finalUrl.pathname) &&
        (response.headers.get('content-type') || '').includes('text/html');
}

self.addEventListener('install', event => {
    event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', event => {
    event.waitUntil((async () => {
        const names = await caches.keys();
        await Promise.all(names
            .filter(name => name.startsWith(OWNED_CACHE_PREFIX) && name !== EXAM_CACHE && name !== ASSET_CACHE)
            .map(name => caches.delete(name)));
        await self.clients.claim();
    })());
});

self.addEventListener('fetch', event => {
    const request = event.request;
    if (request.method !== 'GET') return;

    const url = new URL(request.url);
    if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;

    if (request.mode === 'navigate' && isExamPath(url.pathname)) {
        event.respondWith((async () => {
            const canonical = canonicalExamRequest(url.toString());
            try {
                const response = await fetch(request);
                if (isCacheableExamResponse(response)) {
                    await cacheSafe(EXAM_CACHE, canonical, response);
                }
                return response;
            } catch (error) {
                const cached = await caches.match(canonical);
                if (cached) return cached;
                throw error;
            }
        })());
        return;
    }

    const isStaticAsset = url.pathname.startsWith('/_next/static/') ||
        url.pathname.startsWith('/_next/image') ||
        ['script', 'style', 'font', 'image'].includes(request.destination);
    if (!isStaticAsset) return;

    event.respondWith((async () => {
        const client = event.clientId ? await self.clients.get(event.clientId) : null;
        if (!client || !isExamPath(new URL(client.url).pathname)) {
            return fetch(request);
        }
        const cached = await caches.match(request);
        if (cached) return cached;
        const response = await fetch(request);
        return cacheSafe(ASSET_CACHE, request, response);
    })());
});

self.addEventListener('message', event => {
    const data = event.data || {};
    const reply = success => event.ports[0]?.postMessage({ success });

    if (data.type === 'CACHE_EXAM_SHELL') {
        event.waitUntil((async () => {
            try {
                const url = new URL(data.path || '', self.location.origin);
                if (url.origin !== self.location.origin || !isExamPath(url.pathname)) {
                    reply(false);
                    return;
                }

                const canonical = canonicalExamRequest(url.toString());
                const response = await fetch(canonical);
                if (!isCacheableExamResponse(response)) {
                    reply(false);
                    return;
                }
                await cacheSafe(EXAM_CACHE, canonical, response);

                const assets = Array.isArray(data.assets) ? data.assets : [];
                const assetCache = await caches.open(ASSET_CACHE);
                const results = await Promise.allSettled(assets.map(async value => {
                    const assetUrl = new URL(value, self.location.origin);
                    if (assetUrl.origin !== self.location.origin || !assetUrl.pathname.startsWith('/_next/')) return;
                    const request = new Request(assetUrl.toString(), { credentials: 'same-origin' });
                    const assetResponse = await fetch(request);
                    if (assetResponse.ok && assetResponse.type !== 'opaque') {
                        await assetCache.put(request, assetResponse);
                    }
                }));
                reply(results.every(result => result.status === 'fulfilled'));
            } catch {
                reply(false);
            }
        })());
        return;
    }

    if (data.type === 'UNCACHE_EXAM_SHELL') {
        event.waitUntil((async () => {
            try {
                const url = new URL(data.path || '', self.location.origin);
                if (!isExamPath(url.pathname)) {
                    reply(false);
                    return;
                }
                const cache = await caches.open(EXAM_CACHE);
                await cache.delete(canonicalExamRequest(url.toString()));
                reply(true);
            } catch {
                reply(false);
            }
        })());
        return;
    }

    if (data.type === 'CLEAR_EXAM_CACHES') {
        event.waitUntil(Promise.all([caches.delete(EXAM_CACHE), caches.delete(ASSET_CACHE)])
            .then(() => reply(true), () => reply(false)));
    }
});
