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
        const context = await browser.newContext({ viewport: { width: 1440, height: 1050 }, serviceWorkers: 'block' });
        await context.addCookies([{ name: 'cbt_session', value: token, url: base, httpOnly: true, sameSite: 'Lax' }]);
        let role = 'Guru', completed = false, pdfBytes;
        let material = { id, title: 'Mengenal Persamaan Kuadrat', subject: 'Matematika', description: 'Jelajahi bentuk persamaan kuadrat, pahami rumusnya, dan coba aktivitas belajar.', status: 'draft', format: 'attachment', content_html: '', conversion_notes: '', revision: 1, hasFile: false, file_name: null, file_size: null, updated_at: '2026-10-04T10:00:00Z' };
        await context.route('**/api/**', async route => {
            const request = route.request(), url = new URL(request.url());
            const reply = body => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, ...body }) });
            if (url.pathname === '/api/auth/me') return reply({ id: 'lms-fixture', email: 'lms-fixture@example.invalid', resolved: { guru: role === 'Guru', siswa: role === 'Siswa', admin: false, proktor: false, pengawas: false, superadmin: false }, roles: [role], bestRole: role, organizationId: 'school', isPlatformAdmin: false });
            if (url.pathname === '/api/auth/profile') return reply({ profile: { full_name: 'Pengguna Uji LMS' }, organization: { name: 'Sekolah Uji' } });
            if (url.pathname === '/api/settings') return reply({ settings: [] });
            if (url.pathname === '/api/learning') return reply({ materials: [material], canManage: role === 'Guru' });
            if (url.pathname === `/api/learning/${id}/progress`) { completed = request.postDataJSON().completed; return reply({ completed }); }
            if (url.pathname === `/api/learning/${id}/file` && request.method() === 'GET' && pdfBytes) return route.fulfill({ contentType: 'application/octet-stream', body: pdfBytes });
            if (url.pathname === `/api/learning/${id}/file` && request.method() === 'POST') {
                material = { ...material, revision: material.revision + 1, hasFile: true, file_name: 'fixture.docx', file_size: 512, content_html: '', format: 'attachment' };
                return reply({ material });
            }
            if (url.pathname === `/api/learning/${id}`) {
                if (request.method() === 'PUT') {
                    const dto = request.postDataJSON();
                    material = { ...material, title: dto.title, description: dto.description, subject: dto.subject, status: dto.status, content_html: dto.contentHtml, conversion_notes: dto.conversionNotes, format: dto.format, revision: material.revision + 1 };
                }
                return reply({ material, canEdit: role === 'Guru', completed });
            }
            return reply({ items: [], notifications: [], count: 0 });
        });
        const page = await context.newPage(); page.setDefaultTimeout(45000);
        page.on('pageerror', error => console.log('Browser error:', error.message));
        await page.goto(`${base}/dashboard/learning/${id}/edit`, { waitUntil: 'domcontentloaded', timeout: 120000 });
        await page.getByLabel('Judul', { exact: true }).waitFor().catch(async error => {
            console.log('Page:', page.url()); console.log((await page.locator('body').innerText()).slice(0, 1500)); throw error;
        });
        await page.getByLabel('Unggah bahan ajar').setInputFiles({ name: 'aljabar.tex', mimeType: 'text/plain', buffer: Buffer.from(String.raw`\documentclass{article}\begin{document}\section{Tujuan}Memahami akar persamaan.\section{Rumus}$x=\frac{-b}{2a}$\end{document}`) });
        await page.getByText('Dokumen tersimpan sebagai draf.', { exact: false }).waitFor();
        await page.frameLocator('iframe').locator('math').waitFor();
        await page.frameLocator('iframe').getByText('Daftar isi', { exact: true }).waitFor();
        console.log('PASS: LaTeX upload → rendered math + table of contents');
        const docx = await Packer.toBuffer(new Document({ sections: [{ children: [new Paragraph({ text: 'Tujuan Pembelajaran', heading: HeadingLevel.HEADING_1 }), new Paragraph('Memahami persamaan kuadrat.'), new Paragraph({ text: 'Latihan', heading: HeadingLevel.HEADING_1 }), new Paragraph('Tentukan akar persamaan.') ] }] }));
        await page.getByLabel('Unggah bahan ajar').setInputFiles({ name: 'materi.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: docx });
        await page.frameLocator('iframe').getByRole('heading', { name: 'Tujuan Pembelajaran' }).waitFor();
        await page.getByText('Dokumen tersimpan sebagai draf.', { exact: false }).waitFor();
        console.log('PASS: Word upload → headings, content + navigation');
        await page.screenshot({ path: path.join(output, 'editor-desktop.png'), fullPage: true, animations: 'disabled' });
        const html = `<h1>Aktivitas Pecahan</h1><button onclick="document.getElementById('answer').textContent='Benar!'">2/4 = 1/2</button><p id="answer"></p><p id="isolation"></p><script>try{parent.document.body.dataset.attacked='yes';document.getElementById('isolation').textContent='UNSAFE'}catch{document.getElementById('isolation').textContent='ISOLATED'}</script>`;
        await page.getByLabel('Unggah bahan ajar').setInputFiles({ name: 'aktivitas.html', mimeType: 'text/html', buffer: Buffer.from(html) });
        await page.frameLocator('iframe').getByText('ISOLATED').waitFor();
        await page.frameLocator('iframe').getByRole('button', { name: '2/4 = 1/2' }).click();
        await page.frameLocator('iframe').getByText('Benar!').waitFor();
        assert.equal(await page.locator('body').getAttribute('data-attacked'), null);
        assert.equal(await page.frameLocator('iframe').locator('body').evaluate(async () => { try { await fetch('/api/auth/me'); return true; } catch { return false; } }), false);
        console.log('PASS: interactive HTML works; parent DOM inaccessible');
        await page.getByText('Dokumen tersimpan sebagai draf.', { exact: false }).waitFor();
        await page.getByRole('button', { name: 'Terbitkan', exact: true }).click();
        await page.getByText('Bahan ajar telah diterbitkan untuk seluruh siswa.').waitFor();
        assert.equal(material.status, 'published');
        role = 'Siswa';
        await page.goto(`${base}/dashboard/learning/${id}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
        await page.getByRole('button', { name: 'Tandai selesai', exact: true }).click();
        await page.getByRole('button', { name: 'Tandai belum selesai', exact: true }).waitFor(); assert.equal(completed, true);
        assert.equal(await page.getByRole('link', { name: 'Edit materi' }).count(), 0);
        console.log('PASS: publish → student reader → persisted completion');
        await page.setViewportSize({ width: 390, height: 844 });
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.getByRole('button', { name: 'Tandai belum selesai', exact: true }).waitFor();
        await page.screenshot({ path: path.join(output, 'reader-mobile.png'), fullPage: true, animations: 'disabled' });
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Mobile reader should not overflow');
        await page.goto(`${base}/dashboard/learning`, { waitUntil: 'domcontentloaded', timeout: 120000 });
        await page.getByRole('link', { name: 'Mulai belajar' }).waitFor();
        assert.equal(await page.getByRole('button', { name: 'Tambah bahan ajar' }).count(), 0);
        await page.getByLabel('Cari bahan ajar').fill('tidak-ada'); await page.getByText('Materi tidak ditemukan').waitFor();
        await page.getByLabel('Cari bahan ajar').fill('');
        await page.screenshot({ path: path.join(output, 'library-mobile.png'), fullPage: true, animations: 'disabled' });
        await page.setViewportSize({ width: 1440, height: 1050 });
        await page.screenshot({ path: path.join(output, 'library-desktop.png'), fullPage: true, animations: 'disabled' });
        console.log('PASS: student library search + responsive layout');
        const { jsPDF } = require('jspdf'); const pdf = new jsPDF(); pdf.text('Bahan ajar halaman pertama', 20, 20); pdf.addPage(); pdf.text('Halaman kedua', 20, 20); pdfBytes = Buffer.from(pdf.output('arraybuffer'));
        material = { ...material, format: 'pdf', content_html: '', file_name: 'materi.pdf', hasFile: true };
        await page.goto(`${base}/dashboard/learning/${id}`, { waitUntil: 'domcontentloaded' });
        await page.getByRole('button', { name: 'Berikutnya', exact: true }).waitFor();
        await page.getByRole('button', { name: 'Berikutnya', exact: true }).click();
        await page.getByText('Halaman 2 / 2', { exact: true }).waitFor();
        assert.ok(await page.locator('canvas').evaluate(canvas => canvas.width > 100));
        console.log('PASS: PDF rendering + page navigation');
        console.log('Screenshots:', output);
    } finally { await browser.close(); }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
