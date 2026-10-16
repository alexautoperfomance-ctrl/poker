// Ретранслятор через публичный MQTT-over-WSS брокер. Работает за любым NAT.
// Брокер видит только шифротекст: у каждого игрока свой ключ (ECDH P-256 -> AES-GCM-256),
// рукопожатие подписано ключом хоста (ECDSA P-256), отпечаток ключа хоста — в ссылке на стол.
export const BROKERS = ['wss://broker.emqx.io:8084/mqtt', 'wss://broker.hivemq.com:8884/mqtt', 'wss://test.mosquitto.org:8081/mqtt'];
const S = crypto.subtle, te = new TextEncoder(), td = new TextDecoder();
export const b64 = buf => { const u = new Uint8Array(buf); let s = ''; for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
export const ub64 = s => { s = s.replace(/-/g, '+').replace(/_/g, '/'); s += '='.repeat((4 - s.length % 4) % 4); return Uint8Array.from(atob(s), c => c.charCodeAt(0)); };
const rnd = n => b64(crypto.getRandomValues(new Uint8Array(n)));
const topicBase = code => 'pk26/' + code;
const ECDH = { name: 'ECDH', namedCurve: 'P-256' }, ECDSA = { name: 'ECDSA', namedCurve: 'P-256' }, SIG = { name: 'ECDSA', hash: 'SHA-256' };

export async function genHostKeys() {
  const k = await S.generateKey(ECDSA, true, ['sign', 'verify']);
  const pk = b64(await S.exportKey('raw', k.publicKey));
  return { sk: await S.exportKey('jwk', k.privateKey), pk, fp: await fingerprint(pk) };
}
export async function fingerprint(pk) { return b64(await S.digest('SHA-256', ub64(pk))).slice(0, 16); }
async function ecdhPair() { const k = await S.generateKey(ECDH, true, ['deriveKey']); return { k, pub: b64(await S.exportKey('raw', k.publicKey)) }; }
async function derive(priv, pubB64) {
  const pub = await S.importKey('raw', ub64(pubB64), ECDH, false, []);
  return S.deriveKey({ name: 'ECDH', public: pub }, priv, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
async function seal(key, obj) { const iv = crypto.getRandomValues(new Uint8Array(12)); const ct = await S.encrypt({ name: 'AES-GCM', iv }, key, te.encode(JSON.stringify(obj))); return { iv: b64(iv), ct: b64(ct) }; }
async function open(key, m) { return JSON.parse(td.decode(await S.decrypt({ name: 'AES-GCM', iv: ub64(m.iv) }, key, ub64(m.ct)))); }

class Emitter {
  constructor() { this.h = {}; }
  on(e, f) { (this.h[e] ||= []).push(f); return this; }
  emit(e, ...a) { for (const f of this.h[e] || []) try { f(...a); } catch (err) { console.warn(err); } }
}

function mqConnect(url, timeout = 5000) {
  return new Promise(res => {
    const c = mqtt.connect(url, { connectTimeout: timeout, reconnectPeriod: 2500, clean: true, keepalive: 20, clientId: 'pk_' + rnd(9) });
    const t = setTimeout(() => { c.end(true); res(null); }, timeout + 500);
    c.once('connect', () => { clearTimeout(t); res(c); });
    c.on('error', () => { });
  });
}

/* ---------- хост ---------- */
class HostConn extends Emitter {
  constructor(host, mq, cid, key) { super(); Object.assign(this, { host, mq, cid, key, open: true, sn: 0, rn: 0, seen: Date.now(), q: Promise.resolve(), rq: Promise.resolve(), relay: true }); }
  send(obj) {
    if (!this.open) return;
    const n = ++this.sn;
    this.q = this.q.then(async () => { const e = await seal(this.key, { d: 'h', n, m: obj }); this.mq.publish(this.host.base + '/c/' + this.cid, JSON.stringify({ t: 'e', ...e })); }).catch(() => { });
  }
  close() { if (!this.open) return; this.open = false; delete this.host.conns[this.cid]; this.emit('close'); }
}
export class RelayHost extends Emitter {
  constructor({ code, keys, brokers = BROKERS }) { super(); Object.assign(this, { code, keys, brokers, base: topicBase(code), conns: {}, up: {} }); }
  async start() {
    this.sk = await S.importKey('jwk', this.keys.sk, ECDSA, false, ['sign']);
    for (const url of this.brokers) this.attach(url);
    setInterval(() => { const now = Date.now(); for (const c of Object.values(this.conns)) if (now - c.seen > 15000) c.close(); }, 4000);
  }
  attach(url) {
    const c = mqtt.connect(url, { connectTimeout: 6000, reconnectPeriod: 3000, clean: true, keepalive: 20, clientId: 'pkh_' + rnd(9) });
    c.on('connect', () => { c.subscribe(this.base + '/h'); this.up[url] = true; this.emit('status'); });
    c.on('close', () => { if (this.up[url]) { this.up[url] = false; this.emit('status'); } });
    c.on('error', () => { });
    c.on('message', (_t, payload) => this.onMsg(c, payload));
  }
  online() { return Object.values(this.up).filter(Boolean).length; }
  async onMsg(mq, payload) {
    let m; try { m = JSON.parse(payload.toString()); } catch (e) { return; }
    if (!m || typeof m.cid !== 'string' || m.cid.length > 40) return;
    if (m.t === 'join' && typeof m.epk === 'string') {
      try {
        const eph = await ecdhPair();
        const key = await derive(eph.k.privateKey, m.epk);
        const sig = b64(await S.sign(SIG, this.sk, te.encode(`${this.code}|${m.cid}|${m.epk}|${eph.pub}`)));
        if (this.conns[m.cid]) this.conns[m.cid].close();
        const conn = this.conns[m.cid] = new HostConn(this, mq, m.cid, key);
        mq.publish(this.base + '/c/' + m.cid, JSON.stringify({ t: 'hk', spk: this.keys.pk, hepk: eph.pub, sig }));
        this.emit('connection', conn);
      } catch (e) { }
      return;
    }
    if (m.t === 'e') {
      const conn = this.conns[m.cid];
      if (!conn) { mq.publish(this.base + '/c/' + m.cid, JSON.stringify({ t: 'rejoin' })); return; }
      conn.rq = conn.rq.then(async () => {
        const p = await open(conn.key, m);
        if (p.d !== 'c' || !(p.n > conn.rn)) return; // защита от повтора/отражения
        conn.rn = p.n; conn.seen = Date.now(); conn.mq = mq;
        if (p.m && p.m.t === 'bye') return conn.close();
        conn.emit('data', p.m);
      }).catch(() => { });
    }
  }
}

/* ---------- клиент ---------- */
export class RelayClient extends Emitter {
  constructor({ code, fp, brokers = BROKERS }) { super(); Object.assign(this, { code, fp, brokers, base: topicBase(code), cid: rnd(12), open: false, sn: 0, rn: 0, q: Promise.resolve(), rq: Promise.resolve(), relay: true }); }
  status(s, kind) { this.emit('status', s, kind); }
  async start() {
    this.status('Подключаюсь к серверу…');
    for (const url of this.brokers) { this.mq = await mqConnect(url); if (this.closed) { this.mq?.end(true); return false; } if (this.mq) { this.url = url; break; } }
    if (!this.mq) return false;
    this.mq.subscribe(this.base + '/c/' + this.cid);
    this.mq.on('message', (_t, p) => this.onMsg(p));
    this.mq.on('connect', () => { if (!this.open) this.hello(); }); // после переподключения к брокеру
    this.hello();
    return true;
  }
  async hello() {
    if (this.closed) return;
    clearTimeout(this.ht);
    this.open = false;
    if (!this.eph) this.eph = await ecdhPair();
    if (!this.offline) this.status('Ищу стол…');
    this.mq.publish(this.base + '/h', JSON.stringify({ t: 'join', cid: this.cid, epk: this.eph.pub }));
    this.tries = (this.tries || 0) + 1;
    this.ht = setTimeout(() => { if (!this.open && !this.closed) { this.offline = true; this.status('Хост не в сети — попросите его открыть стол', 'offline'); this.hello(); } }, 6000);
  }
  async onMsg(payload) {
    let m; try { m = JSON.parse(payload.toString()); } catch (e) { return; }
    if (m.t === 'hk' && !this.open) {
      try {
        const fp = await fingerprint(m.spk);
        if (this.fp && fp !== this.fp) return this.status('Ответ не от хоста этого стола (неверный ключ)', 'error');
        const spk = await S.importKey('raw', ub64(m.spk), ECDSA, false, ['verify']);
        const ok = await S.verify(SIG, spk, ub64(m.sig), te.encode(`${this.code}|${this.cid}|${this.eph.pub}|${m.hepk}`));
        if (!ok) return;
        this.key = await derive(this.eph.k.privateKey, m.hepk);
        this.hostFp = fp; this.rn = 0; this.open = true; this.offline = false; clearTimeout(this.ht);
        this.emit('open');
      } catch (e) { }
    } else if (m.t === 'rejoin') { if (this.open) { this.open = false; this.emit('lost'); } this.eph = null; this.hello(); }
    else if (m.t === 'e' && this.key) {
      this.rq = this.rq.then(async () => { const p = await open(this.key, m); if (p.d !== 'h' || !(p.n > this.rn)) return; this.rn = p.n; this.emit('data', p.m); }).catch(() => { });
    }
  }
  send(obj) {
    if (!this.open) return;
    const n = ++this.sn;
    this.q = this.q.then(async () => { const e = await seal(this.key, { d: 'c', n, m: obj }); this.mq.publish(this.base + '/h', JSON.stringify({ t: 'e', cid: this.cid, ...e })); }).catch(() => { });
  }
  rehello() { this.eph = null; this.offline = false; this.hello(); }
  close() { this.closed = true; clearTimeout(this.ht); if (this.open) this.send({ t: 'bye' }); this.open = false; setTimeout(() => this.mq?.end(true), 300); }
}
