/**
 * Regenerates the README screenshots in docs/. Drives a headless Edge or Chrome
 * over the DevTools protocol against the dev server, which must be running:
 *
 *   npm run dev            # in one terminal
 *   npm run screenshots    # in another
 *
 * Set BROWSER to a Chrome or Edge executable if neither default path exists,
 * and URL if the dev server isn't on http://localhost:5173/.
 */

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const URL = process.env.URL ?? 'http://localhost:5173/';
const OUT = 'docs';
const PORT = 9333;
const [W, H] = [1600, 1000];

const candidates = [
  process.env.BROWSER,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].filter((p): p is string => !!p);
const browserPath = candidates.find((p) => existsSync(p));
if (!browserPath) throw new Error('No Chrome or Edge found; set BROWSER to its executable.');

const profile = mkdtempSync(join(tmpdir(), 'fermi-shots-'));
const browser = spawn(browserPath, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, `--window-size=${W},${H}`, '--hide-scrollbars', 'about:blank'], {
  stdio: 'ignore',
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function pageSocket(): Promise<string> {
  for (let i = 0; i < 50; i++) {
    try {
      const list = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()) as { type: string; webSocketDebuggerUrl: string }[];
      const page = list.find((t) => t.type === 'page');
      if (page) return page.webSocketDebuggerUrl;
    } catch {
      // Not up yet.
    }
    await sleep(200);
  }
  throw new Error('browser did not start');
}

const ws = new WebSocket(await pageSocket());
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
let nextId = 0;
const pending = new Map<number, (v: { result?: unknown; error?: { message: string } }) => void>();
ws.addEventListener('message', (e) => {
  const msg = JSON.parse(String(e.data));
  if (msg.id !== undefined) pending.get(msg.id)?.(msg);
});
async function send<T = unknown>(method: string, params: object = {}): Promise<T> {
  const id = ++nextId;
  ws.send(JSON.stringify({ id, method, params }));
  const msg = await new Promise<{ result?: unknown; error?: { message: string } }>((r) => pending.set(id, r));
  if (msg.error) throw new Error(`${method}: ${msg.error.message}`);
  return msg.result as T;
}
/** Run an expression in the page; promises are awaited. */
async function page<T = unknown>(expression: string): Promise<T> {
  const r = await send<{ result: { value: T }; exceptionDetails?: { text: string; exception?: { description?: string } } }>('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
  return r.result.value;
}
async function shoot(name: string) {
  await sleep(400); // a few frames to draw
  const { data } = await send<{ data: string }>('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(OUT, name), Buffer.from(data, 'base64'));
  console.log(`wrote ${join(OUT, name)}`);
}

/** Pick a preset and size, run it, and wait until the simulation has reached time t. */
async function runTo(preset: string, size: string, t: number) {
  await page(`(() => {
    const p = document.getElementById('preset'); p.value = ${JSON.stringify(preset)}; p.dispatchEvent(new Event('change', { bubbles: true }));
    const s = document.getElementById('size'); s.value = ${JSON.stringify(size)}; s.dispatchEvent(new Event('change'));
    document.getElementById('run').click();
  })()`);
  for (let i = 0; i < 600; i++) {
    await sleep(500);
    const reached = await page<boolean>(`(() => { if (!window.fermi.result) return false; window.fermi.setTime(${t}); return document.getElementById('tlabel').textContent.startsWith(${JSON.stringify(t.toFixed(2))}); })()`);
    if (reached) break;
  }
  // Pause on that moment.
  await page(`(() => { const b = document.getElementById('run'); if (b.textContent.includes('Pause')) b.click(); window.fermi.setTime(${t}); })()`);
}

try {
  mkdirSync(OUT, { recursive: true });
  await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
  await send('Page.enable');
  await send('Page.navigate', { url: URL });
  // Wait for the viewer to be up.
  for (let i = 0; i < 100; i++) {
    await sleep(200);
    if (await page<boolean>(`!!(window.fermi && document.getElementById('preset'))`).catch(() => false)) break;
  }

  // Mid-run, while empires are still growing into empty space and meeting.
  const T = 10.5;
  await runTo('baseline', '12,120000', T);

  // 1. The whole box.
  await page(`window.fermi.select(-1); window.fermi.map.reset()`);
  await shoot('overview.png');

  // 2. Up close, around the middle: single galaxy groups, strikes in flight, stay-at-homes.
  await page(`(() => {
    // About 5x in from filling the screen: close enough that each group is its own disc.
    for (let i = 0; i < 7; i++) window.fermi.map.zoomAt(innerWidth / 2, innerHeight / 2, 1.25);
    window.fermi.setTime(${T});
  })()`);
  await shoot('closeup.png');

  // 3. The Universe menu: kinds of civilisation and conditions of nature.
  await page(`(() => { window.fermi.map.reset(); window.fermi.setTime(${T}); document.getElementById('universe-btn').click(); })()`);
  await shoot('universe-menu.png');
} finally {
  ws.close();
  // Stop the browser and every helper process it started. On Windows, Edge's
  // launcher hands off to a new process and exits, so match them by this run's
  // own profile folder instead.
  browser.kill();
  if (process.platform === 'win32') {
    const kill = `Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*${profile}*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`;
    spawnSync('powershell', ['-NoProfile', '-Command', kill], { stdio: 'ignore' });
  }
  await sleep(1000);
  try {
    rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
  } catch {
    console.warn(`couldn't remove the temporary browser profile ${profile}`);
  }
}
