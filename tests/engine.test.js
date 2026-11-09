import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  RULES,
  PATH_LENGTHS,
  COLUMN_LIST,
  TOTAL_SPACES,
  SPLITS,
  SPLIT_COUNT,
  OFFER_COUNT,
  pathLen,
  rollFromDice,
  valuesForSplit,
  drawOffer,
  candidateSplits,
  createPlayer,
  newGameState,
  newTurn,
  previewValues,
  chooseSplit,
  continueRoll,
  stopTurn,
  legsUsed,
  progressOf,
  columnOwner,
  currentPlayer,
  pendingSummary,
  normalizeRules,
  columnsForCount,
  CONFIG_LIMITS,
} from '../shared/engine.js';
import { bestSplit, surviveProbability, stepOnce } from '../shared/ai.js';

const mkRng = (seed = 1) => {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
};
const mkPlayers = (n = 2) =>
  [0, 1, 2, 3, 4, 5]
    .slice(0, n)
    .map((i) => createPlayer(i, `P${i}`, ['red', 'blue', 'green', 'yellow', 'purple', 'orange'][i]));

test('参数：16 列 3~18、3 腿、5 列胜、每回合抽 5 种', () => {
  assert.deepEqual([...PATH_LENGTHS], [3, 6, 9, 12, 15, 18, 21, 24, 24, 21, 18, 15, 12, 9, 6, 3]);
  assert.deepEqual(COLUMN_LIST.map((c) => c.n), [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18]);
  assert.equal(TOTAL_SPACES, 216);
  assert.equal(RULES.markers, 3);
  assert.equal(RULES.winColumns, 5);
  assert.equal(OFFER_COUNT, 5);
});

test('9 骰自由分组：280 种分法，各为 3×3 覆盖全部骰子', () => {
  assert.equal(SPLIT_COUNT, 280);
  for (const s of SPLITS) {
    assert.equal(s.length, 3);
    assert.ok(s.every((g) => g.length === 3));
    assert.equal(s.flat().sort((a, b) => a - b).join(','), '0,1,2,3,4,5,6,7,8');
  }
  assert.equal(new Set(SPLITS.map((s) => s.map((g) => [...g].sort().join('')).sort().join('|'))).size, 280);
});

test('同一数字出现多次 → 前进多步，只占 1 条腿', () => {
  const ps = mkPlayers(2);
  const pv = previewValues(ps[0], ps, newTurn(1), [10, 10, 10]);
  assert.deepEqual(pv.legs, { 10: 3 });
  assert.equal(pv.moves[0].steps, 3);
  assert.equal(pv.legsCount, 1);
});

test('腿数上限 3：第 4 个新列进不去，已有腿仍可前进', () => {
  const ps = mkPlayers(2);
  const t = newTurn(1);
  t.legs = { 3: 1, 4: 1, 5: 1 };
  const pv = previewValues(ps[0], ps, t, [3, 10, 11]);
  assert.deepEqual(pv.moves.map((m) => m.n), [3]);
  assert.ok(pv.closedSkipped.includes(10));
  assert.ok(pv.closedSkipped.includes(11));
});

test('腿满时重复数字可在同列多步', () => {
  const ps = mkPlayers(2);
  const t = newTurn(1);
  t.legs = { 3: 1, 4: 1, 5: 1 };
  const pv = previewValues(ps[0], ps, t, [3, 3, 10]);
  assert.equal(pv.moves.length, 1);
  assert.equal(pv.moves[0].steps, 2);
});

test('封锁列完全跳过', () => {
  const ps = mkPlayers(2);
  ps[1].claimed = [7];
  const pv = previewValues(ps[0], ps, newTurn(1), [7, 7, 7]);
  assert.equal(pv.ok, false);
  assert.equal(columnOwner(ps, 7), 1);
});

test('drawOffer：从 280 种里随机抽 5 种，不预先过滤，带 ok 标记', () => {
  const ps = mkPlayers(2);
  const rng = mkRng(99);
  let sawDead = false;
  let checked = 0;
  for (let i = 0; i < 300; i++) {
    const t = newTurn(1);
    t.dice = Array.from({ length: 9 }, () => 1 + Math.floor(rng() * 6));
    // 腿满 3 条，逼出一部分走不了的分法
    t.legs = { 3: 1, 4: 1, 5: 1 };
    const offer = drawOffer(ps[0], ps, t, rng);
    assert.ok(offer.length >= 1 && offer.length <= 5);
    for (const o of offer) {
      assert.equal(typeof o.ok, 'boolean');
      assert.ok(Array.isArray(o.values) && o.values.length === 3);
      // ok 必须与 preview 一致
      assert.equal(o.ok, o.preview.moves.length > 0);
      checked++;
      if (!o.ok) sawDead = true;
    }
  }
  assert.ok(checked > 0);
  assert.ok(sawDead, '腿满时应该能抽到走不了的分法');
});

test('offer 里不合法的分法不能被选择', () => {
  const ps = mkPlayers(2);
  const st = newGameState(ps, mkRng(5));
  // 人为塞一个走不了的选项
  st.turn.offer = [
    { key: '99,99,99', values: [99, 99, 99], splitIndex: 0, ok: false, preview: { legs: {}, moves: [], closedSkipped: [99], ok: false } },
  ];
  assert.throws(() => chooseSplit(st, { key: '99,99,99' }), /走不了/);
});

test('不能选不在 offer 里的分法', () => {
  const st = newGameState(mkPlayers(2), mkRng(7));
  assert.throws(() => chooseSplit(st, { key: '1,1,1' }), /不在本回合/);
});

test('开局 offer 里至少有 1 种能走', () => {
  const rng = mkRng(2024);
  for (let i = 0; i < 200; i++) {
    const st = newGameState(mkPlayers(2), rng);
    assert.ok(st.turn.offer?.some((c) => c.ok), `第 ${i} 局开局无可选分法`);
    assert.ok(!st.turn.busted);
  }
});

test('停止写回进度；占满的列被占领，对手进度清零', () => {
  const ps = mkPlayers(2);
  ps[1].progress = { 7: 5 };
  const st = newGameState(ps, mkRng(11));
  st.current = 0;
  st.turn.legs = { 7: pathLen(7) };
  stopTurn(st);
  assert.deepEqual(ps[0].claimed, [7]);
  assert.equal(progressOf(ps[1], 7), 0);
  assert.equal(st.current, 1);
});

test('先占领 5 列者获胜', () => {
  const ps = mkPlayers(2);
  const st = newGameState(ps, mkRng(17));
  ps[0].claimed = [3, 4, 5, 6];
  st.current = 0;
  st.turn.legs = { 8: pathLen(8) };
  stopTurn(st);
  assert.equal(st.ended, true);
  assert.deepEqual(st.winnerSeats, [0]);
});

test('爆掉时本回合进度作废，永久进度不变', () => {
  const ps = mkPlayers(2);
  const st = newGameState(ps, mkRng(13));
  const p = currentPlayer(st);
  for (let n = 3; n <= 18; n++) ps[0].claimed.push(n);
  const before = JSON.stringify(p.progress);
  st.turn.legs = { 7: 5 };
  const r = continueRoll(st, mkRng(99));
  assert.equal(r.busted, true);
  assert.deepEqual(st.turn.legs, {});
  assert.equal(JSON.stringify(p.progress), before);
});

test('AI 完整对局：200 局全部结束，先手不过分占优', () => {
  const winCount = [0, 0];
  const rounds = [];
  for (let i = 0; i < 200; i++) {
    const rng = mkRng(8000 + i * 19);
    const ps = mkPlayers(2);
    const st = newGameState(ps, rng);
    let guard = 0;
    while (!st.ended && guard++ < 20000) stepOnce(st, rng);
    assert.ok(st.ended, `第 ${i} 局未结束`);
    for (const s of st.winnerSeats) winCount[s]++;
    rounds.push(st.turn.round);
  }
  assert.ok(winCount[0] > 50 && winCount[1] > 50, `胜场失衡: ${winCount}`);
  rounds.sort((a, b) => a - b);
  assert.ok(rounds[100] >= 25 && rounds[100] <= 100, `回合数中位异常: ${rounds[100]}`);
});

test('AI 只会挑 ok 的分法', () => {
  const rng = mkRng(31);
  for (let i = 0; i < 100; i++) {
    const st = newGameState(mkPlayers(2), rng);
    const b = bestSplit(st);
    if (b) assert.equal(b.ok, true);
  }
});

test('pendingSummary / surviveProbability 正常', () => {
  const t = newTurn(1);
  t.legs = { 3: 3, 7: 5 };
  const s = pendingSummary(t);
  assert.equal(s.legs, 2);
  assert.equal(s.tops, 1);
  assert.equal(s.cells, 8);

  const p = surviveProbability(newGameState(mkPlayers(2), mkRng(3)));
  assert.ok(p > 0 && p <= 1);
});

/* ═══════════ 可配置规则 ═══════════ */

test('normalizeRules：默认值与范围钳制', () => {
  const d = normalizeRules({});
  assert.equal(d.markers, 3);
  assert.equal(d.winColumns, 5);
  assert.equal(d.columnCount, 16);
  assert.equal(d.columns.length, 16);

  const clamp1 = normalizeRules({ markers: 99, winColumns: 99, columnCount: 99 });
  assert.equal(clamp1.markers, 6);
  assert.equal(clamp1.columnCount, 16);
  assert.equal(clamp1.winColumns, 16);

  const low = normalizeRules({ markers: -5, winColumns: 0, columnCount: 0 });
  assert.equal(low.markers, 1);
  assert.equal(low.winColumns, 1);
  assert.equal(low.columnCount, 1);
});

test('normalizeRules：获胜列数不会超过牌面列数', () => {
  const r = normalizeRules({ columnCount: 6, winColumns: 10 });
  assert.equal(r.columnCount, 6);
  assert.equal(r.winColumns, 6);
  assert.equal(r.columns.length, 6);
});

test('columnsForCount：围绕中间截取，且连续', () => {
  assert.equal(columnsForCount(16).length, 16);
  assert.deepEqual(columnsForCount(16)[0], 3);
  assert.deepEqual(columnsForCount(16)[15], 18);

  const c10 = columnsForCount(10);
  assert.equal(c10.length, 10);
  assert.deepEqual(c10, [6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);

  const c5 = columnsForCount(5);
  assert.equal(c5.length, 5);
  // 连续且含中间列
  assert.ok(c5.includes(10));
  for (let i = 1; i < c5.length; i++) assert.equal(c5[i], c5[i - 1] + 1);

  // 任何数量都应连续且居中
  for (let n = 1; n <= 16; n++) {
    const cols = columnsForCount(n);
    assert.equal(cols.length, n);
    for (let i = 1; i < cols.length; i++) assert.equal(cols[i], cols[i - 1] + 1);
  }
});

test('每局配置独立：不同 markers 生效', () => {
  for (const markers of [1, 2, 3, 5, 6]) {
    const ps = mkPlayers(2);
    const st = newGameState(ps, mkRng(11), { markers, winColumns: 5, columnCount: 16 });
    assert.equal(st.rules.markers, markers);
    // 腿数永远不会超过配置
    let guard = 0;
    while (!st.turn.busted && !st.turn.stopped && guard++ < 50) {
      const best = bestSplit(st);
      if (!best) break;
      chooseSplit(st, { key: best.key });
      assert.ok(legsUsed(st.turn.legs) <= markers, `腿数 ${legsUsed(st.turn.legs)} 超过 ${markers}`);
      const c = continueRoll(st, mkRng(guard * 7 + 1));
      if (c.busted) break;
    }
  }
});

test('牌面之外的列不会被推进', () => {
  const ps = mkPlayers(2);
  const st = newGameState(ps, mkRng(21), { markers: 3, winColumns: 3, columnCount: 10 });
  const cols = new Set(st.rules.columns);
  assert.ok(!cols.has(3), '10 条路径时不应含 3 号列');

  // 直接喂一个落在牌面外的数字
  const t = newTurn(1);
  t.dice = [1, 1, 1, 1, 1, 1, 1, 1, 1];
  const pv = previewValues(ps[0], ps, t, [3, 3, 3], { markers: 3, columns: st.rules.columns });
  assert.equal(pv.ok, false);
  assert.ok(pv.closedSkipped.includes(3));
});

test('获胜列数按每局配置判定', () => {
  for (const winColumns of [1, 2, 5]) {
    const ps = mkPlayers(2);
    const st = newGameState(ps, mkRng(31), { markers: 3, winColumns, columnCount: 16 });
    ps[0].claimed = [3, 4, 5, 6].slice(0, winColumns - 1);
    st.current = 0;
    // 再占一条
    const target = [7, 8, 9, 10].find((n) => !ps[0].claimed.includes(n));
    st.turn.legs = { [target]: pathLen(target) };
    stopTurn(st);
    assert.equal(st.ended, true, `winColumns=${winColumns} 应在占满后结束`);
    assert.deepEqual(st.winnerSeats, [0]);
  }
});

test('AI 在极小配置下也能打完（2 腿 / 2 列胜 / 7 条路径）', () => {
  for (let i = 0; i < 40; i++) {
    const rng = mkRng(900 + i * 7);
    const ps = mkPlayers(2);
    const st = newGameState(ps, rng, { markers: 2, winColumns: 2, columnCount: 7 });
    let guard = 0;
    while (!st.ended && guard++ < 20000) stepOnce(st, rng);
    assert.ok(st.ended, `第 ${i} 局未结束`);
    const w = ps[st.winnerSeats[0]];
    assert.ok(w.claimed.length >= 2);
    // 占领的列都在牌面内
    const cols = new Set(st.rules.columns);
    for (const n of w.claimed) assert.ok(cols.has(n), `占领了牌面外的 ${n} 号列`);
  }
});

/* ═══════════ 展示方案数 offerCount ═══════════ */

test('offerCount：范围 1~10，默认 5', () => {
  assert.equal(CONFIG_LIMITS.offerCount.min, 1);
  assert.equal(CONFIG_LIMITS.offerCount.max, 10);
  assert.equal(normalizeRules({}).offerCount, 5);
  assert.equal(normalizeRules({ offerCount: 1 }).offerCount, 1);
  assert.equal(normalizeRules({ offerCount: 10 }).offerCount, 10);
  assert.equal(normalizeRules({ offerCount: 99 }).offerCount, 10, '超上限应钳到 10');
  assert.equal(normalizeRules({ offerCount: 0 }).offerCount, 1, '低于下限应钳到 1');
  assert.equal(normalizeRules({ offerCount: -3 }).offerCount, 1);
});

test('offerCount：实际发出方案数与配置一致', () => {
  for (const offerCount of [1, 2, 3, 5, 7, 10]) {
    const ps = mkPlayers(2);
    const st = newGameState(ps, mkRng(100 + offerCount), { markers: 3, winColumns: 5, columnCount: 16, offerCount });
    assert.equal(st.rules.offerCount, offerCount);
    assert.ok(st.turn.offer, '开局应有 offer');
    assert.ok(
      st.turn.offer.length <= offerCount,
      `offer 长度 ${st.turn.offer.length} 不应超过 ${offerCount}`,
    );
    if (st.turn.offer.length !== offerCount) {
      // 只在去重后组合数不足时才会少于配置值
      const all = candidateSplits(currentPlayer(st), st.players, st.turn);
      const distinct = new Set(all.map((c) => c.key)).size;
      assert.ok(distinct <= offerCount, `只有 ${distinct} 种可用组合，offer 少于 ${offerCount} 合理`);
    }
  }
});

test('offerCount=1 时只给一个方案，仍可正常对局', () => {
  const winCount = [0, 0];
  for (let i = 0; i < 40; i++) {
    const rng = mkRng(700 + i * 11);
    const ps = mkPlayers(2);
    const st = newGameState(ps, rng, { markers: 3, winColumns: 3, columnCount: 9, offerCount: 1 });
    let guard = 0;
    while (!st.ended && guard++ < 30000) stepOnce(st, rng);
    assert.ok(st.ended, `第 ${i} 局未结束`);
    for (const s of st.winnerSeats) winCount[s]++;
  }
  assert.ok(winCount[0] + winCount[1] === 40);
});

test('offerCount=10 时最多给 10 个方案', () => {
  const ps = mkPlayers(2);
  const rng = mkRng(4242);
  let maxSeen = 0;
  for (let i = 0; i < 100; i++) {
    const st = newGameState(ps.map((p) => createPlayer(p.seat, p.name, p.color)), rng, { offerCount: 10 });
    maxSeen = Math.max(maxSeen, st.turn.offer?.length || 0);
    assert.ok((st.turn.offer?.length || 0) <= 10);
  }
  assert.ok(maxSeen <= 10, `应不超过 10，实际 ${maxSeen}`);
});
