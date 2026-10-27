import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const round = process.env.FILMMA_QA_ROUND ?? '1';
if (!['1', '2'].includes(round)) throw new Error('La revisión visual se limita a dos rondas.');
const destination = resolve('output/qa');
await mkdir(destination, { recursive: true });
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const evidence = [];
try {
  for (const [device, viewport] of [['desktop', { width: 1440, height: 1000 }], ['mobile', { width: 390, height: 844 }]]) {
    const context = await browser.newContext({ viewport, deviceScaleFactor: 1, reducedMotion: 'reduce', locale: 'es-CL' });
    // This capture observes the user's live app. All API mutations are blocked.
    const blocked = [], errors = [], page = await context.newPage();
    await page.route('**/api/**', async (route) => {
      if (!['GET', 'HEAD'].includes(route.request().method())) { blocked.push({ method: route.request().method(), url: route.request().url() }); await route.abort(); }
      else await route.continue();
    });
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(process.env.FILMMA_QA_URL ?? 'http://127.0.0.1:4318', { waitUntil: 'domcontentloaded' });
    await page.getByRole('heading', { name: /La sala de montaje/ }).waitFor({ timeout: 45000 });
    await page.locator('.viewer img').evaluateAll(async (images) => Promise.all(images.map((image) => image.decode().catch(() => {}))));
    const metrics = await page.evaluate(() => ({ width: innerWidth, documentWidth: document.documentElement.scrollWidth, bodyWidth: document.body.scrollWidth, heading: document.querySelector('h1')?.textContent, controlsBelow44: [...document.querySelectorAll('button,a,input,select')].filter((element) => { const rect = element.getBoundingClientRect(); return rect.width && rect.height && (rect.width < 44 || rect.height < 44); }).map((element) => ({ label: element.getAttribute('aria-label') || element.textContent?.trim().slice(0, 70), width: Math.round(element.getBoundingClientRect().width), height: Math.round(element.getBoundingClientRect().height) })).slice(0, 24) }));
    const file = `${destination}/${device}-round${round}.png`;
    await page.screenshot({ path: file, fullPage: true, animations: 'disabled' });
    evidence.push({ device, viewport, file, metrics, errors, blockedMutations: blocked });
    await context.close();
  }
} finally { await browser.close(); }
await writeFile(`${destination}/visual-round${round}.json`, JSON.stringify(evidence, null, 2));
console.log(JSON.stringify(evidence, null, 2));
