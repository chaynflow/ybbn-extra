import fs from 'node:fs';
import * as E from '../shared/engine.js';
import * as A from '../shared/ai.js';

const mkRng = (seed) => {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
};

function playGame(seed) {
  const rng = mkRng(seed);
  const ps = [0, 1].map((k) => E.createPlayer(k, `P${k}`, ['red', 'blue', 'lime'][k % 3]));
  const st = E.newGameState(ps, rng);
  let g = 0;
  const s8 = { rolls: 0, stops: 0, busts: 0, deadOffers: 0, deadOptions: 0, totalOptions: 0 };
  while (!st.ended && g++ < 20000) {
    if (st.turn.busted) {
      s8.busts++;
      E.passAfterBust(st, rng);
      continue;
    }
    const offer = st.turn.offer || [];
    s8.totalOptions += offer.length;
    s8.deadOptions += offer.filter((c) => !c.ok).length;
    if (!offer.some((c) => c.ok)) s8.deadOffers++;

    const best = A.bestSplit(st);
    if (!best) {
      st.turn.busted = true;
      st.turn.stopped = true;
      s8.busts++;
      E.passAfterBust(st, rng);
      continue;
    }
    E.chooseSplit(st, { key: best.key });
    s8.rolls++;
    if (A.shouldStop(st, 0.5)) {
      E.stopTurn(st, rng);
      s8.stops++;
    } else {
      const c = E.continueRoll(st, rng);
      if (c.busted) {
        s8.busts++;
        E.passAfterBust(st, rng);
      }
    }
  }
  return { ended: st.ended, rounds: st.turn.round, winner: st.winnerSeats?.[0], ...s8 };
}

const out = [];
out.push('规则：从全部 280 种分法里随机抽 5 种，只允许走其中合法的\n');

const N = 200;
const rounds = [];
let w0 = 0;
let unf = 0;
let tRolls = 0, tStops = 0, tBusts = 0, tDeadOffers = 0, tDeadOpt = 0, tTotOpt = 0;
for (let i = 0; i < N; i++) {
  const r = playGame(50000 + i * 23);
  if (!r.ended) { unf++; continue; }
  rounds.push(r.rounds);
  if (r.winner === 0) w0++;
  tRolls += r.rolls;
  tStops += r.stops;
  tBusts += r.busts;
  tDeadOffers += r.deadOffers;
  tDeadOpt += r.deadOptions;
  tTotOpt += r.totalOptions;
}
rounds.sort((a, b) => a - b);
const done = rounds.length;
out.push(`${N} 局：先手胜 ${w0}，后手胜 ${done - w0}，未结束 ${unf}`);
out.push(`回合数：中位 ${rounds[Math.floor(done / 2)]}，范围 ${rounds[0]}~${rounds[done - 1]}`);
out.push(`平均每局：摇骰 ${(tRolls / done).toFixed(1)} 次，停止 ${(tStops / done).toFixed(1)} 次，爆掉 ${(tBusts / done).toFixed(1)} 次`);
out.push(`**爆率：${((tBusts / (tStops + tBusts)) * 100).toFixed(1)}%**`);
out.push(`每次 offer 里平均有 ${(tDeadOpt / tTotOpt).toFixed(2)} 种是"走不了"的（占 ${((tDeadOpt / tTotOpt) * 100).toFixed(1)}%）`);
out.push(`5 种全走不了的情况：${tDeadOffers} 次（占所有发牌 ${((tDeadOffers / tRolls) * 100).toFixed(1)}%）`);

fs.writeFileSync('offer2.txt', out.join('\n'));
