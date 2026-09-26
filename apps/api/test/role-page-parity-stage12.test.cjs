// Run from repository root: node --test apps/api/test/role-page-parity-stage12.test.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const root = path.resolve(__dirname, '../..');
const web = (...parts) => path.join(root, 'web', ...parts);
const api = (...parts) => path.join(root, 'api', ...parts);

const roles = ['admin', 'guru', 'proktor'];
const sharedPath = web('app', 'components', 'questions', 'QuestionBankDetailPage.tsx');

test('QA-03: semua route detail bank soal memakai satu implementasi bersama', () => {
    for (const role of roles) {
        const routePath = web('app', 'dashboard', role, 'questions', '[bankId]', 'page.tsx');
        const source = fs.readFileSync(routePath, 'utf8');

        assert.match(source, /QuestionBankDetailPage/);
        assert.match(source, new RegExp(`role=["']${role}["']`));
        assert.ok(source.split(/\r?\n/).length <= 8, `${role} kembali menduplikasi implementasi halaman`);
    }
});

test('QA-03: implementasi bersama mengisolasi cache dan navigasi menurut route peran', () => {
    const source = fs.readFileSync(sharedPath, 'utf8');

    assert.match(source, /type QuestionBankRole = 'admin' \| 'guru' \| 'proktor'/);
    assert.match(source, /cachePrefix = `\$\{role\}_questions_\$\{bankId\}`/);
    assert.match(source, /questionsBasePath = `\/dashboard\/\$\{role\}\/questions`/);
    assert.doesNotMatch(source, /\/dashboard\/(admin|guru|proktor)\/questions/);
});

test('QA-03: tautan template mati sudah dihapus dari seluruh implementasi halaman', () => {
    const sources = [sharedPath, ...roles.map((role) =>
        web('app', 'dashboard', role, 'questions', '[bankId]', 'page.tsx'))]
        .map((file) => fs.readFileSync(file, 'utf8'))
        .join('\n');

    assert.doesNotMatch(sources, /handleExportTemplate/);
    assert.doesNotMatch(sources, /template_soal\.docx/);
});

test('QA-03: otorisasi bank soal tetap ditegakkan backend', () => {
    const controller = fs.readFileSync(api('src', 'questions', 'questions.controller.ts'), 'utf8');
    const questionService = fs.readFileSync(api('src', 'questions', 'questions.service.ts'), 'utf8');
    const bankService = fs.readFileSync(api('src', 'questions', 'question-banks.service.ts'), 'utf8');

    assert.match(controller, /@UseGuards\(JwtAuthGuard, RolesGuard\)/);
    assert.ok((questionService.match(/authz\.assertBankAccess/g) || []).length >= 3);
    assert.match(questionService, /authz\.assertBankAccessByChild/);
    assert.ok((bankService.match(/authz\.assertBankAccess/g) || []).length >= 4);
});
