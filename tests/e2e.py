"""E2E: хост + 3 клиента в отдельных контекстах, реальный PeerJS/WebRTC."""
import json, sys, time, subprocess, os
from playwright.sync_api import sync_playwright

URL = os.environ.get('URL', 'http://localhost:8765/')
SHOTS = '/workspace/poker/shots'
NAMES = ['Алексей', 'Миша', 'Оля', 'Дима']
errors = []
def ok(c, m):
    print(('PASS ' if c else 'FAIL ') + m); 
    if not c: errors.append(m)

with sync_playwright() as p:
    br = p.chromium.launch(args=['--disable-features=WebRtcHideLocalIpsWithMdns'])
    pages = []
    def mk():
        ctx = br.new_context(viewport={'width': 440, 'height': 956}, device_scale_factor=2, is_mobile=True, has_touch=True)
        pg = ctx.new_page()
        pg.on('console', lambda m, pg=pg: m.type == 'error' and errors.append('console: ' + m.text))
        pg.on('pageerror', lambda e: errors.append('pageerror: ' + str(e)))
        return pg
    host = mk(); pages.append(host)
    host.goto(URL + '?test=1')
    host.fill('#nick', NAMES[0]); host.click('#createBtn')
    host.wait_for_selector('#net:has-text("онлайн")', timeout=20000)
    code = host.evaluate('__T().code'); print('code', code)
    host.click('[data-sit="0"]')
    for i in (1, 2, 3):
        pg = mk(); pages.append(pg)
        pg.goto(URL + '?test=1#t=' + code)
        pg.fill('#nick', NAMES[i]); pg.click('#joinBtn')
        pg.wait_for_function('window.__V && __V()', timeout=30000)
        pg.click(f'[data-sit="{i}"]')
        pg.wait_for_function(f'__V().me.seat === {i}')
        # запрос фишек через UI
        pg.click('[data-x="chips"]'); pg.fill('#reqAmt', '2000'); pg.click('#reqBtn'); pg.click('#sheetClose')
    host.wait_for_function('__T().requests.length === 3')
    host.click('#menuBtn'); host.click('[data-tab="admin"]')
    for _ in range(3):
        host.click('[data-req] [data-ok]'); time.sleep(0.2)
    host.click('#sheetClose')
    ok(host.evaluate('Object.values(__T().players).every(p => p.stack === 2000)'), 'админ выдал фишки по запросам')

    T = lambda js: host.evaluate(js)
    def setup(stacks=None, rig=None, handNo=None):
        T('__T().started=false')
        host.wait_for_function('!__T().hand', timeout=20000)
        js = 'const t=__T();'
        if stacks: js += ''.join(f't.players[t.seats[{s}]].stack={v};' for s, v in stacks.items())
        if rig: js += f't.rig={json.dumps(rig)};'
        if handNo is not None: js += f't.handNo={handNo};'
        js += 't.started=true; __cfg({});'
        host.evaluate(js)
        host.wait_for_function('__T().hand && __T().hand.toAct !== null || (__T().hand && __T().hand.result)', timeout=20000)
        return T('__T().hand.no')

    holes = {}
    def play(strategy, shot_at=None):
        no = T('__T().hand.no'); holes[no] = T('__T().hand.hole')
        while True:
            st = T('(()=>{const h=__T().hand;return {r:!!h.result,to:h.toAct,n:h.log.length,street:h.street}})()')
            if st['r']: break
            if shot_at and st['street'] == shot_at[0]:
                time.sleep(1.2); pages[shot_at[2]].screenshot(path=f'{SHOTS}/{shot_at[1]}'); shot_at = None
            pg = pages[st['to']]
            pg.wait_for_function('__V() && __V().my', timeout=15000)
            my = pg.evaluate('__V().my')
            a = strategy(st, my)
            sel = {'call': '[data-a="call"]', 'check': '[data-a="check"]', 'allin': '[data-a="allin"]', 'fold': '[data-a="fold"]'}[a]
            if a == 'allin' and not pg.query_selector(sel): sel = '[data-a="call"]'
            if a == 'call' and not pg.query_selector(sel): sel = '[data-a="check"]'
            pg.click(sel)
            host.wait_for_function(f'__T().hand.result || __T().hand.log.length > {st["n"]}', timeout=15000)
        return T('__T().hand')

    passive = lambda st, my: 'check' if my['canCheck'] else 'call'
    # 1) обычная раздача + переподключение клиента посреди раздачи
    setup(rig=[{'hole': {'0': ['Ah', 'Kd'], '1': ['Qs', 'Qh'], '2': ['9c', '8c'], '3': ['7d', '2s']}, 'board': ['Qd', 'Jc', '4h', '5s', 'Kh']}])
    # префлоп колл первого игрока, затем перезагрузка Оли
    pages[1].wait_for_timeout(500)
    pages[2].reload(); pages[2].wait_for_function('window.__V && __V() && __V().me && __V().me.seat === 2', timeout=30000)
    ok(pages[2].evaluate('__V().seats[2].cards[0]') == '9c', 'переподключение после обновления: место и свои карты на месте')
    h = play(passive, shot_at=('flop', 'mid-hand-440.png', 1))
    ok(h['result']['awards'][0]['seat'] == 1 and h['result']['awards'][0]['name'] == 'Тройка', 'Миша выигрывает тройкой')
    time.sleep(1.0); pages[1].screenshot(path=f'{SHOTS}/showdown-440.png')

    # 2) олл-ины и сайд-поты
    setup(stacks={0: 2000, 1: 300, 2: 800, 3: 2000},
          rig=[{'hole': {'0': ['7h', '2d'], '1': ['As', 'Ad'], '2': ['Ks', 'Kd'], '3': ['Qs', 'Qd']}, 'board': ['2c', '5d', '9h', 'Jc', '3s']}])
    h = play(lambda st, my: 'allin')
    st = T('Object.fromEntries(__T().seats.map((pid,s)=>[s,pid&&__T().players[pid].stack]))')
    ok(st['1'] == 1200 and st['2'] == 1500 and st['3'] == 2400 and st['0'] == 0, f'сайд-поты распределены верно {st}')
    time.sleep(1.0); pages[2].screenshot(path=f'{SHOTS}/showdown-sidepots-440.png')

    # 3) сплит — стрит на доске
    setup(stacks={0: 2000, 1: 2000, 2: 2000, 3: 2000},
          rig=[{'hole': {'0': ['2h', '3d'], '1': ['4s', '6d'], '2': ['7c', '8d'], '3': ['2s', '3c']}, 'board': ['Ah', 'Kd', 'Qc', 'Jh', 'Ts']}])
    h = play(passive)
    st = T('Object.values(__T().players).map(p=>p.stack)')
    ok(all(x == 2000 for x in st) and all(a['split'] for a in h['result']['awards']), f'сплит-пот на четверых {st}')
    time.sleep(1.0); host.screenshot(path=f'{SHOTS}/split-440.png')

    # 4) бомб-пот, 7-я раздача, две доски
    pages[3].evaluate('0'); 
    hn = setup(stacks={0: 2000, 1: 2000, 2: 2000, 3: 2000}, handNo=6,
               rig=[{'hole': {'0': ['2h', '3d'], '1': ['As', 'Ad'], '2': ['Ks', 'Kd'], '3': ['7s', '8c']},
                     'board': ['Ac', '9d', '4h', 'Kh', '9s', '5h', '2c', '3c', 'Jd', 'Td']}])
    ok(hn == 7 and T('__T().hand.bomb && __T().hand.street') == 'flop', 'бомб-пот: сразу флоп')
    ok(pages[1].evaluate('!document.querySelector("#bombBanner").classList.contains("hidden")'), 'баннер БОМБ-ПОТ виден')
    h = play(passive, shot_at=('flop', 'bomb-pot-440.png', 2))
    st = T('Object.fromEntries(__T().seats.map((pid,s)=>[s,pid&&__T().players[pid].stack]))')
    ok(st['1'] == 2040 and st['2'] == 2040 and st['0'] == 1960 and st['3'] == 1960, f'бомб-пот: банк 160 (анте 4×40) поделён по доскам {st}')
    time.sleep(1.0); pages[2].screenshot(path=f'{SHOTS}/bomb-showdown-440.png')

    # приватность: до вскрытия никто не получал чужие карманные карты
    leaks = 0
    for i in (1, 2, 3):
        for m in pages[i].evaluate('__msgs'):
            if m.get('t') != 'view' or not m['v'].get('hand'): continue
            hv = m['v']['hand']; no = hv['no']
            if no not in holes: continue
            vv = dict(m['v']); vv.pop('history', None)  # история прошлых раздач (там только вскрытые карты)
            raw = json.dumps(vv, ensure_ascii=False)
            if 'deck' in raw: leaks += 1
            for s, cards in holes[no].items():
                if int(s) == i or hv.get('result'): continue
                for c in cards:
                    if f'"{c}"' in raw: leaks += 1
    ok(leaks == 0, f'утечек чужих карт в сообщениях: {leaks}')
    ok(pages[1].evaluate('__V().untilBomb') >= 1, 'счётчик до бомб-пота')

    # перезапуск хоста: состояние из localStorage, клиенты переподключаются
    T('__T().started=false')
    host.reload(); host.wait_for_selector('#net:has-text("онлайн")', timeout=30000)
    pages[3].wait_for_function('__V() && !document.querySelector("#overlay:not(.hidden)")', timeout=40000)
    host.wait_for_function('Object.values(__T().players).filter(p=>p.connected).length === 4', timeout=40000)
    ok(T('__T().handNo') == 7, 'хост восстановил стол после перезагрузки, все клиенты вернулись')

    host.click('#menuBtn'); time.sleep(0.5); host.screenshot(path=f'{SHOTS}/history-440.png'); host.click('#sheetClose')
    br.close()

errs = [e for e in errors if not e.startswith(('PASS',))]
print('ERRORS:', errs if errs else 'none')
sys.exit(1 if errs else 0)
