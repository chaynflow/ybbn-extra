// 验证「本回合临时推进」显示为 N+M
import { JSDOM } from 'jsdom';
import fs from 'node:fs';

const BASE = 'http://127.0.0.1:3119';
const out = [];
const log = (...a) => out.push(a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' '));

const nodeFetch = globalThis.fetch;
const login = await nodeFetch(BASE + '/api/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ name: '临时进度' }),
});
const token = login.headers.get('set-cookie').split(';')[0];

// 直接调 API 造局面：建房 → 连续 continue 多次，制造 pending
const api = async (p, o = {}) => {
  const r = await nodeFetch(BASE + p, {
    method: o.method || 'GET',
    headers: { 'Content-Type': 'application/json', Cookie: token },
    body: o.body ? JSON.stringify(o.body) : undefined,
  });
  return r.json();
};
const created = await api('/api/rooms', { method: 'POST', body: { roomName: '临时', botCount: 1, columnCount: 9 } });
const gameId = created.game.id;

// 用 UI 渲染
const html = fs.readFileSync('public/index.html', 'utf8').replace(/<script[\s\S]*?<\/script>/g, '');
const dom = new JSDOM(html, { url: BASE + '/#/', pretendToBeVisual: true });
const win = dom.window;
const wrappedFetch = (url, opts = {}) =>
  nodeFetch(new URL(url, BASE).toString(), { ...opts, headers: { ...(opts.headers || {}), Cookie: token } });
win.fetch = wrappedFetch;
globalThis.fetch = wrappedFetch;
globalThis.window = win;
globalThis.document = win.document;
globalThis.location = win.location;
globalThis.location.hash = `#/game/${gameId}`;

const engineUrl = new URL('../shared/engine.js', import.meta.url).href;
let src = fs.readFileSync('public/app.js', 'utf8').replace("'/shared/engine.js'", `'${engineUrl}'`);
const tmp = `${process.cwd()}\\.tmp\\app-mine2.mjs`;
fs.mkdirSync(`${process.cwd()}\\.tmp`, { recursive: true });
fs.writeFileSync(tmp, src);
const errors = [];
win.addEventListener('error', (e) => errors.push(String(e.message)));
await import('file://' + tmp.replace(/\\/g, '/'));
await new Promise((r) => setTimeout(r, 2600));

const doc = win.document;
let foundPending = false;
for (let i = 0; i < 15; i++) {
  // 每个 N+M 意味着该行有 .mine i 元素
  const withPlus = [...doc.querySelectorAll('.mine i')];
  if (withPlus.length) {
    foundPending = true;
    log('✅ 发现临时推进标记:', withPlus.map((e) => e.parentElement.textContent.trim()).join(' | '));
    log('对应 tooltip:', withPlus.map((e) => e.parentElement.getAttribute('title')).join(' | '));
    break;
  }
  const c = doc.querySelector('.offer.clickable');
  if (c) { c.dispatchEvent(new win.Event('click')); await new Promise((r) => setTimeout(r, 1200)); continue; }
  const cb = doc.querySelector('#btnContinue');
  if (cb) { cb.dispatchEvent(new win.Event('click')); await new Promise((r) => setTimeout(r, 1200)); continue; }
  break;
}
log('找到临时推进显示:', foundPending);
log('errors:', errors.length ? errors : 'none');
fs.writeFileSync('uidom9.txt', out.join('\n'));
process.exit(0);
