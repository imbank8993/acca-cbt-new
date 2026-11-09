/* ACCA CBT — service worker terbatas untuk shell ujian siswa. */
'use strict';

const VERSION = 'acca-exam-shell-v2';
const EXAM_CACHE = `${VERSION}:exam`;
const ASSET_CACHE = `${VERSION}:assets`;
const OWNED_CACHE_PREFIX = 'acca-exam-shell-';
/**
 * Gambar soal per ujian (nama cache = prefix + path ujian). Gambar diambil dari
 * /api/storage/file/ dengan sesi siswa sendiri saat online, lalu dipakai saat
 * jaringan terputus atau halaman dimuat ulang offline. Berkas penyimpanan tidak
 * pernah berubah isi pada alamat yang sama, jadi salinan cache selalu benar.
 */
const IMAGE_CACHE_PREFIX = `${VERSION}:images:`;
const STORAGE_FILE_PREFIX = '/api/storage/file/';
const MAX_EXAM_IMAGES = 400;

function imageCacheName(path) {
    return `${IMAGE_CACHE_PREFIX}${new URL(path, self.location.origin).pathname}`;
}

function isStorageImageUrl(value) {
    try {
        const url = new URL(value, self.location.origin);
        return url.origin === self.location.origin && url.pathname.startsWith(STORAGE_FILE_PREFIX) &&
            /\.(?:png|jpe?g|gif|webp|bmp|svg)$/i.test(url.pathname);
    } catch {
        return false;
    }
}

async function findCachedImage(url) {
    const names = (await caches.keys()).filter(name => name.startsWith(IMAGE_CACHE_PREFIX));
    for (const name of names) {
        const cache = await caches.open(name);
        const hit = await cache.match(url, { ignoreVary: true });
        if (hit) return hit;
    }
    return null;
}

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
    if (!response || !response.ok || response.type === 'opaque' || (cacheName === ASSET_CACHE && /private|no-store/i.test(response.headers.get('cache-control') || ''))) return response;
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
            .filter(name => name.startsWith(OWNED_CACHE_PREFIX) && name !== EXAM_CACHE && name !== ASSET_CACHE &&
                !name.startsWith(IMAGE_CACHE_PREFIX))
            .map(name => caches.delete(name)));
        await self.clients.claim();
    })());
});

self.addEventListener('fetch', event => {
    const request = event.request;
    if (request.method !== 'GET') return;

    const url = new URL(request.url);
    // Satu-satunya pengecualian API: GAMBAR soal yang sudah disimpan untuk ujian.
    // Audio/video (Range request), unduhan, dan endpoint lain tetap tidak disentuh.
    if (url.origin === self.location.origin && url.pathname.startsWith(STORAGE_FILE_PREFIX) &&
        request.destination === 'image') {
        event.respondWith((async () => {
            const cached = await findCachedImage(url.href).catch(() => null);
            return cached || fetch(request);
        })());
        return;
    }
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

    const isStaticAsset = url.pathname.startsWith('/_next/static/');
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
                    if (assetUrl.origin !== self.location.origin || !assetUrl.pathname.startsWith('/_next/static/')) return;
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

    if (data.type === 'CACHE_EXAM_IMAGES') {
        event.waitUntil((async () => {
            try {
                const url = new URL(data.path || '', self.location.origin);
                if (url.origin !== self.location.origin || !isExamPath(url.pathname)) {
                    reply(false);
                    return;
                }
                const wanted = [...new Set((Array.isArray(data.images) ? data.images : [])
                    .filter(isStorageImageUrl)
                    .map(value => new URL(value, self.location.origin).href))].slice(0, MAX_EXAM_IMAGES);
                const cache = await caches.open(imageCacheName(url.pathname));
                // Gambar yang tidak lagi dipakai soal ujian ini dibuang.
                for (const request of await cache.keys()) {
                    if (!wanted.includes(request.url)) await cache.delete(request);
                }
                const queue = [];
                for (const href of wanted) {
                    if (!(await cache.match(href, { ignoreVary: true }))) queue.push(href);
                }
                let failed = 0;
                const worker = async () => {
                    for (let href = queue.shift(); href; href = queue.shift()) {
                        try {
                            const response = await fetch(new Request(href, { credentials: 'same-origin' }));
                            const type = response.headers.get('content-type') || '';
                            if (response.ok && response.type !== 'opaque' && !response.redirected && type.startsWith('image/')) {
                                await cache.put(href, response);
                            } else {
                                failed++;
                            }
                        } catch {
                            failed++;
                        }
                    }
                };
                // Dua unduhan sekaligus: cukup cepat tanpa membanjiri server saat ujian dimulai.
                await Promise.all([worker(), worker()]);
                reply(failed === 0);
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
                await caches.delete(imageCacheName(url.pathname));
                reply(true);
            } catch {
                reply(false);
            }
        })());
        return;
    }

    if (data.type === 'CLEAR_EXAM_CACHES') {
        event.waitUntil(caches.keys()
            .then(names => Promise.all(names
                .filter(name => name.startsWith(OWNED_CACHE_PREFIX))
                .map(name => caches.delete(name))))
            .then(() => reply(true), () => reply(false)));
    }
});
