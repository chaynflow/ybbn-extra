// 在 Node 中执行 public/app.js 的真实渲染逻辑（jsdom 提供 DOM）
import { JSDOM } from 'jsdom';
import fs from 'node:fs';

const BASE = 'http://127.0.0.1:3116';
const out = [];
const log = (...a) => out.push(a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' '));

const nodeFetch = globalThis.fetch;
const login = await nodeFetch(BASE + '/api/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ name: 'UI测试' }),
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
const tmp = `${process.cwd()}\\.tmp\\app-ui.mjs`;
fs.mkdirSync(`${process.cwd()}\\.tmp`, { recursive: true });
fs.writeFileSync(tmp, src);

const errors = [];
win.addEventListener('error', (e) => errors.push(String(e.message)));
try {
  await import('file://' + tmp.replace(/\\/g, '/'));
} catch (e) {
  errors.push('import: ' + e.message);
}
await new Promise((r) => setTimeout(r, 2500));

const doc = win.document;
log('errors:', errors.length ? errors : 'none');
log('h1:', doc.querySelector('h1')?.textContent || '(none)');
if (!doc.querySelector('#createRoom')) {
  fs.writeFileSync('uidom4.txt', out.join('\n'));
  process.exit(3);
}

doc.querySelector('#roomName').value = 'UI 房';
doc.querySelector('#createRoom').dispatchEvent(new win.Event('click'));
await new Promise((r) => setTimeout(r, 2500));

log('hash:', win.location.hash);
log('.board 子节点(应16):', doc.querySelector('.board')?.children.length);
log('骰子数(应9):', doc.querySelectorAll('.die').length);
log('骰子小点(应81):', doc.querySelectorAll('.pip').length);
log('路标点(应3):', doc.querySelectorAll('.marker').length);
log('分法按钮数:', doc.querySelectorAll('.offer').length);
log('可点击分法:', doc.querySelectorAll('.offer.clickable').length);
log('走不了的分法:', doc.querySelectorAll('.offer.dead').length);
log('分法内容:', [...doc.querySelectorAll('.offer')].map((e) => {
  const v = e.querySelector('.offer-values')?.textContent;
  const dead = e.classList.contains('dead') ? ' ✗' : '';
  return v + dead;
}).join(' | '));
log('提示:', doc.querySelector('.choose-hint')?.textContent.trim() || '(无)');
log('每列格数:', [...doc.querySelectorAll('.spots')].map((e) => e.children.length).join(','));

// 点第一个可点击的分法
const first = doc.querySelector('.offer.clickable');
if (first) {
  first.dispatchEvent(new win.Event('click'));
  await new Promise((r) => setTimeout(r, 2500));
  log('--- 选择后 ---');
  log('可选分法(应为0):', doc.querySelectorAll('.offer.clickable').length);
  log('腿高亮格:', doc.querySelectorAll('.spot.leg').length);
  log('路标已用:', doc.querySelectorAll('.marker:not(.spent)').length);
  log('摘要:', doc.querySelector('.pending-box')?.textContent.replace(/\s+/g, ' ').trim().slice(0, 110));
  log('操作按钮:', [...doc.querySelectorAll('#btnStop,#btnContinue')].map((b) => b.textContent.trim()).join(' | ') || '(无)');
  const cb = doc.querySelector('#btnContinue');
  if (cb) {
    cb.dispatchEvent(new win.Event('click'));
    await new Promise((r) => setTimeout(r, 2500));
    log('--- 继续摇后 ---');
    log('可点击分法:', doc.querySelectorAll('.offer.clickable').length);
    log('走不了的分法:', doc.querySelectorAll('.offer.dead').length);
    log('骰子数:', doc.querySelectorAll('.die').length);
  }
}

log('errors end:', errors.length ? errors : 'none');
fs.writeFileSync('uidom4.txt', out.join('\n'));
process.exit(0);
