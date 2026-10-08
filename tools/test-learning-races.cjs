// Browser checks against a running LOCAL Next dev server; every API response is a fixture.
// No requests are sent to the real database or object storage.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { SignJWT } = require('jose');
const { Document, Packer, Paragraph, HeadingLevel } = require('docx');
const root = path.resolve(__dirname, '..');
const base = 'http://localhost:3008';
const id = '00000000-0000-4000-8000-000000000080';

(async () => {
    const env = require('dotenv').parse(fs.readFileSync(path.join(root, 'apps/web/.env')));
    if (!env.JWT_SECRET) throw new Error('Local web JWT configuration is required.');
    const token = await new SignJWT({ email: 'lms-fixture@example.invalid' }).setProtectedHeader({ alg: 'HS256' }).setSubject('lms-fixture').setIssuedAt().setExpirationTime('10m').sign(new TextEncoder().encode(env.JWT_SECRET));
    const executablePath = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe', chromium.executablePath()].find(file => fs.existsSync(file));
    const browser = await chromium.launch({ headless: true, executablePath });
    const output = path.join(os.tmpdir(), 'acca-lms-browser'); fs.mkdirSync(output, { recursive: true });
    try {
        const context = await browser.newContext({ viewport: { width: 1440, height: 1050 }, serviceWorkers: 'allow' });
        await context.addCookies([{ name: 'cbt_session', value: token, url: base, httpOnly: true, sameSite: 'Lax' }]);
        let role = 'Guru', completed = false, pdfBytes, blockAutosave = false;
        const { jsPDF: FixturePdf } = require('jspdf'); const texFallback = new FixturePdf(); texFallback.text('LaTeX fixture page 1', 20, 20); texFallback.addPage(); texFallback.text('LaTeX fixture page 2', 20, 20);
        const texPdf = process.env.LMS_TEST_PDF ? fs.readFileSync(process.env.LMS_TEST_PDF) : Buffer.from(texFallback.output('arraybuffer'));
        let activity = { state: {}, revision: 0, contentVersion: 1, userId: 'lms-fixture' };
        let material = { id, title: 'Mengenal Persamaan Kuadrat', subject: 'Matematika', description: 'Jelajahi bentuk persamaan kuadrat, pahami rumusnya, dan coba aktivitas belajar.', status: 'draft', format: 'attachment', content_html: '', conversion_notes: '', revision: 1, content_version: 1, grade_level: '', topic: '', subtopic: '', hasFile: false, file_name: null, file_size: null, updated_at: '2026-10-04T10:00:00Z' };
        await context.route('**/api/**', async route => {
            const request = route.request(), url = new URL(request.url());
            const reply = body => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, ...body }) });
            if (url.pathname === '/api/auth/me') return reply({ id: 'lms-fixture', email: 'lms-fixture@example.invalid', resolved: { guru: role === 'Guru', siswa: role === 'Siswa', admin: false, proktor: false, pengawas: false, superadmin: false }, roles: [role], bestRole: role, organizationId: 'school', isPlatformAdmin: false });
            if (url.pathname === '/api/auth/profile') return reply({ profile: { full_name: 'Pengguna Uji LMS' }, organization: { name: 'Sekolah Uji' } });
            if (url.pathname === '/api/settings') return reply({ settings: [] });
            if (url.pathname === '/api/learning') return reply({ materials: [material], canManage: role === 'Guru' });
            if (url.pathname === `/api/learning/${id}/activity`) {
                if (request.method() === 'PUT') { const dto = request.postDataJSON(); activity = { ...activity, state: dto.state, revision: dto.revision + 1 }; }
                return reply(activity);
            }
            if (url.pathname === `/api/learning/${id}/activity-results`) return reply({ results: [{ user_id: 'lms-fixture', name: 'Siswa Uji', content_version: 1, updated_at: new Date().toISOString(), state: activity.state }] });
            if (url.pathname === `/api/learning/${id}/progress`) { completed = request.postDataJSON().completed; return reply({ completed }); }
            if (url.pathname === `/api/learning/${id}/pdf`) return route.fulfill({ contentType: 'application/pdf', body: texPdf });
            if (url.pathname === `/api/learning/${id}/file` && request.method() === 'GET' && pdfBytes) return route.fulfill({ contentType: 'application/octet-stream', body: pdfBytes });
            if (url.pathname === `/api/learning/${id}/file` && request.method() === 'POST') {
                const data = await new Response(request.postDataBuffer(), { headers: { 'content-type': request.headers()['content-type'] } }).formData();
                material = { ...material, revision: material.revision + 1, hasFile: true, hasRenderedPdf: data.get('format') === 'latex', file_name: data.get('file').name, file_size: 512, content_html: data.get('contentHtml'), format: data.get('format') };
                return reply({ material });
            }
            if (url.pathname === `/api/learning/${id}`) {
                if (request.method() === 'PUT') {
                    if (blockAutosave) return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ success: false, message: 'Fixture offline save' }) });
                    const dto = request.postDataJSON();
                    material = { ...material, grade_level: dto.gradeLevel, topic: dto.topic, subtopic: dto.subtopic, title: dto.title, description: dto.description, subject: dto.subject, status: dto.status, content_html: dto.contentHtml, conversion_notes: dto.conversionNotes, format: dto.format, revision: material.revision + 1 };
                }
                return reply({ material, canEdit: role === 'Guru', completed });
            }
            return reply({ items: [], notifications: [], count: 0 });
        });

        const page = await context.newPage(); page.setDefaultTimeout(45000); page.setDefaultNavigationTimeout(120000);
        const b = '00000000-0000-4000-8000-000000000081';
        material = { ...material, status: 'published', format: 'text', content_html: '<p>Materi A</p>', title: 'Materi A' };
        const second = { ...material, id: b, title: 'Materi B', content_html: '<p>Materi B</p>' };
        let releaseB, progressId;
        await context.route('**/api/learning', route => route.fulfill({ json: { materials: [material, second], canManage: true } }));
        await context.route(`**/api/learning/${b}`, async route => {
            await new Promise(resolve => { releaseB = resolve; });
            await route.fulfill({ json: { material: second, canEdit: true, completed: false } }).catch(() => {});
        });
        await context.route('**/api/learning/*/progress', route => {
            progressId = new URL(route.request().url()).pathname;
            return route.fulfill({ json: { completed: true } });
        });
        await page.goto(`${base}/dashboard/learning/${id}`, { waitUntil: 'domcontentloaded' });
        await page.getByRole('heading', { name: 'Materi A', exact: true }).waitFor();
        const requestedB = page.waitForRequest(request => request.url().endsWith(`/api/learning/${b}`));
        await page.getByRole('link', { name: /Materi B/ }).click();
        await requestedB;
        await page.waitForURL(`**/${b}`);
        await page.getByText('Memuat bahan ajar…', { exact: true }).waitFor();
        assert.equal(await page.getByRole('button', { name: 'Tandai selesai', exact: true }).count(), 0);
        assert.equal(await page.getByRole('heading', { name: 'Materi A', exact: true }).count(), 0);
        releaseB();
        await page.getByRole('heading', { name: 'Materi B', exact: true }).waitFor();
        await page.getByRole('button', { name: 'Tandai selesai', exact: true }).click();
        await page.getByRole('button', { name: 'Tandai belum selesai', exact: true }).waitFor();
        assert.equal(progressId, `/api/learning/${b}/progress`);
        console.log('PASS: reader clears previous content and binds progress to the loaded material');

        let releaseManage;
        await context.route('**/api/learning?manage=1', async route => {
            await new Promise(resolve => { releaseManage = resolve; });
            await route.fulfill({ json: { materials: [{ ...material, title: 'Draf lama', status: 'draft' }], canManage: true } }).catch(() => {});
        });
        await page.goto(`${base}/dashboard/learning`, { waitUntil: 'domcontentloaded' });
        const requestedManage = page.waitForRequest('**/api/learning?manage=1');
        await page.getByRole('button', { name: 'Kelola materi', exact: true }).click();
        await requestedManage;
        await page.getByText('Memuat bahan ajar…', { exact: true }).waitFor();
        await page.getByRole('button', { name: /Semua materi/ }).click();
        await page.getByRole('heading', { name: 'Materi A', exact: true }).waitFor();
        if (releaseManage) releaseManage();
        await page.waitForTimeout(500);
        assert.equal(await page.getByRole('heading', { name: 'Draf lama' }).count(), 0);
        console.log('PASS: delayed management response cannot replace the published library');

        await context.route(`**/api/learning/${id}/activity`, route => route.request().method() === 'PUT' ? route.fulfill({ status: 503, json: { error: 'Simulated offline' } }) : route.fallback());
        material = { ...material, format: 'html', content_html: '<label>Jawaban<input id="answer"></label>' };
        const other = await context.newPage(); other.setDefaultTimeout(45000); other.setDefaultNavigationTimeout(120000);
        await context.addInitScript(() => sessionStorage.setItem('lms-tab', 'copied-tab-identity'));
        await Promise.all([page.goto(`${base}/dashboard/learning/${id}`), other.goto(`${base}/dashboard/learning/${id}`)]);
        await page.frameLocator('iframe').locator('#answer').fill('Jawaban tab A');
        await other.frameLocator('iframe').locator('#answer').fill('Jawaban tab B');
        const keys = await page.evaluate(() => Object.keys(localStorage).filter(key => key.startsWith('lms-activity:')));
        assert.equal(keys.length, 2);
        const values = await page.evaluate(keys => keys.map(key => localStorage.getItem(key)), keys);
        assert.ok(values.some(value => value.includes('Jawaban tab A')));
        assert.ok(values.some(value => value.includes('Jawaban tab B')));
        console.log('PASS: copied sessionStorage identities still produce independent local answer queues');
        await other.close();
    } finally { await browser.close(); }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
