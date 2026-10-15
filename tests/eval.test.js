import test from 'node:test';
import assert from 'node:assert/strict';
import { best, eval5 } from '../eval.js';
import { computePots, distribute, newTable, addPlayer, sit, startHand, act } from '../engine.js';

const B = s => best(s.split(' '));
const cmp = (a, b) => Math.sign(B(a).score - B(b).score);

test('категории комбинаций', () => {
  const cases = {
    'As Ks Qs Js Ts 2d 3c': 'Роял-флеш', '9h 8h 7h 6h 5h Ad Ac': 'Стрит-флеш', '5d 4d 3d 2d Ad Kc Kh': 'Стрит-флеш',
    'Qc Qd Qh Qs 2c 3d 4h': 'Каре', 'Kc Kd Kh 2s 2c 7d 8h': 'Фулл-хаус', 'Ah 9h 7h 4h 2h Kd Kc': 'Флеш',
    'Ad 2c 3h 4s 5d Kc Kh': 'Стрит', 'Tc Jd Qh Ks Ad 2c 2h': 'Стрит', '7c 7d 7h Ks 2d 4c 9h': 'Тройка',
    'Jc Jd 4h 4s Ad 2c 9h': 'Две пары', 'Tc Td 4h 5s Ad 2c 9h': 'Пара', 'Ac Qd 9h 7s 5d 3c 2h': 'Старшая карта',
  };
  for (const [h, n] of Object.entries(cases)) assert.equal(B(h).name, n, h);
});

test('сравнение и кикеры', () => {
  assert.equal(cmp('As Ad Kc 7h 4s 3d 2c', 'Ah Ac Qc 7d 4h 3s 2d'), 1);
  assert.equal(cmp('6s 5d 4c 3h 2s Kd Kc', 'Ad 2c 3h 4s 5d Qc Jh'), 1); // 6-high > колесо
  assert.equal(cmp('Ks Kd 9c 9h 2s 3d 4c', 'Ks Kd 9c 9h As 3d 4c'), -1); // кикер в двух парах
  assert.equal(cmp('Kc Kd Kh 2s 2c 7d 8h', 'Qc Qd Qh As Ac 7d 8h'), 1);
  assert.equal(cmp('Ah Kh 7h 4h 2h 3c 3d', 'Ah Qh Jh 4h 2h 3c 3d'), 1);
  assert.equal(cmp('2c 2d 5h 6s 9d Jc Qh', '2h 2s 5c 6d 9h Js Qd'), 0); // сплит
  assert.equal(B('As Ac Ad Ah Ks Kd Kc').best5.length, 5);
  assert.equal(eval5('As Ks Qs Js Ts'.split(' ')).cat, 8);
});

test('сайд-поты', () => {
  // A олл-ин 100, B 300, C 300 (C фолд? нет), D фолд вложив 50
  const pots = computePots({ 0: 100, 1: 300, 2: 300, 3: 50 }, [0, 1, 2]);
  assert.deepEqual(pots, [{ amount: 350, eligible: [0, 1, 2] }, { amount: 400, eligible: [1, 2] }]);
  const r = distribute(pots, 1, [{ 0: 9, 1: 5, 2: 1 }], [0, 1, 2]);
  assert.deepEqual(r.pay, { 0: 350, 1: 400 });
});

test('сплит с нечётной фишкой — первому слева от баттона', () => {
  const r = distribute([{ amount: 101, eligible: [2, 5] }], 1, [{ 2: 7, 5: 7 }], [5, 2]);
  assert.deepEqual(r.pay, { 5: 51, 2: 50 });
});

test('двойная доска: банк делится пополам по доскам', () => {
  const r = distribute([{ amount: 400, eligible: [0, 1, 2] }], 2, [{ 0: 9, 1: 1, 2: 1 }, { 0: 1, 1: 9, 2: 1 }], [0, 1, 2]);
  assert.deepEqual(r.pay, { 0: 200, 1: 200 });
});

test('двойная доска: один игрок выигрывает обе', () => {
  const r = distribute([{ amount: 600, eligible: [0, 1] }], 2, [{ 0: 9, 1: 1 }, { 0: 8, 1: 2 }], [1, 0]);
  assert.deepEqual(r.pay, { 0: 600 });
});

test('двойная доска: нечётные фишки и сплит на одной доске', () => {
  // 301 -> доска1 151, доска2 150. Доска1: сплит 0 и 1 (151 -> 76/75), доска2: игрок 2
  const r = distribute([{ amount: 301, eligible: [0, 1, 2] }], 2, [{ 0: 5, 1: 5, 2: 1 }, { 0: 1, 1: 1, 2: 9 }], [1, 0, 2]);
  assert.deepEqual(r.pay, { 1: 76, 0: 75, 2: 150 });
  const total = Object.values(r.pay).reduce((a, b) => a + b);
  assert.equal(total, 301);
});

test('двойная доска с сайд-потами', () => {
  const pots = computePots({ 0: 100, 1: 500, 2: 500 }, [0, 1, 2]); // 300 main, 800 side
  // доска1: выигрывает 0 (коротыш), доска2: выигрывает 2; в сайде на доске1 лучший из 1,2 = 1
  const r = distribute(pots, 2, [{ 0: 9, 1: 5, 2: 1 }, { 0: 1, 1: 2, 2: 9 }], [0, 1, 2]);
  assert.deepEqual(r.pay, { 0: 150, 2: 150 + 400, 1: 400 });
});

function table(n, stack = 1000) {
  const t = newTable({ pause: 0 });
  for (let i = 0; i < n; i++) { addPlayer(t, 'p' + i, 'P' + i); t.players['p' + i].stack = stack; sit(t, 'p' + i, i); }
  return t;
}
const deck = s => { const fixed = s.split(' '); const rest = []; for (const r of '23456789TJQKA') for (const x of 'shdc') if (!fixed.includes(r + x)) rest.push(r + x); return fixed.concat(rest); };
const sum = t => Object.values(t.players).reduce((a, p) => a + p.stack, 0);

test('полная раздача: олл-ин, сайд-пот, сохранение фишек', () => {
  const t = table(3); t.players.p0.stack = 200;
  // button=0, sb=1, bb=2; раздача начиная с 1: 1,2,0,1,2,0
  t.rig = [deck('Kd 2c As Kc 3d Ad 7h 8h 9s 4c 5s')];
  startHand(t, 0);
  const h = t.hand; assert.equal(t.button, 0); assert.equal(h.toAct, 0);
  act(t, 'p0', { type: 'allin' }, 0);
  act(t, 'p1', { type: 'raise', amount: 600 }, 0);
  act(t, 'p2', { type: 'call' }, 0);
  // флоп: p1, p2 активны
  act(t, 'p1', { type: 'check' }, 0); act(t, 'p2', { type: 'check' }, 0);
  act(t, 'p1', { type: 'check' }, 0); act(t, 'p2', { type: 'check' }, 0);
  act(t, 'p1', { type: 'check' }, 0); act(t, 'p2', { type: 'check' }, 0);
  assert.ok(h.result.showdown);
  assert.equal(t.players.p0.stack, 600); // AA выигрывает главный банк 3*200
  assert.equal(sum(t), 2200);
});

test('бомб-пот каждую 7-ю раздачу: анте, без префлопа, две доски', () => {
  const t = table(3); t.handNo = 6;
  startHand(t, 0);
  const h = t.hand;
  assert.ok(h.bomb); assert.equal(h.boards.length, 2); assert.equal(h.street, 'flop');
  assert.equal(h.boards[0].length, 3); assert.equal(h.boards[1].length, 3);
  assert.equal(h.seats.reduce((a, s) => a + h.contrib[s], 0), 120);
  while (!h.result) act(t, t.hand.pid[h.toAct], { type: 'check' }, 0);
  assert.equal(h.boards[0].length, 5); assert.equal(sum(t), 3000);
});

test('стрэддл действует последним на префлопе', () => {
  const t = table(4); t.players.p3.straddle = true; // button 0, sb1, bb2, utg3
  startHand(t, 0);
  assert.equal(t.hand.cur, 40); assert.equal(t.hand.toAct, 0);
  act(t, 'p0', { type: 'call' }, 0); act(t, 'p1', { type: 'call' }, 0); act(t, 'p2', { type: 'call' }, 0);
  assert.equal(t.hand.toAct, 3); assert.equal(t.hand.street, 'preflop');
  act(t, 'p3', { type: 'check' }, 0); assert.equal(t.hand.street, 'flop');
});

test('короткий олл-ин не переоткрывает торги', () => {
  const t = table(3); t.players.p0.stack = 130; // btn0 sb1 bb2, p0 первым
  startHand(t, 0);
  act(t, 'p0', { type: 'call' }, 0); // 20
  act(t, 'p1', { type: 'raise', amount: 100 }, 0);
  act(t, 'p2', { type: 'call' }, 0);
  act(t, 'p0', { type: 'allin' }, 0); // до 130: инкремент 30 < 80
  assert.equal(t.hand.toAct, 1);
  assert.match(act(t, 'p1', { type: 'raise', amount: 400 }, 0), /Рейз/);
});
