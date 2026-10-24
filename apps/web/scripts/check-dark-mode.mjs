import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';
import { chromium } from 'playwright';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));

// Exercise actual application CSS without requiring an authenticated exam attempt.
(async () => {
  const root = path.resolve(scriptDirectory, '..');
  const globalFile = path.join(root, 'app/globals.css');
  const compiled = await postcss([tailwind({ base: root })]).process(await fs.readFile(globalFile, 'utf8'), { from: globalFile });
  const css = compiled.css + '\n' + (await Promise.all(['filter-toolbar.css', 'button.css', 'inline-select.css', 'modal.css'].map(name => fs.readFile(path.join(root, 'app/components/ui', name), 'utf8')))).join('\n');
  const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}) });
  try {
    const page = await browser.newPage();
    const html = `<html class="dark"><body><main style="padding:24px;max-width:1000px;margin:auto;display:grid;gap:20px">
      <h1>Bank soal dan ujian</h1>
      <section class="ftb-toolbar"><div class="ftb-field ftb-field--search"><div class="ftb-box"><input class="ftb-input" placeholder="Cari soal" value="Matematika"></div></div></section>
      <section class="bg-white border rounded-xl p-5"><h2>Soal dan stimulus</h2>
        <div class="latex-renderer"><p id="rich" style="color:#000000;background-color:#ffffff">Tentukan nilai x. العربية واضحة</p>
          <table><thead><tr><th id="heading">Data</th></tr></thead><tbody><tr><td id="cell" style="background:#fff;color:#000">25 siswa</td></tr></tbody></table>
          <span id="math" class="katex"><span class="mord">x²</span> + 2x = 8</span>
          <div id="chart" style="height:12px;background:#3083ff"></div>
        </div>
        <p id="explicit" class="dark:text-slate-100">Teks terang eksplisit</p>
        <label class="cbt-option-item border rounded-lg p-3 block" data-selected="false"><span class="cbt-option-badge">A</span> <span id="option">Jawaban belum dipilih</span></label>
        <label id="selected" class="cbt-option-item border rounded-lg p-3 block" data-selected="true"><span class="cbt-option-badge">B</span> Jawaban dipilih</label>
        <label class="text-slate-700">Isian singkat <input id="answer" class="bg-white text-slate-700 border rounded-lg p-2" value="Jawaban siswa"></label>
        <button class="ui-btn ui-btn--primary ui-btn--sm">Lanjut</button>
      </section></main></body></html>`;
    for (const width of [390, 1280]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.setContent(html);
      await page.addStyleTag({ content: css + '\n*,::before,::after { transition: none !important; animation: none !important; }' });
      const result = await page.evaluate(() => {
        const rgb = s => (s.match(/[\d.]+/g) || []).map(Number);
        const luminance = c => c.slice(0,3).map(n => { n/=255; return n<=.04045?n/12.92:((n+.055)/1.055)**2.4; }).reduce((v,n,i)=>v+n*[.2126,.7152,.0722][i],0);
        function background(el) { for (;el;el=el.parentElement) { const c=rgb(getComputedStyle(el).backgroundColor); if (c.length===3 || c[3]===1) return c; } return [13,18,33]; }
        const contrast = Object.fromEntries(['rich','heading','cell','math','explicit','option','answer'].map(id => {const el=document.getElementById(id), a=luminance(rgb(getComputedStyle(el).color)), b=luminance(background(el)); return [id,(Math.max(a,b)+.05)/(Math.min(a,b)+.05)];}));
        const toolbar=getComputedStyle(document.querySelector('.ftb-toolbar'));
        return { contrast, toolbarWidth:toolbar.borderTopWidth, toolbarColor:toolbar.borderTopColor, selected:getComputedStyle(document.querySelector('#selected')).backgroundColor, chart:getComputedStyle(document.querySelector('#chart')).backgroundColor, overflow:document.documentElement.scrollWidth>innerWidth };
      });
      for (const [id, ratio] of Object.entries(result.contrast)) assert(ratio >= 4.5, `${width}: ${id} contrast ${ratio}`);
      assert(!result.overflow, `${width}: horizontal overflow`);
      assert.equal(result.chart, 'rgb(48, 131, 255)', 'Chart data colors must survive');
      if (width===1280) { assert.equal(result.toolbarWidth,'1px'); assert.equal(result.toolbarColor,'rgba(255, 255, 255, 0.12)'); }
      await page.locator('.ftb-input').focus();
      assert.notEqual(await page.locator('.ftb-box').evaluate(el => getComputedStyle(el).boxShadow), 'none', 'Keyboard focus must remain visible');
      await page.locator('.ftb-input').blur();
      await page.screenshot({ path:path.join(os.tmpdir(), `acca-dark-audit-${width}.png`), fullPage:true });
      console.log(JSON.stringify({ width, ...result }));
    }
    // OS dark + application light must retain dark ink on a light surface.
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.evaluate(() => document.documentElement.classList.remove('dark'));
    const lightMath = await page.locator('#math .mord').evaluate(el => getComputedStyle(el).color);
    assert.equal(lightMath, 'rgb(15, 23, 42)', 'Light mode math must not inherit OS-dark ink');
    console.log('PASS: dark mobile/desktop, visible focus, preserved chart colors, and light-mode math.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode=1; });
