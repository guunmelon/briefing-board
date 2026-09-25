/* ============================================================
   host.js — 라이브 데이터 어댑터 (네이티브 WebView2 / 브라우저 미니 서버 공용)
   - 호스트 판정 순서:
     1) window.__BRIEFING_HOST__.apiBase  (네이티브 WPF 가 주입)
     2) ?host=1 (같은 서버 개발 모드)
     3) 웹에서 /api/health + /api/credentials(probe) 응답 → 같은 origin 을 호스트로 자동 인식
        (tools/live-server.js 가 켜져 있으면 브라우저 데모도 iCloud·실데이터 연결됨)
   - iCloud 일정: /api/events → 오늘 일정 분류 → window.__liveEvents → renderSchedule()
     (관심사/시세/날씨/뉴스는 app.js 가 /api/live/* 를 직접 조회 — host.js 는 일정 폴링 전담)
   - 실패 시 조용히 유지(가짜 일정 대신 iCloud CTA 유지). 완전 오프라인 단일 파일은 무해.
   ============================================================ */
(function () {
  'use strict';

  function isHttp(){ return location.protocol === 'http:' || location.protocol === 'https:'; }
  function hostCfg() {
    const h = window.__BRIEFING_HOST__;
    if (h && h.apiBase) return { base: String(h.apiBase).replace(/\/+$/, ''), native: true };
    if (isHttp() && new URLSearchParams(location.search).has('host')) {
      return { base: location.origin.replace(/\/+$/, ''), native: false };
    }
    return null;
  }
  let CFG = hostCfg();               // 동기 판정(네이티브/개발)
  let started = false;

  /* ---------- 웹 호스트 자동 발견(미니 라이브 서버) ---------- */
  async function probeWebHost(){
    if (!isHttp()) return;
    const base = location.origin.replace(/\/+$/, '');
    try {
      const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 2200);
      const r = await fetch(base + '/api/credentials?probe=1', { signal: ctl.signal, cache: 'no-store' });
      clearTimeout(t);
      if (r.ok){
        const j = await r.json().catch(() => null);
        if (j && (j.ok === true || j.hasPassword !== undefined)) return base;
      }
    } catch (e) {}
    return null;
  }
  function ensureStarted(){
    if (started) return;
    CFG = CFG || hostCfg();
    if (!CFG){ setTimeout(() => { CFG = CFG || hostCfg(); if (CFG) start(); }, 700); return; }
    start();
  }
  function webDiscovery(){
    let tries = 0;
    const tick = async () => {
      if (started || CFG) return;
      const base = await probeWebHost();
      if (base){ CFG = { base, native: false, web: true }; start(); return; }
      if (++tries < 8) setTimeout(tick, 900);          // 약 8초간 시도
    };
    setTimeout(tick, 600);
  }

  async function getJson(path) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 60000);
    try {
      const r = await fetch(CFG.base + path, { cache: 'no-store', signal: ctl.signal });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return await r.json();
    } finally { clearTimeout(t); }
  }

  /* ---------- iCloud 일정 → 오늘 창 + 상태 분류 (renderSchedule 입력) ---------- */
  const KINDS = [
    [/미팅|회의|면담|리뷰|콜|브리핑|발표/, 'meet'],
    [/운동|러닝|조깅|PT|헬스|요가|산책/, 'health'],
    [/기획|개발|작업|리서치|스프린트|데드라인|마감|보고/, 'work'],
  ];
  function guessKind(title){
    for (const [re, k] of KINDS) if (re.test(title)) return k;
    return 'personal';
  }
  function eventsToToday(rawList, now) {
    now = now || new Date();
    const dayStart = new Date(now); dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(dayStart); dayEnd.setDate(dayEnd.getDate() + 1);
    const kindOk = { meet: 1, work: 1, health: 1, personal: 1 };
    const out = [];
    for (const ev of (rawList || [])) {
      if (!ev || !ev.st) continue;
      const st = new Date(ev.st);
      const enRaw = ev.en || ev.end || ev.st;
      const en = new Date(enRaw);
      if (isNaN(st) || isNaN(en)) continue;
      if (!(st < dayEnd && en > dayStart)) continue;          // 오늘과 겹치는 일정만(모든 캘린더 병합 후 필터)
      const kind = kindOk[ev.kind] ? ev.kind : guessKind(String(ev.title || ''));
      const allDay = !!ev.allDay;
      let state;
      if (allDay) state = (en <= now) ? 'done' : 'up';        // 종일은 '진행 중' 표시 안 함
      else state = en <= now ? 'done' : (st <= now ? 'now' : 'up');
      out.push({
        id: ev.id || ('ev-' + st.getTime() + '-' + out.length),
        title: String(ev.title || '(제목 없음)'),
        st: st.toISOString(), en: en.toISOString(),
        kind, icon: kind === 'meet' ? 'i-chat' : (kind === 'work' ? 'i-flag' : (kind === 'health' ? 'i-heart' : 'i-cal')),
        meta: ev.meta || ev.location || ev.calendar || '',
        calendar: ev.calendar || '',
        allDay, state,
      });
    }
    return out.sort((a, b) => a.st < b.st ? -1 : 1);
  }
  window.__hostMap = { eventsToToday, probeWebHost };

  /* ---------- 런타임 ---------- */
  let newsBusy = false, calBusy = false;

  async function refreshEvents() {
    if (calBusy) return false; calBusy = true;
    try {
      const data = await getJson('/api/events');
      if (data && data.enabled === true) {                    // iCloud 연결 + 일정 표시 ON
        window.__liveEvents = eventsToToday(data.items, new Date());
        if (window.__boardApi) window.__boardApi.rerenderSchedule();
        return true;
      }
      if (data && data.reason === 'sync-error'){ return false; }  // 일시 오류 — 기존 일정 유지
      window.__liveEvents = undefined;                        // 미설정/스위치 OFF — CTA 유지
      return false;
    } catch (err) {
      console.warn('[host] 일정 동기화 실패 — 마지막 결과 유지', err && err.message ? err.message : err);
    } finally { calBusy = false; }
    return false;
  }
  async function refreshNews() {
    if (newsBusy) return false; newsBusy = true;
    try {
      if (window.__boardApi && window.__boardApi.rerenderBrief) {
        window.__boardApi.rerenderBrief();                    // fresh 재수집 + 렌더
        return true;
      }
    } finally { newsBusy = false; }
    return false;
  }

  const EVT_MS = 60 * 1000, NEWS_MS = 15 * 60 * 1000;
  function schedule(fn, ms, streak) {
    const wait = ms * Math.pow(2, Math.min(streak || 0, 3));
    setTimeout(() => { fn().then(ok => schedule(fn, ms, ok ? 0 : (streak || 0) + 1)); }, wait);
  }
  function start() {
    if (started) return; started = true;
    window.__hostRefresh = { refreshEvents, refreshNews };
    refreshEvents();
    refreshNews();
    schedule(refreshEvents, EVT_MS, 0);
    schedule(refreshNews, NEWS_MS, 0);
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) { refreshEvents(); refreshNews(); }
    });
    console.info('[host] 라이브 모드 — ' + CFG.base + (CFG.native ? ' (native)' : ' (web mini-server)'));
  }

  // 시작 게이트: 네이티브 주입이 이미 있으면 즉시, 아니면 app.js 가 설정한 값 반영 대기 + 웹 발견
  if (CFG){ start(); }
  else {
    ensureStarted();
    webDiscovery();
  }
})();
