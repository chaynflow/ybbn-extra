/**
 * 欲罢不能 · 9骰扩展包 —— 电脑 AI + 胜率模拟（纯函数，前后端共用）
 *
 * 玩家每次摇骰后的决策：
 *   1. **选分法**：从 280 种分组里挑 3 个数字（候选分法通常 10~80 种）
 *   2. **继续 / 停止**
 */
import {
  RULES,
  pathLen,
  progressOf,
  columnOwner,
  candidateSplits,
  chooseSplit,
  continueRoll,
  stopTurn,
  startTurn,
  currentPlayer,
  clonePlayers,
  legsUsed,
} from './engine.js';

/** 单组 3 骰求和的概率分布（3~18） */
export const SUM3_PROB = (() => {
  const cnt = {};
  for (let a = 1; a <= 6; a++)
    for (let b = 1; b <= 6; b++)
      for (let c = 1; c <= 6; c++) {
        const s = a + b + c;
        cnt[s] = (cnt[s] || 0) + 1;
      }
  const out = {};
  for (let n = 3; n <= 18; n++) out[n] = (cnt[n] || 0) / 216;
  return out;
})();

/* ───────────── 选分法 ───────────── */

/**
 * 给一个候选分法打分：越高越好。
 *   - 每走 1 格有基础价值
 *   - 能占领的列价值极高
 *   - 已投入进度的列更值得推进（沉没成本 + 回报递增）
 *   - 新开一列要花腿，价值打个折
 *   - 越靠近顶部的格子越值钱（因为接近占领）
 */
export function scoreCandidate(state, cand) {
  const player = currentPlayer(state);
  const turn = state.turn;
  let total = 0;

  for (const m of cand.preview.moves) {
    const n = m.n;
    const len = pathLen(n);
    const base = progressOf(player, n);
    const finalPos = m.to;

    // 这一组动作推进的格数
    const steps = m.to - Math.max(base, m.from);
    // 每格基础分：越靠顶越值钱
    for (let pos = Math.max(base, m.from) + 1; pos <= m.to; pos++) {
      total += 0.6 + (pos / len) * 1.4;
    }
    // 沉没进度加成（已投入的列更容易占领，值得继续）
    if (base > 0) total += steps * (base / len) * 0.9;
    // 新开一列花腿
    if (m.newLeg) total -= 0.55;
    // 本回合这列已经走了几步（重复数字）
    if (steps > 1) total += steps * 0.35;
    // 直接走满
    if (finalPos >= len) total += 6;
    else if (len - finalPos <= 2) total += 1.8;
  }

  // 占用列越少越好（省腿给后面）
  total -= Math.max(0, cand.preview.legsCount - legsUsed(turn.legs)) * 0.25;

  return total;
}

/**
 * 从本回合提供的 5 种分法里挑最好的一个（只能选 ok=true 的）。
 * （玩家也只能从 offer 里选，AI 同理）
 */
export function bestSplit(state) {
  const offer = (state.turn.offer || []).filter((c) => c.ok);
  if (!offer.length) return null;
  let best = offer[0];
  let bestScore = -Infinity;
  for (const c of offer) {
    const s = scoreCandidate(state, c);
    if (s > bestScore) {
      bestScore = s;
      best = c;
    }
  }
  return best;
}

/* ───────────── 继续 / 停止 ───────────── */

/** 估算“再摇一次仍能落地”的概率（粗估，用于停止判断） */
export function surviveProbability(state) {
  const turn = state.turn;
  const player = currentPlayer(state);
  const players = state.players;

  // 已有腿所在列的概率质量
  let hit = 0;
  for (const [sn, at] of Object.entries(turn.legs)) {
    const n = Number(sn);
    if (at >= pathLen(n)) continue;
    hit += SUM3_PROB[n] || 0;
  }
  // 剩余可开新列的概率质量
  let open = 0;
  if (legsUsed(turn.legs) < RULES.markers) {
    for (let n = 3; n <= 18; n++) {
      if (turn.legs[n]) continue;
      if (columnOwner(players, n) !== null) continue;
      if (progressOf(player, n) >= pathLen(n)) continue;
      open += SUM3_PROB[n];
    }
  }
  const missOne = Math.max(0, 1 - (hit + open));
  // 3 个数字全部都 miss 才爆
  return 1 - Math.pow(missOne, RULES.groups);
}

/**
 * 该不该停（>0 表示该停）。
 *   停止值 V（本回合已攒下的东西） vs 继续值：survive × (V + ΔV)
 */
export function stopScore(state) {
  const turn = state.turn;
  if (!turn.dice || turn.stopped) return -Infinity;
  const player = currentPlayer(state);

  let gainedCells = 0;
  let claimValue = 0;
  for (const [sn, at] of Object.entries(turn.legs)) {
    const n = Number(sn);
    const len = pathLen(n);
    const added = at - progressOf(player, n);
    if (added > 0) gainedCells += added;
    if (at >= len) claimValue += 5.0;
    else if (len - at === 1) claimValue += 3.2;
    else if (len - at === 2) claimValue += 1.2;
  }
  if (!gainedCells) return -Infinity;

  const survive = surviveProbability(state);
  const bustRisk = 1 - survive;
  const V = gainedCells + claimValue;
  const deltaV = legsUsed(turn.legs) * 0.9;
  const leadWeight = 1 + player.claimed.length * 0.12;

  return V * bustRisk * leadWeight - deltaV * survive;
}

export function shouldStop(state, aggressiveness = 0.5) {
  const s = stopScore(state);
  if (!Number.isFinite(s)) return false;
  return s > (0.5 - aggressiveness) * 2.2;
}

/* ───────────── 决策 ───────────── */

/**
 * AI 一次完整决策（在“还没选分法”的节点上）：
 *   选最优分法落地，然后决定继续或停止。
 * 返回 { action, split }
 */
export function aiPlaySplit(state, rng = Math.random) {
  if (state.ended) return { action: 'end' };
  if (state.turn.stopped) return { action: 'end' };

  const best = bestSplit(state);
  if (!best) {
    state.turn.busted = true;
    state.turn.stopped = true;
    state.turn.legs = {};
    state.turn.offer = null;
    state.seq++;
    return { action: 'bust' };
  }
  chooseSplit(state, { key: best.key });
  return { action: 'split', values: best.values };
}

/**
 * 把当前玩家的整个回合打完（从“待选分法”开始直到停/爆）。
 * stopTurn 会自动换人；爆掉则需要调用方 passAfterBust。
 */
export function playTurnToEnd(state, rng = Math.random) {
  let guard = 0;
  while (!state.ended && !state.turn.stopped && guard++ < 500) {
    // 1) 选分法落地
    if (shouldStop(state, 0.5)) {
      // 还没落地就已经够本了（基本不会发生）
      stopTurn(state, rng);
      return 'stop';
    }
    const r = aiPlaySplit(state, rng);
    if (r.action === 'bust') return 'bust';
    // 2) 落地后判断是否停止
    if (shouldStop(state, 0.5)) {
      stopTurn(state, rng);
      return 'stop';
    }
    // 3) 继续摇
    const c = continueRoll(state, rng);
    if (c.busted) return 'bust';
  }
  if (!state.ended && state.turn.busted) return 'bust';
  return 'end';
}

/* ───────────── 对局推进 ───────────── */

/**
 * 推进一步：当前玩家若是机器人就打完整回合。
 * 人类玩家需要外部调用 chooseSplit / stopTurn。
 */
export function stepOnce(state, rng = Math.random) {
  if (state.ended) return 'end';
  if (state.turn.busted) {
    passAfterBustLocal(state, rng);
    return 'bust';
  }
  if (state.turn.stopped) return 'end';
  return playTurnToEnd(state, rng);
}

function passAfterBustLocal(state, rng) {
  const { passAfterBust } = { passAfterBust: (s, r) => {
    s.current = (s.current + 1) % s.players.length;
    for (let g = 0; g < 100; g++) {
      startTurn(s, r);
      if (!s.turn.busted) return s;
      s.log.push({ t: 'bust', seat: currentPlayer(s).seat });
      s.current = (s.current + 1) % s.players.length;
    }
    return s;
  } };
  return passAfterBust(state, rng);
}

/* ───────────── 胜率模拟 ───────────── */

export function simulateWinRates(state, iterations = 100, seed = Date.now()) {
  let s = seed >>> 0 || 1;
  const rng = () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
  const N = Math.max(10, Math.min(400, iterations | 0));
  const wins = state.players.map(() => 0);
  let unfinished = 0;

  for (let it = 0; it < N; it++) {
    const sim = {
      ...state,
      players: clonePlayers(state.players),
      turn: { ...state.turn, legs: { ...state.turn.legs }, log: [] },
      log: [],
      winnerSeats: null,
      ended: false,
    };
    let guard = 0;
    while (!sim.ended && guard++ < 3000) stepOnce(sim, rng);
    if (sim.winnerSeats) for (const seat of sim.winnerSeats) wins[seat]++;
    else unfinished++;
  }
  return {
    iterations: N,
    results: state.players.map((p, i) => ({
      seat: p.seat,
      name: p.name,
      color: p.color,
      rate: wins[i] / N,
    })),
    unfinished: unfinished / N,
  };
}
