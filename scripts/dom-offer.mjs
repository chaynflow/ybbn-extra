// 验证「展示方案 ?/280」设置项与对局中的实际展示数量
import { JSDOM } from 'jsdom';
import fs from 'node:fs';

const BASE = 'http://127.0.0.1:3118';
const out = [];
const log = (...a) => out.push(a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' '));

const nodeFetch = globalThis.fetch;
const login = await nodeFetch(BASE + '/api/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ name: '方案UI' }),
});
const token = login.headers.get('set-cookie').split(';')[0];

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

const engineUrl = new URL('../shared/engine.js', import.meta.url).href;
let src = fs.readFileSync('public/app.js', 'utf8').replace("'/shared/engine.js'", `'${engineUrl}'`);
const tmp = `${process.cwd()}\\.tmp\\app-oc.mjs`;
fs.mkdirSync(`${process.cwd()}\\.tmp`, { recursive: true });
fs.writeFileSync(tmp, src);

const errors = [];
win.addEventListener('error', (e) => errors.push(String(e.message)));
await import('file://' + tmp.replace(/\\/g, '/'));
await new Promise((r) => setTimeout(r, 2500));

const doc = win.document;
log('errors:', errors.length ? errors : 'none');
log('有 setOffer:', !!doc.querySelector('#setOffer'));
if (!doc.querySelector('#setOffer')) { fs.writeFileSync('uidom7.txt', out.join('\n')); process.exit(3); }

log('方案选项(应为 ?/280 形式):', [...doc.querySelectorAll('#setOffer option')].map((o) => o.textContent).join(' / '));
log('选项数量(应10):', doc.querySelectorAll('#setOffer option').length);
log('默认提示:', doc.querySelector('#settingsHint')?.textContent.trim());

const setVal = (id, v) => {
  const el = doc.querySelector(id);
  el.value = String(v);
  el.dispatchEvent(new win.Event('change'));
};
setVal('#setOffer', 2);
log('选 2 后提示:', doc.querySelector('#settingsHint')?.textContent.trim());
setVal('#setOffer', 10);
log('选 10 后提示:', doc.querySelector('#settingsHint')?.textContent.trim());

// 用 offerCount=3 建房
setVal('#setOffer', 3);
setVal('#setCols', 9);
setVal('#setWin', 3);
doc.querySelector('#roomName').value = '三方案房';
doc.querySelector('#createRoom').dispatchEvent(new win.Event('click'));
await new Promise((r) => setTimeout(r, 2800));

log('--- 建房后 ---');
log('棋盘列(应9):', doc.querySelectorAll('.col-row').length);
log('分法按钮数(应3):', doc.querySelectorAll('.offer').length);
log('选择提示:', doc.querySelector('.choose-hint')?.textContent.replace(/\s+/g, ' ').trim());

// 继续摇几次，确认一直 ≤3
let maxOffers = 0;
for (let i = 0; i < 8; i++) {
  maxOffers = Math.max(maxOffers, doc.querySelectorAll('.offer').length);
  const c = doc.querySelector('.offer.clickable');
  if (c) { c.dispatchEvent(new win.Event('click')); await new Promise((r) => setTimeout(r, 1500)); continue; }
  const cb = doc.querySelector('#btnContinue');
  if (cb) { cb.dispatchEvent(new win.Event('click')); await new Promise((r) => setTimeout(r, 1500)); continue; }
  break;
}
log('发牌数峰值(应≤3):', maxOffers);
log('继续摇提示:', doc.querySelector('.hint')?.textContent.replace(/\s+/g, ' ').trim().slice(0, 100) || '(无)');
log('errors end:', errors.length ? errors : 'none');
fs.writeFileSync('uidom7.txt', out.join('\n'));
process.exit(0);
