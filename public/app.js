/* 欲罢不能 · 9骰扩展包 —— 前端主程序 */
import { COLUMN_LIST, PLAYER_COLORS, RULES, SPLIT_COUNT, columnsForCount, pathLen } from '/shared/engine.js';

const app = document.getElementById('view');
const toastEl = document.getElementById('toast');

const state = { user: null, meta: null, game: null, seat: null, polling: null, busy: false, stats: null };

/* ───────────── 工具 ───────────── */

async function api(url, opts = {}) {
  const res = await fetch(url, {
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `请求失败 (${res.status})`);
  return data;
}

let toastTimer = null;
function toast(msg, kind = '') {
  toastEl.textContent = msg;
  toastEl.className = `toast show ${kind}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (toastEl.className = 'toast'), 2400);
}

function flash(kind, word) {
  const el = document.createElement('div');
  el.className = `flash ${kind}`;
  el.innerHTML = `<div class="word">${word}</div>`;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 950);
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function colorHex(key) {
  return (PLAYER_COLORS.find((c) => c.key === key) || {}).hex || '#888';
}

const FACES = {
  1: [4],
  2: [0, 8],
  3: [0, 4, 8],
  4: [0, 2, 6, 8],
  5: [0, 2, 4, 6, 8],
  6: [0, 2, 3, 5, 6, 8],
};

function dieHtml(v, key) {
  const on = new Set(FACES[v] || [4]);
  let pips = '';
  for (let i = 0; i < 9; i++) pips += `<span class="pip" style="visibility:${on.has(i) ? 'visible' : 'hidden'}"></span>`;
  return `<span class="die" data-k="${key}">${pips}</span>`;
}

/* ───────────── 路由 ───────────── */

function go(hash) {
  if (location.hash === hash) render();
  else location.hash = hash;
}

window.addEventListener('hashchange', () => {
  stopPolling();
  render();
});

document.getElementById('nav').addEventListener('click', (e) => {
  const b = e.target.closest('[data-go]');
  if (!b) return;
  const g = b.dataset.go;
  go(g === 'lobby' ? '#/' : `#/${g}`);
});

async function render() {
  const hash = location.hash || '#/';
  if (!state.meta) state.meta = await api('/api/meta');
  if (!state.user) await loadMe();
  if (hash.startsWith('#/game/')) return renderGame(hash.slice(7));
  if (hash.startsWith('#/rank')) return renderRank();
  if (hash.startsWith('#/rules')) return renderRules();
  return renderLobby();
}

async function loadMe() {
  try {
    const r = await api('/api/me');
    state.user = r.user || null;
    state.stats = r.stats || null;
  } catch {
    state.user = null;
  }
}

/* ───────────── 大厅 ───────────── */

async function renderLobby() {
  app.innerHTML = `
    <section class="lobby-hero">
      <h1>欲罢不能 · 9骰扩展包</h1>
      <p>9 枚骰子 → 3 组各 3 枚求和 → 每回合 3 个数字</p>
      <p>16 列（3~18）、5 枚临时路标、占领 <b>4 列</b> 获胜</p>
      <div class="namebar">
        <input id="nameInput" maxlength="20" placeholder="输入你的昵称" value="${esc(state.user?.name || '')}" />
        <button class="primary" id="saveName">${state.user ? '改名' : '开始'}</button>
      </div>
      ${
        state.user
          ? `<p class="muted" style="margin-top:.6rem">当前玩家：<b>${esc(state.user.name)}</b>${
              state.stats ? ` · 已打 ${state.stats.games} 局 · 胜 ${state.stats.wins} 局` : ''
            }</p>`
          : ''
      }
    </section>

    <div class="grid2">
      <div class="card">
        <h3>开一桌</h3>
        <div class="col">
          <input id="roomName" maxlength="30" placeholder="房间名（可留空）" />
          <label class="row">
            <span class="muted">电脑对手</span>
            <select id="botCount" class="mini-select">
              <option value="1">1 个</option>
              <option value="2" selected>2 个</option>
              <option value="3">3 个</option>
              <option value="4">4 个</option>
              <option value="5">5 个</option>
            </select>
          </label>

          <div class="settings">
            <div class="setting">
              <label for="setMarkers">路标数</label>
              <select id="setMarkers" class="mini-select">
                ${[1, 2, 3, 4, 5, 6].map((v) => `<option value="${v}" ${v === 3 ? 'selected' : ''}>${v} 枚</option>`).join('')}
              </select>
            </div>
            <div class="setting">
              <label for="setWin">需占领</label>
              <select id="setWin" class="mini-select">
                ${[1, 2, 3, 4, 5, 6, 7, 8].map((v) => `<option value="${v}" ${v === 5 ? 'selected' : ''}>${v} 条路径</option>`).join('')}
              </select>
            </div>
            <div class="setting">
              <label for="setCols">展示路径</label>
              <select id="setCols" class="mini-select">
                ${[5, 7, 9, 11, 13, 15, 16].map((v) => `<option value="${v}" ${v === 16 ? 'selected' : ''}>${v} 条</option>`).join('')}
              </select>
            </div>
            <div class="setting">
              <label for="setOffer">展示方案</label>
              <select id="setOffer" class="mini-select">
                ${[1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
                  .map((v) => `<option value="${v}" ${v === 5 ? 'selected' : ''}>${v} / ${SPLIT_COUNT} 种</option>`)
                  .join('')}
              </select>
            </div>
          </div>
          <p class="muted settings-hint" id="settingsHint"></p>
          <button class="primary" id="createRoom">创建房间</button>
        </div>
      </div>

      <div class="card">
        <h3>加入房间</h3>
        <div class="col">
          <input id="joinCode" maxlength="8" placeholder="输入 5 位房间码" style="letter-spacing:.2em;text-transform:uppercase" />
          <button id="joinRoom">加入</button>
        </div>
        <h3 style="margin-top:1.1rem">进行中的房间</h3>
        <div id="roomList" class="muted">加载中…</div>
      </div>
    </div>
  `;

  document.getElementById('saveName').onclick = async () => {
    const name = document.getElementById('nameInput').value.trim();
    if (!name) return toast('请输入昵称', 'bad');
    try {
      const r = await api('/api/login', { method: 'POST', body: { name } });
      state.user = r.user;
      state.stats = r.stats;
      toast(`欢迎，${r.user.name}`, 'good');
      renderLobby();
    } catch (e) {
      toast(e.message, 'bad');
    }
  };

  document.getElementById('createRoom').onclick = async () => {
    if (!state.user) return toast('请先输入昵称', 'bad');
    try {
      const r = await api('/api/rooms', {
        method: 'POST',
        body: {
          roomName: document.getElementById('roomName').value.trim(),
          botCount: Number(document.getElementById('botCount').value),
          markers: Number(document.getElementById('setMarkers').value),
          winColumns: Number(document.getElementById('setWin').value),
          columnCount: Number(document.getElementById('setCols').value),
          offerCount: Number(document.getElementById('setOffer').value),
        },
      });
      state.seat = r.seat;
      go(`#/game/${r.game.id}`);
    } catch (e) {
      toast(e.message, 'bad');
    }
  };

  // 设置项联动提示：展示哪几列、获胜数与列数的关系、每回合给几种方案
  const updateHint = () => {
    const cols = Number(document.getElementById('setCols').value);
    const win = Number(document.getElementById('setWin').value);
    const mk = Number(document.getElementById('setMarkers').value);
    const oc = Number(document.getElementById('setOffer').value);
    const list = columnsForCount(cols);
    const hint = document.getElementById('settingsHint');
    if (!hint) return;
    const warn = win > cols ? ` ⚠️ 将自动调整为 ${cols} 条` : '';
    hint.textContent =
      `牌面 ${list[0]}~${list[list.length - 1]} 号（共 ${cols} 条）· ` +
      `每回合 ${mk} 条腿 · 从 ${SPLIT_COUNT} 种分法里随机给 ${oc} 种选择 · ` +
      `先占 ${Math.min(win, cols)} 条路径获胜${warn}`;
  };
  ['setCols', 'setWin', 'setMarkers', 'setOffer'].forEach((id) => {
    document.getElementById(id)?.addEventListener('change', updateHint);
  });
  updateHint();

  document.getElementById('joinRoom').onclick = async () => {
    if (!state.user) return toast('请先输入昵称', 'bad');
    const code = document.getElementById('joinCode').value.trim();
    if (!code) return toast('请输入房间码', 'bad');
    try {
      const r = await api('/api/rooms/join', { method: 'POST', body: { code } });
      state.seat = r.seat;
      go(`#/game/${r.game.id}`);
    } catch (e) {
      toast(e.message, 'bad');
    }
  };

  loadRooms();
}

async function loadRooms() {
  const box = document.getElementById('roomList');
  if (!box) return;
  try {
    const { rooms } = await api('/api/rooms');
    if (!rooms.length) {
      box.innerHTML = '<p class="muted">暂无进行中的房间，先开一桌吧。</p>';
      return;
    }
    box.innerHTML = rooms
      .map(
        (r) => `
      <div class="room-item">
        <div>
          <div><b>${esc(r.name)}</b> <span class="muted">· ${r.status === 'waiting' ? '等待中' : '进行中'}</span></div>
          <div class="mini-dots" style="margin-top:.3rem">
            ${r.players
              .map((p) => `<span class="mini-dot" style="background:${colorHex(p.color)}" title="${esc(p.name)}"></span>`)
              .join('')}
          </div>
        </div>
        <div class="row">
          <span class="room-code">${esc(r.code)}</span>
          <button data-join="${esc(r.code)}">进入</button>
        </div>
      </div>`,
      )
      .join('');
    box.querySelectorAll('[data-join]').forEach((b) => {
      b.onclick = () => {
        document.getElementById('joinCode').value = b.dataset.join;
        document.getElementById('joinRoom').click();
      };
    });
  } catch (e) {
    box.innerHTML = `<p class="muted">${esc(e.message)}</p>`;
  }
}

/* ───────────── 对局 ───────────── */

function stopPolling() {
  if (state.polling) clearInterval(state.polling);
  state.polling = null;
}

async function renderGame(id) {
  app.innerHTML = `<div class="card">加载中…</div>`;
  try {
    const r = await api(`/api/rooms/${id}`);
    state.game = r.game;
    if (r.seat != null) state.seat = r.seat;
  } catch (e) {
    app.innerHTML = `<div class="card"><h3>无法加载对局</h3><p class="muted">${esc(e.message)}</p><button onclick="location.hash='#/'">返回大厅</button></div>`;
    return;
  }
  paintGame();
  stopPolling();
  state.polling = setInterval(refreshGame, 1500);
}

async function refreshGame() {
  if (!state.game || state.busy) return;
  try {
    const prev = state.game;
    const r = await api(`/api/rooms/${prev.id}`);
    state.game = r.game;
    if (r.seat != null) state.seat = r.seat;
    if (state.game.seq !== prev.seq) {
      // 检测爆掉 / 结束事件做动效
      if (state.game.turn?.busted && !prev.turn?.busted) flash('bust', 'BUST');
      if (state.game.ended && !prev.ended) flash('win', 'WIN');
      paintGame();
    }
  } catch {
    /* 忽略瞬时错误 */
  }
}

async function doAct(action, payload = {}) {
  if (!state.game || state.busy) return;
  state.busy = true;
  try {
    const before = state.game;
    const r = await api(`/api/games/${state.game.id}/act`, { method: 'POST', body: { action, ...payload } });
    const g = r.game;
    if (action === 'stop') flash('stop', '锁定');
    if (g.turn?.busted) flash('bust', 'BUST');
    if (g.ended) flash('win', 'WIN');
    state.game = g;
    paintGame();
  } catch (e) {
    toast(e.message, 'bad');
    refreshGame();
  } finally {
    state.busy = false;
  }
}

function paintGame() {
  const g = state.game;
  if (!g) return;
  const turn = g.turn || {};
  const ended = g.ended;
  /** 自己所在的座位（null = 观战） */
  const you = g.seat != null ? g.seat : null;
  const yourTurn = g.isYourTurn;
  const legs = turn.legs || {};
  const closed = g.closed || {};
  const cur = g.players[g.current] || {};
  const offer = turn.offer || [];
  const mustChoose = yourTurn && !ended && !turn.busted && offer.length > 0;

  /* ── 玩家卡 ── */
  const playersHtml = g.players
    .map((p) => {
      const isWinner = (g.winnerSeats || []).includes(p.seat);
      const pct = Math.round((p.claimed.length / g.winColumns) * 100);
      return `
        <div class="player-card ${p.seat === g.current && !ended ? 'active' : ''} ${isWinner ? 'winner' : ''}">
          <div class="pc-top">
            <span class="swatch" style="background:${p.hex}"></span>
            <span class="pc-name">${esc(p.name)}</span>
            ${p.isBot ? '<span class="pc-badge">电脑</span>' : ''}
            ${p.isYou ? '<span class="pc-badge">你</span>' : ''}
            ${isWinner ? '<span class="pc-badge win-badge">胜</span>' : ''}
          </div>
          <div class="progress"><i style="width:${pct}%;background:${p.hex}"></i></div>
          <div class="pc-stats">
            <span>占领 <b style="color:${p.hex}">${p.claimed.length}</b>/${g.winColumns}</span>
            <span>格 ${p.spots}</span>
          </div>
        </div>`;
    })
    .join('');

  /* ── 骰面：9 枚骰子 ── */
  const diceHtml = (turn.dice || [])
    .map((d, i) => `<span class="die-wrap">${dieHtml(d, i)}<i class="die-idx">${i + 1}</i></span>`)
    .join('');

  /* ── 本回合从 280 种里抽出的 5 种分法 ── */
  const legalCount = offer.filter((o) => o.ok).length;
  const offerHtml = offer.length
    ? offer
        .map((o) => {
          const moves = (o.moves || [])
            .map((m) => {
              const len = (COLUMN_LIST.find((c) => c.n === m.n) || {}).len || 0;
              const cls = m.newLeg ? 'mv-new' : 'mv-old';
              return `<span class="mv ${cls}">${m.n} 号 ${m.steps > 1 ? `<b>+${m.steps}</b>` : '+1'} <i>${m.to}/${len}</i></span>`;
            })
            .join('');
          const skipped = (o.skipped || []).length ? `<span class="mv-skip">跳过 ${o.skipped.join(',')}</span>` : '';
          const dead = !o.ok;
          const disabled = dead || !mustChoose;
          return `
          <button class="offer ${mustChoose && !dead ? 'clickable' : ''} ${dead ? 'dead' : ''}"
                  data-key="${esc(o.key)}" ${disabled ? 'disabled' : ''}>
            <span class="offer-values">${o.values.join(' + ')}</span>
            <span class="offer-moves">${dead ? '<span class="mv-skip">✕ 走不了：落不进任何有效列</span>' : moves}${skipped}</span>
          </button>`;
        })
        .join('')
    : `<div class="offer-empty muted">已选好分法，请决定「继续摇」或「停止」</div>`;

  /* ── 腿指示 ── */
  const legDots = Array.from({ length: g.markers }, (_, i) => `<span class="marker ${i < turn.legsUsed ? '' : 'spent'}"></span>`).join('');

  /* ── 本回合已推进摘要 ── */
  const legacyList = Object.entries(legs)
    .sort((a, b) => Number(a[0]) - Number(b[0]))
    .map(([n, at]) => {
      const nn = Number(n);
      const len = pathLen(nn) || 0;
      return `<span class="leg-chip" style="border-color:${cur.hex}">${nn} 号 <b>${at}</b>/${len}</span>`;
    })
    .join('');

  /* ── 棋盘（只渲染本局启用的列） ── */
  const gameCols = (g.rules?.columns || COLUMN_LIST.map((c) => c.n)).slice().sort((a, b) => a - b);
  const boardHtml = gameCols.map((n) => {
    const len = pathLen(n);
    const ownerSeat = closed[n];
    const legAt = legs[n] || 0;
    const spots = [];
    for (let idx = 0; idx < len; idx++) {
      const cellNo = idx + 1;
      // 找出哪些玩家永久进度覆盖此格
      const holders = g.players.filter((p) => (p.progress?.[n] || 0) >= cellNo);
      const isLeg = legAt === cellNo;
      // 本回合腿“越过”但没有永久进度的部分
      const isLegTrail = legAt > cellNo && !holders.length;
      let style = '';
      let cls = 'spot';
      if (holders.length) {
        style = `background:${holders[0].hex};opacity:.95`;
      } else if (isLegTrail) {
        style = `background:${cur.hex};opacity:.32`;
        cls += ' pending';
      }
      if (isLeg) {
        cls += ' leg';
        style += `;--legc:${cur.hex}`;
      }
      if (ownerSeat !== undefined && idx === len - 1) cls += ' claim-top';
      spots.push(`<span class="${cls}" style="${style}" title="${n} 号 · 第 ${cellNo} 格${isLeg ? ' · 路标' : ''}"></span>`);
    }
    const ownerP = ownerSeat !== undefined ? g.players[ownerSeat] : null;
    // 我自己在这条路径上已走的格数（永久进度）
    const myProgress = you != null ? g.players[you]?.progress?.[n] || 0 : 0;
    // 本回合临时推进到第几格（含路标），用于显示 +N
    const myPending = you != null ? Math.max(0, legAt - myProgress) : 0;
    const isClosedByOther = ownerSeat !== undefined && ownerSeat !== you;

    let mineHtml = '';
    if (myProgress > 0 || myPending > 0) {
      const myHex = (you != null ? g.players[you]?.hex : null) || '#ffb020';
      const tip =
        `${n} 号：你已走 ${myProgress}/${len} 格` + (myPending > 0 ? `，本回合另推进 ${myPending} 格` : '');
      mineHtml = `<span class="mine ${myPending > 0 ? 'mine-pending' : ''}"
          style="--mc:${myHex};color:${myHex};border-color:${myHex}80;background:${myHex}22"
          title="${tip}">${myProgress}${myPending > 0 ? `<i>+${myPending}</i>` : ''}</span>`;
    } else {
      mineHtml = '<span class="mine empty"></span>';
    }

    return `
      <div class="col-row ${ownerP ? 'closed' : ''} ${isClosedByOther ? 'closed-other' : ''}">
        ${mineHtml}
        <span class="col-num" style="${ownerP ? `color:${ownerP.hex}` : ''}">${n}</span>
        <div class="spots" style="--n:${len}">${spots.join('')}</div>
        ${ownerP ? `<span class="owner-tag" style="background:${ownerP.hex}">${esc(ownerP.name)}</span>` : '<span class="owner-tag empty"></span>'}
      </div>`;
  }).join('');

  /* ── 操作区 ── */
  let actionHtml = '';
  if (ended) {
    const names = (g.winnerSeats || []).map((s) => g.players[s]?.name).join('、');
    actionHtml = `
      <div class="end-box">
        <h3>对局结束</h3>
        <p>获胜者：<b style="color:#ffd35c">${esc(names)}</b></p>
        <div class="row"><button class="primary" onclick="location.hash='#/'">返回大厅</button>
        <button onclick="location.hash='#/rank'">看排行榜</button></div>
      </div>`;
  } else if (yourTurn) {
    if (turn.busted) {
      actionHtml = `<div class="actions"><button class="danger" disabled>💥 本回合爆掉了…</button></div>`;
    } else {
      const s = turn.summary || { cells: 0, tops: 0 };
      const summaryBox = `
        <div class="pending-box">
          ${
            s.cells
              ? `本回合已推进 <b>${s.cells}</b> 格 / <b>${turn.legsUsed}</b> 条路标${s.tops ? ` · 可占领 <b>${s.tops}</b> 列` : ''}`
              : '本回合尚未推进'
          }
          ${legacyList ? `<div class="leg-chips">${legacyList}</div>` : ''}
        </div>`;
      if (mustChoose) {
        actionHtml = `
          ${summaryBox}
          <p class="choose-hint">👇 从 ${SPLIT_COUNT} 种分法里随机抽出的 <b>${offer.length}</b> 种中选一个${legalCount < offer.length ? `（其中 <b>${legalCount}</b> 种能走）` : ''}；选了的数字会被强制走完</p>
          <div class="offers">${offerHtml}</div>`;
      } else {
        actionHtml = `
          ${summaryBox}
          <div class="offers">${offerHtml}</div>
          <div class="actions">
            <button class="primary" id="btnStop">✋ 停止并锁定</button>
            <button id="btnContinue">🎲 继续摇</button>
          </div>
          <p class="muted hint">路标已用 ${turn.legsUsed}/${g.markers}：本回合最多推进 ${g.markers} 个不同的列。继续摇会重新从 ${SPLIT_COUNT} 种里抽 ${g.rules?.offerCount || 5} 种，若一种都落不进有效列就爆掉。</p>`;
      }
    }
  } else {
    actionHtml = `<div class="pending-box">等待 <b>${esc(cur.name || '对手')}</b> 行动…</div>`;
  }

  app.innerHTML = `
    <div class="game-grid">
      <div class="col">
        <div class="card dice-panel">
          <div class="row" style="justify-content:space-between;margin-bottom:.6rem">
            <span class="big-tag">第 ${g.round} 回合</span>
            <span class="muted">房间码 <span class="room-code">${esc(g.code)}</span></span>
          </div>
          <div class="statusbar">
            <span class="muted">路标</span>
            <span class="markers">${legDots}</span>
            <span class="muted" style="margin-left:auto">${yourTurn ? '轮到你了' : `${esc(cur.name || '')} 的回合`}</span>
          </div>
          <div class="dice-strip">${diceHtml}</div>
          ${actionHtml}
        </div>
      </div>
      <div class="col">
        <div class="players">${playersHtml}</div>
        <div class="board">${boardHtml}</div>
      </div>
    </div>
  `;

  document.getElementById('btnStop')?.addEventListener('click', () => doAct('stop'));
  document.getElementById('btnContinue')?.addEventListener('click', () => doAct('continue'));
  app.querySelectorAll('.offer.clickable').forEach((el) => {
    el.onclick = () => doAct('choose', { key: el.dataset.key });
  });
}

/* ───────────── 排行 ───────────── */

async function renderRank() {
  app.innerHTML = `<div class="card"><h2>排行榜</h2><div id="rankBody" class="muted">加载中…</div></div>`;
  try {
    const { rows } = await api('/api/leaderboard');
    const body = document.getElementById('rankBody');
    if (!rows.length) {
      body.innerHTML = '<p class="muted">还没有战绩，去开一桌吧。</p>';
      return;
    }
    body.innerHTML = `
      <table>
        <thead><tr><th>#</th><th>玩家</th><th>局数</th><th>胜场</th><th>胜率</th><th>占领列数</th></tr></thead>
        <tbody>
          ${rows
            .map(
              (r, i) => `<tr>
                <td>${i + 1}</td>
                <td><b>${esc(r.name)}</b></td>
                <td>${r.games}</td>
                <td>${r.wins}</td>
                <td>${r.win_rate}%</td>
                <td>${r.total_paths}</td>
              </tr>`,
            )
            .join('')}
        </tbody>
      </table>`;
  } catch (e) {
    document.getElementById('rankBody').innerHTML = `<p class="muted">${esc(e.message)}</p>`;
  }
}

/* ───────────── 规则 ───────────── */

function renderRules() {
  const lens = COLUMN_LIST.map((c) => `${c.n}<span class="muted">(${c.len})</span>`).join(' · ');
  app.innerHTML = `
    <div class="card rules-doc">
      <h2>规则速查（标准版 Can't Stop 骨架）</h2>
      <p class="muted">依据标准版规则，只把「骰子」与「路径表」两项换成扩展设定。</p>
      <p class="muted">16 列长度：${lens}</p>

      <h3>骰子：9 枚，自由分组</h3>
      <ul>
        <li>每回合摇 <b>9 枚</b>骰子，玩家把它们任意分成 <b>3 组、每组 3 枚</b>，每组求和 → <b>3 个数字</b>（3~18）。</li>
        <li>9 枚骰子分成 3 组共 <b>${SPLIT_COUNT} 种</b>分法，但每回合只<b>随机提供若干种</b>（默认 5，可调 1~10），你从中选一个。</li>
        <li>同一数字出现多次就<b>前进多步</b>：例如 <span class="kbd">10+10+10</span> → 10 号列直接前进 <b>3 格</b>（依然只占 1 条路标）。</li>
        <li>单组 3 骰分布：10、11 各 12.5%（最长 24 格），3、18 各 0.5%（最短 3 格）。</li>
      </ul>

      <h3>路标（腿）</h3>
      <ul>
        <li>你每回合有 <b>3 枚临时路标</b>，代表<b>本回合最多能推进 3 个不同的列</b>。</li>
        <li>路标<b>不是消耗品</b>：同一列可以反复前进，不消耗新的路标。</li>
        <li>落在一个<b>还没有路标的列</b>上，就要占用一条新路标。</li>
        <li>3 条腿用满后，摇出的数字若都落不进已有列 → <b>爆掉</b>。</li>
      </ul>

      <h3>每回合流程</h3>
      <ul>
        <li>摇骰 → 从 5 种分法里选一种 → 引擎<b>强制</b>把 3 个数字全部落地（<b>能走的必须走</b>）：新列放腿，老列前进，重复数字多步。</li>
        <li>然后二选一：<b>停止</b> 锁定所得，或 <b>继续摇</b>（重新摇骰 + 重新发 5 种分法）。</li>
        <li>继续后若一种分法都推不动 → <b>爆掉</b>，本回合新推进的格数全部作废（永久进度不受影响）。</li>
      </ul>

      <h3>可自定义的规则（建房时可设）</h3>
      <ul>
        <li><b>路标数</b>：1~6 枚（默认 3）。路标越少，每回合能推进的列越少，越容易爆掉。</li>
        <li><b>需占领路径数</b>：1~N 条（默认 5，N = 展示的路径数）。</li>
        <li><b>展示路径数</b>：5~16 条（默认 16）。少于此数时，会取 3~18 里<b>围绕中间的一段</b>
          （例如 10 条 → 6~15 号），保证长短分布最优。</li>
        <li><b>展示方案数</b>：1~10 种（默认 5）。每回合从 <b>${SPLIT_COUNT} 种</b>分法里随机抽这么多种给你选；
          抽到的可能走不了，1 种时最残酷——没得挑。</li>
      </ul>

      <h3>占领与胜利</h3>
      <ul>
        <li>某列走到最后一格并在停止时确认 → 该列<b>归你所有并永久封锁</b>。</li>
        <li>封锁后：其他玩家在该列的进度<b>清零</b>，任何人（包括你自己）都不能再推进该列。</li>
        <li>先占领<b>规定条数</b>的路径者获胜（默认 5 条）。</li>
      </ul>

      <h3>和标准版的差异</h3>
      <table>
        <thead><tr><th></th><th>标准版</th><th>本扩展</th></tr></thead>
        <tbody>
          <tr><td>骰子</td><td>4 骰，拆 2 组各 2 枚（3 种拆法）</td><td><b>9 骰，3 组各 3 枚（280 种，每回合抽 5 种）</b></td></tr>
          <tr><td>每回合数字数</td><td>2 个</td><td><b>3 个</b></td></tr>
          <tr><td>列</td><td>11 列（2~12）</td><td><b>16 列（3~18）</b></td></tr>
          <tr><td>路标</td><td>3 枚</td><td><b>3 枚</b></td></tr>
          <tr><td>获胜</td><td>3 列</td><td><b>5 列</b></td></tr>
        </tbody>
      </table>

      <div class="row" style="margin-top:1rem">
        <button class="primary" onclick="location.hash='#/'">去开一桌</button>
      </div>
    </div>`;
}

/* ───────────── 启动 ───────────── */

render().catch((e) => {
  app.innerHTML = `<div class="card"><h3>加载失败</h3><p class="muted">${esc(e.message)}</p></div>`;
});
