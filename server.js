/**
 * 欲罢不能 · 9骰扩展包 —— Web 服务入口
 *
 * 环境变量（见 .env.example）：
 *   PORT                       Render 会自动注入
 *   TURSO_DATABASE_URL         libsql://xxx.turso.io
 *   TURSO_AUTH_TOKEN           turso db tokens create
 *   DB_MODE=local              本地开发（file:local.db）
 *   COOKIE_SECURE=1            部署在 https 时建议设为 1
 */
import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  RULES,
  CONFIG_LIMITS,
  COLUMN_LIST,
  PATH_LENGTHS,
  TOTAL_SPACES,
  PLAYER_COLORS,
} from './shared/engine.js';
import { simulateWinRates } from './shared/ai.js';
import * as db from './src/db.js';
import * as rooms from './src/rooms.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = Number(process.env.PORT) || 3000;
const SECURE = process.env.COOKIE_SECURE === '1';

app.set('trust proxy', 1);
app.use(express.json({ limit: '256kb' }));

/* ─────────── 静态资源 ─────────── */

app.use('/shared', express.static(path.join(__dirname, 'shared'), { maxAge: '1h' }));
app.use('/', express.static(path.join(__dirname, 'public'), { index: 'index.html' }));
app.use('/api/shared', express.static(path.join(__dirname, 'shared')));

/* ─────────── 会话（cookie 存游客令牌） ─────────── */

function parseCookies(req) {
  const out = {};
  const raw = req.headers.cookie || '';
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function currentPlayer(req) {
  const c = parseCookies(req);
  return c.ybbn_token || null;
}

function setSession(res, token) {
  const attrs = [`ybbn_token=${encodeURIComponent(token)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=31536000'];
  if (SECURE) attrs.push('Secure');
  res.setHeader('Set-Cookie', attrs.join('; '));
}

/* ─────────── 工具 ─────────── */

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

async function requireUser(req) {
  const token = currentPlayer(req);
  if (!token) throw new rooms.HttpError(401, '请先输入昵称');
  const row = await db.q1('SELECT * FROM players WHERE token = ?', [token]);
  if (!row) throw new rooms.HttpError(401, '会话已失效，请重新输入昵称');
  return db.rowToObj(row);
}

/* ─────────── API ─────────── */

app.get('/api/health', wrap(async (_req, res) => {
  res.json({ ok: true, db: db.isRemote ? 'turso' : 'local', rules: RULES.name, time: Date.now() });
}));

app.get('/api/meta', (_req, res) => {
  res.json({
    rules: RULES,
    configLimits: CONFIG_LIMITS,
    columns: COLUMN_LIST,
    pathLengths: PATH_LENGTHS,
    totalSpaces: TOTAL_SPACES,
    colors: PLAYER_COLORS,
  });
});

app.get('/api/me', wrap(async (req, res) => {
  const token = currentPlayer(req);
  if (!token) return res.json({ user: null });
  const row = await db.q1('SELECT id, name FROM players WHERE token = ?', [token]);
  if (!row) return res.json({ user: null });
  const stats = await db.statsFor(row.id);
  res.json({ user: { id: row.id, name: row.name }, stats });
}));

app.post('/api/login', wrap(async (req, res) => {
  const name = String(req.body?.name || '').trim();
  if (!name) throw new rooms.HttpError(400, '昵称不能为空');
  if (name.length > 20) throw new rooms.HttpError(400, '昵称最多 20 个字');
  const token = currentPlayer(req);
  const player = await db.findOrCreatePlayer(name, token);
  setSession(res, player.token);
  const stats = await db.statsFor(player.id);
  res.json({ user: { id: player.id, name: player.name }, stats });
}));

app.get('/api/rooms', wrap(async (_req, res) => {
  const rows = await db.listOpenGames(30);
  res.json({
    rooms: rows.map((r) => {
      let players = [];
      try {
        players = JSON.parse(r.state_json).players || [];
      } catch {
        /* ignore */
      }
      return {
        id: r.id,
        code: r.code,
        name: r.room_name,
        status: r.status,
        updatedAt: r.updated_at,
        players: players.map((p) => ({
          name: p.name,
          color: p.color,
          isBot: !!p.isBot,
          claimed: (p.claimed || []).length,
        })),
      };
    }),
  });
}));

app.post('/api/rooms', wrap(async (req, res) => {
  const user = await requireUser(req);
  const { roomName, botCount, color, markers, winColumns, columnCount } = req.body || {};
  const game = await rooms.createRoom({ roomName, host: user, botCount, color, markers, winColumns, columnCount });
  const seat = 0;
  res.json({ game: rooms.publicView(game, seat), seat });
}));

app.get('/api/rooms/:id', wrap(async (req, res) => {
  const game = await rooms.getGame(req.params.id);
  if (!game) throw new rooms.HttpError(404, '房间不存在');
  const user = await requireUser(req);
  const seat = game.data.players.findIndex((p) => !p.isBot && p.name === user.name);
  res.json({ game: rooms.publicView(game, seat >= 0 ? seat : null), seat: seat >= 0 ? seat : null });
}));

app.post('/api/rooms/join', wrap(async (req, res) => {
  const user = await requireUser(req);
  const { code, color } = req.body || {};
  const r = await rooms.joinByCode(code, user, color);
  if (!r) throw new rooms.HttpError(404, '房间不存在或已结束');
  if (r.full) throw new rooms.HttpError(400, '房间已满');
  res.json({ game: rooms.publicView(r.game, r.seat), seat: r.seat });
}));

app.post('/api/games/:id/act', wrap(async (req, res) => {
  const user = await requireUser(req);
  const game = await rooms.getGame(req.params.id);
  if (!game) throw new rooms.HttpError(404, '对局不存在');
  const seat = game.data.players.findIndex((p) => !p.isBot && p.name === user.name);
  if (seat < 0) throw new rooms.HttpError(403, '你不在这个房间');
  const { action, key } = req.body || {};
  if (!['choose', 'continue', 'stop'].includes(action)) {
    throw new rooms.HttpError(400, '只支持 choose / continue / stop');
  }
  await rooms.act(game, seat, action, { key });
  res.json({ game: rooms.publicView(game, seat) });
}));

app.get('/api/games/:id/simulate', wrap(async (req, res) => {
  const game = await rooms.getGame(req.params.id);
  if (!game) throw new rooms.HttpError(404, '对局不存在');
  if (game.data.ended) return res.json({ impossible: true });
  const n = Math.max(20, Math.min(400, Number(req.query.n) || 160));
  const r = simulateWinRates(game.data, n, Date.now() % 100000);
  res.json(r);
}));

app.get('/api/leaderboard', wrap(async (_req, res) => {
  const rows = await db.leaderboard(50);
  res.json({ rows: rows.map((r) => db.rowToObj(r)) });
}));

app.post('/api/rooms/:id/bots', wrap(async (req, res) => {
  const user = await requireUser(req);
  const game = await rooms.getGame(req.params.id);
  if (!game) throw new rooms.HttpError(404, '对局不存在');
  const seat = game.data.players.findIndex((p) => !p.isBot && p.name === user.name);
  if (seat !== 0) throw new rooms.HttpError(403, '只有房主可以加电脑');
  const g = await rooms.addBots(game, Number(req.body?.count) || 1);
  res.json({ game: rooms.publicView(g, seat) });
}));

/* ─────────── 错误处理 ─────────── */

app.use((err, _req, res, _next) => {
  const status = err.status || err.statusCode || 500;
  if (status >= 500) console.error('[api]', err);
  res.status(status).json({ error: err.message || '服务器错误' });
});

/* ─────────── 启动 ─────────── */

async function main() {
  await db.initDb();
  app.listen(PORT, () => {
    console.log(`🎲 欲罢不能 · 9骰扩展包 —— http://localhost:${PORT}`);
  });
}

main().catch((e) => {
  console.error('启动失败', e);
  process.exit(1);
});

void fs;
