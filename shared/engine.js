/**
 * 欲罢不能 · 9骰扩展包 —— 纯游戏引擎（服务端 / 浏览器共用，无 Node / DOM 依赖）
 *
 * 严格遵循标准版 Can't Stop 骨架，改动只有「骰子」「路径表」「获胜列数」。
 *
 * ═══════════════════════════ 规则 ═══════════════════════════
 *
 * 【骰子：9 枚，玩家自由分组】
 *   每回合摇 9 枚骰子。玩家把 9 枚骰子**任意**分成 3 组、每组 3 枚（共 280 种分法），
 *   每组 3 枚求和得到一个数字 → 本回合得到 **3 个数字**（3~18）。
 *   标准版是 4 骰自由拆成 2 组各 2 枚（3 种分法）；本扩展是 9 骰拆 3 组各 3 枚（280 种分法）。
 *
 * 【同一数字出现多次 = 走多步】
 *   若 3 个数字里有重复，例如 10,10,10，则 10 号列**前进 3 格**。
 *   同一回合内同一列只占用 1 条临时路标（多次前进不额外占用）。
 *
 * 【临时路标 = 5 条腿】
 *   每回合有 5 枚临时路标，代表**本回合最多能推进 5 个不同的列**。
 *   路标不是消耗品：同一列可以反复前进，永不消耗。
 *
 * 【能走的必须走（must perform all moves possible）】
 *   选定分法后，引擎**强制**把 3 个数字全部落地：
 *     - 该列已有腿 → 前进 1 格（重复数字则前进多格，见上）
 *     - 该列没有腿 → 占用一条新腿，从「永久进度 +1」开始
 *     - 该列已被占领（封锁）→ 该数字作废，不推进
 *   若 3 个数字**一个都推不动**（腿已满 5 条且都落不进已有列，或全部落在封锁列）→ 爆掉。
 *
 * 【回合】
 *   落地之后玩家二选一：**继续摇**（再选一次分组）或 **停止**（把腿写回永久进度）。
 *   继续后若无法推进 → **BUST**，本回合新推进全部作废。
 *
 * 【占领与胜利】
 *   某列走到最后一格并在停止时确认 → 该列归该玩家并永久封锁：
 *   其他玩家在该列的进度清零，任何人（包括自己）都不能再推进该列。
 *   先占领 **4 列**者获胜。
 */

export const PLAYER_COLORS = [
  { key: 'red', name: '红', hex: '#e5484d' },
  { key: 'blue', name: '蓝', hex: '#3b82f6' },
  { key: 'green', name: '绿', hex: '#22c55e' },
  { key: 'yellow', name: '黄', hex: '#eab308' },
  { key: 'purple', name: '紫', hex: '#a855f7' },
  { key: 'orange', name: '橙', hex: '#f97316' },
];

/** 3~18 号路径长度（下标 0 对应 3 号）。改规则时只改这一处。 */
export const PATH_LENGTHS = Object.freeze([3, 6, 9, 12, 15, 18, 21, 24, 24, 21, 18, 15, 12, 9, 6, 3]);

export const RULES = Object.freeze({
  name: '欲罢不能 · 9骰扩展包',
  diceTotal: 9,
  groups: 3,
  dicePerGroup: 3,
  /** 每回合临时路标（腿）数 = 本回合最多推进的列数 */
  markers: 3,
  columnMin: 3,
  columnMax: 18,
  pathMin: 3,
  pathMax: 18,
  /** 占领多少列获胜 */
  winColumns: 5,
  maxPlayers: 6,
});

export function pathLen(n) {
  if (!Number.isInteger(n) || n < 3 || n > 18) return 0;
  return PATH_LENGTHS[n - 3];
}

export const COLUMN_LIST = Array.from({ length: 16 }, (_, i) => {
  const n = i + 3;
  return { n, len: pathLen(n) };
});

export const COLUMN_NUMS = COLUMN_LIST.map((c) => c.n);
export const TOTAL_SPACES = PATH_LENGTHS.reduce((a, b) => a + b, 0);

export function spotScore(index0) {
  return index0 + 1;
}

export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
export const isColumnNumber = (n) => Number.isInteger(n) && n >= 3 && n <= 18;

/* ═══════════════════ 骰子：280 种分组 ═══════════════════ */

/**
 * 预计算 9 个位置分成 3 个无标号三元组的全部方案（280 种），
 * 每种方案用扁平数组表示：[[i,j,k],[i,j,k],[i,j,k]]
 */
export const SPLITS = (() => {
  const res = [];
  const combosOf = (arr, k) => {
    const out = [];
    const cur = [];
    const rec = (start) => {
      if (cur.length === k) {
        out.push([...cur]);
        return;
      }
      for (let i = start; i < arr.length; i++) {
        cur.push(arr[i]);
        rec(i + 1);
        cur.pop();
      }
    };
    rec(0);
    return out;
  };
  const idx = [0, 1, 2, 3, 4, 5, 6, 7, 8];

  // 无标号：第 1 组必须含 0 号骰；第 2 组必须含剩余最小骰
  for (const g1 of combosOf(idx, 3)) {
    if (!g1.includes(0)) continue;
    const rest1 = idx.filter((i) => !g1.includes(i));
    for (const g2 of combosOf(rest1, 3)) {
      if (!g2.includes(rest1[0])) continue;
      const g3 = rest1.filter((i) => !g2.includes(i));
      res.push([g1, g2, g3]);
    }
  }
  return Object.freeze(res.map(Object.freeze));
})();

export const SPLIT_COUNT = SPLITS.length; // 280

/** 按某种分法计算 3 个数字 */
export function valuesForSplit(dice, split) {
  return split.map((g) => dice[g[0]] + dice[g[1]] + dice[g[2]]);
}

/** 所有分法产生的数字组合（去重后），用于 UI 列出可选的“数字组合” */
export function distinctCombos(dice) {
  const map = new Map();
  SPLITS.forEach((split, i) => {
    const v = valuesForSplit(dice, split);
    const key = [...v].sort((a, b) => a - b).join(',');
    if (!map.has(key)) map.set(key, { key, values: v, splitIndex: i });
  });
  return [...map.values()];
}

/**
 * 摇骰。返回骰面（9 个 1~6），以及可选的数字组合。
 * 注意：roll 本身还没有“3 个数字”，要等玩家选分法。
 */
export function rollDice(rng = Math.random) {
  const dice = Array.from({ length: RULES.diceTotal }, () => 1 + Math.floor(rng() * 6));
  return { dice, combos: distinctCombos(dice) };
}

export function rollFromDice(dice) {
  if (!Array.isArray(dice) || dice.length !== RULES.diceTotal) throw new Error('需要 9 枚骰子');
  const d = dice.map((x) => clamp(Math.round(Number(x)), 1, 6));
  return { dice: d, combos: distinctCombos(d) };
}

/* ═══════════════════ 玩家 ═══════════════════ */

export function createPlayer(seat, name, color, isBot = false) {
  const def = PLAYER_COLORS.find((c) => c.key === color) || PLAYER_COLORS[seat % PLAYER_COLORS.length];
  return {
    seat,
    name: String(name || `玩家${seat + 1}`).slice(0, 20),
    color: def.key,
    hex: def.hex,
    isBot: !!isBot,
    /** 永久进度：列 → 已推进格数 */
    progress: {},
    /** 已占领的列 */
    claimed: [],
    spots: 0,
    score: 0,
  };
}

export function clonePlayer(p) {
  return { ...p, progress: { ...p.progress }, claimed: [...p.claimed] };
}

export function clonePlayers(ps) {
  return ps.map(clonePlayer);
}

export function progressOf(player, n) {
  return Math.min(pathLen(n), Math.max(0, (player.progress || {})[n] || 0));
}

export function columnOwner(players, n) {
  for (const p of players) if (p.claimed?.includes(n)) return p.seat;
  return null;
}

export function recomputeStats(player) {
  if (!player.progress) player.progress = {};
  if (!player.claimed) player.claimed = [];
  let spots = 0;
  let score = 0;
  for (const [sn, cells] of Object.entries(player.progress)) {
    const n = Number(sn);
    if (player.claimed.includes(n)) {
      const len = pathLen(n);
      spots += len;
      score += (len * (len + 1)) / 2;
      continue;
    }
    const c = clamp(cells, 0, pathLen(n));
    spots += c;
    score += (c * (c + 1)) / 2;
  }
  player.spots = spots;
  player.score = score;
  return player;
}

/* ═══════════════════ 回合 ═══════════════════ */

export function newTurn(round = 1) {
  return {
    round,
    dice: null,
    /** 本回合提供给玩家选择的 5 种分法：[{ key, values, splitIndex, preview }] */
    offer: null,
    /** 本回合的腿：列号 → 该列上腿所在的格数（1..len） */
    legs: {},
    /** 最近一次落地的记录 */
    lastMove: null,
    stopped: false,
    busted: false,
    rolls: 0,
    log: [],
  };
}

export const legsUsed = (legs) => Object.keys(legs || {}).length;
export const legsLeft = (legs) => RULES.markers - legsUsed(legs);

/**
 * 计算应用一组数字（3 个值，允许重复）后，每条腿的新位置。
 * **不修改 state**，用于预览所有候选分法。
 *
 * 返回 {
 *   ok: boolean,
 *   reason?: string,
 *   legs: 新的 legs 对象,
 *   moves: [{ n, from, to, steps }],
 *   closedSkipped: [n...]   被封锁而跳过的数字
 * }
 */
export function previewValues(player, players, turn, values) {
  const legs = { ...turn.legs };
  const moves = [];
  const closedSkipped = [];
  let used = legsUsed(legs);

  // 统计每个数字出现次数（重复 = 多步）
  const counts = new Map();
  for (const v of values) counts.set(v, (counts.get(v) || 0) + 1);

  // 先处理已有腿的列（不需要新腿），再处理新列
  const nums = [...counts.keys()].sort((a, b) => {
    const aHas = legs[a] > 0 ? 1 : 0;
    const bHas = legs[b] > 0 ? 1 : 0;
    return bHas - aHas;
  });

  for (const n of nums) {
    const steps = counts.get(n);
    if (!isColumnNumber(n)) {
      closedSkipped.push(n);
      continue;
    }
    if (columnOwner(players, n) !== null) {
      closedSkipped.push(n);
      continue;
    }
    const len = pathLen(n);
    let cur = legs[n] || 0;
    const from = cur;

    if (!cur) {
      // 需要新腿
      if (used >= RULES.markers) {
        closedSkipped.push(n); // 腿不够，该数字作废
        continue;
      }
      const base = progressOf(player, n);
      if (base >= len) {
        closedSkipped.push(n);
        continue;
      }
      cur = base + 1;
      used += 1;
      legs[n] = cur;
      moves.push({ n, from: base, to: cur, steps: 1, newLeg: true, extra: steps - 1 });
      // 剩余的重复次数继续前进
      if (steps > 1) {
        const extra = Math.min(steps - 1, len - cur);
        if (extra > 0) {
          cur += extra;
          legs[n] = cur;
          moves[moves.length - 1].to = cur;
          moves[moves.length - 1].steps += extra;
        }
      }
      continue;
    }

    // 已有腿：前进 steps 格
    if (cur >= len) {
      closedSkipped.push(n); // 已到顶
      continue;
    }
    const advance = Math.min(steps, len - cur);
    cur += advance;
    legs[n] = cur;
    moves.push({ n, from, to: cur, steps: advance, newLeg: false });
  }

  return {
    ok: moves.length > 0,
    reason: moves.length ? '' : closedSkipped.length ? '全部数字都落不进有效列' : '无有效数字',
    legs,
    moves,
    closedSkipped,
    legsCount: legsUsed(legs),
  };
}

/**
 * 列出当前骰面下**所有合法且能推进的分法**。
 * 主要用于 AI 兜底与测试；玩家实际只能从 drawOffer 抽出的 5 种里选。
 *
 * 返回 [{ key, values, splitIndex, preview }]
 */
export function candidateSplits(player, players, turn) {
  if (!turn.dice) return [];
  const seen = new Set();
  const out = [];
  SPLITS.forEach((split, i) => {
    const values = valuesForSplit(turn.dice, split);
    const key = [...values].sort((a, b) => a - b).join(',');
    if (seen.has(key)) return;
    seen.add(key);
    const preview = previewValues(player, players, turn, values);
    if (!preview.ok) return;
    out.push({ key, values, splitIndex: i, preview });
  });
  return out;
}

/** 每回合随机提供的分法数量 */
export const OFFER_COUNT = 5;

/**
 * 抽取本回合「提供给玩家选择」的 5 种分法。
 *
 * ── 规则（重要）──
 * 从**全部 280 种分法**里随机抽 5 种，**不做任何预先过滤**。
 * 抽到的分法里可能有走不了的（腿已满 / 数字落在封锁列 / 已到顶），
 * 玩家**只能从这 5 种里能走的那几个中选**。
 * 若 5 种全都走不了 → 本回合立即爆掉。
 *
 * 返回 [{ key, values, splitIndex, preview, ok }]，长度固定为 min(5, 去重后总数)。
 *   ok=true 表示该分法能走（可被选择）。
 */
export function drawOffer(player, players, turn, rng = Math.random) {
  if (!turn.dice) return [];
  const seen = new Set();
  const pool = [];
  SPLITS.forEach((split, i) => {
    const values = valuesForSplit(turn.dice, split);
    const key = [...values].sort((a, b) => a - b).join(',');
    if (seen.has(key)) return;
    seen.add(key);
    pool.push({ key, values, splitIndex: i });
  });

  // 从全部去重后的组合里随机抽 5 种（Fisher-Yates）
  const arr = pool.slice();
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  const picked = arr.slice(0, OFFER_COUNT);

  return picked.map((c) => {
    const preview = previewValues(player, players, turn, c.values);
    return { ...c, preview, ok: preview.ok };
  });
}

/**
 * 提供一个简单的确定性哈希 RNG（同一玩家+同一回合总是同一组 5 种分法，
 * 刷新页面不会变）。用于服务端：offer 存进 turn，客户端只能从中选。
 */
export function makeSeedRng(seed) {
  let s = (seed >>> 0) || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/**
 * 选择一个分法落地。
 * payload: { splitIndex } 或 { key } 或 { values }
 * 必须是从本回合 offer 里选；会直接修改 state。
 */
export function chooseSplit(state, payload) {
  const turn = state.turn;
  const player = currentPlayer(state);
  if (state.ended) throw new RuleError('对局已结束');
  if (turn.stopped) throw new RuleError('本回合已结束');
  if (!turn.dice) throw new RuleError('尚未摇骰');

  if (!turn.offer?.length) {
    throw new RuleError('本回合还没有可选的骰子分法');
  }

  let pick = null;
  if (payload.key) {
    pick = turn.offer.find((c) => c.key === payload.key) || null;
  } else if (payload.splitIndex != null) {
    const values = valuesForSplit(turn.dice, SPLITS[Number(payload.splitIndex)]);
    const key = [...values].sort((a, b) => a - b).join(',');
    pick = turn.offer.find((c) => c.key === key) || null;
  } else if (payload.values) {
    const key = [...payload.values].sort((a, b) => a - b).join(',');
    pick = turn.offer.find((c) => c.key === key) || null;
  }
  if (!pick) throw new RuleError('该分法不在本回合的 5 个选项中');
  if (!pick.ok) throw new RuleError('该分法走不了：数字无法落到有效列');

  turn.legs = pick.preview.legs;
  turn.lastMove = { values: pick.values, moves: pick.preview.moves, skipped: pick.preview.closedSkipped };
  turn.log.push(turn.lastMove);
  turn.offer = null; // 已消费
  state.seq++;
  return { busted: false, values: pick.values, moves: pick.preview.moves };
}

/* ═══════════════════ 状态 / 流程 ═══════════════════ */

export class RuleError extends Error {
  constructor(msg) {
    super(msg);
    this.code = 'RULE';
  }
}

export function currentPlayer(state) {
  return state.players[state.current];
}

export function newGameState(players, rng = Math.random) {
  const state = {
    players,
    current: 0,
    turn: newTurn(1),
    log: [],
    winnerSeats: null,
    ended: false,
    seq: 0,
  };
  for (let guard = 0; guard < 100; guard++) {
    startTurn(state, rng);
    if (!state.turn.busted) return state;
    state.log.push({ t: 'bust', seat: currentPlayer(state).seat });
    state.current = (state.current + 1) % state.players.length;
  }
  return state;
}

/**
 * 摇骰并从 280 种里随机抽 5 种分法。
 * 返回这 5 种里是否有能走的（ok=true 的）。
 */
function rollAndOffer(state, rng) {
  const turn = state.turn;
  const player = currentPlayer(state);
  const r = rollDice(rng);
  turn.dice = r.dice;
  turn.rolls += 1;
  const offer = drawOffer(player, state.players, turn, rng);
  turn.offer = offer.length ? offer : null;
  return offer.some((c) => c.ok);
}

/** 开新回合：摇骰 + 抽 5 种分法 */
export function startTurn(state, rng = Math.random) {
  state.turn = newTurn((state.turn?.round || 0) + 1);
  if (!rollAndOffer(state, rng)) {
    state.turn.busted = true;
    state.turn.stopped = true;
    state.turn.legs = {};
  }
  state.seq++;
  return state;
}

/**
 * 继续摇：重新摇骰（保留已有腿），重新抽 5 种分法。
 * 若一个可选分法都没有 → 立即爆掉，本回合进度作废。
 */
export function continueRoll(state, rng = Math.random) {
  const turn = state.turn;
  const player = currentPlayer(state);
  if (state.ended) throw new RuleError('对局已结束');
  if (turn.stopped) throw new RuleError('本回合已结束');

  const before = { ...turn.legs };
  if (!rollAndOffer(state, rng)) {
    turn.legs = {};
    turn.busted = true;
    turn.stopped = true;
    turn.offer = null;
    state.log.push({ t: 'bust', seat: player.seat, lost: before });
    state.seq++;
    return { busted: true, dice: turn.dice };
  }
  state.seq++;
  return { busted: false, dice: turn.dice };
}

/**
 * 停止：把腿写回永久进度；走满的列被占领并封锁；检查胜负；换人。
 */
export function stopTurn(state, rng = Math.random) {
  const turn = state.turn;
  const player = currentPlayer(state);
  const players = state.players;
  if (state.ended) throw new RuleError('对局已结束');
  if (turn.stopped) throw new RuleError('本回合已结束');

  const closedNow = [];
  for (const [sn, at] of Object.entries(turn.legs)) {
    const n = Number(sn);
    if (columnOwner(players, n) !== null) continue;
    const len = pathLen(n);
    const cur = progressOf(player, n);
    if (at > cur) player.progress[n] = Math.min(len, at);
    if ((player.progress[n] || 0) >= len && !player.claimed.includes(n)) {
      player.claimed.push(n);
      closedNow.push(n);
    }
  }
  recomputeStats(player);

  turn.stopped = true;
  turn.legs = {};
  state.log.push({ t: 'stop', seat: player.seat, claimed: closedNow });
  state.seq++;

  for (const other of players) {
    if (other.seat === player.seat) continue;
    for (const n of closedNow) {
      if (other.progress[n]) {
        delete other.progress[n];
        recomputeStats(other);
      }
    }
  }

  const winners = players.filter((p) => p.claimed.length >= RULES.winColumns);
  if (winners.length) {
    state.winnerSeats = winners.map((p) => p.seat);
    state.ended = true;
    state.log.push({ t: 'end', winners: state.winnerSeats });
    state.seq++;
    return state;
  }

  state.current = (state.current + 1) % players.length;
  startTurn(state, rng);
  return state;
}

/** 爆掉后换人（跳过连续爆掉的玩家） */
export function passAfterBust(state, rng = Math.random) {
  state.current = (state.current + 1) % state.players.length;
  for (let guard = 0; guard < 100; guard++) {
    startTurn(state, rng);
    if (!state.turn.busted) return state;
    state.log.push({ t: 'bust', seat: currentPlayer(state).seat });
    state.current = (state.current + 1) % state.players.length;
  }
  return state;
}

/** 本回合已推进的摘要 */
export function pendingSummary(turn) {
  let cells = 0;
  let tops = 0;
  for (const [sn, at] of Object.entries(turn.legs || {})) {
    const n = Number(sn);
    cells += at;
    if (at >= pathLen(n)) tops++;
  }
  return { cells, tops, legs: legsUsed(turn.legs) };
}
