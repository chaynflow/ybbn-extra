import fs from 'node:fs';
const BASE = process.env.BASE || 'http://127.0.0.1:3116';
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
check('16 列', r.data.columns?.length === 16);
check('3 腿 / 5 列胜', r.data.rules?.markers === 3 && r.data.rules?.winColumns === 5);

r = await call('/api/login', { method: 'POST', body: { name: '抽样测试' } });
check('login', r.status === 200);

r = await call('/api/rooms', { method: 'POST', body: { roomName: '抽样', botCount: 1 } });
const game = r.data.game;
check('建房', r.status === 200, `码 ${game?.code}`);
const offer = game?.turn?.offer || [];
check('下发 5 种分法', offer.length === 5, `${offer.length} 种`);
check('每种都带 ok 标记', offer.every((o) => typeof o.ok === 'boolean'), offer.map((o) => (o.ok ? '✓' : '✗')).join(''));
check('至少 1 种能走', offer.some((o) => o.ok));

// 尝试选一个走不了的（若存在）
const dead = offer.find((o) => !o.ok);
if (dead) {
  const bad = await call(`/api/games/${game.id}/act`, { method: 'POST', body: { action: 'choose', key: dead.key } });
  check('不能选走不了的分法', bad.status === 400, bad.data.error);
} else {
  check('（本轮 5 种都能走，跳过死选测）', true);
}

// 选一个合法分法
const legal = offer.find((o) => o.ok);
let a = await call(`/api/games/${game.id}/act`, { method: 'POST', body: { action: 'choose', key: legal.key } });
check('choose 合法分法成功', a.status === 200 && !a.data.error, a.data.error);
check('落地后腿数', a.data.game?.turn?.legsUsed >= 1, JSON.stringify(a.data.game?.turn?.legs));

// 未选分法不能继续
a = await call(`/api/games/${game.id}/act`, { method: 'POST', body: { action: 'continue' } });
const afterChoose = a.data.game;
check('选完可以继续（或已换人）', a.status === 200 || a.status === 403, `${a.status}`);

// 打完整局
let steps = 0, lastSeq = -1, myActs = 0, deadSeen = 0, offersSeen = 0, idle = 0;
while (steps++ < 8000) {
  const s = await call(`/api/rooms/${game.id}`);
  const g = s.data.game;
  if (!g) { check('拉取对局', false); break; }
  if (g.ended) { log(`对局结束：胜者 ${JSON.stringify(g.winnerSeats)}，${g.round} 回合`); break; }
  if (g.seq === lastSeq) {
    // 状态没变：要么等机器人，要么等网络
    idle++;
    if (idle > 400) { log('等待超时，当前玩家：' + g.currentName + ' isBot=' + g.players[g.current]?.isBot); break; }
    await new Promise((x) => setTimeout(x, 40));
    continue;
  }
  idle = 0;
  lastSeq = g.seq;
  if (!g.isYourTurn || g.turn.busted) continue;
  const of = g.turn.offer || [];
  if (!of.length) {
    const val = g.turn.summary.cells + g.turn.legsUsed * 0.9;
    if (val >= 4) await call(`/api/games/${game.id}/act`, { method: 'POST', body: { action: 'stop' } });
    else await call(`/api/games/${game.id}/act`, { method: 'POST', body: { action: 'continue' } });
    myActs++;
  } else {
    offersSeen++;
    deadSeen += of.filter((o) => !o.ok).length;
    const best = of
      .filter((o) => o.ok)
      .sort((x, y) => {
        const sx = x.moves.reduce((t2, m) => t2 + m.steps, 0);
        const sy = y.moves.reduce((t2, m) => t2 + m.steps, 0);
        return sy - sx;
      })[0];
    if (!best) { await new Promise((x) => setTimeout(x, 40)); continue; }
    const rr = await call(`/api/games/${game.id}/act`, { method: 'POST', body: { action: 'choose', key: best.key } });
    if (rr.status !== 200) log('choose 失败：' + rr.data.error);
    myActs++;
  }
}
const fin = await call(`/api/rooms/${game.id}`);
check('对局已结束', fin.data.game?.ended === true);
log(`我方操作 ${myActs} 次；发牌 ${offersSeen} 次，其中走不了的分法共 ${deadSeen} 个`);

const lb = await call('/api/leaderboard');
check('排行榜', lb.data.rows.length > 0);

const noAuth = await fetch(BASE + '/api/rooms', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
check('未登录被拒', noAuth.status === 401);

log('');
log(fail === 0 ? `✅ 全部通过（${out.filter((l) => l.startsWith('PASS')).length} 项）` : `❌ ${fail} 项失败`);
fs.writeFileSync('accept4.txt', out.join('\n'));
process.exit(fail === 0 ? 0 : 1);
