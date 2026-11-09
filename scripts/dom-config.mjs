// 验证创建房间的设置项 + 自定义配置的棋盘渲染
import { JSDOM } from 'jsdom';
import fs from 'node:fs';

const BASE = 'http://127.0.0.1:3117';
const out = [];
const log = (...a) => out.push(a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' '));

const nodeFetch = globalThis.fetch;
const login = await nodeFetch(BASE + '/api/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ name: '设置测试' }),
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
const tmp = `${process.cwd()}\\.tmp\\app-cfg.mjs`;
fs.mkdirSync(`${process.cwd()}\\.tmp`, { recursive: true });
fs.writeFileSync(tmp, src);

const errors = [];
win.addEventListener('error', (e) => errors.push(String(e.message)));
await import('file://' + tmp.replace(/\\/g, '/'));
await new Promise((r) => setTimeout(r, 2500));

const doc = win.document;
log('errors:', errors.length ? errors : 'none');

// 设置项是否存在
log('有 setMarkers:', !!doc.querySelector('#setMarkers'));
log('有 setWin:', !!doc.querySelector('#setWin'));
log('有 setCols:', !!doc.querySelector('#setCols'));
if (!doc.querySelector('#setMarkers')) { fs.writeFileSync('uidom6.txt', out.join('\n')); process.exit(3); }

log('路标选项:', [...doc.querySelectorAll('#setMarkers option')].map((o) => o.textContent).join('/'));
log('占领选项:', [...doc.querySelectorAll('#setWin option')].map((o) => o.textContent).join('/'));
log('路径选项:', [...doc.querySelectorAll('#setCols option')].map((o) => o.textContent).join('/'));
log('默认提示:', doc.querySelector('#settingsHint')?.textContent.trim());

// 改成 2 腿 / 3 胜 / 9 列，看提示变化
const setVal = (id, v) => {
  const el = doc.querySelector(id);
  el.value = String(v);
  el.dispatchEvent(new win.Event('change'));
};
setVal('#setMarkers', 2);
setVal('#setWin', 3);
setVal('#setCols', 9);
log('改后提示:', doc.querySelector('#settingsHint')?.textContent.trim());

// 把胜利数设成超过列数，看警告
setVal('#setWin', 8);
setVal('#setCols', 5);
log('超限提示:', doc.querySelector('#settingsHint')?.textContent.trim());

// 恢复成 2/3/9 并建房
setVal('#setMarkers', 2);
setVal('#setWin', 3);
setVal('#setCols', 9);
doc.querySelector('#roomName').value = '自定义房';
doc.querySelector('#createRoom').dispatchEvent(new win.Event('click'));
await new Promise((r) => setTimeout(r, 2800));

log('--- 建房后 ---');
log('hash:', win.location.hash);
log('棋盘列数(应9):', doc.querySelectorAll('.col-row').length);
log('列号:', [...doc.querySelectorAll('.col-num')].map((e) => e.textContent.trim()).join(','));
log('每列格数:', [...doc.querySelectorAll('.spots')].map((e) => e.children.length).join(','));
log('路标点(应2):', doc.querySelectorAll('.marker').length);
log('玩家卡:', doc.querySelectorAll('.player-card').length);
log('分法按钮:', doc.querySelectorAll('.offer').length);
log('提示里提到几枚:', (doc.querySelector('.hint')?.textContent || '').match(/最多推进 (\d+) 个/)?.[1] || '(无)');

// 打几步看腿数上限
let maxLegs = 0;
for (let i = 0; i < 25; i++) {
  maxLegs = Math.max(maxLegs, doc.querySelectorAll('.marker:not(.spent)').length);
  const c = doc.querySelector('.offer.clickable');
  if (c) {
    c.dispatchEvent(new win.Event('click'));
    await new Promise((r) => setTimeout(r, 1500));
    continue;
  }
  const cb = doc.querySelector('#btnContinue');
  if (cb) { cb.dispatchEvent(new win.Event('click')); await new Promise((r) => setTimeout(r, 1500)); continue; }
  break;
}
log('实际腿数峰值(应≤2):', maxLegs);

log('errors end:', errors.length ? errors : 'none');
fs.writeFileSync('uidom6.txt', out.join('\n'));
process.exit(0);
