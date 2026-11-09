// Browser smoke test using your installed Google Chrome (no browser download).
// Usage: npm run build && npm run e2e   (starts `vite preview` itself)
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright-core';

const PORT = 4179;
const BASE = `http://localhost:${PORT}`;
const SHOTS = process.env.SHOTS_DIR || 'e2e/screenshots';
mkdirSync(SHOTS, { recursive: true });

const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'pipe' });
await new Promise((res, rej) => {
  server.stdout.on('data', (d) => d.toString().includes('Local') && res());
  server.on('exit', () => rej(new Error('preview server exited')));
  setTimeout(() => rej(new Error('preview server timeout')), 20000);
});

const failures = [];
const check = (cond, msg) => {
  console.log(`${cond ? '  ✓' : '  ✗'} ${msg}`);
  if (!cond) failures.push(msg);
};

const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  for (const vp of [
    { name: 'desktop', width: 1440, height: 900 },
    { name: 'mobile', width: 390, height: 844 },
  ]) {
    console.log(`\n== ${vp.name} (${vp.width}px) ==`);
    const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

    for (const path of ['/calendar', '/events/gtm-panel', '/events/media-night', '/events/joseph-mock', '/events/siemens', '/events/nope', '/contacts', '/news', '/news?tab=saved', '/news?tab=lab', '/settings']) {
      await page.goto(BASE + path);
      await page.waitForTimeout(400);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      check(overflow <= 0, `${path}: no horizontal page overflow (${overflow}px)`);
      await page.screenshot({ path: `${SHOTS}/${vp.name}-${path.replace(/[/?=]/g, '_') || 'root'}.png`, fullPage: vp.name === 'desktop' && !path.includes('lab') });
    }

    // Calendar → event → back keeps week and scroll position.
    await page.goto(BASE + '/calendar?week=2026-11-09');
    const link = page.getByRole('link', { name: 'Open brief: Presentation: Siemens: Company Overview and Programs' });
    await link.scrollIntoViewIfNeeded();
    await page.waitForTimeout(100);
    const before = await page.evaluate(() => window.scrollY);
    check(before > 0, `calendar scrolled before opening event (${before})`);
    await link.click();
    await page.getByRole('heading', { level: 1, name: /Siemens/ }).waitFor();
    await page.getByRole('button', { name: /Back to calendar/ }).click();
    await page.getByText('Sample week · Nov 9–15, 2026').waitFor();
    await page.waitForTimeout(150);
    const after = await page.evaluate(() => window.scrollY);
    check(Math.abs(after - before) < 5, `returns to same week and scroll position (${before} → ${after})`);

    // Siemens generate: double click does one generation.
    await page.goto(BASE + '/events/siemens');
    const gen = page.getByRole('button', { name: /Generate demo brief now/ });
    if (await gen.count()) {
      await gen.dblclick();
      await page.getByRole('heading', { name: /Suggested questions/ }).waitFor({ timeout: 5000 });
      check(true, 'Siemens brief generated on demand');
    }

    if (vp.name === 'desktop') {
      // Lab: drag persists, click opens drawer, drag does not open drawer, reset works.
      await page.goto(BASE + '/news?tab=lab');
      const node = page.locator('.react-flow__node-article').first();
      await node.waitFor();
      const nodeCount = await page.locator('.react-flow__node-article').count();
      check(nodeCount === 6, `Lab shows 6 saved article nodes (${nodeCount})`);
      const hubs = await page.locator('.react-flow__node-hub').count();
      check(hubs === 4, `Lab shows 4 industry hubs (${hubs})`);
      // No initial overlap between any nodes.
      const boxes = await page.locator('.react-flow__node').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().toJSON()));
      let overlaps = 0;
      for (let i = 0; i < boxes.length; i++)
        for (let j = i + 1; j < boxes.length; j++) {
          const a = boxes[i], b = boxes[j];
          if (a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom) overlaps++;
        }
      check(overlaps === 0, `no initial node overlap (${overlaps})`);
      const id = await node.getAttribute('data-id');
      const b0 = await node.boundingBox();
      await page.mouse.move(b0.x + 40, b0.y + 30);
      await page.mouse.down();
      await page.mouse.move(b0.x + 140, b0.y + 110, { steps: 12 });
      await page.mouse.up();
      await page.waitForTimeout(200);
      check((await page.getByRole('dialog').count()) === 0, 'dragging a node does not open the drawer');
      const stored = await page.evaluate((aid) => JSON.parse(localStorage.getItem('networking-studio:v1')).labPositions[aid.replace('article:', '')], id);
      check(!!stored, `drag position stored (${JSON.stringify(stored)})`);
      await page.reload();
      await page.locator(`[data-id="${id}"]`).waitFor();
      const stored2 = await page.evaluate((aid) => JSON.parse(localStorage.getItem('networking-studio:v1')).labPositions[aid.replace('article:', '')], id);
      check(JSON.stringify(stored) === JSON.stringify(stored2), 'drag position survives reload');
      await page.locator(`[data-id="${id}"]`).click();
      check((await page.getByRole('dialog').count()) === 1, 'clicking a node opens its summary drawer');
      await page.keyboard.press('Escape');
      await page.getByRole('button', { name: 'Reset layout' }).click();
      await page.waitForTimeout(200);
      const afterReset = await page.evaluate((aid) => JSON.parse(localStorage.getItem('networking-studio:v1')).labPositions[aid.replace('article:', '')], id);
      check(afterReset === undefined, 'reset layout clears the moved position');
      await page.screenshot({ path: `${SHOTS}/desktop-lab-after.png` });
    }

    check(errors.length === 0, `no console errors or uncaught exceptions${errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''}`);
    await ctx.close();
  }
} finally {
  await browser.close();
  server.kill();
}
console.log(failures.length ? `\n${failures.length} check(s) failed` : '\nAll browser checks passed');
process.exit(failures.length ? 1 : 0);
