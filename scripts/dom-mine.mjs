// 验证「列号左侧显示自己已走格数」
import { JSDOM } from 'jsdom';
import fs from 'node:fs';

const BASE = 'http://127.0.0.1:3119';
const out = [];
const log = (...a) => out.push(a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' '));

const nodeFetch = globalThis.fetch;
const login = await nodeFetch(BASE + '/api/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ name: '进度测试' }),
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
const tmp = `${process.cwd()}\\.tmp\\app-mine.mjs`;
fs.mkdirSync(`${process.cwd()}\\.tmp`, { recursive: true });
fs.writeFileSync(tmp, src);

const errors = [];
win.addEventListener('error', (e) => errors.push(String(e.message)));
await import('file://' + tmp.replace(/\\/g, '/'));
await new Promise((r) => setTimeout(r, 2500));

const doc = win.document;
log('errors:', errors.length ? errors : 'none');

// 建房（单人对电脑），选 9 列便于观察
const setVal = (id, v) => {
  const el = doc.querySelector(id);
  if (!el) return;
  el.value = String(v);
  el.dispatchEvent(new win.Event('change'));
};
doc.querySelector('#roomName').value = '进度房';
if (doc.querySelector('#setCols')) setVal('#setCols', 9);
doc.querySelector('#createRoom').dispatchEvent(new win.Event('click'));
await new Promise((r) => setTimeout(r, 2800));

log('--- 开局 ---');
log('列行数:', doc.querySelectorAll('.col-row').length);
log('.mine 元素数(应=列数):', doc.querySelectorAll('.mine').length);
log('开局时 .mine 全部为空:', [...doc.querySelectorAll('.mine')].every((e) => e.classList.contains('empty')));

// 走几步，让永久进度出现
let rounds = 0;
for (let i = 0; i < 12; i++) {
  const c = doc.querySelector('.offer.clickable');
  if (c) {
    c.dispatchEvent(new win.Event('click'));
    await new Promise((r) => setTimeout(r, 1400));
  }
  const cb = doc.querySelector('#btnContinue');
  if (cb) {
    const stopBtn = doc.querySelector('#btnStop');
    // 交替：一半继续、一半停止，制造永久进度
    if (i % 3 === 2 && stopBtn && !stopBtn.disabled) {
      stopBtn.dispatchEvent(new win.Event('click'));
      await new Promise((r) => setTimeout(r, 1800));
      rounds++;
    } else {
      cb.dispatchEvent(new win.Event('click'));
      await new Promise((r) => setTimeout(r, 1400));
    }
  }
}
log('--- 打了几回合 ---');
log('reload 前 .mine 非空数量:', [...doc.querySelectorAll('.mine')].filter((e) => !e.classList.contains('empty')).length);

const mines = [...doc.querySelectorAll('.col-row')].map((row) => ({
  num: row.querySelector('.col-num')?.textContent?.trim(),
  mine: row.querySelector('.mine')?.textContent?.trim() || '',
  tip: row.querySelector('.mine')?.getAttribute('title') || '',
}));
log('列号 → 我的进度:', JSON.stringify(mines));

// 检查 DOM 顺序：.mine 必须在 .col-num 左侧
const firstRow = doc.querySelector('.col-row');
const kids = [...(firstRow?.children || [])].map((c) => c.className.split(' ')[0]);
log('第一行子元素顺序:', kids.join(' → '));
log('.mine 在 .col-num 之前:', kids.indexOf('mine') < kids.indexOf('col-num'));

// 每一行的结构都应一致
log('所有行都是 [mine, col-num, spots, owner-tag]:', [...doc.querySelectorAll('.col-row')].every((row) => {
  const k = [...row.children].map((c) => c.className.split(' ')[0]);
  return k[0] === 'mine' && k[1] === 'col-num' && k[2] === 'spots';
}));

// 有进度的行应带 tooltip
const withTip = mines.filter((m) => m.tip);
log('有 tooltip 的行数:', withTip.length, withTip.slice(0, 3).map((m) => m.tip).join(' | '));

log('errors end:', errors.length ? errors : 'none');
fs.writeFileSync('uidom8.txt', out.join('\n'));
process.exit(0);
