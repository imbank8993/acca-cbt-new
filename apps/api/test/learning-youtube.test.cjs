const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
require('ts-node').register({ project: path.resolve(__dirname, '../tsconfig.json'), transpileOnly: true });
const { ForbiddenException } = require('@nestjs/common');
const { plainToInstance } = require('class-transformer');
const { validate } = require('class-validator');
const { canonicalYoutubeUrl, youtubeEmbedUrl, youtubeVideoId, youtubeStartSeconds } = require('@acca-cbt/shared');
const { LearningService } = require('../src/learning/learning.service.ts');
const { UpdateMaterialDto } = require('../src/learning/learning.dto.ts');
const { fixtureDb } = require('./fixture-db.cjs');

const teacher = { id: 'teacher', roles: ['Guru'] };
const dto = (contentHtml, extra = {}) => ({ revision: 1, title: 'Video', description: '', subject: 'Fisika', status: 'draft', format: 'youtube', contentHtml, conversionNotes: 'x', ...extra });
function setup(row = {}) {
    const db = fixtureDb({ cbt_learning_materials: [{ id: 'm', created_by: 'teacher', organization_id: 'school', title: 'Old', revision: 1, content_version: 1, status: 'draft', format: 'html', content_html: '<p>lama</p>', ...row }], cbt_learning_progress: [] });
    const auth = { async assertOrgRole(user, org, roles) { if (org !== 'school' || !user.roles.some(role => roles.includes(role))) throw new ForbiddenException(); } };
    return { db, service: new LearningService(db, auth, {}, {}) };
}

test('YouTube links in common forms resolve to the video ID; other sites and malformed IDs are refused', () => {
    const id = 'dQw4w9WgXcQ';
    for (const link of [`https://www.youtube.com/watch?v=${id}`, `youtube.com/watch?v=${id}&list=PL1`, `https://youtu.be/${id}?si=abc`,
        `https://m.youtube.com/watch?v=${id}`, `https://www.youtube.com/shorts/${id}`, `https://www.youtube.com/embed/${id}`,
        `https://www.youtube-nocookie.com/embed/${id}`, `https://www.youtube.com/live/${id}`, ` ${id} `]) {
        assert.equal(youtubeVideoId(link), id, link);
    }
    for (const link of ['', 'https://vimeo.com/123', `https://evil.example/watch?v=${id}`, `https://youtube.com.evil.example/watch?v=${id}`,
        'https://www.youtube.com/watch?v=short', 'javascript:alert(1)', `ftp://youtube.com/watch?v=${id}`, 'https://www.youtube.com/@channel']) {
        assert.equal(youtubeVideoId(link), null, link);
    }
    assert.equal(youtubeStartSeconds(`https://youtu.be/${id}?t=90`), 90);
    assert.equal(youtubeStartSeconds(`https://www.youtube.com/watch?v=${id}&t=1m30s`), 90);
    assert.equal(canonicalYoutubeUrl(`https://youtu.be/${id}?t=1h2m3s&si=tracking`), `https://www.youtube.com/watch?v=${id}&t=3723`);
    assert.equal(youtubeEmbedUrl(`https://www.youtube.com/watch?v=${id}&t=90`), `https://www.youtube-nocookie.com/embed/${id}?rel=0&modestbranding=1&playsinline=1&start=90`);
});

test('saving a YouTube material stores only the canonical link and rejects invalid links', async () => {
    const { service, db } = setup();
    const { material } = await service.update(teacher, 'school', 'm', dto('https://youtu.be/dQw4w9WgXcQ?si=tracking'));
    assert.equal(material.format, 'youtube');
    assert.equal(material.content_html, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    assert.equal(material.conversion_notes, '');
    assert.equal(db.tables.cbt_learning_materials[0].content_version, 2, 'siswa diminta membaca ulang bila isi berganti');
    await assert.rejects(setup().service.update(teacher, 'school', 'm', dto('<iframe src="https://evil.example"></iframe>')), /Tautan YouTube tidak valid/);
    await assert.rejects(setup().service.update(teacher, 'school', 'm', dto('', { status: 'published' })), /Tempel tautan video YouTube/);
    assert.equal((await validate(plainToInstance(UpdateMaterialDto, dto('https://youtu.be/dQw4w9WgXcQ')))).length, 0);
});

test('a compiled LaTeX material can be switched to a YouTube video', async () => {
    const { service } = setup({ format: 'latex', rendered_pdf_key: 'pdf', content_html: '' });
    const { material } = await service.update(teacher, 'school', 'm', dto('https://www.youtube.com/watch?v=dQw4w9WgXcQ'));
    assert.equal(material.format, 'youtube');
});

test('reader plays YouTube outside the sandboxed HTML frame with the referrer YouTube requires', () => {
    const preview = fs.readFileSync(path.resolve(__dirname, '../../web/app/components/learning/MaterialPreview.tsx'), 'utf8');
    assert.match(preview, /youtube \? <YoutubePreview url=\{material\.content_html\}/);
    assert.match(preview, /material\.content_html && !youtube/, 'tautan tidak pernah dirender sebagai dokumen HTML');
    assert.match(preview, /referrerPolicy="strict-origin-when-cross-origin"/);
    const editor = fs.readFileSync(path.resolve(__dirname, '../../web/app/dashboard/learning/[id]/edit/page.tsx'), 'utf8');
    assert.match(editor, /<h2>Video YouTube<\/h2>/);
    assert.match(editor, /format: 'youtube' as const, content_html: youtubeUrl/);
});
