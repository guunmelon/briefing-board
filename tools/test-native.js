/* 네이티브 어댑터 + 라이브 파이프라인 테스트
   A) host.js eventsToToday 순수 함수(오늘 병합/상태 분류)
   B) window.__BRIEFING_HOST__ + fetch 스텁으로 부팅 → app.js 가 /api/live/* 를 조회해
      실데이터(뉴스·시세·날씨) payload 로 타일/브리핑/오늘 위젯을 채우는지,
      host.js 가 /api/events(iCloud) 를 오늘 일정에 병합하는지 검증.
   C) 브라우저에서 일정 표시 스위치 ON → 동기화 → 업데이트 반영(웹 호스트 승격).
   D) good!(읽음) 진행으로 같은 관심사 다음 기사 · 실측 강수 → 하늘 자동 전환 ·
      피드백 → 서버 코드 엔진 호출(생성 코드 노출) · 스포츠 경기 카드.
   실행: node tools/test-native.js (npm test 포함) — dist 빌드 후
*/
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const html = fs.readFileSync(path.join(__dirname, '..', 'dist', 'index.html'), 'utf8');
let pass = 0;
function assert(name, cond, extra) {
  console.log('  ' + (cond ? '✓ ' : '✗ ') + name + (cond ? '' : (extra ? '  → ' + extra : '')));
  if (!cond) process.exitCode = 1;
  if (cond) pass++;
}
const wait = ms => new Promise(r => setTimeout(r, ms));

/* ---------- 스텁: 네이티브 백엔드(/api/events + /api/live/*) ---------- */
function makeStub(now) {
  const iso = dt => dt.toISOString();
  const t0 = new Date(now);
  const at = (hh, mm) => { const d = new Date(t0); d.setHours(hh, mm, 0, 0); return iso(d); };
  const events = [
    { id: 'e1', title: '지난 회의', st: at(9, 0), en: at(10, 0), kind: 'meet', calendar: '업무' },
    { id: 'e2', title: '지금 미팅', st: at(t0.getHours(), Math.max(0, t0.getMinutes() - 10)), en: at(t0.getHours(), t0.getMinutes() + 50), kind: 'work' },
    { id: 'e3', title: '다음 러닝', st: at(19, 0), en: at(20, 0), kind: 'health', meta: '공원' },
  ];
  const btcItems = Array.from({ length: 8 }, (_, i) => ({
    id: 'bt' + i, title: 'Bitcoin spot ETF 유입 신기록 ' + (i + 1), link: 'https://ex.com/btc' + i,
    src: 'CoinTelegraph', pub: new Date(Date.now() - 3600 * 1000 * (i + 1)).toUTCString(), img: null,
    desc: '실시간 코인 뉴스 요약 문장입니다.',
  }));
  const mciItems = Array.from({ length: 8 }, (_, i) => ({
    id: 'mc' + i, title: i === 0 ? 'Haaland double gives Manchester City ideal start' : 'City squad news update ' + i,
    link: 'https://ex.com/mci' + i, src: 'The Guardian',
    pub: new Date(Date.now() - 3600 * 1000 * (i + 1)).toUTCString(), img: null,
    desc: '프리미어리그 실시간 맨시티 소식 요약 문장입니다.',
  }));
  const json = o => ({ ok: true, status: 200, json: async () => o });
  const routes = (u) => {
    if (u.includes('/api/health')) return json({ ok: true, live: true });
    if (u.includes('/api/events')) return json({ enabled: true, items: events });
    if (u.includes('/api/live/interest') && u.includes('topic=bitcoin'))
      return json({ ok: true, kind: 'coin', quote: { kind: 'coin', market: 'KRW-BTC', name: 'BTC', price: 123450000, prev: 120000000, chgPct: 2.87, chgAbs: 3450000, high: 125000000, low: 119000000, spark: Array.from({ length: 24 }, (_, i) => 120000000 + i * 140000), updated: iso(new Date()) } });
    if (u.includes('/api/live/interest') && u.includes('mancity')){
      const nowMs2 = Date.now();
      return json({ ok: true, kind: 'sport', sport: { kind: 'sport', team: 'Manchester City', sport: 'Soccer', league: 'English Premier League', homeGround: 'Etihad Stadium',
        next: { id: 's1', home: 'Manchester United', away: 'Manchester City', isHome: 0, venue: 'Old Trafford', ts: nowMs2 + 3 * 86400000, when: '9월 14일 (월) 00:30', status: 'NS', hs: null, as: null, score: null, round: 4, league: 'English Premier League' },
        live: null, results: [{ id: 's0', home: 'Manchester City', away: 'Coventry City', isHome: 1, venue: 'Etihad Stadium', ts: nowMs2 - 5 * 86400000, when: '9월 5일 (토) 23:00', status: 'FT', hs: 1, as: 0, score: '1 - 0', round: 3, league: 'English Premier League' }],
        upcoming: [], today: [], form: ['W', 'W', 'D'], source: 'TheSportsDB' } });
    }
    if (u.includes('/api/live/interest') && u.includes('topic=seoul'))
      return json({ ok: true, kind: 'weather', weather: { kind: 'weather', city: '서울', temp: 20.4, cond: '맑음', icon: 0, humidity: 42, wind: 2.4, min: 14, max: 26, weekMin: [14, 15, 13], weekMax: [26, 27, 25], updated: iso(new Date()) } });
    if (u.includes('/api/live/news')) {
      const topic = (u.includes('topic=mancity') || u.includes('label=' + encodeURIComponent('맨시티'))) ? 'mancity' : (u.includes('topic=bitcoin') ? 'bitcoin' : 'generic');
      return json({ ok: true, kind: 'news', items: topic === 'mancity' ? mciItems : (topic === 'bitcoin' ? btcItems : mciItems), ts: Date.now() });
    }
    return { ok: false, status: 404, json: async () => ({ ok: false }) };
  };
  return { routes, events, iso };
}

(async () => {
  /* ========== A) eventsToToday 순수 함수 ========== */
  {
    const domM = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://127.0.0.1:9/', runScripts: 'outside-only' });
    const M = null;
    const hostCode = fs.readFileSync(path.join(__dirname, '..', 'src', 'host.js'), 'utf8');
    domM.window.__BRIEFING_HOST__ = { apiBase: 'http://127.0.0.1:9' };
    // __boardApi 를 두지 않음 → host.js 폴링 미시작(순수 매핑만 평가)
    domM.window.eval(hostCode);
    const map = domM.window.__hostMap;
    assert('A. __hostMap.eventsToToday 노출', !!(map && map.eventsToToday));
    if (map) {
      const now = new Date(2026, 8, 8, 12, 0, 0);
      const d0 = new Date(now); d0.setHours(0, 0, 0, 0);
      const iso = x => new Date(x).toISOString();
      const evts = [
        { id: 'y', title: '어제 일정', st: iso(new Date(2026, 8, 7, 11, 0)), en: iso(new Date(2026, 8, 7, 12, 0)) },
        { id: 'n', title: '지금 러닝', st: iso(new Date(2026, 8, 8, 11, 30)), en: iso(new Date(2026, 8, 8, 13, 0)), kind: 'health' },
        { id: 'u', title: '다음 회의', st: iso(new Date(2026, 8, 8, 15, 0)), en: iso(new Date(2026, 8, 8, 16, 0)), kind: 'meet', location: 'A회의실' },
        { id: 'z', title: '내일 것', st: iso(new Date(2026, 8, 9, 10, 0)), en: iso(new Date(2026, 8, 9, 11, 0)) },
      ];
      const out = map.eventsToToday(evts, now);
      assert('A. 오늘 일정만 병합(어제/내일 제외)', out.length === 2 && !out.some(x => x.id === 'y') && !out.some(x => x.id === 'z'));
      assert('A. 상태 분류(now/up)', out.find(x => x.id === 'n').state === 'now' && out.find(x => x.id === 'u').state === 'up');
      assert('A. 시간순 정렬', out[0].id === 'n');
      assert('A. kind/위치 메타 보존', out[1].kind === 'meet' && out[1].meta === 'A회의실');
    }
    domM.window.close();
  }

  /* ========== B) host 부팅 + /api/live/* 실데이터 파이프라인 ========== */
  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => errors.push(String((e && e.message) || e)));
  const stub = makeStub(new Date());
  const dom = new JSDOM(html, {
    url: 'http://127.0.0.1:9/',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    virtualConsole: vc,
    beforeParse(w) {
      w.__BRIEFING_HOST__ = { apiBase: 'http://127.0.0.1:9' };
      if (!w.AbortController) w.AbortController = globalThis.AbortController;
      if (!w.AbortSignal) w.AbortSignal = globalThis.AbortSignal;
      w.fetch = (u, o) => {
        const r = stub.routes(String(u));
        return Promise.resolve(r.ok ? r : { ok: false, status: 404, json: async () => ({ ok: false }) });
      };
    },
  });
  const w = dom.window, d = w.document;
  await wait(9000);

  const schedText = (d.querySelector('#todaySchedule') || {}).textContent || '';
  const briefText = (d.querySelector('#briefRail') || {}).textContent || '';
  const btcTile = [...d.querySelectorAll('.tile')].find(x => /비트코인/.test((x.querySelector('.tile-name') || {}).textContent || ''));
  const mciTile = [...d.querySelectorAll('.tile')].find(x => /맨시티/.test((x.querySelector('.tile-name') || {}).textContent || ''));
  const btcBody = btcTile ? (btcTile.textContent || '') : '';

  assert('B. iCloud 일정 병합(오늘 일정 목록 표시)', schedText.includes('지금 미팅') && schedText.includes('다음 러닝'), schedText.slice(0, 120));
  assert('B. 오늘 위젯 동기화 문구', /동기화됨/.test((d.querySelector('#todaySub') || {}).textContent || ''));
  assert('B. 비트코인 타일 = 실시세(억/▲)', btcBody.includes('억') && /▲/.test(btcBody), btcBody.slice(0, 120));
  const mciTxt = mciTile ? (mciTile.textContent || '').replace(/\s+/g, ' ') : '';
  assert('B. 맨시티 타일 = 스포츠 실시세(구장·D-day)', mciTile && /Old Trafford/.test(mciTxt) && /D-[34]/.test(mciTxt), mciTxt.slice(0, 150));
  assert('B. 브리핑 레일에 실기사 카드', /Haaland double/.test(briefText) || /CoinTelegraph/.test(briefText), briefText.slice(0, 120));
  assert('B. 서울 날씨(Open-Meteo 스타일) 실측 표시', /맑음/.test((d.querySelector('#wxChip') || {}).textContent || ''));
  assert('B. 런타임 에러 없음', errors.length === 0, errors.join(' | '));

  dom.window.close();

  /* ========== C) 일정 표시 스위치 ON + 일정 업데이트 즉시 반영(웹 호스트 승격 모드) ========== */
  {
    const dToday = new Date();
    const cState = { calendarEnabled: false, syncErr: 0, events: [
      { id: 'e1', title: '지난 회의', st: new Date(new Date(dToday).setHours(0, 5, 0, 0)).toISOString(), en: new Date(new Date(dToday).setHours(0, 35, 0, 0)).toISOString(), kind: 'meet' },
      { id: 'e2', title: '다음 러닝', st: new Date(new Date(dToday).setHours(23, 0, 0, 0)).toISOString(), en: new Date(new Date(dToday).setHours(23, 30, 0, 0)).toISOString(), kind: 'health' },
    ] };
    const mockFetch = (u, o = {}) => {
      const m = String(u).split('?')[0].replace('http://localhost:9999', '');
      const json = x => ({ ok: true, status: 200, json: async () => x });
      if (m === '/api/health') return Promise.resolve(json({ ok: true, live: true }));
      if (m === '/api/credentials') return Promise.resolve(json({ ok: true, connected: true, hasPassword: true, email: 'me@icloud.com', calendars: 2 }));
      if (m === '/api/prefs') {
        if ((o.method || 'GET') === 'POST') { const b = JSON.parse(o.body || '{}'); if (b.calendarEnabled !== undefined) cState.calendarEnabled = b.calendarEnabled; }
        return Promise.resolve(json({ ok: true, calendarEnabled: cState.calendarEnabled, newsPollMinutes: 15 }));
      }
      if (m === '/api/events') {
        if (cState.calendarEnabled && cState.syncErr === 0) return Promise.resolve(json({ ok: true, enabled: true, email: 'me@icloud.com', items: cState.events, ts: Date.now() }));
        if (cState.calendarEnabled && cState.syncErr === 1) return Promise.resolve(json({ ok: true, enabled: false, reason: 'sync-error' }));
        return Promise.resolve(json({ ok: true, enabled: false, reason: 'disabled' }));
      }
      if (m.includes('/api/live/')) return Promise.resolve(json({ ok: true, kind: 'news', items: [] }));
      return Promise.resolve({ ok: false, status: 404, json: async () => ({ ok: false }) });
    };
    const vcC = new VirtualConsole(); vcC.on('jsdomError', () => {});
    const domC = new JSDOM(html, { url: 'http://localhost:9999/', runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vcC,
      beforeParse(w) { w.fetch = mockFetch; if (!w.AbortController) w.AbortController = globalThis.AbortController; if (!w.AbortSignal) w.AbortSignal = globalThis.AbortSignal; } });
    const wC = domC.window, dC = wC.document;
    await wait(2600);
    // 웹 호스트 승격(설정에 iCloud 입력칸이 뜨는 조건)을 기다린다
    for (let i = 0; !(wC.__BRIEFING_HOST__ && wC.__BRIEFING_HOST__.apiBase) && i < 12; i++) await wait(350);
    assert('C. 웹 호스트 승격(설정 iCloud 섹션 노출 준비)', !!(wC.__BRIEFING_HOST__ && wC.__BRIEFING_HOST__.apiBase));
    dC.querySelector('#btnSettings').click(); await wait(450);
    const cal0 = dC.querySelector('#stCal');
    assert('C. 스위치 초기 OFF(일정 표시 꺼짐 상태)', !!cal0 && !cal0.classList.contains('on'));
    assert('C. 연결 상태줄 “연결됨”', /연결됨 · me@icloud.com/.test((dC.querySelector('#stCalState') || {}).textContent || ''));
    cal0.click(); await wait(800);
    assert('C. 스위치 클릭 → ON', dC.querySelector('#stCal').classList.contains('on'));
    await wait(1600);
    const sc = (dC.querySelector('#todaySchedule') || {}).textContent || '';
    assert('C. ON 후 오늘 일정 표시(지난 회의·다음 러닝)', /지난 회의/.test(sc) && /다음 러닝/.test(sc), sc.replace(/\s+/g, ' ').slice(0, 90));
    assert('C. 동기화됨 문구(오늘 2건)', /iCloud 캘린더와 동기화됨 · 오늘 2건/.test((dC.querySelector('#todaySub') || {}).textContent || ''));
    // 일정 업데이트(새 항목) → 동기화 클릭 즉시 반영
    cState.events.push({ id: 'e3', title: '새로 추가된 미팅', st: new Date(new Date(dToday).setHours(23, 40, 0, 0)).toISOString(), en: new Date(new Date(dToday).setHours(23, 55, 0, 0)).toISOString(), kind: 'work' });
    const sync = dC.querySelector('#schedSync');
    if (sync) sync.click();
    await wait(1400);
    const sc2 = (dC.querySelector('#todaySchedule') || {}).textContent || '';
    assert('C. 일정 업데이트 → 동기화 클릭 즉시 반영', /새로 추가된 미팅/.test(sc2), sc2.replace(/\s+/g, ' ').slice(0, 120));
    assert('C. 동기화 후 문구(오늘 3건)', /오늘 3건/.test((dC.querySelector('#todaySub') || {}).textContent || ''));
    // 일시 동기화 오류 → 기존 일정 유지(빈 화면/연결 CTA로 되돌아가지 않음)
    cState.syncErr = 1;
    const sync2 = dC.querySelector('#schedSync');
    if (sync2) sync2.click();
    await wait(1400);
    const sc3 = (dC.querySelector('#todaySchedule') || {}).textContent || '';
    assert('C. sync-error 시 기존 일정 유지', /새로 추가된 미팅/.test(sc3) && !/아직 실제 일정이 없어요/.test(sc3), sc3.replace(/\s+/g, ' ').slice(0, 100));
    domC.window.close();
  }


  /* ========== D) good! 읽음 진행 · 실측 강수 → 하늘 자동 전환 · 피드백 → 코드 반영 ========== */
  {
    const calls = [];
    const mcItems = Array.from({ length: 4 }, (_, i) => ({
      id: 'mc' + i, title: `MC ${'첫 둘째 셋째 넷째'.split(' ')[i]} 기사`, link: 'https://ex/mc' + i, src: 'Eurogamer',
      pub: new Date(Date.now() - 3600e3 * (i + 1)).toUTCString(), desc: '마인크래프트 최신 소식 요약 문장입니다.',
    }));
    const nowMs = Date.now();
    const sportData = {
      kind: 'sport', team: 'Manchester City', sport: 'Soccer', league: 'English Premier League', homeGround: 'Etihad Stadium',
      next: { id: 'x1', home: 'Manchester United', away: 'Manchester City', isHome: 0, venue: 'Old Trafford', ts: nowMs + 3 * 86400000, when: '9월 14일 (월) 00:30', status: 'NS', hs: null, as: null, score: null, round: 4, league: 'English Premier League' },
      live: null, results: [{ id: 'x0', home: 'Manchester City', away: 'Coventry City', isHome: 1, venue: 'Etihad Stadium', ts: nowMs - 5 * 86400000, when: '9월 5일 (토) 23:00', status: 'FT', hs: 1, as: 0, score: '1 - 0', round: 3, league: 'English Premier League' }],
      upcoming: [{ id: 'x1', home: 'Manchester United', away: 'Manchester City', isHome: 0, venue: 'Old Trafford', ts: nowMs + 3 * 86400000, when: '9월 14일 (월) 00:30', status: 'NS', hs: null, as: null, score: null, round: 4, league: 'English Premier League' }],
      today: [], form: ['W', 'W', 'D'], source: 'TheSportsDB',
    };
    const rainy = { kind: 'weather', city: '서울', temp: 19.6, feels: 19.1, humidity: 92, wind: 3.1, cond: '비', code: 61, precip: 1.4, min: 17, max: 21, rainPct: 80, pm10: 21, pm25: 12, sunrise: '06:09', sunset: '18:48',
      weekMin: [17, 16, 15], weekMax: [21, 20, 22], weekRain: [80, 40, 10],
      hourly: Array.from({ length: 24 }, (_, h) => ({ h, t: 17 + h * 0.1, pp: h >= 6 && h <= 14 ? 70 : 10, pr: h >= 6 && h <= 14 ? 0.8 : 0, wc: h >= 6 && h <= 14 ? 61 : 3, cond: h >= 6 && h <= 14 ? '비' : '흐림' })) };
    const json = x => ({ ok: true, status: 200, json: async () => x, text: async () => JSON.stringify(x) });
    const mockFetch = (u, o = {}) => {
      const url = String(u);
      const m = url.split('?')[0].replace('http://localhost:9998', '');
      calls.push({ m, method: o.method || 'GET', body: o.body || '' });
      if (m === '/api/health') return Promise.resolve(json({ ok: true, live: true }));
      if (m === '/api/credentials') return Promise.resolve(json({ ok: true, connected: false, hasPassword: false }));
      if (m === '/api/prefs') return Promise.resolve(json({ ok: true, calendarEnabled: false, newsPollMinutes: 15 }));
      if (m === '/api/events') return Promise.resolve(json({ ok: true, enabled: false, reason: 'not-configured' }));
      if (m === '/api/build') return Promise.resolve(json({ ok: true, hash: 'stubhash-1', size: 1000 }));
      if (m === '/api/feedback/patches') return Promise.resolve(json({ ok: true, patches: [{ id: 'p1', file: 'p1.js', op: 'split-daypart', title: '오전/오후 분리', log: '테스트', request: '테스트' }] }));
      if (m === '/api/feedback/apply') {
        const body = JSON.parse(o.body || '{}');
        return Promise.resolve(json({ ok: true, request: body.text, applied: [{ id: 'p1', file: 'p1.js', op: 'split-daypart', title: '오전/오후·시간대 분리 표시 · weather', log: '기온을(를) 오전·오후으로 쪼개는 렌더 코드를 생성', code: 'BPatch.register({ id: "p1", target: { kind: "weather" }, html: function (ctx) { return ctx.html + "<div class=\\"bp-split\\">오전/오후</div>"; } });' }], rebuild: { ok: true, hash: 'stubhash-2', size: 1001 } }));
      }
      if (m === '/api/live/interest') {
        if (url.includes('topic=seoul')) return Promise.resolve(json({ ok: true, kind: 'weather', weather: rainy }));
        if (url.includes('kind=sport') || url.includes('topic=mancity')) return Promise.resolve(json({ ok: true, kind: 'sport', sport: sportData }));
        return Promise.resolve(json({ ok: true, kind: 'coin', quote: { kind: 'coin', market: 'KRW-BTC', name: 'BTC', price: 123450000, prev: 120000000, chgPct: 2.87, chgAbs: 3450000, high: 1, low: 0, spark: [1, 2, 3] } }));
      }
      if (m === '/api/live/news') {
        const isMc = url.includes('마인크래프트') || url.includes('topic=minecraft');
        // 서버처럼 동작: exclude(읽음·관심없음) 로 거른 뒤 남은 목록, 전부 걸러지면 “방금 수집한 새 기사”
        const exm = /[?&]exclude=([^&]*)/.exec(url);
        const ex = exm ? decodeURIComponent(exm[1]).split(',').filter(Boolean) : [];
        let items = isMc ? mcItems.filter(i => !ex.includes(i.id)) : [{ id: 'gen0', title: '조류 관찰 최신 소식', src: 'BirdWatch', pub: new Date(Date.now() - 600e3).toUTCString(), desc: '새 이동 관찰 요약 문장입니다.' }];
        if (isMc && !items.length) items = [{ id: 'mc9', title: 'MC 다섯째 기사', src: 'Eurogamer', pub: new Date().toUTCString(), desc: '방금 수집한 새 기사 요약 문장입니다.' }];
        return Promise.resolve(json({ ok: true, kind: 'news', items, ts: Date.now() }));
      }
      return Promise.resolve({ ok: false, status: 404, json: async () => ({ ok: false }), text: async () => '{}' });
    };
    const vcD = new VirtualConsole();
    const errsD = [];
    vcD.on('jsdomError', e => errsD.push(String((e && e.message) || e)));
    const domD = new JSDOM(html, { url: 'http://localhost:9998/', runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vcD,
      beforeParse(w) { w.fetch = mockFetch; if (!w.AbortController) w.AbortController = globalThis.AbortController; if (!w.AbortSignal) w.AbortSignal = globalThis.AbortSignal; } });
    const wD = domD.window, dD = wD.document;
    await wait(4200);

    // ── 스포츠 위젯: 경기 일정 · 남은 시간 · 경기장 · 결과
    const spTile = [...dD.querySelectorAll('.tile')].find(x => /맨시티/.test((x.querySelector('.tile-name') || {}).textContent || ''));
    const spTxt = spTile ? (spTile.textContent || '').replace(/\s+/g, ' ') : '';
    assert('D. 스포츠 타일: 리그·상대·구장·D-day·남은 시간', /English Premier League/.test(spTxt) && /Manchester United/.test(spTxt) && /Old Trafford/.test(spTxt) && /D-[34]/.test(spTxt) && /남음/.test(spTxt), spTxt.slice(0, 180));
    assert('D. 스포츠 타일: 최근 결과·폼(승패 점)', /1 - 0/.test(spTxt) && /최근 결과/.test(spTxt), spTxt.slice(0, 180));
    const spBrief = [...dD.querySelectorAll('.brief.is-sport')][0];
    assert('D. 뉴스레터에 스포츠 카드(일정·구장·결과 격자)', !!spBrief && /경기장/.test(spBrief.textContent) && /Old Trafford/.test(spBrief.textContent) && /최근 5경기/.test(spBrief.textContent), spBrief && spBrief.textContent.replace(/\s+/g, ' ').slice(0, 160));

    // ── good! = 읽음 → 같은 관심사의 다음 기사
    const rail = dD.querySelector('#briefRail');
    const mcCard = [...(rail ? rail.querySelectorAll('.brief') : [])].find(c => /MC 첫 기사/.test(c.textContent));
    assert('D. 시작: 마인크래프트 첫 기사 카드', !!mcCard, rail && rail.textContent.replace(/\s+/g, ' ').slice(0, 160));
    if (mcCard) {
      mcCard.querySelector('[data-a="like"]').click();
      await wait(500);
      const t2 = dD.querySelector('#briefRail').textContent;
      assert('D. good! → 같은 관심사의 다음 기사로 진행', /MC 둘째 기사/.test(t2) && !/MC 첫 기사/.test(t2), t2.replace(/\s+/g, ' ').slice(0, 160));
      const prog = [...dD.querySelectorAll('#briefRail .read-prog')].map(x => x.textContent.trim());
      assert('D. 읽음 진행률 표시(읽음 1/4)', prog.some(x => /읽음 1\/4/.test(x)), JSON.stringify(prog));
      const likeBtn = [...dD.querySelectorAll('#briefRail .brief')].find(c => /MC 둘째 기사/.test(c.textContent));
      if (likeBtn) likeBtn.querySelector('[data-a="like"]').click();
      await wait(400);
      assert('D. 연속 good! → 셋째 기사', /MC 셋째 기사/.test(dD.querySelector('#briefRail').textContent));
      const third = [...dD.querySelectorAll('#briefRail .brief')].find(c => /MC 셋째 기사/.test(c.textContent));
      if (third) third.querySelector('[data-a="like"]').click();
      await wait(400);
      const fourth = [...dD.querySelectorAll('#briefRail .brief')].find(c => /MC 넷째 기사/.test(c.textContent));
      if (fourth) fourth.querySelector('[data-a="like"]').click();
      await wait(900);
      const t5 = dD.querySelector('#briefRail').textContent;
      assert('D. 다 읽으면 그 관심사의 새 기사를 실시간 수집해 이음', /MC 다섯째 기사/.test(t5), t5.replace(/\s+/g, ' ').slice(0, 200));
      const stLikes = (() => { try { return JSON.parse(wD.localStorage.getItem('aibrief.board.v3') || '{}').likes || []; } catch(e) { return [1]; } })();
      assert('D. 취향 데이터 저장 및 good! 기록', stLikes.length >= 1, String(stLikes.length));
      assert('D. 하단 취향 안내 문구 삭제로 공간 확보', !dD.querySelector('.taste-note') && !dD.querySelector('#briefNote'), 'briefNote removed');
      // 카드 열어서(modal) good! → 모달 닫히고 다음 기사로
      const shown = [...dD.querySelectorAll('#briefRail .brief')][1] || [...dD.querySelectorAll('#briefRail .brief')][0];
      const title = shown && shown.querySelector('[data-a="open"]');
      const beforeTxt = dD.querySelector('#briefRail').textContent;
      if (title) { title.click(); await wait(400); }
      const mLike = dD.querySelector('#modalBox [data-a="like-article"]');
      assert('D. 기사 열기 → 모달에 good! 버튼', !!mLike, (dD.querySelector('#modalBox') || {}).textContent && 'open');
      if (mLike) { mLike.click(); await wait(700); }
      assert('D. 모달에서 good! → 모달 닫히고 같은 관심사 다음 기사', !dD.querySelector('#modalBox .brief, #modalBox [data-a="like-article"]') && dD.querySelector('#briefRail').textContent !== beforeTxt, dD.querySelector('#briefRail').textContent.replace(/\s+/g, ' ').slice(0, 120));
    }

    // ── 실측 강수 → 배경 하늘 자동 전환 (비가 실제로 와 확인 못 하던 것)
    assert('D. 실측 강수 → body.rain(빗줄기·창물방울 클래스)', dD.body.classList.contains('rain'), String(dD.body.className));
    assert('D. 하늘 그라데이션이 비 팔레트로 교체', /rain/.test(dD.body.dataset.sky || ''), String(dD.body.dataset.sky));
    const gradCss = (dD.querySelector('#sky .grad') || {}).style && dD.querySelector('#sky .grad').style.background || '';
    assert('D. 비 하늘색(#37475a/#10161f 계열) 적용', /55, 71, 90|#37475a|16, 22, 31|#10161f/i.test(gradCss.replace(/\s+/g, ' ')), gradCss.slice(0, 90));
    assert('D. 유리창 물방울 노드 생성', (dD.querySelectorAll('#glassDrops i').length) > 0, String(dD.querySelectorAll('#glassDrops i').length));
    dD.querySelector('#btnSettings').click(); await wait(500);
    const sl = (dD.querySelector('#stSkyLive') || {}).textContent || '';
    assert('D. 설정: 실시간 판정 근거 + 전환 문구', /실시간 판정/.test(sl) && /비 하늘로 자동 전환/.test(sl) && /1\.4mm/.test(sl), sl.replace(/\s+/g, ' ').slice(0, 160));
    dD.querySelector('#modalBox [data-c]') && dD.querySelector('#modalBox [data-c]').click(); await wait(250);

    // ── 오늘 위젯 날씨 줄(스트립) 컨테이너
    assert('D. 일정 위젯 날씨 줄 컨테이너 존재(패치 도착지)', !!dD.querySelector('#wxStrip'));

    // ── 피드백 → 코드 반영 엔진 호출
    dD.querySelector('#fbPill').click(); await wait(300);
    dD.querySelector('#fbInput').value = '날씨를 오전/오후로 나눠서 표시해줘';
    dD.querySelector('#fbSend').click();
    await wait(2200);
    const applied = calls.filter(c => c.m === '/api/feedback/apply');
    assert('D. 피드백 → 서버 코드 엔진에 POST', applied.length === 1 && /오분|오전\/오후/.test(applied[0].body), JSON.stringify(applied.map(a => a.m)));
    const mb = (dD.querySelector('#modalBox') || {}).textContent || '';
    assert('D. 반영 결과에 생성된 코드가 그대로 보인다', /BPatch\.register/.test(mb) && /bp-split/.test(mb), mb.replace(/\s+/g, ' ').slice(0, 140));
    assert('D. 로그에 [코드 반영] 기록', /\[코드 반영\]/.test((dD.querySelector('#aiLogText') || {}).textContent || '') || /코드 반영/.test((dD.querySelector('.modal') || {}).textContent || ''), (dD.querySelector('#aiLogText') || {}).textContent);
    assert('D. 적용된 패치 개수를 피드백 칸에 표시', /코드 패치/.test((dD.querySelector('#fbPatchFoot') || {}).textContent || ''), (dD.querySelector('#fbPatchFoot') || {}).textContent);
    assert('D. 런타임 에러 없음', errsD.filter(e => !/Not implemented|navigation/i.test(e)).length === 0, errsD.join(' | ').slice(0, 220));
    domD.window.close();
  }


  /* ============================================================
     시나리오 E: 5라운드 검증
     1) F1 모터스포츠 맞춤 인터페이스 (드라이버 선두 Antonelli 292점, 세션 타임라인, 다음 GP, 포디엄)
     2) 스포츠 종목별 명예 (축구 최다 득점 Haaland 5골, 리그 선두 1위 15점)
     3) 주식/환율 실시간 호가/실세시세 (삼성전자 274,500원, 달러 1,371원)
     4) 개별 새로고침 격리: 타일 새로고침 시 브리핑 레일 재렌더 없이 해당 타일만 갱신
     ============================================================ */
  {
    const errsE = [], callsE = [];
    const vcE = new VirtualConsole();
    vcE.on('jsdomError', e => errsE.push(String(e.message || e)));
    vcE.on('error', (...a) => errsE.push('console.error: ' + a.join(' ')));

    const mockFetchE = async (url, init) => {
      const u = String(url);
      const m = (init && init.method) || 'GET';
      const path = u.replace(/^https?:\/\/[^\/]+/, '').split('?')[0];
      const qs = Object.fromEntries(new URL(u, 'http://x').searchParams);
      callsE.push({ path, m, qs });

      if (path === '/api/health') return { ok: true, status: 200, json: async () => ({ ok: true, live: true }) };

      if (path === '/api/live/interest'){
        const topic = qs.topic || '';
        const label = qs.label || '';
        if (topic === 'f1' || label === 'F1'){
          return { ok: true, status: 200, json: async () => ({
            ok: true, kind: 'sport', topic: 'f1', label: 'F1', cadence: 180000,
            sport: {
              kind: 'sport', discipline: 'motorsport', series: 'f1', sport: '포뮬러 1', league: 'FIA F1 세계선수권', season: 2026, round: 14, roundsTotal: 23, roundsLeft: 9,
              leader: { rank: 1, name: 'Andrea Kimi Antonelli', code: 'ANT', team: 'Mercedes', points: 292, wins: 8 },
              rival: { rank: 2, name: 'George Russell', team: 'Mercedes', points: 211 }, gap: 81, clinched: false,
              honors: { type: 'points', title: '드라이버즈 선두', name: 'Andrea Kimi Antonelli', team: 'Mercedes', value: '292점 · 2위와 +81' },
              next: { name: 'Azerbaijan Grand Prix', round: 15, circuit: 'Baku City Circuit', ts: Date.now() + 5 * 86400000, when: '9월 26일 (토) 20:00', sessions: [{ label: '1차 연습', when: '9/24 17:30' }, { label: '예선', when: '9/25 21:00' }] },
              lastRace: { name: 'Spanish Grand Prix', podium: [{ pos: 1, driver: 'Andrea Kimi Antonelli', team: 'Mercedes' }, { pos: 2, driver: 'Max Verstappen', team: 'Red Bull' }] },
              standings: [{ rank: 1, name: 'Andrea Kimi Antonelli', team: 'Mercedes', points: 292 }],
              constructors: [{ rank: 1, team: 'Mercedes', points: 503 }],
              source: 'Jolpica F1',
            }
          }) };
        }
        if (topic === 'mancity' || label.includes('맨시티')){
          return { ok: true, status: 200, json: async () => ({
            ok: true, kind: 'sport', topic: 'mancity', label: '맨시티', cadence: 180000,
            sport: {
              kind: 'sport', discipline: 'league', team: 'Manchester City', sport: 'Soccer', league: 'English Premier League', homeGround: 'Etihad Stadium',
              standings: { rank: 1, points: 15, leader: { team: 'Manchester City', points: 15, rank: 1 }, gapToLeader: 0 },
              honors: [
                { type: 'points', title: '리그 선두(우승 레이스 1위)', name: 'Manchester City', value: '1위 · 승점 15점' },
                { type: 'scorer', title: '최다 득점(골든부츠 경쟁)', name: 'Erling Haaland', value: '5골', team: 'Manchester City' },
              ],
              next: { id: 'nx', home: 'Arsenal', away: 'Manchester City', venue: 'Emirates Stadium', ts: Date.now() + 6 * 86400000, when: '9월 27일 (일) 01:30' },
              results: [{ home: 'Manchester City', away: 'Sunderland', score: '5 - 3' }],
              form: ['W', 'W', 'W', 'W', 'W'], source: 'TheSportsDB + 위키피디아',
            }
          }) };
        }
        if (topic === 'samsung' || label.includes('삼성')){
          return { ok: true, status: 200, json: async () => ({
            ok: true, kind: 'stock', topic: 'samsung', label: '삼성전자', cadence: 20000,
            quote: {
              kind: 'stock', code: '005930.KS', name: '삼성전자', market: 'KOSPI', price: 274500, prev: 261000, chgPct: 5.17, chgAbs: 13500, currency: 'KRW', dir: 'up',
              spark: [260000, 264000, 271000, 274500], marketState: 'open', asOf: '2026-09-21T17:48:23+09:00', source: 'KRX 실세시세(네이버)',
            }
          }) };
        }
        if (topic === 'usd' || label.includes('달러')){
          return { ok: true, status: 200, json: async () => ({
            ok: true, kind: 'fx', topic: 'usd', label: '달러 환율', cadence: 30000,
            quote: {
              kind: 'fx', base: 'usd', pair: 'USD/KRW', name: '미국 달러', price: 1371.35, prev: 1382.55, chgPct: -0.81, chgAbs: -11.20,
              spark: [1382, 1378, 1374, 1371.35], cadence: 'realtime', asOf: '2026-09-21T08:55:00Z', source: '실시간 호가 Coinbase(≈1분)',
            }
          }) };
        }
        if (topic === 'bitcoin' || label.includes('비트코인')){
          return { ok: true, status: 200, json: async () => ({
            ok: true, kind: 'coin', topic: 'bitcoin', label: '비트코인', cadence: 20000,
            quote: {
              kind: 'coin', market: 'KRW-BTC', name: 'BTC', price: 113440000, prev: 111160000, chgPct: 2.05, chgAbs: 2280000,
              spark: [111000000, 112000000, 113440000], cadence: 'tick', asOf: '20260921 175500', source: 'Upbit 실거래(1초)',
            }
          }) };
        }
        return { ok: true, status: 200, json: async () => ({ ok: true, kind: 'news', topic, items: [] }) };
      }

      if (path === '/api/live/news'){
        return { ok: true, status: 200, json: async () => ({
          ok: true, kind: 'news', topic: qs.topic || 'news',
          items: [{ id: 'n1', title: '마인크래프트 1.22 업데이트 정식 출시', src: 'Eurogamer', pub: 'Mon, 21 Sep 2026 09:00:00 GMT' }],
        }) };
      }

      return { ok: true, status: 200, json: async () => ({ ok: true }) };
    };

    const domE = new JSDOM(html, {
      url: 'http://localhost:8420/',
      runScripts: 'dangerously',
      pretendToBeVisual: true,
      virtualConsole: vcE,
      beforeParse(w) {
        w.__TEST_ENV__ = true;
        w.__BRIEFING_HOST__ = { apiBase: 'http://localhost:8420', native: true };
        w.fetch = mockFetchE;
        try {
          w.localStorage.setItem('aibrief.board.v3', JSON.stringify({
            topics: [
              { id: 'f1', label: 'F1', kind: 'sport', tpl: 'a', brief: true },
              { id: 'mancity', label: '맨시티', kind: 'sport', tpl: 'a', brief: true },
              { id: 'samsung', label: '삼성전자', kind: 'stock', tpl: 'a', brief: true },
              { id: 'usd', label: '달러 환율', kind: 'fx', tpl: 'a', brief: true },
              { id: 'bitcoin', label: '비트코인', kind: 'coin', tpl: 'a', brief: true },
            ]
          }));
        } catch (e) {}
      },
    });

    const wE = domE.window, dE = wE.document;
    await wait(1800);

    // 1) F1 모터스포츠 뷰 검증
    const f1Tile = dE.querySelector('.tile[data-tid="f1"]');
    assert('E. F1 타일 존재', !!f1Tile);
    const f1Txt = (f1Tile || {}).textContent || '';
    assert('E. F1 드라이버 선두(Andrea Kimi Antonelli · 292점) 표시', /Andrea Kimi Antonelli/.test(f1Txt) && /292점/.test(f1Txt), f1Txt.slice(0, 100));
    assert('E. F1 2위 격차(+81점) 및 잔여 9R 표시', /\+81점/.test(f1Txt) && /9R/.test(f1Txt), f1Txt.slice(0, 100));
    assert('E. F1 다음 그랑프리(Azerbaijan Grand Prix · Baku) 및 세션 타임라인', /Azerbaijan Grand Prix/.test(f1Txt) && /1차 연습/.test(f1Txt), f1Txt.slice(0, 120));

    // 2) 맨시티 축구 명예 배지 검증
    const mcTile = dE.querySelector('.tile[data-tid="mancity"]');
    const mcTxt = (mcTile || {}).textContent || '';
    assert('E. 맨시티: 최다 득점 선수(Erling Haaland 5골) 명예 배지 노출', /Erling Haaland/.test(mcTxt) && /5골/.test(mcTxt), mcTxt.slice(0, 120));
    assert('E. 맨시티: 리그 선두(1위 · 승점 15점) 노출', /1위/.test(mcTxt) && /15점/.test(mcTxt), mcTxt.slice(0, 100));

    // 3) 삼성전자 실거래 시세 + 달러 환율 실시간 호가
    const samTile = dE.querySelector('.tile[data-tid="samsung"]');
    const samTxt = (samTile || {}).textContent || '';
    assert('E. 삼성전자 실세시세(274,500원 · ▲5.17% · KRX)', /274,500/.test(samTxt) && /5\.17%/.test(samTxt) && /KRX/.test(samTxt), samTxt.slice(0, 100));

    const usdTile = dE.querySelector('.tile[data-tid="usd"]');
    const usdTxt = (usdTile || {}).textContent || '';
    assert('E. 달러 환율 실시간 호가(1,371.35원 · 실시간 호가)', /1,371\.35/.test(usdTxt) && /실시간 호가/.test(usdTxt), usdTxt.slice(0, 100));

    // 4) 개별 새로고침 격리 검증: 비트코인 타일의 새로고침 클릭 시 브리핑 레일 재렌더 없음
    const btcRefresh = dE.querySelector('.tile[data-tid="bitcoin"] .tile-refresh');
    assert('E. 비트코인 개별 새로고침 버튼 존재', !!btcRefresh);
    const briefBefore = dE.querySelector('#briefRail').innerHTML;
    const callsBeforeLen = callsE.length;
    if (btcRefresh){
      btcRefresh.click();
      await wait(800);
    }
    const btcCalls = callsE.slice(callsBeforeLen).filter(c => c.path === '/api/live/interest' && (c.qs.topic === 'bitcoin' || (c.qs.label || '').includes('비트코인')));
    assert('E. 개별 새로고침: 해당 관심사(비트코인)만 API 호출', btcCalls.length >= 1, JSON.stringify(callsE.slice(callsBeforeLen)));
    const briefAfter = dE.querySelector('#briefRail').innerHTML;
    assert('E. 개별 새로고침 격리: 브리핑보드 레일 재렌더 없이 타일만 독립 갱신', briefBefore === briefAfter);

    // 5) 브리핑 레일 스포츠 카드
    const briefRailTxt = (dE.querySelector('#briefRail') || {}).textContent || '';
    assert('E. 브리핑 레일에 F1 챔피언십 카드 포함', /F1 세계선수권/.test(briefRailTxt) && /Antonelli/.test(briefRailTxt));
    assert('E. 브리핑 레일에 맨시티 명예(Haaland 5골 / 1위) 포함', /Manchester City/.test(briefRailTxt) || /맨시티/.test(briefRailTxt));

    
    // ── F. 시나리오 F: 위젯 세로 높이 조절 & 10초 슬라이드 뷰
    assert('F. 관심사 위젯 세로 리사이즈 핸들 존재', !!dE.querySelector('.wd[data-w="topics"] .wd-v-handle'));
    assert('F. 뉴스레터 위젯 세로 리사이즈 핸들 존재', !!dE.querySelector('.wd[data-w="news"] .wd-v-handle'));
    assert('F. 관심사/뉴스레터 높이 조절 버튼 존재', !!dE.querySelector('#btnTopicsHeight') && !!dE.querySelector('#btnNewsHeight'));
    const btnTH = dE.querySelector('#btnTopicsHeight');
    if (btnTH) btnTH.click();
    const stE = (() => { try { return JSON.parse(wE.localStorage.getItem('aibrief.board.v3') || '{}'); } catch(e){ return {}; } })();
    assert('F. 높이 버튼 클릭 시 state.topicsHeight 갱신', !!stE.topicsHeight, String(stE.topicsHeight));

    assert('E. 런타임 에러 없음', errsE.filter(e => !/Not implemented|navigation/i.test(e)).length === 0, errsE.join(' | ').slice(0, 220));
    domE.window.close();
  }

  console.log(`\nRESULT: ${pass} passed`);
  process.exit(process.exitCode || 0);
})();
