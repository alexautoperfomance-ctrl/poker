import * as E from './engine.js';

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const TEST = new URLSearchParams(location.search).has('test');
const PREFIX = 'hpk26-';
const ABC = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const rid = n => Array.from(crypto.getRandomValues(new Uint8Array(n)), b => ABC[b % ABC.length]).join('');
const fmt = n => (n ?? 0).toLocaleString('ru-RU');
const plural = (n, a, b, c) => { const m = n % 10, h = n % 100; return m === 1 && h !== 11 ? a : m >= 2 && m <= 4 && (h < 10 || h >= 20) ? b : c; };
const STREET = { preflop: 'Префлоп', flop: 'Флоп', turn: 'Тёрн', river: 'Ривер', showdown: 'Вскрытие' };
const SUIT = { s: '♠', h: '♥', d: '♦', c: '♣' };
if (TEST) { window.__msgs = []; window.__V = () => V; window.__peer = () => peer; window.__send = d => send(d); }

let code = (location.hash.match(/t=([A-Z0-9]{4,8})/i) || [])[1]?.toUpperCase();
let role = null, T = null, myPid = null, peer = null, hostConn = null, V = null, PV = null, clockOff = 0;
const conns = {};
let tab = 'hist', sheetOpen = false, raiseTo = null;

/* ---------- утилиты UI ---------- */
function toast(m) { const t = $('#toast'); t.textContent = m; t.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 2400); }
function setNet(ok, text) { const n = $('#net'); n.textContent = text; n.classList.toggle('bad', !ok); }
function overlay(html) { const o = $('#overlay'); if (!html) return o.classList.add('hidden'); o.innerHTML = html; o.classList.remove('hidden'); }
const cardHTML = (c, cls = '') => c === '??' || !c ? `<div class="card back ${cls}"></div>`
  : `<div class="card ${c[1]} ${cls}" data-c="${c}"><b>${c[0] === 'T' ? '10' : c[0]}</b><i>${SUIT[c[1]]}</i><span class="big">${SUIT[c[1]]}</span></div>`;
const hue = s => [...s].reduce((a, c) => a * 31 + c.charCodeAt(0) >>> 0, 7) % 360;
const avatar = name => { const h = hue(name || '?'); return `background:radial-gradient(circle at 35% 30%,hsl(${h} 70% 62%),hsl(${(h + 40) % 360} 65% 32%))`; };
const initials = n => (n || '?').trim().split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();
const peerOpts = { debug: 0, config: { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:global.stun.twilio.com:3478' }] } };
const shareLink = () => location.origin + location.pathname + '#t=' + code;

/* ---------- лендинг ---------- */
function landing() {
  $('#game').classList.add('hidden');
  const L = $('#landing'); L.classList.remove('hidden');
  const name = localStorage.pk_name || '';
  const mine = Object.keys(localStorage).filter(k => k.startsWith('pkh_')).map(k => k.slice(4));
  const chip = `<svg class="chipsvg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="48" fill="#c1121f"/><g fill="#fff">${[0, 60, 120, 180, 240, 300].map(a => `<rect x="44" y="2" width="12" height="18" rx="3" transform="rotate(${a} 50 50)"/>`).join('')}</g><circle cx="50" cy="50" r="30" fill="#8d0d17" stroke="#fff" stroke-width="3" stroke-dasharray="5 4"/><text x="50" y="60" font-size="30" text-anchor="middle" fill="#fff" font-weight="900">♠</text></svg>`;
  if (code) {
    L.innerHTML = `<div class="brand">${chip}<h1>Стол ${esc(code)}</h1><p>Вас пригласили сыграть в холдем</p></div>
    <div class="panel"><label class="l">Ваш ник</label><input id="nick" maxlength="16" placeholder="Например, Лёша" value="${esc(name)}">
    <div style="height:14px"></div><button class="btn" id="joinBtn">Войти за стол</button></div>
    <div class="panel mut">Фишки виртуальные. После входа попросите фишки у хоста в меню «Фишки».</div>`;
    $('#joinBtn').onclick = () => { const n = $('#nick').value.trim(); if (!n) return toast('Введите ник'); localStorage.pk_name = n; startClient(n); };
    return;
  }
  L.innerHTML = `<div class="brand">${chip}<h1>Холдем с друзьями</h1><p>Безлимитный техасский холдем · только виртуальные фишки</p></div>
  <div class="panel"><h2>Создать стол</h2>
    <label class="l">Ваш ник</label><input id="nick" maxlength="16" placeholder="Ник" value="${esc(name)}">
    <label class="l">Блайнды</label><select id="blinds">${E.BLINDS.map((b, i) => `<option value="${i}">${b[0]} / ${b[1]}</option>`).join('')}</select>
    <div class="row"><div><label class="l">Ваш стек</label><input id="stack" type="number" value="2000"></div><div><label class="l">Таймер хода, с</label><input id="timer" type="number" value="25"></div></div>
    <div class="row"><div><label class="l">Бомб-пот каждые N рук</label><input id="bombEvery" type="number" value="7"></div><div><label class="l">Анте бомб-пота</label><input id="bombAnte" type="number" placeholder="2×ББ"></div></div>
    <label class="chk"><input type="checkbox" id="straddle" checked> Разрешить стрэддл (UTG, 2×ББ)</label>
    <label class="l">PIN админа (4–8 цифр) — понадобится, чтобы снова открыть стол как хост</label><input id="pin" type="password" inputmode="numeric" maxlength="8" placeholder="••••" autocomplete="new-password">
    <button class="btn" id="createBtn">Создать стол</button></div>
  <div class="panel"><h2>Войти по коду</h2><div class="row"><input id="codeIn" placeholder="Код стола" maxlength="8" style="text-transform:uppercase"><button class="btn sm sec" id="goBtn" style="flex:none">Войти</button></div></div>
  ${mine.length ? `<div class="panel mytables"><h2>Мои столы (я хост)</h2>${mine.map(c => `<a href="#t=${c}">Стол ${c} — продолжить</a>`).join('')}</div>` : ''}`;
  $('#goBtn').onclick = () => { const c = $('#codeIn').value.trim().toUpperCase(); if (c) location.hash = 't=' + c; };
  $('#createBtn').onclick = async () => {
    const n = $('#nick').value.trim(); if (!n) return toast('Введите ник');
    const pin = $('#pin').value.trim(); if (!/^\d{4,8}$/.test(pin)) return toast('PIN: от 4 до 8 цифр');
    localStorage.pk_name = n;
    code = rid(5);
    const t = E.newTable(TEST ? { pause: 1800 } : {});
    const bi = +$('#blinds').value;
    E.setCfg(t, { blinds: bi, straddle: $('#straddle').checked, bombEvery: +$('#bombEvery').value, timer: +$('#timer').value });
    if (+$('#bombAnte').value > 0) E.setCfg(t, { bombAnte: +$('#bombAnte').value });
    const pid = rid(8);
    E.addPlayer(t, pid, n, rid(12)); t.adminPid = pid; E.adjust(t, pid, Math.max(0, +$('#stack').value | 0), 'стартовый стек хоста');
    t.code = code; t.players[pid].status = 'ok';
    t.pinHash = await pinHash(code, pin); sessionStorage['pku_' + code] = t.pinHash;
    localStorage['pkh_' + code] = JSON.stringify(t);
    history.replaceState(null, '', '#t=' + code);
    startHost();
  };
}

/* ---------- хост ---------- */
async function pinHash(c, pin) { const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('poker:' + c + ':' + pin)); return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join(''); }
// Вход хоста: на этом устройстве стол открывается только после ввода PIN (на вкладку запоминается до закрытия)
function hostGate() {
  const t = JSON.parse(localStorage['pkh_' + code]);
  if (t.pinHash && sessionStorage['pku_' + code] === t.pinHash) return startHost();
  $('#game').classList.add('hidden');
  const L = $('#landing'); L.classList.remove('hidden');
  L.innerHTML = `<div class="brand"><h1>Стол ${esc(code)}</h1><p>${t.pinHash ? 'Введите PIN админа' : 'Задайте PIN админа для этого стола'}</p></div>
    <div class="panel"><input id="pinIn" type="password" inputmode="numeric" maxlength="8" placeholder="PIN" autocomplete="off"><div style="height:12px"></div>
    <button class="btn" id="pinBtn">Открыть как хост</button><div style="height:10px"></div><button class="btn sec" id="pinBack">На главную</button></div>`;
  $('#pinBack').onclick = () => { location.hash = ''; };
  $('#pinBtn').onclick = async () => {
    const pin = $('#pinIn').value.trim(); if (!/^\d{4,8}$/.test(pin)) return toast('PIN: от 4 до 8 цифр');
    const hsh = await pinHash(code, pin);
    if (!t.pinHash) { t.pinHash = hsh; localStorage['pkh_' + code] = JSON.stringify(t); }
    else if (hsh !== t.pinHash) { await new Promise(r => setTimeout(r, 800)); return toast('Неверный PIN'); }
    sessionStorage['pku_' + code] = hsh; startHost();
  };
}
function persist() { try { localStorage['pkh_' + code] = JSON.stringify(T); } catch (e) { } }
function changed() {
  persist();
  const now = Date.now();
  for (const [pid, c] of Object.entries(conns)) if (c.open) try { c.send({ t: 'view', v: E.view(T, pid, now) }); } catch (e) { }
  V = E.view(T, myPid, now); clockOff = 0; render();
}
function startHost() {
  role = 'host';
  T = JSON.parse(localStorage['pkh_' + code]); myPid = T.adminPid;
  for (const p of Object.values(T.players)) p.connected = false;
  T.players[myPid].connected = true;
  if (T.hand && !T.hand.result && T.hand.toAct != null) T.hand.deadline = Date.now() + T.cfg.timer * 1000; // не штрафуем за время офлайна
  if (T.hand && T.hand.result) T.hand.result.until = Date.now() + 2500;
  if (TEST) { window.__T = () => T; window.__rig = decks => { T.rig = decks; }; window.__cfg = c => { Object.assign(T.cfg, c); changed(); }; }
  showGame();
  makeHostPeer();
  setInterval(() => { if (E.tick(T, Date.now())) changed(); }, 250);
  setInterval(() => { for (const c of Object.values(conns)) if (c.open) try { c.send({ t: 'ping' }); } catch (e) { } }, 3000);
  changed();
}
function makeHostPeer() {
  setNet(false, 'подключение…');
  peer = new Peer(PREFIX + code, peerOpts);
  peer.on('open', () => setNet(true, 'хост ● онлайн'));
  peer.on('connection', c => {
    c.on('data', d => onHostMsg(c, d));
    c.on('close', () => { if (c.pid && conns[c.pid] === c) { delete conns[c.pid]; T.players[c.pid].connected = false; changed(); } });
  });
  peer.on('disconnected', () => { setNet(false, 'переподключение…'); setTimeout(() => { if (!peer.destroyed) peer.reconnect(); }, 1500); });
  peer.on('error', e => {
    if (e.type === 'unavailable-id') { setNet(false, 'ожидание ID…'); peer.destroy(); setTimeout(makeHostPeer, 4000); }
    else if (e.type === 'network' || e.type === 'server-error' || e.type === 'socket-error') { setNet(false, 'нет сети'); }
  });
}
function onHostMsg(c, d) {
  if (!d || typeof d !== 'object') return;
  if (d.t === 'hello') {
    let pid = d.pid, p = pid && T.players[pid];
    if (!p || p.token !== d.token || pid === T.adminPid) {
      pid = rid(8); p = E.addPlayer(T, pid, String(d.name || 'Игрок').slice(0, 16), rid(12));
      const inv = (T.invites ||= []).find(i => i.name.toLowerCase() === p.name.toLowerCase());
      if (inv) { p.status = 'ok'; T.invites = T.invites.filter(i => i !== inv); if (inv.chips > 0) E.adjust(T, pid, inv.chips, 'приглашение'); }
    }
    else if (d.name) p.name = String(d.name).slice(0, 16);
    if (p.status === 'kicked') { c.send({ t: 'kicked' }); setTimeout(() => c.close(), 500); return; }
    p.connected = true; c.pid = pid;
    if (conns[pid] && conns[pid] !== c) try { conns[pid].close(); } catch (e) { }
    conns[pid] = c;
    c.send({ t: 'welcome', pid, token: p.token });
    changed(); return;
  }
  if (!c.pid) return;
  const err = handle(c.pid, d);
  if (err) c.send({ t: 'err', msg: err });
  changed();
}
function handle(pid, d) {
  const now = Date.now(), p = T.players[pid]; if (!p) return 'Нет игрока';
  switch (d.t) {
    case 'sit': return E.sit(T, pid, d.seat | 0);
    case 'stand': return E.stand(T, pid, now);
    case 'act': return E.act(T, pid, d.a || {}, now);
    case 'sitout': p.sitOut = !!d.v; return;
    case 'straddle': p.straddle = !!d.v; return;
    case 'req': { if (p.status !== 'ok' && pid !== T.adminPid) return 'Сначала хост должен вас одобрить'; const a = Math.max(1, Math.min(1e7, d.amount | 0)); T.requests = T.requests.filter(r => r.pid !== pid); T.requests.push({ id: rid(6), pid, amount: a }); return; }
  }
  if (pid !== T.adminPid) return 'Только для хоста';
  switch (d.t) {
    case 'start': T.started = true; return;
    case 'pause': T.started = false; return;
    case 'chips': return E.adjust(T, d.pid, d.delta, d.delta > 0 ? 'выдача' : 'изъятие');
    case 'approve': case 'deny': { const r = T.requests.find(x => x.id === d.id); if (!r) return; T.requests = T.requests.filter(x => x !== r); if (d.t === 'approve') E.adjust(T, r.pid, r.amount, 'по запросу'); return; }
    case 'admit': { const q = T.players[d.pid]; if (q) q.status = 'ok'; return; }
    case 'reject': { const q = T.players[d.pid]; if (q && q.status === 'pending') { q.status = 'kicked'; conns[d.pid]?.send({ t: 'kicked' }); } return; }
    case 'unban': { const q = T.players[d.pid]; if (q) q.status = 'ok'; return; }
    case 'invite': { const n = String(d.name || '').trim().slice(0, 16); if (!n) return 'Введите ник'; (T.invites ||= []).push({ name: n, chips: Math.max(0, d.chips | 0) }); return; }
    case 'uninvite': T.invites = (T.invites || []).filter(i => i.name !== d.name); return;
    case 'cfg': E.setCfg(T, d.cfg || {}); return;
    case 'kick': { if (d.pid === T.adminPid) return; E.stand(T, d.pid, now); const q = T.players[d.pid]; if (q) q.status = 'kicked'; T.requests = T.requests.filter(r => r.pid !== d.pid);
      const kc = conns[d.pid]; if (kc) { try { kc.send({ t: 'kicked' }); } catch (e) { } setTimeout(() => kc.close(), 500); } return; }
  }
}

/* ---------- клиент ---------- */
let ident = {}, connTimer = null, gotView = false, kicked = false, lastMsg = 0;
// сторож: если хост молчит дольше 9 с (пинг раз в 3 с) — переподключаемся
setInterval(() => { if (role === 'client' && hostConn && hostConn.open && lastMsg && Date.now() - lastMsg > 9000) { lastMsg = 0; hostDown(); connect(); } }, 2000);
function startClient(name) {
  role = 'client';
  ident = JSON.parse(localStorage['pkc_' + code] || '{}'); ident.name = name;
  showGame(); overlay(`<div><div class="spin"></div>Подключаемся к столу ${esc(code)}…</div>`);
  peer = new Peer(peerOpts);
  peer.on('open', connect);
  peer.on('error', e => { if (e.type === 'peer-unavailable') { hostDown(); retry(3000); } });
  peer.on('disconnected', () => setTimeout(() => { if (!peer.destroyed) peer.reconnect(); }, 1500));
}
function retry(ms) { if (kicked) return; clearTimeout(connTimer); connTimer = setTimeout(connect, ms); }
function hostDown() { if (kicked) return;
  setNet(false, 'хост офлайн');
  overlay(`<div><div class="spin"></div><b>Хост не в сети</b><p class="mut">Игра сохранена у хоста и продолжится, как только он снова откроет стол. Переподключаемся автоматически…</p><button class="btn sec sm" onclick="location.hash='';location.reload()">На главную</button></div>`);
}
function connect() {
  if (!peer.open) return retry(2000);
  if (hostConn) try { hostConn.close(); } catch (e) { }
  const c = hostConn = peer.connect(PREFIX + code, { reliable: true });
  retry(8000); // если не открылось — пробуем снова
  c.on('open', () => { clearTimeout(connTimer); lastMsg = Date.now(); c.send({ t: 'hello', pid: ident.pid, token: ident.token, name: ident.name }); setNet(true, '● онлайн'); });
  c.on('data', d => {
    lastMsg = Date.now();
    if (d.t === 'ping') return;
    if (TEST) window.__msgs.push(JSON.parse(JSON.stringify(d)));
    if (d.t === 'welcome') { ident.pid = d.pid; ident.token = d.token; myPid = d.pid; localStorage['pkc_' + code] = JSON.stringify(ident); }
    else if (d.t === 'view') { if (kicked) return; gotView = true; overlay(null); V = d.v; clockOff = V.now - Date.now(); render(); }
    else if (d.t === 'err') toast(d.msg);
    else if (d.t === 'kicked') { kicked = true; clearTimeout(connTimer); overlay(`<div><b>Хост убрал вас со стола</b><p class="mut">Ваш баланс сохранён у хоста.</p><button class="btn sec sm" onclick="location.hash='';location.reload()">На главную</button></div>`); }
  });
  c.on('close', () => { if (c !== hostConn) return; hostDown(); retry(2000); });
}
function send(d) {
  if (role === 'host') { const e = handle(myPid, d); if (e) toast(e); changed(); }
  else if (hostConn && hostConn.open) hostConn.send(d); else toast('Нет связи с хостом');
}

/* ---------- игра: рендер ---------- */
function showGame() {
  $('#landing').classList.add('hidden'); $('#game').classList.remove('hidden');
  $('#menuBtn').onclick = () => openSheet(tab);
  $('#sheetClose').onclick = closeSheet;
  $('#sheet').onclick = e => { if (e.target.id === 'sheet') closeSheet(); };
  $('#shareBtn').onclick = async () => {
    const url = shareLink();
    try { if (navigator.share) await navigator.share({ title: 'Холдем: стол ' + code, text: 'Садись за стол ' + code, url }); else { await navigator.clipboard.writeText(url); toast('Ссылка скопирована'); } }
    catch (e) { prompt('Ссылка на стол:', url); }
  };
  addEventListener('resize', () => V && render());
  requestAnimationFrame(timerLoop);
}
function seatPos(s) {
  const my = V.me?.seat;
  const r = my != null ? (s - my + 9) % 9 : s;
  const wide = innerWidth / innerHeight > 1;
  const a = Math.PI / 2 + r * 2 * Math.PI / 9;
  const rx = wide ? 45 : 41, ry = wide ? 40 : 44;
  return { x: 50 + rx * Math.cos(a), y: 50 + ry * Math.sin(a) };
}
const lerp = (p, k, cy = 47) => ({ x: p.x + (50 - p.x) * k, y: p.y + (cy - p.y) * k });

function render() {
  if (!V) return;
  const v = V, h = v.hand, prev = PV && PV.hand && h && PV.hand.no === h.no ? PV : null;
  $('#tCode').textContent = 'Стол ' + code;
  $('#tSub').textContent = `${v.cfg.sb}/${v.cfg.bb}${v.cfg.straddle ? ' · стрэддл' : ''} · ${h ? 'Раздача #' + h.no + ' · ' + STREET[h.street] : (v.started ? 'ждём игроков' : 'пауза')}`;
  $('#bombInfo').textContent = h?.bomb ? '' : v.untilBomb ? `до бомб-пота: ${v.untilBomb} ${plural(v.untilBomb, 'рука', 'руки', 'рук')}` : '';
  $('#bombBanner').classList.toggle('hidden', !h?.bomb);
  const tb = $('#table'), W = tb.clientWidth, H = tb.clientHeight;
  const res = h?.result;
  const winSeats = new Set(res ? res.awards.filter(a => a.amount > 0).map(a => a.seat) : []);
  // лучшие карты для подсветки
  const hiCards = new Set();
  if (res && res.showdown) for (const a of res.awards) if (a.best5) a.best5.forEach(c => hiCards.add((a.board ?? 0) + c));
  // места
  let html = '';
  const dealOrder = h ? h.seats || [] : [];
  v.seats.forEach((st, s) => {
    const p = seatPos(s);
    if (!st) {
      const canSit = v.me && v.me.seat == null && v.me.status === 'ok';
      html += `<div class="seat empty" style="left:${p.x}%;top:${p.y}%" ${canSit ? `data-sit="${s}"` : ''}><div class="av"><div class="face">${canSit ? 'Сесть' : ''}</div></div></div>`;
      return;
    }
    const isMe = st.pid === v.me?.pid;
    const cls = ['seat', isMe && 'me', st.folded && 'folded', (st.sitOut || !st.connected) && 'out', h && h.toAct === s && 'turn', winSeats.has(s) && 'win'].filter(Boolean).join(' ');
    let cards = '';
    if (st.cards) {
      const fresh = !prev || !PV.seats[s]?.cards;
      const revealed = prev && PV.seats[s]?.cards?.[0] === '??' && st.cards[0] !== '??';
      const fx = (50 - p.x) / 100 * W, fy = (47 - p.y) / 100 * H;
      cards = `<div class="hc">${st.cards.map((c, i) => {
        let k = fresh ? 'deal' : revealed ? 'flip' : '';
        if (res && res.showdown && c !== '??') k += [...hiCards].some(x => x.slice(1) === c) ? ' hi' : '';
        return cardHTML(c, k).replace('class="card', `style="--fx:${fx}px;--fy:${fy}px;animation-delay:${fresh ? (i * dealOrder.length + Math.max(0, dealOrder.indexOf(s))) * 70 : 0}ms" class="card`);
      }).join('')}</div>`;
    }
    let tag = '';
    if (h && h.last && h.last.seat === s && !res) {
      const L = { fold: 'Фолд', check: 'Чек', call: 'Колл', raise: 'Рейз', allin: 'Олл-ин' };
      tag = `<div class="tag ${h.last.type}">${L[h.last.type]}</div>`;
    } else if (st.allin) tag = `<div class="tag allin">Олл-ин</div>`;
    else if (st.sitOut) tag = `<div class="tag fold">Отошёл</div>`;
    const won = res ? res.awards.filter(a => a.seat === s).reduce((x, a) => x + a.amount, 0) : 0;
    html += `<div class="${cls}" data-seat="${s}" style="left:${p.x}%;top:${p.y}%">${tag}${!st.connected ? '<div class="off">офлайн</div>' : ''}
      ${cards}<div class="av"><div class="ring" ${h && h.toAct === s ? '' : 'style="display:none"'}></div><div class="face" style="${avatar(st.name)}">${esc(initials(st.name))}</div></div>
      <div class="plate"><div class="nm">${esc(st.name)}</div><div class="st">${won ? '+' + fmt(won) : st.stack ? fmt(st.stack) : st.inHand ? 'олл-ин' : '0'}</div></div></div>`;
    if (st.bet > 0) { const b = lerp(p, .42); html += `<div class="bet" data-bet="${s}" style="left:${b.x}%;top:${b.y}%"><span class="chip" style="--cc:${chipColor(st.bet)}"></span>${fmt(st.bet)}</div>`; }
  });
  if (v.button >= 0 && v.seats[v.button]) { const d = lerp(seatPos(v.button), .25); const q = seatPos(v.button); html += `<div class="dbtn" style="left:${d.x + (q.x < 50 ? 6 : -6)}%;top:${d.y}%">D</div>`; }
  $('#seats').innerHTML = html;
  $('#seats').querySelectorAll('[data-sit]').forEach(el => el.onclick = () => send({ t: 'sit', seat: +el.dataset.sit }));
  // доски
  let bh = '';
  if (h) h.boards.forEach((b, bi) => {
    const pb = prev ? prev.hand.boards[bi] : [];
    const wonB = res && res.showdown && h.boards.length > 1 && res.awards.some(a => a.board === bi);
    bh += `<div class="board ${h.boards.length > 1 ? 'b2' : ''}">${h.boards.length > 1 ? `<span class="bl">${bi + 1}</span>` : ''}${[0, 1, 2, 3, 4].map(i => {
      const c = b[i]; if (!c) return `<div class="card" style="visibility:hidden"></div>`;
      const fresh = !pb || i >= pb.length;
      let k = fresh ? 'flip' : '';
      if (res && res.showdown) k += hiCards.has(bi + c) || (h.boards.length === 1 && hiCards.has('0' + c)) ? ' hi' : ' dim';
      return cardHTML(c, k).replace('class="card', `style="animation-delay:${fresh ? (i - (pb ? pb.length : 0)) * 120 + bi * 200 : 0}ms" class="card`);
    }).join('')}</div>`;
    void wonB;
  });
  $('#boards').innerHTML = bh;
  const potShown = h ? (res ? 0 : h.pot) : 0;
  $('#pot').innerHTML = h && (potShown || !res) && h.total ? `<span class="chip"></span>Банк: ${fmt(res ? h.total : potShown || 0)}` : '';
  if (h && !res) $('#pot').innerHTML = h.pot ? `<span class="chip"></span>Банк: ${fmt(h.pot)}` : '';
  $('#hname').innerHTML = res ? resultText(res, h) : '';
  renderControls();
  animations(prev, v);
  if (sheetOpen) renderSheet();
  PV = v;
}
function chipColor(n) { return n >= 1000 ? '#222' : n >= 500 ? '#7b2cbf' : n >= 100 ? '#1d6fd8' : n >= 50 ? '#13914a' : '#e63946'; }
function resultText(res, h) {
  const by = {};
  for (const a of res.awards) { if (!a.amount) continue; const k = a.seat + '|' + (a.board ?? 'x'); by[k] ||= { ...a, amount: 0 }; by[k].amount += a.amount; }
  return Object.values(by).map(a => `<span class="w">${h.boards.length > 1 && a.board != null ? `Доска ${a.board + 1}: ` : ''}${esc(a.who)} +${fmt(a.amount)}${a.name ? ' — ' + a.name : ''}${a.split ? ' (делёж)' : ''}</span>`).join('');
}
function elCenter(el) { const r = el.getBoundingClientRect(), f = $('#fx').getBoundingClientRect(); return { x: r.left + r.width / 2 - f.left, y: r.top + r.height / 2 - f.top }; }
function fly(from, to, label, delay = 0) {
  const d = document.createElement('div'); d.className = 'fly';
  d.innerHTML = `<span class="chip"></span>${label ? `<b style="font-size:12px;margin-left:3px">${label}</b>` : ''}`;
  d.style.cssText = `left:${from.x}px;top:${from.y}px;display:flex;align-items:center`;
  $('#fx').appendChild(d);
  setTimeout(() => requestAnimationFrame(() => { d.style.left = to.x + 'px'; d.style.top = to.y + 'px'; }), 30 + delay);
  setTimeout(() => { d.style.opacity = 0; }, 650 + delay);
  setTimeout(() => d.remove(), 1000 + delay);
}
function animations(prev, v) {
  const h = v.hand; if (!h) return;
  const potEl = $('#pot'); const potC = elCenter(potEl.innerHTML ? potEl : $('#boards'));
  const tb = $('#table'), W = tb.clientWidth, H = tb.clientHeight;
  const pct = q => ({ x: q.x / 100 * W, y: q.y / 100 * H });
  // ставки в банк
  if (prev && h.collect > prev.hand.collect) prev.seats.forEach((st, s) => { if (st && st.bet > 0) fly(pct(lerp(seatPos(s), .42)), potC, '', 0); });
  // банк победителю
  if (h.result && !(prev && prev.hand.result)) {
    let i = 0;
    for (const a of h.result.awards) if (a.amount > 0) { const el = document.querySelector(`.seat[data-seat="${a.seat}"] .av`); if (el) for (let k = 0; k < 4; k++) fly(potC, elCenter(el), k === 0 ? '+' + fmt(a.amount) : '', 350 + i * 250 + k * 60); i++; }
  }
}
function timerLoop() {
  requestAnimationFrame(timerLoop);
  if (!V || !V.hand || V.hand.toAct == null) return;
  const ring = document.querySelector(`.seat[data-seat="${V.hand.toAct}"] .ring`); if (!ring) return;
  const left = (V.hand.deadline - (Date.now() + clockOff)) / (V.cfg.timer * 1000);
  const p = Math.max(0, Math.min(1, left));
  ring.style.setProperty('--p', p); ring.style.setProperty('--rc', p > .5 ? '#2ec27e' : p > .2 ? '#ffb703' : '#e63946');
}

function renderControls() {
  const v = V, h = v.hand, m = v.my, C = $('#controls');
  if (!v.me) { C.innerHTML = ''; return; }
  if (m) {
    const potAll = h.pot + v.seats.reduce((a, s) => a + (s ? s.bet : 0), 0);
    if (raiseTo == null || raiseTo < m.minTo || raiseTo > m.maxTo || C.dataset.key !== h.no + h.street + h.cur) raiseTo = m.minTo;
    C.dataset.key = h.no + h.street + h.cur;
    const potTo = f => Math.max(m.minTo, Math.min(m.maxTo, Math.round(h.cur + f * (potAll + m.toCall))));
    const allinOnly = m.minTo >= m.maxTo;
    C.innerHTML = `${m.canRaise && !allinOnly ? `<div class="slider">
        <button class="pre" data-f=".5">½ банка</button><button class="pre" data-f="1">Банк</button>
        <input type="range" id="rng" min="${m.minTo}" max="${m.maxTo}" step="${v.cfg.sb}" value="${raiseTo}">
        <div class="amt" id="amt">${fmt(raiseTo)}</div></div>` : ''}
      <div class="acts">
        <button class="act a-fold" data-a="fold">Фолд</button>
        ${m.canCheck ? `<button class="act a-check" data-a="check">Чек</button>` : `<button class="act a-check" data-a="call">Колл<small>${fmt(m.toCall)}</small></button>`}
        ${m.canRaise && !allinOnly ? `<button class="act a-raise" data-a="raise">${h.cur ? 'Рейз' : 'Бет'}<small id="rlab">до ${fmt(raiseTo)}</small></button>` : ''}
        ${m.canRaise || m.toCall >= v.me.stack ? `<button class="act a-allin" data-a="allin">Олл-ин<small>${fmt(m.maxTo)}</small></button>` : ''}
      </div>`;
    const rng = $('#rng');
    const upd = () => { $('#amt').textContent = fmt(raiseTo); $('#rlab').textContent = 'до ' + fmt(raiseTo); };
    if (rng) rng.oninput = () => { raiseTo = +rng.value; if (m.maxTo - raiseTo < v.cfg.sb) raiseTo = m.maxTo; upd(); };
    C.querySelectorAll('[data-f]').forEach(b => b.onclick = () => { raiseTo = potTo(+b.dataset.f); rng.value = raiseTo; upd(); });
    C.querySelectorAll('[data-a]').forEach(b => b.onclick = () => {
      const a = b.dataset.a; navigator.vibrate?.(15);
      send({ t: 'act', a: a === 'raise' ? { type: 'raise', amount: raiseTo } : { type: a } });
    });
    return;
  }
  C.dataset.key = '';
  const me = v.me, seated = me.seat != null;
  let msg;
  if (me.status === 'pending') msg = '⏳ Ждём, пока хост одобрит вас';
  else if (!seated) msg = 'Нажмите «Сесть» на свободном месте';
  else if (me.stack <= 0 && !(h && v.seats[me.seat]?.inHand)) msg = 'Нет фишек — запросите их у хоста (меню → Фишки)';
  else if (!v.started) msg = v.admin ? 'Нажмите «Начать игру», когда все сядут' : 'Ждём, пока хост начнёт игру';
  else if (h && h.toAct != null) msg = `Ходит ${esc(v.seats[h.toAct]?.name || '')}`;
  else if (!h) msg = 'Ждём игроков (нужно минимум двое с фишками)';
  else msg = '&nbsp;';
  C.innerHTML = `<div class="wait"><div class="msg">${msg}</div>
    ${v.admin && !v.started ? `<button class="tog on" data-x="start">▶ Начать игру</button>` : ''}
    ${seated ? `<button class="tog ${me.sitOut ? 'on' : ''}" data-x="sitout">${me.sitOut ? 'Вернуться в игру' : 'Отойти'}</button>` : ''}
    ${seated && v.cfg.straddle ? `<button class="tog ${me.straddle ? 'on' : ''}" data-x="straddle">Стрэддл ${me.straddle ? 'вкл' : 'выкл'}</button>` : ''}
    ${seated ? `<button class="tog" data-x="stand">Встать</button>` : ''}
    <button class="tog" data-x="chips">Фишки</button></div>`;
  C.querySelectorAll('[data-x]').forEach(b => b.onclick = () => {
    const x = b.dataset.x;
    if (x === 'start') send({ t: 'start' });
    if (x === 'sitout') send({ t: 'sitout', v: !me.sitOut });
    if (x === 'straddle') send({ t: 'straddle', v: !me.straddle });
    if (x === 'stand') send({ t: 'stand' });
    if (x === 'chips') openSheet('chips');
  });
}

/* ---------- меню ---------- */
function openSheet(t) { tab = t; sheetOpen = true; $('#sheet').classList.remove('hidden'); renderSheet(); }
function closeSheet() { sheetOpen = false; $('#sheet').classList.add('hidden'); }
function renderSheet() {
  const v = V; if (!v) return;
  const tabs = [['hist', 'История'], ['chips', 'Фишки'], v.admin && ['admin', 'Админ' + (v.requests.length ? ` (${v.requests.length})` : '')], ['table', 'Стол']].filter(Boolean);
  $('#tabs').innerHTML = tabs.map(([k, n]) => `<button data-tab="${k}" class="${tab === k ? 'on' : ''}">${n}</button>`).join('');
  $('#tabs').querySelectorAll('button').forEach(b => b.onclick = () => { tab = b.dataset.tab; renderSheet(); });
  const B = $('#sheetBody');
  const focusId = document.activeElement?.id, focusVal = document.activeElement?.value;
  if (focusId && B.contains(document.activeElement)) return; // не мешаем вводу
  if (tab === 'hist') {
    B.innerHTML = v.history.length ? v.history.map(r => `<div class="hist"><b>Раздача #${r.no}${r.bomb ? ' · 💣 бомб-пот' : ''}</b>
      ${r.boards.map((b, i) => `<div class="cards">${r.boards.length > 1 ? `<span class="mut">Д${i + 1}&nbsp;</span>` : ''}${b.map(c => cardHTML(c)).join('')}</div>`).join('')}
      ${r.players.map(p => `<div class="pl"><span>${esc(p.name)}</span><span class="cards" style="margin:0">${p.hole ? p.hole.map(c => cardHTML(c)).join('') : ''}</span><span class="${p.net > 0 ? 'pos' : p.net < 0 ? 'neg' : 'mut'}">${p.net > 0 ? '+' : ''}${fmt(p.net)}</span></div>`).join('')}
      <div class="mut">${r.awards.filter(a => a.amount).map(a => `${esc(a.who)} забирает ${fmt(a.amount)}${a.name ? ' (' + a.name + ')' : ''}${a.board != null && r.boards.length > 1 ? ' · доска ' + (a.board + 1) : ''}`).join('<br>')}</div>
      <details class="mut"><summary>Действия</summary>${r.log.map(esc).join('<br>')}</details></div>`).join('') : '<p class="mut">Пока не сыграно ни одной раздачи.</p>';
  } else if (tab === 'chips') {
    B.innerHTML = `<p>Ваш стек: <b style="color:var(--gold)">${fmt(v.me.stack)}</b>${v.me.pending ? ` <span class="mut">(+${fmt(v.me.pending)} после раздачи)</span>` : ''}</p>
      <p class="mut">Фишки виртуальные и выдаются хостом вручную.</p>
      <label class="l">Сколько попросить</label><div class="row"><input id="reqAmt" type="number" value="${v.cfg.bb * 100}"><button class="btn sm" id="reqBtn" style="flex:none">Запросить</button></div>
      ${ledgerHTML(v.ledger, false)}
      ${v.requests.length && !v.admin ? `<p class="mut">Запрос отправлен: ${fmt(v.requests[0].amount)}. Ждём хоста.</p>` : ''}`;
    $('#reqBtn').onclick = () => { send({ t: 'req', amount: +$('#reqAmt').value }); toast('Запрос отправлен хосту'); };
  } else if (tab === 'admin') {
    const c = v.cfg, bi = E.BLINDS.findIndex(b => b[1] === c.bb);
    const pend = v.players.filter(p => p.status === 'pending'), banned = v.players.filter(p => p.status === 'kicked');
    B.innerHTML = `<div class="li"><div class="grow">🏦 Банк хоста</div><b style="font-size:24px;color:var(--gold)" id="bank">∞</b></div>
      ${pend.map(p => `<div class="li" data-pend="${p.pid}"><div class="grow">🆕 <b>${esc(p.name)}</b> хочет за стол</div><button class="btn sm" data-admit>Пустить</button><button class="btn sm sec" data-reject>Отказать</button></div>`).join('')}
      ${v.requests.map(r => `<div class="li" data-req="${r.id}"><div class="grow">🙋 <b>${esc(r.name)}</b> просит ${fmt(r.amount)}</div><button class="btn sm" data-ok>Выдать</button><button class="btn sm sec" data-no>Отклонить</button></div>`).join('')}
      <div class="row"><button class="btn sm ${v.started ? 'sec' : ''}" id="startBtn">${v.started ? '⏸ Пауза после раздачи' : '▶ Начать игру'}</button></div>
      <h3>Добавить игрока</h3><p class="mut">Игрок с этим ником войдёт по ссылке без одобрения и сразу получит фишки.</p>
      <div class="row"><input id="invName" placeholder="Ник" maxlength="16"><input id="invChips" type="number" value="2000" style="max-width:110px"><button class="btn sm" id="invBtn" style="flex:none">Добавить</button></div>
      ${v.invites.map(i => `<div class="li"><div class="grow">✉️ ${esc(i.name)} · ${fmt(i.chips)}</div><button class="btn sm sec" data-uninv="${esc(i.name)}">✕</button></div>`).join('')}
      <h3>Игроки</h3>${v.players.filter(p => p.status === 'ok').map(p => `<div class="li" data-pid="${p.pid}"><div class="grow"><b>${esc(p.name)}</b> ${p.connected ? '🟢' : '⚪'}<br><span class="mut">${fmt(p.stack)}${p.pending ? ' (' + (p.pending > 0 ? '+' : '') + fmt(p.pending) + ' ждёт)' : ''} · ${p.seat != null ? 'место ' + (p.seat + 1) : 'не за столом'}</span></div>
        <input type="number" value="1000" class="camt"><button class="btn sm" data-add>+</button><button class="btn sm sec" data-sub>−</button>${p.pid !== myPid ? '<button class="btn sm sec" data-kick>Выгнать</button>' : ''}</div>`).join('')}
      ${banned.length ? `<h3>Удалённые</h3>${banned.map(p => `<div class="li"><div class="grow">${esc(p.name)} <span class="mut">${fmt(p.stack)}</span></div><button class="btn sm sec" data-unban="${p.pid}">Вернуть</button></div>`).join('')}` : ''}
      <h3>Настройки стола</h3>
      <label class="l">Блайнды</label><select id="cBl">${E.BLINDS.map((b, i) => `<option value="${i}" ${i === bi ? 'selected' : ''}>${b[0]} / ${b[1]}</option>`).join('')}</select>
      <label class="chk"><input type="checkbox" id="cSt" ${c.straddle ? 'checked' : ''}> Стрэддл разрешён</label>
      <div class="row"><div><label class="l">Бомб-пот каждые</label><input id="cBe" type="number" value="${c.bombEvery}"></div><div><label class="l">Анте бомб-пота</label><input id="cBa" type="number" value="${c.bombAnte}"></div><div><label class="l">Таймер, с</label><input id="cTm" type="number" value="${c.timer}"></div></div>
      <button class="btn sec" id="cSave">Сохранить (с следующей раздачи)</button>
      <h3>Журнал фишек</h3>${ledgerHTML(v.ledger, true)}`;
    B.querySelectorAll('[data-pend]').forEach(el => { el.querySelector('[data-admit]').onclick = () => send({ t: 'admit', pid: el.dataset.pend }); el.querySelector('[data-reject]').onclick = () => send({ t: 'reject', pid: el.dataset.pend }); });
    B.querySelectorAll('[data-unban]').forEach(el => el.onclick = () => send({ t: 'unban', pid: el.dataset.unban }));
    B.querySelectorAll('[data-uninv]').forEach(el => el.onclick = () => send({ t: 'uninvite', name: el.dataset.uninv }));
    $('#invBtn').onclick = () => send({ t: 'invite', name: $('#invName').value, chips: +$('#invChips').value });
    B.querySelectorAll('[data-req]').forEach(el => { el.querySelector('[data-ok]').onclick = () => send({ t: 'approve', id: el.dataset.req }); el.querySelector('[data-no]').onclick = () => send({ t: 'deny', id: el.dataset.req }); });
    B.querySelectorAll('[data-pid]').forEach(el => {
      const amt = () => Math.abs(+el.querySelector('.camt').value || 0);
      el.querySelector('[data-add]').onclick = () => send({ t: 'chips', pid: el.dataset.pid, delta: amt() });
      el.querySelector('[data-sub]').onclick = () => send({ t: 'chips', pid: el.dataset.pid, delta: -amt() });
      const k = el.querySelector('[data-kick]'); if (k) k.onclick = () => send({ t: 'kick', pid: el.dataset.pid });
    });
    $('#startBtn').onclick = () => send({ t: v.started ? 'pause' : 'start' });
    $('#cSave').onclick = () => { send({ t: 'cfg', cfg: { blinds: +$('#cBl').value, straddle: $('#cSt').checked, bombEvery: +$('#cBe').value, bombAnte: +$('#cBa').value, timer: +$('#cTm').value } }); toast('Сохранено'); };
  } else {
    B.innerHTML = `<p>Код стола: <b style="font-size:22px;letter-spacing:3px;color:var(--gold)">${code}</b></p>
      <p class="mut">Друзья открывают ссылку, вводят ник и садятся на свободное место.</p>
      <input readonly value="${shareLink()}" onclick="this.select()">
      <div style="height:10px"></div><button class="btn sec" id="cp">Скопировать ссылку</button>
      ${role === 'host' ? '<p class="mut">Вы — хост: игра идёт в вашем браузере. Не закрывайте вкладку, иначе стол встанет на паузу (состояние сохранится, просто откройте ссылку снова).</p>' : ''}
      <div style="height:10px"></div><button class="btn sec" id="leave">${role === 'host' ? 'Выйти в меню (стол на паузе)' : 'Покинуть стол'}</button>`;
    $('#cp').onclick = () => navigator.clipboard?.writeText(shareLink()).then(() => toast('Скопировано'));
    $('#leave').onclick = () => { if (role === 'client') { send({ t: 'stand' }); } setTimeout(() => { location.hash = ''; location.reload(); }, 300); };
  }
  void focusVal;
}

function ledgerHTML(L, all) {
  if (!L || !L.length) return '<p class="mut">Операций с фишками пока нет.</p>';
  return `<div class="ledger">${L.map(l => `<div class="pl" style="font-size:13px;padding:4px 0;border-bottom:1px solid #ffffff0d"><span class="mut">${new Date(l.at).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>${all ? `<span>${esc(l.name)}</span>` : ''}<span class="mut">${esc(l.reason)}</span><b class="${l.delta > 0 ? 'pos' : 'neg'}">${l.delta > 0 ? '+' : ''}${fmt(l.delta)}</b></div>`).join('')}</div>`;
}
/* ---------- запуск ---------- */
addEventListener('hashchange', () => location.reload());
if ('serviceWorker' in navigator && !TEST) navigator.serviceWorker.register('sw.js').catch(() => { });
if (code && localStorage['pkh_' + code]) hostGate();
else if (code && localStorage['pkc_' + code] && localStorage.pk_name) startClient(localStorage.pk_name);
else landing();
