// Run from repository root: node --test apps/api/test/acca-logout.test.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const web = relative => path.resolve(__dirname, '../../web', relative);
function load(relative, env = {}) {
    const m = { exports: {} };
    const code = ts.transpileModule(fs.readFileSync(web(relative), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    vm.runInNewContext(code, { module: m, exports: m.exports, URL, process: { env } });
    return m.exports;
}

test('CBT logout hands off to the ACCA shared logout page', () => {
    const { accaLogoutUrl } = load('lib/acca-logout.ts');
    assert.equal(accaLogoutUrl('https://acca.icgowa.sch.id'), 'https://acca.icgowa.sch.id/logout?from=cbt');
    assert.equal(accaLogoutUrl('https://acca.icgowa.sch.id/sub/path?x=1'), 'https://acca.icgowa.sch.id/logout?from=cbt');
    assert.equal(load('lib/acca-logout.ts', { NEXT_PUBLIC_ACCA_URL: 'https://acca.test' }).accaLogoutUrl(), 'https://acca.test/logout?from=cbt');
});

test('Header logout clears CBT first, then navigates to ACCA logout (not back to CBT home)', () => {
    const header = fs.readFileSync(web('app/components/Header.tsx'), 'utf8');
    const handler = header.slice(header.indexOf('const handleLogout'), header.indexOf('const displayName'));
    assert.ok(handler.indexOf("fetch('/api/auth/logout'") < handler.indexOf('accaLogoutUrl()'));
    assert.match(handler, /window\.location\.href = accaLogoutUrl\(\);/);
    assert.doesNotMatch(handler, /window\.location\.href = '\/';/);
});
