import fs from 'node:fs';
const BASE = process.env.BASE || 'http://127.0.0.1:3117';
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
check('meta 暴露 configLimits', !!r.data.configLimits, JSON.stringify(r.data.configLimits));

r = await call('/api/login', { method: 'POST', body: { name: '配置测试' } });
check('login', r.status === 200);

/* ── 默认配置 ── */
r = await call('/api/rooms', { method: 'POST', body: { roomName: '默认', botCount: 1 } });
check('默认 3腿/5胜/16列', r.data.game?.rules?.markers === 3 && r.data.game?.rules?.winColumns === 5 && r.data.game?.rules?.columnCount === 16,
  JSON.stringify(r.data.game?.rules));

/* ── 自定义配置 ── */
r = await call('/api/rooms', { method: 'POST', body: { roomName: '自定义', botCount: 1, markers: 2, winColumns: 3, columnCount: 9 } });
const game = r.data.game;
check('自定义 2腿/3胜/9列', game?.rules?.markers === 2 && game?.rules?.winColumns === 3 && game?.rules?.columnCount === 9,
  JSON.stringify(game?.rules));
check('9 条路径落在中间段', game?.rules?.columns?.length === 9 && game.rules.columns.includes(10),
  JSON.stringify(game?.rules?.columns));

/* ── 越界钳制 ── */
r = await call('/api/rooms', { method: 'POST', body: { roomName: '越界', botCount: 1, markers: 99, winColumns: 99, columnCount: 99 } });
check('越界被钳制', r.data.game?.rules?.markers === 6 && r.data.game?.rules?.columnCount === 16 && r.data.game?.rules?.winColumns === 16,
  JSON.stringify(r.data.game?.rules));

/* ── 获胜数 > 列数 时自动降 ── */
r = await call('/api/rooms', { method: 'POST', body: { roomName: '超胜', botCount: 1, winColumns: 10, columnCount: 6 } });
check('胜利数不超过列数', r.data.game?.rules?.winColumns === 6 && r.data.game?.rules?.columnCount === 6,
  JSON.stringify(r.data.game?.rules));

/* ── 打完整局（自定义配置），验证腿数上限与获胜条件 ── */
let steps = 0, lastSeq = -1, maxLegs = 0, idle = 0;
const myGame = game.id;
while (steps++ < 8000) {
  const s = await call(`/api/rooms/${myGame}`);
  const g = s.data.game;
  if (!g) { check('拉取对局', false); break; }
  if (g.ended) { log(`自定义对局结束：胜者 ${JSON.stringify(g.winnerSeats)}，${g.round} 回合`); break; }
  if (g.seq === lastSeq) { idle++; if (idle > 400) { log('等待超时'); break; } await new Promise((x) => setTimeout(x, 40)); continue; }
  idle = 0;
  lastSeq = g.seq;
  maxLegs = Math.max(maxLegs, g.turn.legsUsed || 0);
  if (!g.isYourTurn || g.turn.busted) continue;
  const of = g.turn.offer || [];
  if (!of.length) {
    const val = g.turn.summary.cells + g.turn.legsUsed * 0.9;
    if (val >= 2.5) await call(`/api/games/${myGame}/act`, { method: 'POST', body: { action: 'stop' } });
    else await call(`/api/games/${myGame}/act`, { method: 'POST', body: { action: 'continue' } });
  } else {
    const best = of.filter((o) => o.ok).sort((x, y) => {
      const sx = x.moves.reduce((t2, m) => t2 + m.steps, 0);
      const sy = y.moves.reduce((t2, m) => t2 + m.steps, 0);
      return sy - sx;
    })[0];
    if (best) await call(`/api/games/${myGame}/act`, { method: 'POST', body: { action: 'choose', key: best.key } });
  }
}
const fin = await call(`/api/rooms/${myGame}`);
check('自定义对局已结束', fin.data.game?.ended === true);
check('腿数从未超过 2', maxLegs <= 2, `最大 ${maxLegs}`);
const w = fin.data.game?.players?.[fin.data.game.winnerSeats?.[0]];
check('胜者占领 3 条路径', w?.claimed?.length >= 3, `${w?.claimed?.length} 条`);
const levelCols = new Set(fin.data.game?.rules?.columns);
check('占领的列都在牌面内', (w?.claimed || []).every((n) => levelCols.has(n)), JSON.stringify(w?.claimed));

log('');
log(fail === 0 ? `✅ 全部通过（${out.filter((l) => l.startsWith('PASS')).length} 项）` : `❌ ${fail} 项失败`);
fs.writeFileSync('accept5.txt', out.join('\n'));
process.exit(fail === 0 ? 0 : 1);
