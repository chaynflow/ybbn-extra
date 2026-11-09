/**
 * 对局管理：内存中跑引擎，变更时落库到 Turso。
 *
 * 状态模型（shared/engine.js）：
 *   data = { players, current, turn, log, winnerSeats, ended, seq }
 *   turn = { round, roll, legs, rollstops, stopped, busted, rolls }
 *
 * 玩家动作只有两种：`continue`（继续摇）或 `stop`（停止锁定）。
 * 落子由引擎强制完成。
 */
import {
  RULES,
  CONFIG_LIMITS,
  OFFER_COUNT,
  createPlayer,
  newGameState,
  currentPlayer,
  chooseSplit,
  continueRoll,
  stopTurn,
  passAfterBust,
  recomputeStats,
  pendingSummary,
  progressOf,
  pathLen,
  columnOwner,
  legsUsed,
  rulesOf,
  normalizeRules,
} from '../shared/engine.js';
import { playTurnToEnd } from '../shared/ai.js';
import * as db from './db.js';
import { randHex } from './db.js';
import { randomBytes } from 'node:crypto';

/** id -> game */
const cache = new Map();
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

const newId = () => randHex(10);
const newCode = (len = 5) =>
  Array.from(randomBytes(len), (x) => CODE_ALPHABET[x % CODE_ALPHABET.length]).join('');

export class HttpError extends Error {
  constructor(status, msg) {
    super(msg);
    this.status = status;
  }
}

/* ─────────────── 序列化给前端 ─────────────── */

export function publicView(game, viewerSeat = null) {
  const d = game.data;
  const turn = d.turn;
  const cur = currentPlayer(d);
  const isYourTurn = viewerSeat != null && viewerSeat === d.current && !d.ended;
  const rules = rulesOf(d);

  const closed = {};
  for (const n of rules.columns) {
    const owner = columnOwner(d.players, n);
    if (owner !== null) closed[n] = owner;
  }

  return {
    id: game.id,
    code: game.code,
    roomName: game.roomName,
    status: game.status,
    seat: viewerSeat,
    seq: d.seq,
    ended: d.ended,
    winnerSeats: d.winnerSeats,
    current: d.current,
    round: turn?.round ?? 1,
    /** 本局规则：路标数 / 获胜列数 / 牌面列 */
    rules: {
      markers: rules.markers,
      winColumns: rules.winColumns,
      columnCount: rules.columnCount,
      columns: rules.columns,
    },
    winColumns: rules.winColumns,
    markers: rules.markers,
    players: d.players.map((x) => ({
      seat: x.seat,
      name: x.name,
      color: x.color,
      hex: x.hex,
      isBot: !!x.isBot,
      isYou: x.seat === viewerSeat,
      progress: x.progress || {},
      claimed: x.claimed || [],
      spots: x.spots,
      score: x.score,
    })),
    closed,
    offerCount: OFFER_COUNT,
    turn: turn
      ? {
          round: turn.round,
          dice: turn.dice || [],
          // 本回合从 280 种里随机抽的 5 种分法（含 ok 标记）；只在你回合下发
          offer:
            isYourTurn && turn.offer
              ? turn.offer.map((o) => ({
                  key: o.key,
                  values: o.values,
                  ok: o.ok,
                  moves: o.preview?.moves || [],
                  skipped: o.preview?.closedSkipped || [],
                }))
              : null,
          lastMove: turn.lastMove,
          legs: turn.legs,
          legsUsed: legsUsed(turn.legs),
          markersLeft: rules.markers - legsUsed(turn.legs),
          rolls: turn.rolls,
          stopped: turn.stopped,
          busted: turn.busted,
          summary: pendingSummary(turn),
        }
      : null,
    isYourTurn,
    you: viewerSeat != null ? d.players[viewerSeat] || null : null,
    currentName: cur?.name || '',
    log: d.log.slice(-30),
  };
}

/* ─────────────── 创建 / 载入 ─────────────── */

/**
 * 创建房间。
 * options: { markers, winColumns, columnCount } —— 可选，会做范围校验与归一化
 */
export async function createRoom({ roomName, host, botCount = 0, color, markers, winColumns, columnCount }) {
  const seats = Math.min(RULES.maxPlayers, 1 + Math.max(0, Math.min(5, botCount)));
  const players = [];
  for (let i = 0; i < seats; i++) {
    const isBot = i >= 1;
    players.push(createPlayer(i, isBot ? `电脑${i}` : host.name, i === 0 ? color || 'red' : undefined, isBot));
  }

  const rules = normalizeRules({ markers, winColumns, columnCount });
  const data = newGameState(players, Math.random, rules);
  data.players = players;

  const game = {
    id: newId(),
    code: newCode(5),
    roomName: String(roomName || `${host.name} 的房间`).slice(0, 30),
    seed: Date.now() % 1e9,
    status: seats > 1 ? 'playing' : 'waiting',
    data,
  };

  await db.createGame({
    id: game.id,
    code: game.code,
    roomName: game.roomName,
    seed: game.seed,
    state: data,
    status: game.status,
  });
  for (const p of players) {
    await db.q(
      'INSERT OR REPLACE INTO game_players (game_id, seat, player_id, name, color, is_bot) VALUES (?,?,?,?,?,?)',
      [game.id, p.seat, p.isBot ? null : host.id, p.name, p.color, p.isBot ? 1 : 0],
    );
  }
  cache.set(game.id, game);
  await maybeRunBots(game);
  return game;
}

export async function getGame(id) {
  if (cache.has(id)) return cache.get(id);
  const g = await db.loadGame(id);
  if (!g) return null;
  // 兼容老状态：补齐字段
  if (!g.data.rules) g.data.rules = normalizeRules({});
  for (const p of g.data.players) {
    p.progress = p.progress || {};
    p.claimed = p.claimed || [];
    recomputeStats(p);
  }
  cache.set(id, g);
  return g;
}

export async function joinByCode(code, player, color) {
  const rows = await db.qAll(
    `SELECT id FROM games WHERE code = ? AND status IN ('waiting','playing') ORDER BY updated_at DESC LIMIT 1`,
    [String(code || '').toUpperCase().trim()],
  );
  if (!rows.length) return null;
  const game = await getGame(rows[0].id);
  if (!game) return null;
  const d = game.data;

  const existing = d.players.find((p) => p.name === player.name && !p.isBot);
  if (existing) return { game, seat: existing.seat };

  const bot = d.players.find((p) => p.isBot);
  if (bot) {
    const seat = bot.seat;
    const np = createPlayer(seat, player.name, bot.color, false);
    d.players[seat] = np;
    await db.q('UPDATE game_players SET player_id = ?, name = ?, is_bot = 0 WHERE game_id = ? AND seat = ?', [
      player.id,
      np.name,
      game.id,
      seat,
    ]);
    d.seq++;
    game.status = 'playing';
    await db.saveGame(game);
    return { game, seat };
  }

  if (d.players.length >= RULES.maxPlayers) return { full: true, game };
  const seat = d.players.length;
  d.players.push(createPlayer(seat, player.name, color));
  await db.q('INSERT OR REPLACE INTO game_players (game_id, seat, player_id, name, color, is_bot) VALUES (?,?,?,?,?,?)', [
    game.id,
    seat,
    player.id,
    player.name,
    d.players[seat].color,
    0,
  ]);
  d.seq++;
  game.status = 'playing';
  await db.saveGame(game);
  return { game, seat };
}

export async function addBots(game, count = 1) {
  const d = game.data;
  if (d.ended) throw new HttpError(400, '对局已结束');
  const n = Math.max(0, Math.min(RULES.maxPlayers, d.players.length + count) - d.players.length);
  for (let i = 0; i < n; i++) {
    const seat = d.players.length;
    const p = createPlayer(seat, `电脑${seat}`, undefined, true);
    d.players.push(p);
    await db.q('INSERT OR REPLACE INTO game_players (game_id, seat, player_id, name, color, is_bot) VALUES (?,?,?,?,?,?)', [
      game.id,
      seat,
      null,
      p.name,
      p.color,
      1,
    ]);
  }
  d.seq++;
  game.status = 'playing';
  await db.saveGame(game);
  await maybeRunBots(game);
  return game;
}

/* ─────────────── 动作 ─────────────── */

/**
 * 玩家动作：
 *   `choose`  { key }  从本回合 5 种分法里选一种落地
 *   `continue`         重新摇骰 + 重抽 5 种分法（有爆掉风险）
 *   `stop`             锁定本回合所得
 */
export async function act(game, seat, action, payload = {}) {
  const d = game.data;
  if (d.ended) throw new HttpError(400, '对局已结束');
  if (seat !== d.current) throw new HttpError(403, '还没轮到你');
  if (d.turn.busted) throw new HttpError(400, '本回合已爆掉');
  if (d.turn.stopped) throw new HttpError(400, '本回合已结束');

  let result = { ok: true };

  if (action === 'choose') {
    const r = chooseSplit(d, { key: payload.key });
    result = { ok: true, values: r.values };
    // 落地后若刚好走到顶，仍然由玩家决定继续还是停止
  } else if (action === 'continue') {
    if (d.turn.offer) {
      throw new HttpError(400, '请先选择本回合的骰子分法');
    }
    const r = continueRoll(d);
    result = { ok: true, busted: r.busted };
    if (r.busted) {
      passAfterBust(d);
      result.passed = true;
    }
  } else if (action === 'stop') {
    if (d.turn.offer) {
      throw new HttpError(400, '请先选择本回合的骰子分法');
    }
    stopTurn(d);
    result = { ok: true, ended: d.ended };
  } else {
    throw new HttpError(400, `未知动作 ${action}`);
  }

  if (d.ended) {
    game.status = 'finished';
    await db.finishGame(game.id);
  }
  await db.saveGame(game);
  await db.logAction(game.id, d.seq, `seat:${seat}`, action, { ...payload, ...result });
  if (!d.ended) await maybeRunBots(game);
  return result;
}

/** 若当前玩家是机器人，自动推进 */
export async function maybeRunBots(game, maxSteps = 400) {
  const d = game.data;
  let ran = false;
  let guard = 0;
  while (!d.ended && guard++ < maxSteps) {
    const p = d.players[d.current];
    if (!p || !p.isBot) break;
    const before = d.seq;
    if (d.turn.busted) {
      passAfterBust(d);
    } else {
      const r = playTurnToEnd(d);
      // 'stop' → stopTurn 已换人；'bust' → 需要手动换人
      if (r === 'bust' || d.turn.busted) passAfterBust(d);
    }
    if (d.seq === before) break;
    ran = true;
  }
  if (d.ended && game.status !== 'finished') {
    game.status = 'finished';
    await db.finishGame(game.id);
  }
  if (ran || d.ended) await db.saveGame(game);
  return game;
}

/* ─────────────── 辅助 ─────────────── */

export { progressOf, pathLen, RULES };
