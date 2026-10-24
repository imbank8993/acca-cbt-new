import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';
import {chromium} from 'playwright';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const from=path.join(root,'app/globals.css');
const css=(await postcss([tailwind({base:root})]).process(await fs.readFile(from,'utf8'),{from})).css;
const browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHANNEL?{channel:process.env.PLAYWRIGHT_CHANNEL}:{})});
try {
 for(const width of [1280,390]) {
  const context=await browser.newContext({viewport:{width,height:800},hasTouch:true,isMobile:false});
  const page=await context.newPage();
  await page.setContent('<html class="scroll-locked"><body class="scroll-locked"><div style="height:2000px">Background</div><div style="position:fixed;inset:0;display:flex;align-items:center;justify-content:center"><div id="scroller" class="mdl-body" style="height:300px;max-width:300px;overflow-y:auto;background:white"><div style="height:1500px;flex-shrink:0">Scrollable dialog</div></div></div></body></html>');
  await page.addStyleTag({content:css});
  const cdp=await context.newCDPSession(page);
  const box=await page.locator('#scroller').boundingBox();
  const x=Math.round(box.x+box.width/2), y=Math.round(box.y+230);
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});
  for(let i=1;i<=12;i++) {
   await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y:y-i*15}]});
   await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(resolve)));
  }
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  await page.waitForFunction(()=>document.querySelector('#scroller').scrollTop>0);
  assert.equal(await page.evaluate(()=>window.scrollY),0,'Background stays locked');
  console.log(`PASS ${width}px: touch scroll moves dialog; background stays locked.`);
  await context.close();
 }
} finally {await browser.close();}
