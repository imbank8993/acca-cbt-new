const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
require('ts-node').register({ project: path.resolve(__dirname, '../tsconfig.json'), transpileOnly: true });
const { fixtureDb } = require('./fixture-db.cjs');
const { StorageController } = require('../src/storage/storage.controller.ts');
const { fetchExternalLogo, isLogoContentType, pickSchoolLogoUrl, MAX_LOGO_BYTES } = require('../src/storage/school-logo.ts');

const png = Buffer.from('89504e470d0a1a0a', 'hex');

function imageResponse(body, type = 'image/png', extra = {}) {
    return {
        ok: true,
        headers: { get: name => ({ 'content-type': type, ...extra })[name.toLowerCase()] ?? null },
        arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength),
    };
}

function response() {
    const headers = {};
    return { headers, setHeader: (name, value) => { headers[name] = value; }, end(body) { this.body = body; } };
}

test('LOGO-01: logo profil sekolah diutamakan, logo organisasi menjadi cadangan', () => {
    assert.equal(pickSchoolLogoUrl({ data: { logo_url: ' https://a/logo.png ' } }, { data: { logo_url: 'https://b/org.png' } }), 'https://a/logo.png');
    assert.equal(pickSchoolLogoUrl({ data: { logo_url: '' } }, { data: { logo_url: 'https://b/org.png' } }), 'https://b/org.png');
    assert.equal(pickSchoolLogoUrl({ data: null }, { data: null }), '');
});

test('LOGO-02: logo luar hanya diterima bila http(s), berupa gambar, dan tidak melebihi batas ukuran', async () => {
    assert.equal(isLogoContentType('image/webp'), true);
    assert.equal(isLogoContentType('text/html; charset=utf-8'), false);
    assert.equal(await fetchExternalLogo('file:///etc/passwd', async () => assert.fail('tidak boleh diambil')), null);
    assert.equal(await fetchExternalLogo('javascript:alert(1)', async () => assert.fail('tidak boleh diambil')), null);
    assert.equal(await fetchExternalLogo('https://x/logo', async () => imageResponse(png, 'text/html')), null);
    assert.equal(await fetchExternalLogo('https://x/logo', async () => imageResponse(png, 'image/png', { 'content-length': String(MAX_LOGO_BYTES + 1) })), null);
    assert.equal(await fetchExternalLogo('https://x/logo', async () => ({ ok: false, headers: { get: () => null } })), null);
    assert.equal(await fetchExternalLogo('https://x/logo', async () => { throw new Error('offline'); }), null);
    const logo = await fetchExternalLogo('https://x/logo.png', async () => imageResponse(png, 'image/png; charset=binary'));
    assert.deepEqual(logo, { body: png, contentType: 'image/png' });
});

test('LOGO-03: logo di bucket aplikasi disajikan langsung dari penyimpanan', async () => {
    const db = fixtureDb({ profil_sekolah: [{ logo_url: '/api/storage/file/logos/sekolah.png' }], cbt_organizations: [] });
    let piped = false, requestedKey;
    const storage = {
        objectKeyFromUrl: url => url.replace('/api/storage/file/', ''),
        getObject: async key => { requestedKey = key; return { contentType: 'image/png', contentLength: 8, stream: { pipe: () => { piped = true; } } }; },
    };
    const controller = new StorageController(storage, {}, db);
    const res = response();
    await controller.serveSchoolLogo(res);
    assert.equal(requestedKey, 'logos/sekolah.png');
    assert.equal(piped, true);
    assert.equal(res.headers['Content-Type'], 'image/png');
    assert.equal(res.headers['Cross-Origin-Resource-Policy'], 'same-origin');
});

test('LOGO-04: logo di host luar diambilkan server sehingga PDF tidak terhalang CORS', async () => {
    const db = fixtureDb({ profil_sekolah: [{ logo_url: 'https://sekolah.example/logo.png' }], cbt_organizations: [] });
    const controller = new StorageController({ objectKeyFromUrl: () => null }, {}, db);
    const originalFetch = globalThis.fetch;
    let fetched;
    globalThis.fetch = async url => { fetched = url; return imageResponse(png); };
    try {
        const res = response();
        await controller.serveSchoolLogo(res);
        assert.equal(fetched, 'https://sekolah.example/logo.png');
        assert.deepEqual(res.body, png);
        assert.equal(res.headers['Content-Type'], 'image/png');
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test('LOGO-05: tanpa logo, berkas privat, atau berkas bukan gambar menghasilkan 404', async () => {
    const empty = new StorageController({ objectKeyFromUrl: () => null }, {}, fixtureDb({ profil_sekolah: [], cbt_organizations: [] }));
    await assert.rejects(empty.serveSchoolLogo(response()), error => error.getStatus() === 404);

    const privateDb = fixtureDb({ profil_sekolah: [{ logo_url: '/api/storage/file/lms-private/x.png' }], cbt_organizations: [] });
    const privateController = new StorageController({
        objectKeyFromUrl: url => url.replace('/api/storage/file/', ''),
        getObject: async () => assert.fail('berkas privat tidak boleh dibaca'),
    }, {}, privateDb);
    await assert.rejects(privateController.serveSchoolLogo(response()), error => error.getStatus() === 404);

    const htmlDb = fixtureDb({ profil_sekolah: [{ logo_url: '/api/storage/file/logos/x.html' }], cbt_organizations: [] });
    const htmlController = new StorageController({
        objectKeyFromUrl: url => url.replace('/api/storage/file/', ''),
        getObject: async () => ({ contentType: 'text/html', stream: { pipe: () => assert.fail('tidak boleh disajikan') } }),
    }, {}, htmlDb);
    await assert.rejects(htmlController.serveSchoolLogo(response()), error => error.getStatus() === 404);
});
