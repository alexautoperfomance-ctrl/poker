// Авторитетный движок NLHE (работает в браузере хоста и в Node для тестов)
import { best } from './eval.js';

export const BLINDS = [[10, 20], [25, 50], [50, 100], [100, 200]];
const rnd = () => crypto.getRandomValues(new Uint32Array(1))[0] / 4294967296;

export function newDeck() {
  const d = [];
  for (const r of '23456789TJQKA') for (const s of 'shdc') d.push(r + s);
  for (let i = d.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [d[i], d[j]] = [d[j], d[i]]; }
  return d;
}

export function newTable(cfg = {}) {
  return {
    cfg: { sb: 10, bb: 20, straddle: true, bombEvery: 7, bombAnte: 40, timer: 25, pause: 5000, ...cfg },
    seats: Array(9).fill(null), players: {}, handNo: 0, button: -1, hand: null,
    history: [], requests: [], started: false, rig: null, adminPid: null,
  };
}

const nextIn = (list, from) => { for (const s of list) if (s > from) return s; return list[0]; };
const P = (t, s) => t.players[t.hand.pid[s]];
const inLiveHand = (t, p) => { const h = t.hand; return h && !h.result && p.seat != null && h.seats.includes(p.seat) && h.pid[p.seat] && !h.folded.includes(p.seat); };

export function addPlayer(t, pid, name, token) {
  if (!t.players[pid]) t.players[pid] = { name, token, stack: 0, pending: 0, seat: null, sitOut: false, straddle: false, connected: true };
  else if (name) t.players[pid].name = name;
  return t.players[pid];
}

export function setCfg(t, c) {
  const k = t.cfg;
  if (c.blinds != null && BLINDS[c.blinds]) { [k.sb, k.bb] = BLINDS[c.blinds]; if (c.bombAnte == null) k.bombAnte = k.bb * 2; }
  if (c.straddle != null) k.straddle = !!c.straddle;
  if (c.bombEvery != null) k.bombEvery = Math.max(0, Math.min(50, c.bombEvery | 0));
  if (c.bombAnte != null) k.bombAnte = Math.max(1, c.bombAnte | 0);
  if (c.timer != null) k.timer = Math.max(5, Math.min(120, c.timer | 0));
}

export function adjust(t, pid, delta) {
  const p = t.players[pid]; if (!p) return 'Нет игрока';
  delta = Math.trunc(delta);
  if (inLiveHand(t, p)) { p.pending += delta; return; } // применится после раздачи
  p.stack = Math.max(0, p.stack + delta);
}
function applyPending(t) {
  for (const p of Object.values(t.players)) if (p.pending) { p.stack = Math.max(0, p.stack + p.pending); p.pending = 0; }
}

export function sit(t, pid, seat) {
  const p = t.players[pid];
  if (!p || seat < 0 || seat > 8 || t.seats[seat]) return 'Место занято';
  if (p.seat != null) return 'Вы уже за столом';
  if (t.hand && !t.hand.result && t.hand.seats.includes(seat)) return 'Дождитесь конца раздачи';
  t.seats[seat] = pid; p.seat = seat; p.sitOut = false;
}

export function stand(t, pid, now) {
  const p = t.players[pid]; if (!p || p.seat == null) return;
  const h = t.hand, s = p.seat;
  if (inLiveHand(t, p)) { h.folded.push(s); h.log.push(p.name + ': фолд (встал)'); advance(t, now, h.toAct - 1); }
  t.seats[s] = null; p.seat = null;
}

function put(t, s, amt) { const h = t.hand, p = P(t, s); amt = Math.min(amt, p.stack); p.stack -= amt; h.bets[s] += amt; h.contrib[s] += amt; }

export function startHand(t, now) {
  applyPending(t);
  const elig = [];
  for (let s = 0; s < 9; s++) { const p = t.seats[s] && t.players[t.seats[s]]; if (p && !p.sitOut && p.stack > 0) elig.push(s); }
  if (elig.length < 2) { t.hand = null; return false; }
  const c = t.cfg;
  t.handNo++;
  const bomb = c.bombEvery > 0 && t.handNo % c.bombEvery === 0;
  t.button = nextIn(elig, t.button);
  const rig = t.rig && t.rig.length ? t.rig.shift() : null; // подтасовка только для тестов
  let deck = Array.isArray(rig) ? rig.slice() : newDeck();
  if (rig && !Array.isArray(rig)) { const used = new Set([...Object.values(rig.hole).flat(), ...rig.board]); deck = rig.board.concat(deck.filter(c => !used.has(c))); }
  const h = t.hand = {
    no: t.handNo, bomb, deck, boards: bomb ? [[], []] : [[]], hole: {}, pid: {}, seats: elig, folded: [], bets: {}, contrib: {},
    start: {}, street: 'preflop', cur: 0, minRaise: c.bb, acted: [], toAct: null, deadline: 0, result: null, log: [], collect: 0, last: null,
    sb: null, bbSeat: null, straddleSeat: null,
  };
  for (const s of elig) { h.pid[s] = t.seats[s]; h.bets[s] = 0; h.contrib[s] = 0; h.start[s] = P(t, s).stack; }
  const order = []; let x = t.button;
  for (let i = 0; i < elig.length; i++) { x = nextIn(elig, x); order.push(x); }
  if (rig && rig.hole) for (const s of elig) h.hole[s] = rig.hole[s].slice();
  else for (let r = 0; r < 2; r++) for (const s of order) (h.hole[s] ||= []).push(deck.shift());
  if (bomb) {
    for (const s of elig) { const p = P(t, s), a = Math.min(c.bombAnte, p.stack); p.stack -= a; h.contrib[s] += a; }
    h.log.push('БОМБ-ПОТ: анте ' + c.bombAnte);
    nextStreet(t, now);
    if (!h.result) advance(t, now, t.button);
    return true;
  }
  let sb, bb;
  if (elig.length === 2) { sb = t.button; bb = nextIn(elig, sb); } else { sb = nextIn(elig, t.button); bb = nextIn(elig, sb); }
  put(t, sb, c.sb); put(t, bb, c.bb); h.cur = c.bb; h.sb = sb; h.bbSeat = bb;
  let last = bb;
  if (c.straddle && elig.length >= 3) {
    const u = nextIn(elig, bb), pu = P(t, u);
    if (pu.straddle && u !== t.button) { put(t, u, 2 * c.bb); h.cur = 2 * c.bb; h.minRaise = 2 * c.bb; h.straddleSeat = u; last = u; h.log.push(pu.name + ': стрэддл ' + 2 * c.bb); }
  }
  advance(t, now, last);
  return true;
}

function nextStreet(t, now) {
  const h = t.hand;
  for (const s of h.seats) h.bets[s] = 0;
  h.cur = 0; h.minRaise = t.cfg.bb; h.acted = []; h.collect++; h.last = null;
  const n = { preflop: 3, flop: 1, turn: 1 }[h.street];
  h.street = { preflop: 'flop', flop: 'turn', turn: 'river', river: 'showdown' }[h.street];
  if (h.street === 'showdown') return finish(t, now);
  for (const b of h.boards) for (let i = 0; i < n; i++) b.push(h.deck.shift());
}

function advance(t, now, from) {
  const h = t.hand; if (h.result) return;
  const live = h.seats.filter(s => !h.folded.includes(s));
  if (live.length === 1) return finish(t, now);
  const can = live.filter(s => P(t, s).stack > 0);
  let needs = can.filter(s => !h.acted.includes(s) || h.bets[s] < h.cur);
  if (can.length === 1 && h.bets[can[0]] >= h.cur) needs = [];
  if (!needs.length) {
    h.toAct = null;
    if (can.length <= 1) { while (!h.result) nextStreet(t, now); return; }
    nextStreet(t, now);
    if (!h.result) advance(t, now, t.button);
    return;
  }
  h.toAct = nextIn(needs, from);
  h.deadline = now + t.cfg.timer * 1000;
}

export function act(t, pid, a, now) {
  const h = t.hand; if (!h || h.result) return 'Нет активной раздачи';
  const p = t.players[pid], s = p && p.seat;
  if (s == null || h.toAct !== s || h.pid[s] !== pid) return 'Сейчас не ваш ход';
  const bet = h.bets[s], toCall = h.cur - bet, max = bet + p.stack;
  let type = a.type, amount = a.amount;
  if (type === 'allin') { if (max <= h.cur) type = 'call'; else { type = 'raise'; amount = max; } }
  if (type === 'check' && toCall > 0) return 'Чек невозможен';
  if (type === 'call' && toCall <= 0) type = 'check';
  if (type === 'fold') h.folded.push(s);
  else if (type === 'call') put(t, s, toCall);
  else if (type === 'raise') {
    if (h.acted.includes(s)) return 'Рейз недоступен';
    const to = Math.min(Math.floor(+amount || 0), max);
    if (to <= h.cur) { put(t, s, toCall); type = 'call'; }
    else {
      const inc = to - h.cur;
      if (inc < h.minRaise && to < max) return 'Минимальный рейз до ' + (h.cur + h.minRaise);
      put(t, s, to - bet);
      if (inc >= h.minRaise) { h.minRaise = inc; h.acted = []; }
      h.cur = to;
    }
  } else if (type !== 'check') return 'Неизвестное действие';
  if (!h.acted.includes(s)) h.acted.push(s);
  if (p.stack === 0 && type !== 'fold') type = 'allin';
  const RU = { fold: 'фолд', check: 'чек', call: 'колл', raise: 'рейз до', allin: 'олл-ин' };
  h.last = { seat: s, type, amount: h.bets[s], at: now };
  h.log.push(`${p.name}: ${RU[type]}${type === 'raise' || type === 'call' || type === 'allin' ? ' ' + h.bets[s] : ''}`);
  advance(t, now, s);
}

// Банки и сайд-поты по вкладам
export function computePots(contrib, live) {
  const seats = Object.keys(contrib).map(Number);
  const lv = [...new Set(seats.map(s => contrib[s]).filter(x => x > 0))].sort((a, b) => a - b);
  let prev = 0; const pots = [];
  for (const L of lv) {
    let amt = 0;
    for (const s of seats) amt += Math.min(contrib[s], L) - Math.min(contrib[s], prev);
    prev = L;
    const el = live.filter(s => contrib[s] >= L);
    const last = pots[pots.length - 1];
    if (!el.length) { if (last) last.amount += amt; else pots.push({ amount: amt, eligible: live.slice() }); continue; }
    if (last && last.eligible.join() === el.join()) last.amount += amt; else pots.push({ amount: amt, eligible: el });
  }
  return pots;
}

// Распределение: при двух досках каждый банк делится пополам (лишняя фишка — первой доске),
// внутри доли — делёж между победителями, лишние фишки — первым слева от баттона.
export function distribute(pots, nBoards, scores, order) {
  const pay = {}, awards = [];
  pots.forEach((pot, pi) => {
    const single = pot.eligible.length === 1 || !scores;
    const shares = single || nBoards === 1 ? [pot.amount] : [pot.amount - Math.floor(pot.amount / 2), Math.floor(pot.amount / 2)];
    shares.forEach((amt, bi) => {
      let w;
      if (single) w = [pot.eligible[0]];
      else { const sc = scores[bi]; const top = Math.max(...pot.eligible.map(s => sc[s])); w = pot.eligible.filter(s => sc[s] === top); }
      w.sort((a, b) => order.indexOf(a) - order.indexOf(b));
      const each = Math.floor(amt / w.length); let rem = amt - each * w.length;
      for (const s of w) { const g = each + (rem-- > 0 ? 1 : 0); pay[s] = (pay[s] || 0) + g; awards.push({ pot: pi, board: single ? null : bi, seat: s, amount: g, split: w.length > 1 }); }
    });
  });
  return { pay, awards };
}

function finish(t, now) {
  const h = t.hand;
  const live = h.seats.filter(s => !h.folded.includes(s));
  const showdown = live.length > 1;
  // Если раздача закончилась без вскрытия — доски не дораздаются
  const pots = computePots(h.contrib, live);
  const order = []; let x = t.button;
  for (let i = 0; i < h.seats.length; i++) { x = nextIn(h.seats, x); order.push(x); }
  let scores = null, hands = {};
  if (showdown) {
    scores = h.boards.map((b, bi) => Object.fromEntries(live.map(s => {
      const r = best(h.hole[s].concat(b)); (hands[s] ||= [])[bi] = { name: r.name, best5: r.best5 }; return [s, r.score];
    })));
  }
  const { pay, awards } = distribute(pots, h.boards.length, scores, order);
  for (const s in pay) P(t, +s).stack += pay[s];
  for (const a of awards) { const hb = hands[a.seat]; a.name = hb ? hb[a.board ?? 0].name : null; a.best5 = hb ? hb[a.board ?? 0].best5 : null; a.who = P(t, a.seat).name; }
  const shown = {}; if (showdown) for (const s of live) shown[s] = h.hole[s];
  h.toAct = null;
  h.result = { showdown, shown, hands, awards, pay, pots: pots.map(p => p.amount), until: now + t.cfg.pause };
  t.history.unshift({
    no: h.no, bomb: h.bomb, boards: h.boards, log: h.log.slice(-30),
    players: h.seats.map(s => ({ seat: s, name: P(t, s).name, hole: shown[s] || null, net: (pay[s] || 0) - h.contrib[s] })),
    awards: awards.map(a => ({ who: a.who, amount: a.amount, name: a.name, board: a.board })),
  });
  t.history.length = Math.min(t.history.length, 20);
  applyPending(t);
}

export function tick(t, now) {
  const h = t.hand;
  if (!h) return t.started ? startHand(t, now) : false;
  if (h.result) { if (now >= h.result.until) { t.hand = null; if (t.started) startHand(t, now); return true; } return false; }
  if (h.toAct == null) return false;
  const p = P(t, h.toAct);
  const timeout = now >= h.deadline;
  if (timeout || p.sitOut || p.seat !== h.toAct) {
    const toCall = h.cur - h.bets[h.toAct];
    if (timeout && toCall > 0) p.sitOut = true;
    act(t, h.pid[h.toAct], { type: toCall > 0 ? 'fold' : 'check' }, now);
    return true;
  }
  return false;
}

// Персональное представление: только свои карманные карты (+ вскрытые на шоудауне)
export function view(t, pid, now) {
  const h = t.hand, me = t.players[pid];
  const seats = t.seats.map((spid, s) => {
    const inH = !!(h && h.seats.includes(s));
    const hp = inH ? h.pid[s] : spid; if (!hp) return null;
    const p = t.players[hp];
    let cards = null;
    if (inH) {
      if (hp === pid || (h.result && h.result.shown[s])) cards = h.hole[s];
      else if (!h.folded.includes(s)) cards = ['??', '??'];
    }
    return { pid: hp, name: p.name, stack: p.stack, sitOut: p.sitOut, connected: p.connected, inHand: inH, folded: inH && h.folded.includes(s),
      bet: inH ? h.bets[s] : 0, allin: inH && p.stack === 0 && !h.folded.includes(s), cards, straddle: p.straddle, left: inH && spid !== hp };
  });
  let hand = null, my = null;
  if (h) {
    const sumBets = h.seats.reduce((a, s) => a + h.bets[s], 0);
    const total = h.seats.reduce((a, s) => a + h.contrib[s], 0);
    hand = { no: h.no, bomb: h.bomb, boards: h.boards, street: h.street, toAct: h.toAct, deadline: h.deadline, cur: h.cur, minRaise: h.minRaise,
      pot: total - sumBets, total, collect: h.collect, last: h.last, sb: h.sb, bb: h.bbSeat, straddle: h.straddleSeat, log: h.log.slice(-6),
      result: h.result && { showdown: h.result.showdown, hands: h.result.hands, awards: h.result.awards, until: h.result.until } };
    if (me && me.seat != null && h.toAct === me.seat && !h.result) {
      const bet = h.bets[me.seat], max = bet + me.stack;
      my = { toCall: Math.min(h.cur - bet, me.stack), canCheck: h.cur <= bet, minTo: Math.min(h.cur + h.minRaise, max), maxTo: max,
        canRaise: !h.acted.includes(me.seat) && max > h.cur, bet };
    }
  }
  const k = t.cfg.bombEvery;
  return {
    now, cfg: t.cfg, seats, hand, my, handNo: t.handNo, button: t.button, started: t.started,
    untilBomb: k > 0 ? (Math.ceil((t.handNo + 1) / k) * k - t.handNo) : null,
    me: me ? { pid, name: me.name, seat: me.seat, stack: me.stack, pending: me.pending, sitOut: me.sitOut, straddle: me.straddle } : null,
    admin: pid === t.adminPid,
    players: pid === t.adminPid ? Object.entries(t.players).map(([id, p]) => ({ pid: id, name: p.name, stack: p.stack, pending: p.pending, seat: p.seat, connected: p.connected })) : null,
    requests: pid === t.adminPid ? t.requests.map(r => ({ ...r, name: t.players[r.pid]?.name })) : t.requests.filter(r => r.pid === pid),
    history: t.history,
  };
}
