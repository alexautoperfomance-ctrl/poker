// Оценщик покерных комбинаций (7 карт -> лучшие 5)
export const RANKS = '23456789TJQKA';
export const CAT_RU = ['Старшая карта','Пара','Две пары','Тройка','Стрит','Флеш','Фулл-хаус','Каре','Стрит-флеш','Роял-флеш'];
const rv = c => RANKS.indexOf(c[0]) + 2;

export function eval5(cs) {
  const r = cs.map(rv).sort((a, b) => b - a);
  const flush = cs.every(c => c[1] === cs[0][1]);
  const uniq = [...new Set(r)];
  let straightHi = 0;
  if (uniq.length === 5) {
    if (r[0] - r[4] === 4) straightHi = r[0];
    else if (r[0] === 14 && r[1] === 5) straightHi = 5; // колесо A-5
  }
  const cnt = {};
  r.forEach(x => cnt[x] = (cnt[x] || 0) + 1);
  const groups = Object.keys(cnt).map(Number).sort((a, b) => cnt[b] - cnt[a] || b - a);
  const shape = groups.map(g => cnt[g]).join('');
  let cat, tb;
  if (straightHi && flush) { cat = 8; tb = [straightHi]; }
  else if (shape === '41') { cat = 7; tb = groups; }
  else if (shape === '32') { cat = 6; tb = groups; }
  else if (flush) { cat = 5; tb = r; }
  else if (straightHi) { cat = 4; tb = [straightHi]; }
  else if (shape === '311') { cat = 3; tb = groups; }
  else if (shape === '221') { cat = 2; tb = groups; }
  else if (shape === '2111') { cat = 1; tb = groups; }
  else { cat = 0; tb = r; }
  let score = cat;
  for (let i = 0; i < 5; i++) score = score * 15 + (tb[i] || 0);
  return { score, cat };
}

export function best(cards) {
  const n = cards.length;
  let top = null;
  for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) for (let c = b + 1; c < n; c++)
    for (let d = c + 1; d < n; d++) for (let e = d + 1; e < n; e++) {
      const five = [cards[a], cards[b], cards[c], cards[d], cards[e]];
      const v = eval5(five);
      if (!top || v.score > top.score) top = { ...v, best5: five };
    }
  top.name = top.cat === 8 && rv(top.best5.slice().sort((x, y) => rv(y) - rv(x))[0]) === 14 && top.best5.some(c => c[0] === 'K') ? CAT_RU[9] : CAT_RU[top.cat];
  return top;
}
