/**
 * Turso（libSQL）数据库层。
 *
 * 环境变量：
 *   TURSO_DATABASE_URL   libsql://<db>-<org>.turso.io  （或 http:// 本地）
 *   TURSO_AUTH_TOKEN     turso db tokens create <db> 生成的令牌
 *   DB_MODE=local        可选：不连 Turso，用本地文件 file:local.db（开发用）
 */
import { createClient } from '@libsql/client';
import { randomBytes } from 'node:crypto';

const env = process.env;
const DB_MODE = (env.DB_MODE || '').toLowerCase();

let url = env.TURSO_DATABASE_URL || '';
let authToken = env.TURSO_AUTH_TOKEN || '';

if (DB_MODE === 'local' || (!url && env.NODE_ENV !== 'production')) {
  url = env.TURSO_DATABASE_URL || 'file:local.db';
  authToken = undefined;
  console.warn(`[db] 使用本地数据库 ${url}（未配置 TURSO_DATABASE_URL 或 DB_MODE=local）`);
} else if (!url) {
  throw new Error('缺少 TURSO_DATABASE_URL 环境变量');
}

/** 本地模式的 file: 协议需要 @libsql/client 的本地实现；Turso 用 https 转换 */
const finalUrl = url.startsWith('libsql://') ? url.replace('libsql://', 'https://') : url;

export const db = createClient({ url: finalUrl, authToken });

export const isRemote = finalUrl.startsWith('https://');

/** 是否已初始化 */
let ready = false;

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS players (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     name TEXT NOT NULL,
     token TEXT NOT NULL UNIQUE,
     created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
   )`,
  `CREATE TABLE IF NOT EXISTS games (
     id TEXT PRIMARY KEY,
     code TEXT NOT NULL,
     room_name TEXT NOT NULL,
     seed INTEGER NOT NULL,
     status TEXT NOT NULL DEFAULT 'waiting',
     state_json TEXT NOT NULL,
     created_at INTEGER NOT NULL,
     updated_at INTEGER NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS idx_games_code ON games(code)`,
  `CREATE INDEX IF NOT EXISTS idx_games_status ON games(status, updated_at)`,
  `CREATE TABLE IF NOT EXISTS game_players (
     game_id TEXT NOT NULL,
     seat INTEGER NOT NULL,
     player_id INTEGER,
     name TEXT NOT NULL,
     color TEXT NOT NULL,
     is_bot INTEGER NOT NULL DEFAULT 0,
     PRIMARY KEY (game_id, seat)
   )`,
  `CREATE TABLE IF NOT EXISTS results (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     game_id TEXT NOT NULL,
     seat INTEGER NOT NULL,
     player_id INTEGER,
     name TEXT NOT NULL,
     win INTEGER NOT NULL DEFAULT 0,
     paths INTEGER NOT NULL DEFAULT 0,
     spots INTEGER NOT NULL DEFAULT 0,
     score INTEGER NOT NULL DEFAULT 0,
     finished_at INTEGER NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS idx_results_player ON results(player_id)`,
  `CREATE TABLE IF NOT EXISTS replay_log (
     game_id TEXT NOT NULL,
     seq INTEGER NOT NULL,
     at INTEGER NOT NULL,
     actor TEXT NOT NULL,
     action TEXT NOT NULL,
     detail TEXT,
     PRIMARY KEY (game_id, seq)
   )`,
];

export async function initDb() {
  if (ready) return;
  for (const sql of SCHEMA) {
    await db.execute(sql);
  }
  ready = true;
  console.log(`[db] 已连接并初始化：${isRemote ? 'Turso 远程库' : finalUrl}`);
  return true;
}

export async function q(sql, args = []) {
  await initDb();
  return db.execute({ sql, args });
}

export async function q1(sql, args = []) {
  const r = await q(sql, args);
  return r.rows[0] || null;
}

export async function qAll(sql, args = []) {
  const r = await q(sql, args);
  return r.rows;
}

/** libsql 返回的行需要转成普通对象 */
export function rowToObj(row) {
  if (!row) return null;
  const o = {};
  for (const k of Object.keys(row)) o[k] = row[k];
  return o;
}

/* ─────────────── 玩家 ─────────────── */

export function randomToken() {
  return randomBytes(24).toString('hex');
}

/** 随机十六进制串 */
export function randHex(n) {
  return randomBytes(n).toString('hex');
}

export async function findOrCreatePlayer(name, token) {
  const safeName = String(name || '').trim().slice(0, 20) || '匿名玩家';
  if (token) {
    const ex = await q1('SELECT * FROM players WHERE token = ?', [token]);
    if (ex) {
      if (ex.name !== safeName) {
        await q('UPDATE players SET name = ? WHERE id = ?', [safeName, ex.id]);
        return { ...rowToObj(ex), name: safeName };
      }
      return rowToObj(ex);
    }
  }
  const t = token || randomToken();
  const r = await q('INSERT INTO players (name, token) VALUES (?, ?)', [safeName, t]);
  return { id: Number(r.lastInsertRowid), name: safeName, token: t };
}

/* ─────────────── 对局 ─────────────── */

export async function saveGame(game) {
  const now = Date.now();
  await q(
    `UPDATE games SET status = ?, state_json = ?, updated_at = ? WHERE id = ?`,
    [game.status, JSON.stringify(game.data), now, game.id],
  );
}

export async function loadGame(id) {
  const row = await q1('SELECT * FROM games WHERE id = ?', [id]);
  if (!row) return null;
  return {
    id: row.id,
    code: row.code,
    roomName: row.room_name,
    seed: row.seed,
    status: row.status,
    updatedAt: row.updated_at,
    data: JSON.parse(row.state_json),
  };
}

export async function createGame({ id, code, roomName, seed, state, status }) {
  const now = Date.now();
  await q(
    `INSERT INTO games (id, code, room_name, seed, status, state_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, code, roomName, seed, status, JSON.stringify(state), now, now],
  );
}

export async function listOpenGames(limit = 30) {
  return qAll(
    `SELECT id, code, room_name, status, updated_at, state_json FROM games
     WHERE status IN ('waiting','playing') ORDER BY updated_at DESC LIMIT ?`,
    [limit],
  );
}

export async function logAction(gameId, seq, actor, action, detail) {
  await q('INSERT OR REPLACE INTO replay_log (game_id, seq, at, actor, action, detail) VALUES (?, ?, ?, ?, ?, ?)', [
    gameId,
    seq,
    Date.now(),
    actor,
    action,
    detail ? JSON.stringify(detail) : null,
  ]);
}

export async function finishGame(gameId) {
  const rows = await qAll('SELECT * FROM game_players WHERE game_id = ?', [gameId]);
  const data = (await loadGame(gameId))?.data;
  if (!data) return;
  const now = Date.now();
  for (const r of rows) {
    const p = data.players?.[r.seat];
    if (!p) continue;
    const win = Array.isArray(data.winnerSeats) && data.winnerSeats.includes(r.seat) ? 1 : 0;
    await q(
      `INSERT INTO results (game_id, seat, player_id, name, win, paths, spots, score, finished_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [gameId, r.seat, r.player_id ?? null, r.name, win, p.finished || 0, p.spots || 0, p.score || 0, now],
    );
  }
  await q(`UPDATE games SET status = 'finished', updated_at = ? WHERE id = ?`, [now, gameId]);
}

export async function leaderboard(limit = 50) {
  return qAll(
    `SELECT name, COUNT(*) AS games,
            SUM(win) AS wins,
            ROUND(CASE WHEN COUNT(*) > 0 THEN 100.0 * SUM(win) / COUNT(*) ELSE 0 END, 1) AS win_rate,
            SUM(paths) AS total_paths,
            MAX(finished_at) AS last_at
     FROM results
     WHERE player_id IS NOT NULL
     GROUP BY player_id
     ORDER BY wins DESC, win_rate DESC, games DESC
     LIMIT ?`,
    [limit],
  );
}

export async function statsFor(playerId) {
  return q1(
    `SELECT COUNT(*) AS games, COALESCE(SUM(win),0) AS wins, COALESCE(SUM(spots),0) AS spots,
            COALESCE(SUM(paths),0) AS paths
     FROM results WHERE player_id = ?`,
    [playerId],
  );
}
