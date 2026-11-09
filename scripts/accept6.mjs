import fs from 'node:fs';
const BASE = process.env.BASE || 'http://127.0.0.1:3118';
let cookie = '';
async function call(path, opts = {}) {
  const res = await fetch(BASE + path, {
    method: opts.method || 'GET',
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const sc = res.headers.get('set-cookie');
  if (sc) cookie = sc.split(';')[0];
  const t = await res.text();
  let d;
  try { d = JSON.parse(t); } catch { d = { raw: t }; }
  return { status: res.status, data: d };
}
const out = [];
const log = (...a) => out.push(a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' '));
let fail = 0;
const check = (n, c, extra = '') => { log(`${c ? 'PASS' : 'FAIL'}  ${n}${extra ? '  ' + extra : ''}`); if (!c) fail++; };

let r = await call('/api/health');
check('health', r.status === 200);

r = await call('/api/meta');
check('meta 含 offerCount 限制', r.data.configLimits?.offerCount?.min === 1 && r.data.configLimits?.offerCount?.max === 10,
  JSON.stringify(r.data.configLimits?.offerCount));
check('meta 含 splitCount=280', r.data.splitCount === 280, String(r.data.splitCount));

r = await call('/api/login', { method: 'POST', body: { name: '方案数测试' } });
check('login', r.status === 200);

/* 默认 */
r = await call('/api/rooms', { method: 'POST', body: { roomName: '默认', botCount: 1 } });
check('默认 offerCount=5', r.data.game?.rules?.offerCount === 5, String(r.data.game?.rules?.offerCount));
check('默认实际发 5 种', (r.data.game?.turn?.offer || []).length <= 5);

/* offerCount = 1 */
r = await call('/api/rooms', { method: 'POST', body: { roomName: '一个方案', botCount: 1, offerCount: 1 } });
const g1 = r.data.game;
check('offerCount=1 生效', g1?.rules?.offerCount === 1, String(g1?.rules?.offerCount));
check('实际只发 1 种', (g1?.turn?.offer || []).length === 1, `${(g1?.turn?.offer || []).length} 种`);

/* offerCount = 10 */
r = await call('/api/rooms', { method: 'POST', body: { roomName: '十个方案', botCount: 1, offerCount: 10 } });
const g10 = r.data.game;
check('offerCount=10 生效', g10?.rules?.offerCount === 10, String(g10?.rules?.offerCount));
check('实际发 ≤10 种', (g10?.turn?.offer || []).length <= 10, `${(g10?.turn?.offer || []).length} 种`);

/* 越界 */
r = await call('/api/rooms', { method: 'POST', body: { roomName: '越界', botCount: 1, offerCount: 99 } });
check('offerCount=99 钳到 10', r.data.game?.rules?.offerCount === 10, String(r.data.game?.rules?.offerCount));
r = await call('/api/rooms', { method: 'POST', body: { roomName: '越界2', botCount: 1, offerCount: 0 } });
check('offerCount=0 钳到 1', r.data.game?.rules?.offerCount === 1, String(r.data.game?.rules?.offerCount));

/* 用 offerCount=2 打完整局，验证实际发牌数始终 ≤2 */
const gameId = (await call('/api/rooms', { method: 'POST', body: { roomName: '实战', botCount: 1, offerCount: 2, markers: 3, winColumns: 3, columnCount: 9 } })).data.game.id;
let steps = 0, lastSeq = -1, maxOffer = 0, offers = 0, idle = 0, finished = false;
while (steps++ < 8000) {
  const s = await call(`/api/rooms/${gameId}`);
  const g = s.data.game;
  if (!g) { check('拉取对局', false); break; }
  if (g.ended) { finished = true; log(`对局结束：胜者 ${JSON.stringify(g.winnerSeats)}，${g.round} 回合`); break; }
  if (g.seq === lastSeq) { idle++; if (idle > 400) break; await new Promise((x) => setTimeout(x, 40)); continue; }
  idle = 0;
  lastSeq = g.seq;
  if (!g.isYourTurn || g.turn.busted) continue;
  const of = g.turn.offer || [];
  if (of.length) {
    offers++;
    maxOffer = Math.max(maxOffer, of.length);
    const best = of.filter((o) => o.ok).sort((x, y) => {
      const sx = x.moves.reduce((t2, m) => t2 + m.steps, 0);
      const sy = y.moves.reduce((t2, m) => t2 + m.steps, 0);
      return sy - sx;
    })[0];
    if (best) await call(`/api/games/${gameId}/act`, { method: 'POST', body: { action: 'choose', key: best.key } });
  } else {
    const val = g.turn.summary.cells + g.turn.legsUsed * 0.9;
    if (val >= 2.5) await call(`/api/games/${gameId}/act`, { method: 'POST', body: { action: 'stop' } });
    else await call(`/api/games/${gameId}/act`, { method: 'POST', body: { action: 'continue' } });
  }
}
check('对局已结束', finished);
check('发牌数始终 ≤2', maxOffer <= 2, `峰值 ${maxOffer}，共发牌 ${offers} 次`);

log('');
log(fail === 0 ? `✅ 全部通过（${out.filter((l) => l.startsWith('PASS')).length} 项）` : `❌ ${fail} 项失败`);
fs.writeFileSync('accept6.txt', out.join('\n'));
process.exit(fail === 0 ? 0 : 1);
