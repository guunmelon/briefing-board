/* ============================================================
   APP — AI 브리핑 보드 메인 (Windows 데스크톱 위젯 1차 프로토타입)
   Board 1개 + 독립 위젯 3개 (오늘 일정 / 관심사 / 맞춤 뉴스레터)
   ============================================================ */
(function () {
  'use strict';

  const D = window.Data, Lg = window.Logic, S = window.BStore;
  const state = S.load();
  state.likes = Array.isArray(state.likes) ? state.likes : [];   // “good!”(관심있음) 취향 데이터
  state.readIds = Array.isArray(state.readIds) ? state.readIds : [];   // good! = 읽은 기사 → 같은 관심사 다음 기사로
  if (!Array.isArray(state.mutedIds)) state.mutedIds = [];
  // 관심사 스키마 정규화: 종류/템플릿/브리핑 포함(기본 ON) 정리 — 라이브 파이프라인 스키마(v4)
  {
    state.topics = (Array.isArray(state.topics) ? state.topics : []).map(t => {
      const nt = D.normalizeTopic(t);
      if (nt.brief === undefined) nt.brief = true;   // 기본: 뉴스레터 포함 (개별 스위치로 끌 수 있음)
      return nt;
    });
    if (!state.topics.length) state.topics = D.defaultTopics();
  }

  /* ============ helpers ============ */
  const $  = s => document.querySelector(s);
  const $$ = s => Array.from(document.querySelectorAll(s));
  const ic = (n, w=14) => `<svg width="${w}" height="${w}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><use href="#${n}"/></svg>`;
  const K = D.KIND;

  let DEMO_EVENTS = null;          // 오늘 시드 일정
  let undoStack = null;            // 마지막 상태(되돌리기)
  function bestTplOf(kind, label){
    // 시안 기본값: 날씨=주간(b), 개인은 게이지(a)·주간 기록 성향이면(b), 나머지는 대표 카드(a)
    if (kind === 'weather') return 'b';
    if (kind === 'sport') return 'a';          // 팬 한눈에 보기(다음 경기·남은 시간·구장·결과)
    if (kind === 'personal') return /주\s*\d|습관|루틴|독서|명상|수면/.test(String(label || '')) ? 'b' : 'a';
    return 'a';
  }
  let boardResize = null;
  let lastFeedCount = 0;
  let BUILD_HASH = null;                     // dist/index.html 해시 — 코드가 바뀌면 화면도 새로 그림

  function now(){ return new Date(); }
  function fmtClock(d){
    const h = d.getHours();
    if (state.timeFormat === '24') return `${D.$U.pad(h)}:${D.$U.pad(d.getMinutes())}`;
    const ap = h < 12 ? '오전' : '오후'; const hh = h % 12 || 12;
    return `${ap} ${hh}:${D.$U.pad(d.getMinutes())}`;
  }

  /* ============ 테마 ============ */
  function themeOf(){
    if (!state.autoTheme && state.themeOverride) return state.themeOverride;
    const h = now().getHours();
    return (h >= 6 && h < 18) ? 'light' : 'dark';
  }
  function applyTheme(silent){
    const t = themeOf();
    document.documentElement.setAttribute('data-theme', t);
    const sun = t==='light';
    $('#tbThemeIco').innerHTML = sun ? ic('i-sun',16) :
      `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z"/></svg>`;
    $('#tbTheme').title = state.autoTheme ? '테마 자동(시간대) — 수동 전환' : '수동 테마 — 자동으로 복귀';
    if (!silent) pushLog(`테마를 <b>${t==='light'?'라이트':'다크'}</b>로 적용했습니다`);
    applyAmbience();
  }
  function toggleTheme(){
    if (state.autoTheme){ state.autoTheme=false; state.themeOverride = themeOf()==='light'?'dark':'light'; }
    else if (state.themeOverride){ state.themeOverride = state.themeOverride==='light'?'dark':'light'; }
    else { state.autoTheme=true; }
    S.save(state); applyTheme();
  }

  /* ============ 로그 ============ */
  function pushLog(html){
    if (!state.log) state.log = [];
    const d = now();
    state.log.unshift({ t: `${D.$U.pad(d.getHours())}:${D.$U.pad(d.getMinutes())}`, m: html });
    state.log = state.log.slice(0, 12);
    const hint = $('#aiLogHint'), txt = $('#aiLogText');
    const plain = html.replace(/<[^>]+>/g,'');
    txt.textContent = 'AI ' + plain;
    hint.style.display = 'flex';
    if (txt.animate) { txt.animate([{opacity:.3},{opacity:1}], {duration:600}); }
    save();
  }
  function logRows(){
    return (state.log||[]).map(x => `<div class="log-row"><span class="lt">${x.t}</span><span class="lm">${x.m}</span></div>`).join('') || '<div class="log-row"><span class="lm muted">아직 변경 기록이 없어요.</span></div>';
  }

  /* ============ 상태 안내 (디클러터: 상시 배너 없음) ============ */
  function setAI(){ /* 제거됨 — 안내는 피드백 확장 창 속 AI 로그·토스트로만 전달 */ }

  /* ============ 저장 ============ */
  function save(){ S.save(state); }
  function snap(){
    return { topics: JSON.parse(JSON.stringify(state.topics)), layout: state.layout,
      stockRule: state.stockRule||'kr', scale: state.scale||1, themeOverride: state.themeOverride, autoTheme: state.autoTheme,
      mutedIds: (state.mutedIds||[]).slice() };
  }
  function pushUndo(){ undoStack = snap(); $('#undoChip').classList.add('show'); }
  function undo(){
    if (!undoStack) return;
    Object.assign(state, undoStack); state.aiCfg = state.aiCfg||{};
    undoStack = null; $('#undoChip').classList.remove('show');
    applyTheme(true); applyScale(); applyStockRule();
    decideGrid();
    render();
    pushLog('변경을 되돌렸습니다 (이전 구성으로 복원)');
    S.save(state);
  }

  /* ============ 토스트(알림) ============ */
  function toast(o){
    const box = document.createElement('div');
    box.className = 'toast';
    const g = o.g || ['#6366f1','#22d3ee'];
    box.innerHTML = `
      <div class="t-ic" style="--t1:${g[0]};--t2:${g[1]}">${ic(o.ic||'i-spark',16)}</div>
      <div class="t-b"><div class="t-t">${o.t}</div><div class="t-m">${o.m||''}</div></div>
      <button class="t-x">${ic('i-x',12)}</button><i class="bar"></i>`;
    const kill = () => { if(box.parentNode){ box.classList.add('out'); setTimeout(()=>box.remove(), 420);} };
    box.querySelector('.t-x').onclick = kill;
    setTimeout(kill, o.ms || 6000);
    $('#toasts').appendChild(box);
  }

  /* ============ 위젯 배치 (Board 밸런스) — 현황 카드 개수 기준 ============ */
  function decideGrid(){
    const dataCount = state.topics.length; // 관심사 현황 위젯 타일 수(실제 소식 표시 — 뉴스형 포함)
    const target = Lg.decideLayout(dataCount, state.layout || 'today-hero');
    const changed = target !== state.layout;
    state.layout = target;
    $('#grid').setAttribute('data-layout', target);
    if (changed){
      requestAnimationFrame(()=> $$('#grid .wd').forEach(w => { w.classList.remove('reflow'); void w.offsetWidth; w.classList.add('reflow'); }));
    }
    S.save(state);
  }

  /* ============ 스케일/색상 룰 ============ */
  function applyScale(){ const s = D.$U.clamp(state.scale||1, .85, 1.2); state.scale = s; $('#board').style.zoom = s; }
  function applyStockRule(){
    document.body.classList.toggle('stock-us', (state.stockRule||'kr')==='us');
  }

  /* ============================================================
     [v5] 분위기 스카이 — 시간대별 블러 그라데이션 + 기상경보 효과
     - 하늘: 일출(5–7) · 낮(8–16) · 노을(17–19) · 황혼(19–21) · 밤(22–4)
       정적 블러 빛장(그라데이션)만 그려 최적. 밤에는 달빛, 낮에는 햇빛.
     - 기상경보(비/폭풍)일 때만: 빗줄 애니메이션 + (폭풍) 번개 + 창유리 빗방울.
     - 데모용 스카이 모드: auto / day / sunset / night / rain / storm
   ============================================================ */
  const SKY_PAL = {
    dawn: {
      l: { c:['#35436e','#7c5a8f','#e2837f','#ffd9a4'], orb:{ x:68, y:56, w:560, h:320, c:'rgba(255,213,150,.9)' } },
      d: { c:['#1c2244','#55355f','#b4514b','#dd7c3f'], orb:{ x:66, y:58, w:520, h:300, c:'rgba(255,183,110,.75)' } },
    },
    day: {
      l: { c:['#1f6fc2','#57a8e8','#9ed2f7','#e8f6ff'], orb:{ x:60, y:16, w:760, h:420, c:'rgba(255,244,190,.95)' } },
      d: { c:['#123f77','#2465a8','#4d96d4','#cfe9fb'], orb:{ x:58, y:18, w:720, h:400, c:'rgba(255,244,190,.55)' } },
    },
    sunset: {
      l: { c:['#253a72','#a04f8d','#ef8a54','#ffca80'], orb:{ x:70, y:52, w:620, h:360, c:'rgba(255,224,160,.95)' } },
      d: { c:['#161d44','#6a3a5f','#b0573f','#e6883f'], orb:{ x:68, y:54, w:560, h:330, c:'rgba(255,196,120,.8)' } },
    },
    dusk: {
      l: { c:['#141b45','#43307c','#a14a86','#e58368'], orb:{ x:20, y:70, w:520, h:300, c:'rgba(255,170,140,.5)' } },
      d: { c:['#0c1130','#2b2056','#743c66','#b05c4a'], orb:{ x:22, y:72, w:480, h:280, c:'rgba(255,150,120,.4)' } },
    },
    night: {
      l: { c:['#050a24','#0f1a46','#1c2a5e','#283869'], orb:{ x:74, y:14, w:520, h:520, c:'rgba(220,228,255,.85)' } },
      d: { c:['#030618','#0a1236','#141f4c','#1e2b5a'], orb:{ x:76, y:12, w:520, h:520, c:'rgba(196,208,255,.7)' } },
    },
    /* ---- 기상경보 전용 배경 ---- */
    rain: {
      l: { c:['#37475a','#52657a','#7d8fa1','#b6c4d0'], orb:{ x:18, y:10, w:1000, h:460, c:'rgba(214,226,240,.4)' } },
      d: { c:['#10161f','#192231','#2a3748','#405065'], orb:{ x:18, y:10, w:1000, h:460, c:'rgba(200,212,228,.18)' } },
    },
    storm: {
      l: { c:['#21242f','#323348','#49475c','#5f5270'], orb:{ x:68, y:16, w:640, h:560, c:'rgba(218,214,255,.26)' } },
      d: { c:['#0d0e17','#161826','#222338','#322e44'], orb:{ x:68, y:14, w:660, h:580, c:'rgba(208,202,245,.2)' } },
    },
    dust: {
      l: { c:['#6f5e3a','#9c824c','#c4a86e','#e2cf9f'], orb:{ x:54, y:10, w:1100, h:560, c:'rgba(250,224,158,.6)' } },
      d: { c:['#282114','#42361f','#5e4e2c','#7d6840'], orb:{ x:52, y:12, w:1000, h:540, c:'rgba(228,204,148,.34)' } },
    },
    heat: {
      l: { c:['#4a0d10','#7f1d1d','#c2410c','#fda45e'], orb:{ x:56, y:12, w:1100, h:620, c:'rgba(255,226,160,.98)' } },
      d: { c:['#1c0607','#3a0c0e','#64150f','#9c3510'], orb:{ x:54, y:12, w:1000, h:580, c:'rgba(255,196,140,.55)' } },
    },
    cold: {
      l: { c:['#8daeda','#b6cdec','#dbe8f6','#f8fbff'], orb:{ x:20, y:60, w:520, h:320, c:'rgba(232,242,255,.85)' } },
      d: { c:['#14223c','#203557','#324f77','#4e6c97'], orb:{ x:18, y:62, w:500, h:300, c:'rgba(214,230,255,.6)' } },
    },
    snow: {
      l: { c:['#98a5b7','#bfc9d6','#dde4ec','#f3f6f9'], orb:{ x:12, y:6, w:1500, h:760, c:'rgba(242,247,253,.55)' } },
      d: { c:['#212a38','#313c4d','#455265','#5d6a7c'], orb:{ x:12, y:6, w:1500, h:760, c:'rgba(224,232,242,.32)' } },
    },
  };
  const skyKeyByHour = Lg.skyKeyByHour || (h => (h >= 5 && h < 8 ? 'dawn' : h >= 8 && h < 17 ? 'day' : h >= 17 && h < 19 ? 'sunset' : h >= 19 && h < 22 ? 'dusk' : 'night'));
  const ALERT_KEYS = Lg.ALERT_KEYS || { rain:1, storm:1, dust:1, heat:1, cold:1, snow:1 };
  const SKY_MODE = {
    auto:'자동(시간대)', day:'낮 · 햇빛', sunset:'노을', night:'밤 · 달빛',
    rain:'비 경보', storm:'폭풍 경보', dust:'황사 · 미세먼지 경보',
    heat:'폭염 경보', cold:'한파 경보', snow:'대설 경보',
  };
  const ALERT_ICON = { rain:'i-drop', storm:'i-wind', dust:'i-drop', heat:'i-sun', cold:'i-drop', snow:'i-drop' };
  /* 하늘 판정의 실측 소스: 등록한 날씨 관심사 payload(우선) → 서울 실측 */
  function liveWxForSky(){
    for (const t of state.topics){
      if (t.kind !== 'weather') continue;
      const p2 = livePayload[t.id];
      if (p2 && p2.status === 'ok' && p2.data && (p2.data.code != null || p2.data.cond)) return p2.data;
    }
    return seoulWx;
  }
  function skyAlertNow(){ return Lg.skyAlertFromWeather(liveWxForSky()); }
  function skyDecision(){
    const d = Lg.decideSky(state.skyMode || 'auto', skyAlertNow(), now().getHours());
    return SKY_PAL[d.base] ? d : Object.assign({}, d, { base: skyKeyByHour(now().getHours()) });
  }
  function ensureDrops(){
    const box = $('#glassDrops');
    if (box.childElementCount) return;
    for (let i = 0; i < 30; i++){
      const b = document.createElement('i');
      const j = document.createElement('span'); j.className = 'blob';
      const rnd = (a,b)=>a+Math.random()*(b-a);
      b.style.cssText = `left:${rnd(0,97)}%; top:${rnd(0,45)}%; animation-delay:${rnd(0,1.8)}s; animation-duration:${rnd(1.3,2.4)}s;`;
      j.style.cssText = `left:${rnd(1,98)}%; top:${rnd(0,92)}%; width:${rnd(9,30)}px; height:${rnd(7,20)}px;`;
      box.appendChild(b); box.appendChild(j);
    }
  }

  /* --- 경보 전용 FX 노드 생성 (클리어 시 비움) --- */
  function clearNode(n){ while (n && n.firstChild) n.removeChild(n.firstChild); }
  function buildDustClouds(){
    const beh = $('#fxBehind');
    for (let i = 0; i < 3; i++){
      const c = document.createElement('div'); c.className = 'dcloud';
      const rnd = (a,b)=>a+Math.random()*(b-a);
      c.style.cssText = `left:${rnd(0,55)}%; top:${rnd(8,64)}%; width:${rnd(380,720)}px; height:${rnd(240,440)}px; ` +
        `animation-duration:${rnd(46,84).toFixed(1)}s; animation-delay:${-rnd(0,40).toFixed(1)}s;`;
      beh.appendChild(c);
    }
  }
  function buildHeatBands(){
    const fr = $('#fxFront');
    for (let i = 0; i < 7; i++){
      const b = document.createElement('div'); b.className = 'hband';
      const rnd = (a,b)=>a+Math.random()*(b-a);
      b.style.cssText = `--hd:${rnd(6,12).toFixed(2)}s; --hh:${rnd(70,170).toFixed(0)}px; ` +
        `bottom:${rnd(-30,35).toFixed(0)}%; animation-delay:${-rnd(0,12).toFixed(2)}s;`;
      fr.appendChild(b);
    }
  }
  function buildIcicles(){
    const bf = $('#boardFx'); clearNode(bf);
    const rnd = (a,b)=>a+Math.random()*(b-a);
    const spots = [6,14,24,34,44,55,65,75,85,93];
    for (let i = 0; i < 9; i++){
      const left = spots[Math.floor(rnd(0, spots.length))] + rnd(-2.5,2.5);
      const ic = document.createElement('div'); ic.className = 'icicle';
      ic.style.left = left.toFixed(1) + '%';
      ic.style.animationDelay = (-rnd(0,6)).toFixed(2) + 's';
      ic.style.height = (46 + rnd(0,34)).toFixed(0) + 'px';
      bf.appendChild(ic);
      const dp = document.createElement('div'); dp.className = 'ice-drip';
      dp.style.left = (left + rnd(-2.5,2.5)).toFixed(1) + '%';
      dp.style.animationDelay = (-rnd(0,7)).toFixed(2) + 's';
      bf.appendChild(dp);
    }
  }
  function renderFX(weath){
    const beh = $('#fxBehind'), fr = $('#fxFront'), bf = $('#boardFx');
    clearNode(beh); clearNode(fr); clearNode(bf);
    if (weath === 'dust') buildDustClouds();
    else if (weath === 'heat') buildHeatBands();
    else if (weath === 'cold') buildIcicles();
    // rain/storm/snow: 배경·위젯·창유리 효과는 CSS 전용
  }
  function applyAmbience(force){
    const dec = skyDecision();
    const base = dec.base;
    const weath = dec.weath || 'clear';
    if (!dec.manual){                        // 실측으로 전환된 순간만 알린다(매 틱 반복 알림 금지)
      const seen = applyAmbience._alertSeen || null;
      if (weath !== 'clear' && weath !== seen) pushLog(`실시간 기상 감지 → 배경 하늘을 <b>${(Lg.SKY_ALERT_LABEL || {})[weath] || weath}</b>(으)로 전환`);
      else if (seen && weath === 'clear') pushLog('기상 특보 해제 → 시간대 하늘로 자동 복귀');
      applyAmbience._alertSeen = weath === 'clear' ? null : weath;
    }
    const sig = [base, weath, themeOf()].join('|');
    if (!force && applyAmbience._sig === sig) return;
    applyAmbience._sig = sig;
    const pal = SKY_PAL[base] ? SKY_PAL[base][themeOf() === 'dark' ? 'd' : 'l'] : null;
    const grad = $('#sky .grad'), orb = $('#sky .orb');
    if (pal){
      document.body.dataset.sky = base;
      grad.style.background = `linear-gradient(180deg, ${pal.c.join(',')})`;
      orb.style.cssText = `left:${pal.orb.x}%; top:${pal.orb.y}%; width:${pal.orb.w}px; height:${pal.orb.h}px; ` +
        `background:radial-gradient(circle at 50% 60%, ${pal.orb.c} 0%, rgba(255,255,255,0) 64%);`;
    }
    Object.keys(ALERT_KEYS).forEach(c => document.body.classList.toggle(c, weath === c));
    document.body.classList.toggle('drops', weath === 'rain' || weath === 'storm');
    if (weath === 'rain' || weath === 'storm') ensureDrops();
    renderFX(weath);
  }

  /* ============================================================
     위젯 1 : 오늘 일정
     ============================================================ */
  /* 오늘 위젯 상단의 서울 날씨 — 실제 Open-Meteo(서버) 값만. 없으면 숫자 대신 연결 안내 */
  let seoulWx = null, seoulWxAt = 0;
  function wxIconTag(){
    if (!seoulWx) return 'i-sun';
    const n = String(seoulWx.icon || '');
    if (/^(3|4|9|10|11|9[0-9]|95|96|99)$/.test(n)) return 'i-drop';           // 비·소나기·뇌우
    if (/^(7|8|71|73|75|77|85|86)$/.test(n)) return 'i-drop';                  // 눈
    if (/clear|sun/i.test(n)) return 'i-sun';
    if (/cloud|overcast/i.test(n)) return 'i-sun';
    return 'i-wind';
  }
  function paintSeoulWeather(){
    const tEl = $('#wxTemp'), iEl = $('#wxIco'), cEl = $('#wxChip');
    if (!tEl || !iEl || !cEl) return;
    if (seoulWx && seoulWx.temp != null){
      tEl.textContent = Math.round(seoulWx.temp) + '°';
      iEl.innerHTML = ic(wxIconTag(), 24);
      cEl.textContent = `서울 · ${seoulWx.cond || ''}${seoulWx.humidity != null ? ' · 습도 ' + Math.round(seoulWx.humidity) + '%' : ''}`;
    } else if (LIVE){
      tEl.textContent = '--°';
      iEl.innerHTML = ic('i-sun', 24);
      cEl.textContent = '서울 · 날씨 불러오는 중';
    } else {
      tEl.textContent = '--°';
      iEl.innerHTML = ic('i-sun', 24);
      cEl.textContent = '서울 · 실시간 연결 필요';
    }
    if (window.BPatch && window.BPatch.count && window.BPatch.count()) renderWxStrip();
  }
  async function ensureSeoulWeather(){
    if (seoulWx && Date.now() - seoulWxAt < 5 * 60 * 1000) return;
    try {
      const b = await liveBase();
      if (!b){ paintSeoulWeather(); return; }
      const r = await apiGet('/api/live/interest?topic=seoul&label=' + encodeURIComponent('서울') + '&kind=weather');
      if (r && r.ok !== false && r.weather){ seoulWx = r.weather; seoulWxAt = Date.now(); renderWxStrip(); applyAmbience(true); }
    } catch (e) {}
    paintSeoulWeather();
  }
  /* 오늘 일정 위젯의 날씨 줄 — 피드백으로 만들어진 ‘스트립’ 패치(#wxStrip)가 여기에 붙는다 */
  function renderWxStrip(){
    const box = $('#wxStrip');
    if (!box) return;
    if (!window.BPatch || !window.BPatch.applyHtml || !seoulWx){ box.innerHTML = ''; return; }
    const topic = { id: '_strip', label: '서울 날씨', kind: 'weather' };
    const payload = { status: 'ok', kind: 'weather', data: seoulWx };
    let html = '';
    try { html = window.BPatch.applyHtml(topic, payload, '', 'strip'); } catch (e) { html = ''; }
    box.innerHTML = html || '';
    box.style.display = html ? 'block' : 'none';
  }
  function scheduleSource(){
    // 소스 우선순위: 라이브(host/iCloud) > 사용자가 직접 추가한 일정 — 가짜 시드 일정 없음
    if (Array.isArray(window.__liveEvents)) return { live: true, events: window.__liveEvents };
    if (state.demoEvents && state.demoEvents.length) return { live: false, user: true, events: state.demoEvents };
    return { live: false, events: [] };
  }
  function normalizeEvents(list){
    return (list || []).map(e => {
      const st = e.st instanceof Date ? e.st : new Date(e.st);
      const en = (e.en ? (e.en instanceof Date ? e.en : new Date(e.en)) : st);
      return { ...e, st, en, state: en <= now() ? 'done' : (st <= now() ? 'now' : 'up') };
    }).filter(e => !isNaN(e.st)).sort((a,b) => a.st - b.st);
  }
  function openICloudGuide(){
    // 네이티브면 설정(자격증명 입력)을 바로 연다. 브라우저 데모면 절차 안내 모달.
    if (hostBase()){ openSettings(); return; }
    openModal({
      title:'iCloud 일정 연결하기', ic:'i-cal',
      body:`<div style="display:flex;flex-direction:column;gap:8px;margin-top:2px">
        <div style="font-size:12px;line-height:1.7;color:var(--ink-2)">
          오늘 일정의 실데이터는 <b>Apple iCloud 캘린더(CalDAV)</b>에서 가져와요.<br/>
          지금 화면은 파일을 직접 연(오프라인) 상태라 입력란이 없어요. 아래 1번만 하면
          <b>이 브라우저 화면(미니 서버)에서 바로</b> 연결할 수 있어요.</div>
        <ol style="margin:2px 0 0;padding-left:18px;font-size:12px;line-height:1.9;color:var(--ink-2)">
          <li>브라우저를 닫고 이 폴더에서 <b>미니 라이브 서버</b>를 실행해 이 화면을 다시 엽니다.<br/>
              <span style="font-family:ui-monospace,monospace;font-size:11px;background:rgba(99,102,241,.08);border-radius:6px;padding:2px 6px">node tools/live-server.js --dir dist</span>
              → <span style="font-family:ui-monospace,monospace;font-size:11px">http://localhost:8420</span></li>
          <li>보드 좌측 상단 <b>☰ 설정</b> → <b>iCloud 일정</b> 칸을 엽니다.</li>
          <li>아래 '앱 암호 만드는 법' 링크를 눌러 <b>앱 특수 암호</b>(xxxx-xxxx-xxxx-xxxx)를 발급받습니다.</li>
          <li><b>Apple ID(이메일)</b>와 <b>앱 특수 암호</b>를 입력하고 <b>연결 저장</b> → <b>일정 표시</b>를 켭니다.</li>
        </ol>
        <a class="btn ghost" style="align-self:flex-start" href="https://appleid.apple.com/account/manage" target="_blank" rel="noopener">${ic('i-open',12)} 앱 특수 암호 만드는 법 (appleid.apple.com)</a>
        <div class="m-sub">앱 특수 암호는 Apple ID 비밀번호가 아니라 '로그인 및 보안 → 앱 암호'에서 만드는 16자리 전용 암호예요.</div>
      </div>`,
      foot:`<button class="btn primary" data-c>확인</button>`
    });
  }
  function renderSchedule(){
    const t = now();
    const info = D.todayInfo(t);
    const src = scheduleSource();
    let events = normalizeEvents(src.events);
    const liveConnected = src.live;
    DEMO_EVENTS = events;
    ensureSeoulWeather();

    const g = D.greet(t, events, state.userName);
    $('#greetMsg').textContent = g.hello;
    $('#weatherLine').innerHTML = `<b>${info.month}월 ${info.day}일 ${info.weekdayLong}</b> · 오늘 일정 ${events.length}건 (${events.filter(e=>e.state==='done').length}건 완료) · ${D.blockName(t)}`;
    $('#dayTag').textContent = info.weekday;
    $('#todaySub').textContent = liveConnected ? `iCloud 캘린더와 동기화됨 · 오늘 ${events.length}건`
      : (src.user ? '직접 추가한 일정을 표시 중 — iCloud 연결 시 실제 캘린더와 병합돼요' : '아직 iCloud 캘린더에 연결되지 않았어요');

    paintSeoulWeather();

    /* 동기화 링크 라벨 */
    const syncEl = $('#schedSync');
    if (syncEl) syncEl.innerHTML = liveConnected ? ic('i-reload',11) + ' iCloud 일정 동기화' : ic('i-plus',11) + ' iCloud 일정 연결';

    /* 다음 일정 카드 */
    const up = events.find(e => e.state==='up');
    const nowEv = events.find(e => e.state==='now');
    const doneCount = events.filter(e=>e.state==='done').length;
    let nc;
    if (nowEv){
      const minsLeft = Math.max(0, Math.round((nowEv.en - t)/60000));
      nc = `<div class="next-card">
        <div class="nc-ic">${ic(nowEv.icon||'i-clock',16)}</div>
        <div class="nc-t"><div class="nc-l">지금 진행 중</div><div class="nc-ti">${D.$U.esc(nowEv.title)}</div><div class="nc-when">${fmtClock(nowEv.st)} – ${fmtClock(nowEv.en)}</div></div>
        <div class="nc-togo"><div class="nc-big">${minsLeft}</div><div class="nc-cap">분 후 종료</div></div>
      </div>`;
    } else if (up){
      const mins = Math.round((up.st - t)/60000);
      nc = `<div class="next-card">
        <div class="nc-ic">${ic(up.icon||'i-clock',16)}</div>
        <div class="nc-t"><div class="nc-l">다음 일정</div><div class="nc-ti">${D.$U.esc(up.title)}</div><div class="nc-when">${fmtClock(up.st)} 시작 · ${up.meta||''}</div></div>
        <div class="nc-togo"><div class="nc-big">${mins>=60? (mins/60).toFixed(1).replace('.0',''):mins}</div><div class="nc-cap">${mins>=60?'시간':'분'} 후</div></div>
      </div>`;
    } else if (events.length){
      nc = `<div class="next-card emptygrad"><div class="nc-ic">${ic('i-check',16)}</div>
        <div class="nc-t"><div class="nc-l">오늘 일정 완료 🎉</div><div class="nc-ti">${doneCount}건 모두 마쳤어요</div><div class="nc-when">다음 일정은 내일로 이어집니다</div></div></div>`;
    } else if (!liveConnected){
      nc = `<div class="next-card" style="background:linear-gradient(120deg,#6366f1,#06b6d4);cursor:pointer" id="schedConnectCard">
        <div class="nc-ic">${ic('i-cal',16)}</div>
        <div class="nc-t"><div class="nc-l">실제 일정 표시 준비</div><div class="nc-ti">iCloud 캘린더를 연결하면</div><div class="nc-when">오늘의 진짜 일정이 여기에 떠요</div></div>
        <div class="nc-togo"><div class="nc-cap" style="font-size:10px">연결하기 →</div></div>
      </div>`;
    } else {
      nc = `<div class="next-card emptygrad"><div class="nc-ic">${ic('i-cal',16)}</div>
        <div class="nc-t"><div class="nc-l">오늘 일정</div><div class="nc-ti">등록된 일정이 없어요</div><div class="nc-when">여유로운 하루 보내세요</div></div></div>`;
    }
    $('#nextCard').innerHTML = nc;
    const ctc = $('#schedConnectCard');
    if (ctc) ctc.onclick = openICloudGuide;

    /* 목록 */
    if (!events.length){
      $('#todaySchedule').innerHTML = (!liveConnected)
        ? `<div class="sched-empty">${ic('i-cal',26)}<b>아직 실제 일정이 없어요</b><span>가짜 데모 일정 대신 iCloud 캘린더의 진짜 일정을 보여드려요.</span>
            <button class="btn primary" id="schedConnect" style="margin-top:4px">${ic('i-plus',12)} iCloud 일정 연결하기</button></div>`
        : `<div class="sched-empty">${ic('i-check',26)}<b>오늘은 등록된 일정이 없어요</b><span>여유로운 하루 보내세요</span></div>`;
      const c = $('#schedConnect');
      if (c) c.onclick = openICloudGuide;
      return;
    }
    const rows = events.map(e => {
      const past = e.state==='done';
      const cls = past ? 'past' : (e.state==='now' ? 'active':'');
      const dotCls = e.kind==='health'?'health': (e.kind==='meet'?'meet':(e.kind==='work'?'work':''));
      const tag = e.kind==='meet'?'미팅': e.kind==='work'?'작업': e.kind==='health'?'건강':'개인';
      const tagCls = e.kind==='meet'?'meet': e.kind==='work'?'work': e.kind==='health'?'health':'personal';
      const dur = (e.en && e.to) ? `${Math.round((e.en-e.st)/60000)}분` : '';
      return `<li class="sched-item" ${e.state==='now'?'style="background:rgba(99,102,241,.07);border-radius:10px;padding:7px 6px"':''}>
        <div class="sched-time ${past?'past':''}">${fmtClock(e.st)}</div>
        <div class="sched-mid"><i class="${past?'past':''} ${dotCls}"></i></div>
        <div class="sched-info">
          <div class="sched-name ${past?'past':''}">${D.$U.esc(e.title)}</div>
          <div class="sched-meta"><span class="tag-pill ${tagCls}">${tag}</span>${e.meta?`<span>${D.$U.esc(e.meta)}</span>`:''}${dur?`<span>· ${dur}</span>`:''}</div>
        </div></li>`;
    }).join('');
    $('#todaySchedule').innerHTML = `<ul class="sched-list">${rows}</ul>`;
  }

  function addDemoEventModal(){
    openModal({
      title:'일정 추가', ic:'i-cal',
      body:`<div class="field"><label>시작 시간</label><input class="textin" id="evTime" type="time" value=""/></div>
            <div class="field"><label>일정명</label><input class="textin" id="evTitle" placeholder="예: 클라이언트 미팅"/></div>
            <div class="m-sub">iCloud 캘린더를 연결하면 이 일정이 실제 캘린더에도 저장되는 버전으로 이어집니다. 지금은 이 PC(로컬)에만 기록돼요.</div>`,
      foot:`<button class="btn" data-c>취소</button><button class="btn primary" id="evOk">추가하기</button>`
    });
    const t = now(); t.setMinutes(t.getMinutes()+60,0,0);
    $('#evTime').value = `${D.$U.pad(t.getHours())}:${D.$U.pad(t.getMinutes())}`;
    $('#evOk').onclick = () => {
      const ti = $('#evTime').value, ti2 = $('#evTitle').value.trim();
      if (!ti || !ti2) return toast({t:'입력 필요', m:'시간과 일정명을 채워주세요.', ic:'i-bell'});
      const d0 = new Date(); d0.setHours(0,0,0,0);
      const [hh,mm] = ti.split(':').map(Number);
      const st = new Date(d0); st.setHours(hh,mm,0,0);
      const en = new Date(st); en.setMinutes(en.getMinutes()+30);
      const mins = Math.round((st-now())/60000);
      const ev = { id:D.$U.uid('ev'), st:st.toISOString(), en:en.toISOString(), title:ti2, kind: mins>=0?'work':'personal', icon: mins>=0?'i-flag':'i-coffee', meta:mins>=0?'방금 추가됨':'직접 추가' };
      state.demoEvents = [...(state.demoEvents||[]).map(e=>({...e})), ev];
      // state change not yet Date objects for others; normalize at render
      closeModal();
      pushLog(`일정 <b>${D.$U.esc(ti2)}</b> ${mins>=0? mins+'분 후': '지난 일정으로'} 추가`);
      pushUndo(); save(); renderSchedule();
      toast({t:'일정 추가됨', m:`${fmtClock(st)} · ${ti2}`, ic:'i-cal'});
    };
  }

  /* ============================================================
     라이브 파이프라인 — 실데이터(미니 서버/네이티브 API)와 대화
     payload: { tid: { status:'ok', kind, data, at, err? } }
     feed  :  { tid: { items:[], at } }   (뉴스레터·뉴스 타일용 기사 목록)
     ============================================================ */
  let LIVE = null;                 // { base } — 연결되면 채워짐
  let liveLoadingStarted = false;  // 최초 로드 kick 1회만
  const livePayload = {};          // 타일 데이터
  /* 저장 시점에 코드 패치(BPatch)의 데이터 변환을 1회 적용한다 — 렌더가 반복 적용되지 않도록 여기서만. */
  function setLivePayload(tid, p){
    const t = state.topics.find(x => x.id === tid);
    livePayload[tid] = (t && p && p.status === 'ok' && window.BPatch && window.BPatch.applyData) ? window.BPatch.applyData(t, p) : p;
  }
  const liveFeed = {};             // 관심사별 실시간 기사
  const liveLock = {};             // 동시 fetch 방지
  async function liveBase(){
    if (LIVE) return LIVE;
    // 1) 네이티브/호스트 모드
    const h = window.__BRIEFING_HOST__;
    if (h && h.apiBase) { LIVE = { base: String(h.apiBase).replace(/\/+$/, '') }; return LIVE; }
    // 2) 사용자 지정 API 서버 주소 (설정에 등록된 경우)
    if (state.customApiBase) {
      try {
        const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 2000);
        const r = await fetch(state.customApiBase.replace(/\/+$/, '') + '/api/health', { signal: ctl.signal, cache: 'no-store' });
        clearTimeout(t);
        if (r.ok){
          LIVE = { base: state.customApiBase.replace(/\/+$/, '') };
          if (!h) window.__BRIEFING_HOST__ = { apiBase: LIVE.base, web: true };
          return LIVE;
        }
      } catch (e) {}
    }
    // 3) http(s) 서빙(미니 라이브 서버/개발) — location.origin 확인
    if (location.protocol === 'http:' || location.protocol === 'https:'){
      const base = location.origin;
      try {
        const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 2000);
        const r = await fetch(base + '/api/health', { signal: ctl.signal, cache: 'no-store' });
        clearTimeout(t);
        if (r.ok){
          LIVE = { base };
          if (!h) window.__BRIEFING_HOST__ = { apiBase: base, web: true };
          return LIVE;
        }
      } catch (e) {}
    }
    // 4) 로컬 컴패니언 서버 (GitHub Pages / 외부 웹 배포 시 PC의 localhost:8420 자동 탐색)
    if (location.hostname !== 'localhost' && location.hostname !== '127.0.0.1'){
      try {
        const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 1200);
        const r = await fetch('http://127.0.0.1:8420/api/health', { signal: ctl.signal, cache: 'no-store' });
        clearTimeout(t);
        if (r.ok){
          LIVE = { base: 'http://127.0.0.1:8420' };
          if (!h) window.__BRIEFING_HOST__ = { apiBase: 'http://127.0.0.1:8420', web: true };
          return LIVE;
        }
      } catch (e) {}
    }
    return null;
  }
  async function apiGet(path){
    const b = await liveBase();
    if (!b) throw new Error('no-live');
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 25000);
    try {
      const r = await fetch(b.base + path, { signal: ctl.signal, cache: 'no-store' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return await r.json();
    } finally { clearTimeout(t); }
  }
  async function apiPost(path, body){
    const b = await liveBase();
    if (!b) throw new Error('no-live');
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 40000);
    try {
      const r = await fetch(b.base + path, { method: 'POST', signal: ctl.signal, cache: 'no-store',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
      const j = await r.json().catch(() => ({ ok: false, error: 'HTTP ' + r.status }));
      return j;
    } finally { clearTimeout(t); }
  }
  const TOPIC_LOCK = {};
  function topicKey(t){ return (t && (t.key || (t.cfg && t.cfg.key))) || (t && t.id) || (t && t.label) || ''; }
  function labelOf(t){ return String(t.label || '').trim() || String(t.key || ''); }
  function quoteKind(rk, ck){
    if (rk && ['coin','stock','fx'].includes(rk)) return rk;
    if (ck === 'fx') return 'fx';
    return ck === 'stock' ? 'stock' : 'coin';
  }

  async function loadTopicPayload(t, opts){
    opts = opts || {};
    const tid = t.id;
    const isSingle = !!opts.single;
    const isFresh = !!opts.fresh;
    const key = encodeURIComponent(topicKey(t));
    const lbl = encodeURIComponent(labelOf(t));
    const kind = t.kind;
    const lockId = tid + (isFresh ? ':f' : '');
    if (liveLock[lockId]) return liveLock[lockId];
    liveLock[lockId] = (async () => {
      try {
        if (!opts.background){
          setLivePayload(tid, { status: 'loading', kind, data: null });
          rerenderTile(tid);
        }
        const b = await liveBase();
        if (!b){ setLivePayload(tid, { status: 'off', kind, data: null }); rerenderTile(tid); return; }
        if (kind === 'personal'){
          setLivePayload(tid, { status: 'ok', kind: 'personal', data: {} });
          rerenderTile(tid); return;
        }
        const freshQ = isFresh ? '&fresh=1&force=1&_t=' + Date.now() : '';
        const interestNeeded = kind !== 'news';
        const resp = interestNeeded
          ? await apiGet('/api/live/interest?topic=' + key + '&label=' + lbl + '&kind=' + kind + freshQ)
          : await apiGet('/api/live/news?topic=' + key + '&label=' + lbl + (isFresh ? '&fresh=1&force=1&_t=' + Date.now() : '&seen=0'));
        if (!resp || resp.ok === false) throw new Error((resp && resp.error) || 'empty');
        if (Array.isArray(resp.items)){                        // 뉴스(항목) 응답
          const items = (resp.items || []).map(it => ({ ...it, rss: true, ago: D.$U.ago(it.pub), link: it.link || it.url }));
          setLivePayload(tid, { status: 'ok', kind: 'news', data: { items }, cadence: resp.cadence, noNew: resp.noNew, at: Date.now() });
          if (items.length) liveFeed[tid] = { items, at: Date.now() };
        } else if (resp.quote){                                // 시세(코인/주식/환율)
          setLivePayload(tid, { status: 'ok', kind: quoteKind(resp.kind, kind), data: resp.quote, cadence: resp.cadence, at: Date.now() });
          if (t.brief){
            try {
              const n = await apiGet('/api/live/news?topic=' + key + '&label=' + lbl + freshQ);
              if (n && n.items) liveFeed[tid] = { items: n.items.map(it => ({ ...it, rss: true, ago: D.$U.ago(it.pub), link: it.link || it.url })), at: Date.now() };
            } catch (e) {}
          }
        } else if (resp.sport){                                // 스포츠 — F1/축구/야구/순위/최다득점
          setLivePayload(tid, { status: 'ok', kind: 'sport', data: resp.sport, note: resp.note || '', cadence: resp.cadence, at: Date.now() });
        } else if (resp.weather){                              // 날씨
          livePayload[tid] = { status: 'ok', kind: 'weather', data: resp.weather, cadence: resp.cadence, at: Date.now() };
          if (resp.weather && (resp.weather.code != null || resp.weather.precip != null)){ seoulWx = resp.weather; seoulWxAt = Date.now(); renderWxStrip(); applyAmbience(true); }
        } else {
          livePayload[tid] = { status: 'error', kind, data: null };
        }
      } catch (e) {
        livePayload[tid] = { status: (await liveBase()) ? 'error' : 'off', kind, data: null, err: ((e && e.name) ? e.name + ': ' : '') + String((e && e.message) || e) + ' @' + String((e && e.stack || '').split('\n')[1] || '').trim().slice(0,80) };
      } finally {
        delete liveLock[lockId];
        rerenderTile(tid);
        // 단일 관심사 새로고침(isSingle)일 때는 브리핑 레일을 건드리지 않는다 — 전체 새로고침 때만 브리핑 동기화
        if (!isSingle) rerenderBriefSafe();
      }
    })();
    return liveLock[lockId];
  }
  async function ensureAllTopics(fresh){
    await Promise.allSettled(state.topics.map(t => loadTopicPayload(t, { fresh }).catch(() => {})));
  }
  function payloadOf(t){ return livePayload[t.id] || (LIVE ? { status: 'loading', kind: t.kind, data: null } : { status: 'off', kind: t.kind, data: null }); }
  function feedOf(t){
    if (liveFeed[t.id] && liveFeed[t.id].items) return liveFeed[t.id].items;
    const p = livePayload[t.id];
    if (p && p.status === 'ok' && p.kind === 'news') return (p.data && p.data.items) || [];
    return [];
  }

  /* 관심없음 → 이 관심사의 “지금 새 기사”를 실시간 수집해 맨 앞에 놓는다 */
  async function fetchFreshForTopic(t){
    const key = encodeURIComponent(topicKey(t));
    const lbl = encodeURIComponent(labelOf(t));
    const exclude = (state.mutedIds || []).concat((liveFeed[t.id] && liveFeed[t.id].items || []).map(i => i.id)).filter(Boolean).join(',');
    let items = [];
    try {
      const resp = await apiGet('/api/live/news?topic=' + key + '&label=' + lbl + '&exclude=' + exclude + '&fresh=1');
      items = (resp && resp.items) || [];
    } catch (e) {}
    // 없으면 기존 피드 중 안 본 것 재사용
    const cur = feedOf(t);
    const next = items.length ? items : cur.filter(i => !(state.mutedIds || []).includes(i.id));
    if (next.length){
      liveFeed[t.id] = { items: next.map(i => ({ ...i, rss: true, ago: D.$U.ago(i.pub) })), at: Date.now() };
    } else {
      delete liveFeed[t.id];
    }
    return liveFeed[t.id] ? liveFeed[t.id].items : [];
  }

  /* --- 타일 부분 갱신 (전체 재렌더 없이) --- */
  let _rerenderScheduled = false;
  function rerenderTile(tid){
    const t = state.topics.find(x => x.id === tid);
    if (!t) return;
    const wrap = document.querySelector('#topicTiles');
    if (!wrap) return;
    const el = wrap.querySelector('[data-tid]');
    const tileEl = Array.from(wrap.querySelectorAll('.tile')).find(x => (x.getAttribute('data-tid') || '') === String(tid));
    if (tileEl){ tileEl.outerHTML = D.buildTileHTML(t, payloadOf(t)); bindTileEvents(t.id); }
  }
  function rerenderBriefSafe(){
    // 여러 비동기 완료가 겹쳐도 최종 1회만 브리핑을 다시 그린다
    if (_rerenderScheduled) return;
    _rerenderScheduled = true;
    setTimeout(() => { _rerenderScheduled = false; try { renderBrief(false); } catch (e) {} }, 80);
  }

  /* ============================================================
     위젯 2 : 관심사 — 카드 + 바로 추가 바 (AI가 종류 판단)
     ============================================================ */
  /* 위젯 2 : 관심사 현황 — 등록된 모든 관심사를 실제 데이터 타일로 표시.
     뉴스형(맨시티·비트코인 등)은 각 관심사의 실시간 새 소식을,
     숫자형은 (데모가 아니면) ‘연동 전’ 안내를 보여준다 — 가짜 수치 금지. */
  function bindTileEvents(tid){
    const root = document.querySelector('#topicTiles .tile[data-tid="' + tid + '"]');
    if (!root) return;
    const t = state.topics.find(x => x.id === tid);
    const eb = root.querySelector('.tile-edit');
    if (eb) eb.onclick = () => openTopicEditor(tid);
    const rb = root.querySelector('.tile-refresh');
    if (rb && t){
      rb.onclick = async (ev) => {
        ev.stopPropagation();
        rb.classList.add('spinning');
        try {
          await loadTopicPayload(t, { fresh: true, single: true });
          const p = payloadOf(t);
          let msg = `${t.label} — 최신 데이터를 불러왔어요.`;
          if (p && p.status === 'ok' && p.data){
            const d = p.data;
            if (p.kind === 'stock' || p.kind === 'coin'){
              const up = (d.chgPct || 0) >= 0;
              const sign = up ? '▲' : '▼';
              msg = `${t.label} ${D.$U.fmt(d.price)}원 (${sign}${Math.abs(d.chgPct || 0).toFixed(2)}%) · 최신 시세 반영`;
            } else if (p.kind === 'fx'){
              const up = (d.chgPct || 0) >= 0;
              msg = `${t.label} ${d.price}원 (${up?'▲':'▼'}${Math.abs(d.chgPct||0).toFixed(2)}%) · ${d.cadence==='realtime'?'실시간 호가':'기준환율'} 반영`;
            } else if (p.kind === 'sport'){
              if (d.discipline === 'motorsport' && d.leader){
                msg = `${t.label} — 선두 ${d.leader.name} (${d.leader.points}점) · 다음 ${d.next ? d.next.name : '일정'}`;
              } else if (d.honors && d.honors[0]){
                msg = `${t.label} — ${d.honors[0].title}: ${d.honors[0].name} (${d.honors[0].value})`;
              } else if (d.next){
                msg = `${t.label} — 다음 경기 ${d.next.when || ''} @ ${d.next.venue || ''}`;
              }
            } else if (p.kind === 'news'){
              const items = d.items || [];
              msg = `${t.label} — 최신 기사 ${items.length}건을 확인했어요.`;
            }
          }
          toast({ t: `${t.label} 새로고침 완료`, m: msg, ic: 'i-check', g: ['#22c55e', '#3b82f6'], ms: 2400 });
        } catch (e) {
          toast({ t: `${t.label} 새로고침 실패`, m: '일시적 연결 오류입니다. 잠시 후 다시 시도해 주세요.', ic: 'i-x', ms: 2200 });
        } finally {
          rb.classList.remove('spinning');
        }
      };
    }
  }
  /* ============ 아이폰 스타일 관심사 드래그 앤 드롭 (순서 재배치) ============ */
  function enableTopicTileDragAndDrop(){
    const list = document.querySelector('#topicTiles .mlist');
    if (!list) return;

    list.onpointerdown = (e) => {
      // 버튼 클릭(새로고침, 편집 등) 및 링크는 드래그 시작에서 제외
      if (e.target.closest('button, .icon-btn, input, a')) return;

      const tile = e.target.closest('.tile');
      if (!tile || !tile.dataset.tid) return;

      const startX = e.clientX;
      const startY = e.clientY;
      let isDragging = false;
      let placeholder = null;
      let offsetX = 0;
      let offsetY = 0;
      let initialRect = null;
      const tid = tile.dataset.tid;

      const onPointerMove = (ev) => {
        const dx = ev.clientX - startX;
        const dy = ev.clientY - startY;

        if (!isDragging) {
          // 4px 이상 이동 시 드래그 모드 활성화 (아이폰 햅틱/리프트 효과)
          if (Math.hypot(dx, dy) < 4) return;
          isDragging = true;

          initialRect = tile.getBoundingClientRect();
          offsetX = startX - initialRect.left;
          offsetY = startY - initialRect.top;

          // 플레이스홀더 생성
          placeholder = document.createElement('div');
          placeholder.className = 'tile-placeholder';
          placeholder.style.width = initialRect.width + 'px';
          placeholder.style.height = initialRect.height + 'px';

          // 타일을 최상위 레이어로 띄움
          tile.classList.add('is-dragging');
          tile.style.width = initialRect.width + 'px';
          tile.style.height = initialRect.height + 'px';
          tile.style.left = (ev.clientX - offsetX) + 'px';
          tile.style.top = (ev.clientY - offsetY) + 'px';

          tile.parentNode.insertBefore(placeholder, tile);
          document.body.appendChild(tile);
          list.classList.add('is-reordering');
        }

        if (isDragging) {
          tile.style.left = (ev.clientX - offsetX) + 'px';
          tile.style.top = (ev.clientY - offsetY) + 'px';

          // 마우스 위치에 따른 타일 교체 위치 탐색
          const elemBelow = document.elementFromPoint(ev.clientX, ev.clientY);
          const targetTile = elemBelow && elemBelow.closest('.mlist .tile:not(.is-dragging)');

          if (targetTile && targetTile.parentNode === list) {
            const targetRect = targetTile.getBoundingClientRect();
            const isAfter = (ev.clientY > targetRect.top + targetRect.height / 2) || (ev.clientX > targetRect.left + targetRect.width / 2);
            if (isAfter) {
              list.insertBefore(placeholder, targetTile.nextSibling);
            } else {
              list.insertBefore(placeholder, targetTile);
            }
          }
        }
      };

      const onPointerUp = (ev) => {
        window.removeEventListener('pointermove', onPointerMove);
        window.removeEventListener('pointerup', onPointerUp);
        window.removeEventListener('pointercancel', onPointerUp);

        if (!isDragging) return;

        list.classList.remove('is-reordering');

        if (placeholder && placeholder.parentNode === list) {
          const pRect = placeholder.getBoundingClientRect();
          tile.style.transition = 'all 0.22s cubic-bezier(0.2, 0.8, 0.2, 1)';
          tile.style.left = pRect.left + 'px';
          tile.style.top = pRect.top + 'px';
          tile.style.transform = 'scale(1) rotate(0deg)';

          setTimeout(() => {
            tile.classList.remove('is-dragging');
            tile.style.position = '';
            tile.style.zIndex = '';
            tile.style.width = '';
            tile.style.height = '';
            tile.style.left = '';
            tile.style.top = '';
            tile.style.transform = '';
            tile.style.boxShadow = '';
            tile.style.opacity = '';
            tile.style.pointerEvents = '';
            tile.style.transition = '';

            list.insertBefore(tile, placeholder);
            placeholder.remove();

            // DOM 상의 새로운 타일 순서로 state.topics 동기화
            const newOrderTids = [...list.querySelectorAll('.tile')].map(el => el.dataset.tid).filter(Boolean);
            const topicMap = new Map(state.topics.map(t => [t.id, t]));
            const reordered = [];
            newOrderTids.forEach(id => {
              const item = topicMap.get(id);
              if (item) { reordered.push(item); topicMap.delete(id); }
            });
            topicMap.forEach(item => reordered.push(item));

            const orderChanged = reordered.some((t, i) => t.id !== state.topics[i]?.id);
            if (orderChanged) {
              state.topics = reordered;
              save();
              drawBrief(); // 뉴스레터 브리핑 카드 순서도 동기화
              toast({ t: '관심사 순서 변경', m: '관심사 및 뉴스레터 순서를 새 위치로 저장했어요.', ic: 'i-spark', ms: 1600 });
            }
          }, 220);
        } else {
          tile.classList.remove('is-dragging');
          if (placeholder) placeholder.remove();
        }
      };

      window.addEventListener('pointermove', onPointerMove);
      window.addEventListener('pointerup', onPointerUp);
      window.addEventListener('pointercancel', onPointerUp);
    };
  }

  function renderTopics(){
    const wrap = $('#topicTiles');
    const total = state.topics.length;
    $('#topicCount').textContent = total;                 // 헤더 칩: 전체 관심사 수

    if (!total){
      wrap.innerHTML = `<div class="empty-guide fadeUp">
        ${ic('i-star',30)}
        <div class="eg-title">관심사를 등록해 보세요</div>
        <span class="muted" style="font-size:11px">예: 맨시티 · 비트코인 · 마인크래프트 · 조류 — 각 관심사의 <b>실시간 데이터</b>가 타일·뉴스레터에 표시돼요.</span>
        <button class="btn primary" id="topicsEmptyEdit" style="margin-top:12px">${ic('i-plus',13)} 관심사 추가</button>
      </div>`;
      $('#topicsEmptyEdit').onclick = openTopicsManage;
      return;
    }

    // 즉시: 현재 payload 상태로 렌더(로딩 스켈레톤/연결 안내 포함) → 비동기 로드 시작
    const tilesHtml = state.topics.map(t => D.buildTileHTML(t, payloadOf(t))).join('');
    wrap.innerHTML = `<div class="mlist">${tilesHtml}</div>`;
    state.topics.forEach(t => bindTileEvents(t.id));
    enableTopicTileDragAndDrop();
    kickLoads();
  }
  function kickLoads(){
    if (liveLoadingStarted) return;
    liveLoadingStarted = true;
    state.topics.forEach(t => { if (!livePayload[t.id]) loadTopicPayload(t, {}); });
    ensureSeoulWeather();
  }

  /* AI가 관심사 종류를 판단 → 실제 데이터가 박힌 카드 시안 3종을 먼저 보여주고 추가 */
  function addTopicSmart(label){
    openTopicEditor(null, label);
  }

  /* 관심사 추가/편집 — 이름 → AI 분류 + “실데이터가 박힌” 시안 3종(a·b·c) → 선택 후 확정.
     수치형(코인·주식)은 서버에 연결돼 있으면 실제 시세·등락·스파크를 시안에 박는다.
     개인형은 가짜 수치 없이 ‘연결 필요’ 안내를 실물 그대로 보여준다. */
  function openTopicEditor(tid, prefillLabel){
    const topic = state.topics.find(x => x.id === tid);
    const editing = !!topic;
    const t = topic || { id:null, label:'', kind:'news', cfg:{} };
    const kindKeys = Object.keys(K);
    let cur = t.kind;
    let curLabel = t.label || prefillLabel || '';
    let curBrief = topic ? topic.brief !== false : true;   // “TODAY'S BRIEFING 포함” 스위치 (기본 ON)
    let selTpl = bestTplOf(cur, curLabel);                // 기본 시안
    let kindTouched = !!topic;
    let tplTouched = !!(topic && t.tpl);
    if (!editing && prefillLabel && prefillLabel.trim() && !kindTouched && !tplTouched){
      const c0 = D.classifyLabel(prefillLabel);           // AI 1차 분류: kind 문자열 반환
      if (c0) cur = c0;
      curLabel = prefillLabel.trim();
      selTpl = bestTplOf(cur, curLabel);
    }
    function kindChips(k){
      return `<div class="kind-pick">${kindKeys.map(kk => `<button data-k="${kk}" class="${kk===k?'on':''}">${K[kk].label}</button>`).join('')}</div>`;
    }
    const TPL_NM = { a:'대표 카드', b:'더 넓은 뷰', c:'컴팩트' };
    function tplButtons(){
      const km = K[cur] || K.news;
      return ['a','b','c'].map(tpl => `
        <button data-tpl="${tpl}" class="tpl-pick ${tpl===selTpl?'sel':''}" style="--c1:${km.c1};--c2:${km.c2}">
          <b>시안 ${tpl.toUpperCase()}</b><span>${TPL_NM[tpl]}</span></button>`).join('');
    }
    /* 미리보기 전용: 시안에 박을 실데이터 캐시(같은 이름 동안 재사용) */
    let previewData = null, previewKey = '';
    function previewNow(){
      const label = curLabel.trim() || (K[cur].label + ' 카드');
      const tp = { id:'_preview', label, kind: cur, tpl: selTpl, brief:true };
      const matched = state.topics.find(x => (x.label || '').trim().toLowerCase() === label.toLowerCase() && livePayload[x.id] && livePayload[x.id].status === 'ok');
      let payload = { status:'off', kind: cur, data: null };
      if (LIVE){
        payload = (cur === 'personal')
          ? { status:'ok', kind:'personal', data:{} }
          : (matched ? livePayload[matched.id] : { status:'loading', kind: cur, data: null });
      } else if (cur === 'personal') payload = { status:'ok', kind:'personal', data:{} };
      if (previewData && previewKey === label.toLowerCase() + '|' + cur) payload = previewData;
      return { tp, payload };
    }
    function safeTile(tp, payload){
      try { return D.buildTileHTML(tp, payload); }
      catch (e) { return '<div class="muted">미리보기를 만들 수 없어요.</div>'; }
    }
    function refreshPreview(){
      try {
        const box = $('#tpPreview');
        if (!box) return;
        const { tp, payload } = previewNow();
        const keyNow = String(curLabel || '').trim().toLowerCase() + '|' + cur;
        box.innerHTML = `<div class="prow">${safeTile(tp, payload)}<span class="plabel">${ic('i-eye',11)} 실제 데이터로 미리보기 — 아래에서 시안 선택</span></div>`;
        const eb = box.querySelector('.tile-edit');
        if (eb) eb.style.display = 'none';
        const showData = (p2) => { if (box.isConnected){ previewData = p2; previewKey = keyNow;
          const t2 = previewNow().tp; box.innerHTML = `<div class="prow">${safeTile(t2, p2)}<span class="plabel">${ic('i-eye',11)} 실제 데이터로 미리보기</span></div>`; } };
        if (LIVE && previewData && previewKey === keyNow){ showData(previewData); return; }
        clearTimeout(_pvTimer);
        _pvTimer = setTimeout(() => { previewLoad(tp).then(showData); }, 450);
      } catch (e) {}
    }
    let _pvTimer = null;
    /* 미리보기 전용 실데이터 1회 로드 (수치=interest / 뉴스=news) — 실패 시 조용히 유지 */
    async function previewLoad(tp){
      try {
        const key = encodeURIComponent(topicKey(tp));
        const lbl = encodeURIComponent(labelOf(tp));
        if (cur === 'personal') return { status:'ok', kind:'personal', data:{} };
        const r = cur === 'news'
          ? await apiGet('/api/live/news?topic=' + key + '&label=' + lbl)
          : await apiGet('/api/live/interest?topic=' + key + '&label=' + lbl + '&kind=' + cur);
        if (!r || r.ok === false) throw new Error((r && r.error) || 'empty');
        if (Array.isArray(r.items)) return { status:'ok', kind:'news', data:{ items: r.items.map(it => ({ ...it, ago: D.$U.ago(it.pub), link: it.link || it.url })) } };
        if (r.quote) return { status:'ok', kind:quoteKind(r.kind, cur), data:r.quote };
        if (r.weather) return { status:'ok', kind:'weather', data:r.weather };
        if (r.sport) return { status:'ok', kind:'sport', data:r.sport };
      } catch (e) {}
      return { status: LIVE ? 'loading' : 'off', kind:cur, data:null };
    }
    function refreshUI(){
      const pk = $('#tpKind'); if (pk) pk.innerHTML = kindChips(cur);
      const tb = $('#tpTpls'); if (tb) tb.innerHTML = tplButtons();
      refreshPreview();
    }
    function aiHintRow(){
      const ck = D.classifyLabel(curLabel);
      const kind = K[ck] || K.news;
      return `<div class="m-sub" style="display:flex;gap:6px;align-items:center;color:var(--ink-2)" id="aiHintRow">
        ${ic('i-spark',12)} <span><b>AI 분류:</b> <span style="color:${kind.c1};font-weight:800">${D.$U.esc(kind.label)}</span>${ck==='news' ? ' — 실시간 소식·트렌드 카드로 구성해요.' : ''}</span></div>`;
    }
    openModal({
      title: editing ? '관심사 카드 설정' : '관심사 추가 — 시안 선택', ic:'i-star', wide:true,
      body:`<div class="field"><label>이름</label><input class="textin" id="tpLabel" value="${D.$U.esc(curLabel)}" placeholder="예: 맨시티, 비트코인, 마인크래프트, 조류, 서울 날씨, 걷기…" autocomplete="off"/></div>
            ${aiHintRow()}
            <div class="field"><label>종류</label><div id="tpKind">${kindChips(cur)}</div></div>
            <div class="field"><label>표시 형태 — 완성형 시안 3종</label><div class="tpl-row" id="tpTpls">${tplButtons()}</div>
              <div class="m-sub" style="margin-top:4px">${ic('i-spark',11)} 이름만 적어도 AI가 종류를 판단해요. 시안은 실제 데이터를 끼워 보여줍니다. — 아래 미리보기에서 <b>실물 확인 후 선택</b>하세요.</div></div>
                        <div class="rowitem"><div class="ri-t"><b>TODAY'S BRIEFING 포함</b><span>이 관심사의 소식이 뉴스레터 레일에 등장해요</span></div>
              <button class="switch ${curBrief?'on':''}" id="tpBrief"></button></div>
<div class="field"><label>실제 카드 미리보기</label><div class="tile-preview" id="tpPreview">${(() => { try { const t = previewNow(); return safeTile(t.tp, t.payload); } catch (e) { return ''; } })()}</div></div>`,
      foot: editing ? `<button class="btn" data-del style="color:var(--bad)">삭제</button><div style="flex:1"></div><button class="btn" data-c>취소</button><button class="btn primary" id="tpSave">저장</button>`
                   : `<button class="btn" data-c>취소</button><button class="btn primary" id="tpSave">추가</button>`
    });
    const nameInput = $('#tpLabel');
    function aiReflow(){
      if (kindTouched || tplTouched) return;
      const ck = D.classifyLabel(curLabel);
      if (ck) cur = ck;
      if (!kindTouched) selTpl = bestTplOf(cur, curLabel);
      const tb = $('#tpTpls'); if (tb) tb.innerHTML = tplButtons();
      const pk = $('#tpKind'); if (pk) pk.innerHTML = kindChips(cur);
      refreshPreview();
    }
    nameInput.addEventListener('input', e => {
      curLabel = e.target.value;
      const hint = $('#aiHintRow');
      if (hint) hint.outerHTML = aiHintRow();
      if (!kindTouched && !tplTouched) aiReflow();
      refreshPreview();
    });
    $('#tpKind').addEventListener('click', e => {
      const b = e.target.closest('button[data-k]'); if(!b) return;
      kindTouched = true;
      cur = b.dataset.k;
      selTpl = bestTplOf(cur, curLabel);
      refreshUI();
    });
    $('#tpTpls').addEventListener('click', e => {
      const b = e.target.closest('button[data-tpl]'); if(!b) return;
      tplTouched = true;
      selTpl = b.dataset.tpl;
      $$('#tpTpls .tpl-pick').forEach(x => x.classList.toggle('sel', x === b));
      refreshPreview();
    });
    refreshPreview();
    const delBtn = $('[data-del]');
    const briefSw = $('#tpBrief');
    if (briefSw) briefSw.onclick = () => { curBrief = !curBrief; briefSw.classList.toggle('on', curBrief); };
    $('#tpSave').onclick = () => {
      const label = curLabel.trim() || (K[cur].label + ' 카드');
      const isNew = !editing;
      if (editing){
        t.label = label; t.kind = cur; t.tpl = selTpl; t.brief = curBrief; t.interest = label;
        if (!t.key) t.key = topicKey(t);
      } else {
        pushUndo();
        const nt = { id: D.$U.uid('t'), label, kind: cur, tpl: selTpl, brief: curBrief, interest: label };
        state.topics.push(nt);
        state._justAdded = nt.id;
      }
      save(); closeModal(); decideGrid(); render(); renderTopics(); renderBrief(false);
      loadTopicPayload(state.topics.find(x=>x.id===(editing?t.id:state._justAdded)), {});
      pushLog(`관심사 <b>${D.$U.esc(label)}</b> ${isNew?'추가':'저장'} (${K[cur].label} · 시안 ${selTpl.toUpperCase()})`);
      toast({ t: isNew ? '추가됨' : '저장됨', m: `${label} — ${K[cur].label} 카드로 표시돼요.`, ic:'i-check', g:[K[cur].c1, K[cur].c2] });
      if (!isNew) state._justAdded = null;
    };
    if (delBtn) delBtn.onclick = () => {
      state.topics = state.topics.filter(x => x.id !== t.id);
      save(); closeModal(); decideGrid(); render(); renderTopics(); renderBrief(false);
      pushLog(`관심사 <b>${D.$U.esc(t.label)}</b> 제거`);
      toast({ t:'제거됨', m:`${t.label} 카드를 삭제했어요.`, ic:'i-x', g:['#94a3b8','#cbd5e1'] });
    };
  }


    /* 관심사 일괄 관리 (헤더 버튼) */
  function manageRowHTML(){
    return state.topics.map(t => `
      <div class="rowitem" data-tid="${D.$U.esc(t.id)}">
        <span class="row-drag-handle" title="드래그하여 순서 변경">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><circle cx="8" cy="6" r="1.8"/><circle cx="16" cy="6" r="1.8"/><circle cx="8" cy="12" r="1.8"/><circle cx="16" cy="12" r="1.8"/><circle cx="8" cy="18" r="1.8"/><circle cx="16" cy="18" r="1.8"/></svg>
        </span>
        <div class="wd-dot" style="width:30px;height:30px;border-radius:9px;background:linear-gradient(135deg,${K[t.kind].c1},${K[t.kind].c2})">${ic(K[t.kind].icon,13)}</div>
        <div class="ri-t"><b>${D.$U.esc(t.label)}</b><span>${K[t.kind].label} · 시안 ${String(t.tpl||'a').toUpperCase()}</span></div>
        <button class="btn ghost" data-e="${t.id}">카드 설정</button>
        <button class="btn ghost" data-x="${t.id}" style="color:var(--bad)">삭제</button>
      </div>`).join('') || '<div class="m-sub">등록된 관심사가 없습니다. 아래에서 추가해 보세요.</div>';
  }
  function bindManageRowDnd(){
    const rowset = document.querySelector('#modalBox .rowset');
    if (!rowset) return;
    let dragRow = null;
    rowset.onpointerdown = (e) => {
      if (e.target.closest('button, input, a')) return;
      const row = e.target.closest('.rowitem');
      if (!row || !row.dataset.tid) return;
      let startY = e.clientY;
      let dragging = false;
      const onMove = (ev) => {
        if (!dragging && Math.abs(ev.clientY - startY) > 4){
          dragging = true;
          dragRow = row;
          row.classList.add('is-dragging');
        }
        if (dragging){
          const elem = document.elementFromPoint(ev.clientX, ev.clientY);
          const target = elem && elem.closest('.rowset .rowitem');
          if (target && target !== row && target.parentNode === rowset){
            const rect = target.getBoundingClientRect();
            if (ev.clientY > rect.top + rect.height/2){
              rowset.insertBefore(row, target.nextSibling);
            } else {
              rowset.insertBefore(row, target);
            }
          }
        }
      };
      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onUp);
        if (dragging){
          row.classList.remove('is-dragging');
          const newOrder = [...rowset.querySelectorAll('.rowitem')].map(r => r.dataset.tid).filter(Boolean);
          const topicMap = new Map(state.topics.map(t => [t.id, t]));
          const reordered = [];
          newOrder.forEach(id => { const item = topicMap.get(id); if (item) { reordered.push(item); topicMap.delete(id); } });
          topicMap.forEach(item => reordered.push(item));
          state.topics = reordered;
          save();
          renderTopics();
          drawBrief();
          toast({ t: '순서 저장', m: '관심사 순서를 변경했어요.', ic: 'i-spark', ms: 1400 });
        }
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onUp);
    };
  }

  function openTopicsManage(){
    const rows = manageRowHTML();
    openModal({
      title:'내 관심사 관리', ic:'i-star',
      body:`<div class="rowset">${rows}</div>
            <div style="display:flex;gap:7px;margin-top:10px">
              <input class="textin" id="mqLabel" placeholder="관심사 입력 — 예: 맨시티, 비트코인, 마인크래프트, 조류…" autocomplete="off"/>
              <button class="btn primary" id="mqAdd" style="flex:0 0 auto;white-space:nowrap">${ic('i-spark',13)} AI 분류 → 시안 고르고 추가</button>
            </div>
            <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-top:8px"><span class="kicker">추천 (한 번에 추가)</span>
              ${Lg.TOPIC_SUGGESTIONS.map(sn => `<button class="fh" data-add="${D.$U.esc(sn.label)}">${D.$U.esc(sn.label)}</button>`).join('')}
            </div>
            <div class="m-sub" style="font-size:11px">${ic('i-spark',11)} 입력하면 AI가 종류를 분류해 <b>실데이터가 박힌 시안 3종</b>을 먼저 보여줘요. 직접 고른 시안으로 추가됩니다. 연결 전 숫자형은 가짜 수치 없이 ‘연결 필요’만 표시돼요.</div>`,
      foot:`<button class="btn" data-c>닫기</button>`
    });
    bindManageRowDnd();
    $$('.rowitem [data-e]').forEach(b=>b.onclick=()=>{ closeModal(); openTopicEditor(b.dataset.e); });
    $$('.rowitem [data-x]').forEach(b=>b.onclick=()=>{
      const t = state.topics.find(x=>x.id===b.dataset.x);
      if (!t) return;
      state.topics = state.topics.filter(x=>x.id!==b.dataset.x);
      pushLog(`관심사 <b>${D.$U.esc(t.label)}</b> 제거`);
      save(); closeModal(); decideGrid(); render(); renderBrief(false);
    });
    $('#mqAdd').onclick = () => {
      const label = $('#mqLabel').value.trim();
      if (!label) return;
      closeModal();
      openTopicEditor(null, label);   // AI 분류 + 실데이터 시안 3종 → 사용자가 선택 후 추가
    };
    $('#mqLabel').addEventListener('keydown', e => { if (e.key==='Enter') $('#mqAdd').click(); });
    $$('#modalBox [data-add]').forEach(b=>b.onclick=()=>{ const label = b.dataset.add; closeModal(); addTopicSmart(label); });
  }
  /* ============================================================
     위젯 3 : TODAY'S BRIEFING — “라이브 레일”
     등록 관심사마다 그 실시간 소스에서 가져온 최신 항목 1건씩.
     - 뉴스·시세 관심사: 최신 기사 카드 (시세형은 현재가 칩 동봉)
     - 날씨: 오늘 날씨 브리핑 카드      - 개인형: ‘연결 필요’ 카드(가짜 수치 금지)
     “관심없음” → 그 관심사의 지금 새 기사를 실시간 재수집해 교체
     ============================================================ */
  function isWired(t){ return LIVE && t && t.kind !== 'personal'; }
  function currentItem(t){                       // 그 관심사의 “아직 안 읽은” 첫 기사 (관심없음·good! 제외)
    const feed = liveFeed[t.id];
    if (!feed || !feed.items) return null;
    const res = Lg.pickUnread(feed.items, state.mutedIds || [], state.readIds || [], t.id);
    t._readStat = { read: res.read || 0, total: res.total || 0 };
    return res.item || null;
  }
  function markRead(tid, id, on){
    if (!state.readIds) state.readIds = [];
    const k = Lg.readKey(tid, id), i = state.readIds.indexOf(k);
    if (on && i < 0){ state.readIds.push(k); if (state.readIds.length > 400) state.readIds = state.readIds.slice(-400); }
    if (!on && i >= 0) state.readIds.splice(i, 1);
  }
  function quoteChip(p, kind){
    if (!p || !p.data) return '';
    const d = p.data;
    if (kind === 'coin' || kind === 'stock' || kind === 'fx'){
      let price = d.priceText;
      if (!price && d.price != null) price = kind === 'fx'
        ? d.price.toLocaleString('ko-KR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
        : D.$U.fmt(d.price);
      if (!price) return '';
      const up = d.chgPct >= 0;
      const nm = kind === 'fx' ? ((d.name || '') + '·원') : '';
      return `<span class="qchip ${up?'up':'down'}"><b>${up?'▲':'▼'}</b> ${D.$U.esc(nm)} ${D.$U.esc(price)} <em>${Math.abs(d.chgPct||0).toFixed(2)}%</em></span>`;
    }
    return '';
  }
  function descLine(it, max){
    const raw = it.desc || it.summary || '';
    const one = raw.replace(/\s+/g,' ').trim();
    if (!one) return '';
    return D.$U.esc(one.length > max ? one.slice(0, max-1) + '…' : one);
  }
  function briefMeta(kind, t){
    return D.CAT_META[kind] || D.CAT_META.news;
  }
  function newsBriefCard(t, it, n, p){
    const meta = briefMeta(t.kind, t);
    const short = D.topicShort(t.label);
    const liked = (state.likes || []).some(l => l.id === it.id && l.tid === t.id);
    const bg = it.img ? `background-image:url('${D.$U.esc(it.img)}')` : '';
    const chip = quoteChip(p, t.kind);
    return `<article class="brief ${liked?'is-liked':''}" style="--c1:${meta.c[0]};--c2:${meta.c[1]};" data-tid="${D.$U.esc(t.id)}" data-id="${D.$U.esc(it.id)}">
      <div class="brief-media ${it.img?'hasimg':''}" style="${bg}">
        <span class="bm-glow"></span><span class="brief-no">${D.$U.pad(n)}</span>
        <span class="brief-chip"><span class="brief-cat">${ic(meta.icon,10)} ${D.$U.esc(short)}</span></span>
        ${it.img ? '' : `<span class="bm-ic">${ic(meta.icon,40)}</span>`}
      </div>
      <div class="brief-main">
        <div class="brief-cap"><span class="brief-meta muted">${D.$U.esc(it.src || '실시간 소스')} · ${it.ago || ''}</span>${(t._readStat && t._readStat.total > 1) ? `<span class="read-prog">읽음 ${t._readStat.read}/${t._readStat.total}</span>` : ''}${chip ? '<div style="margin-left:auto">' + chip + '</div>' : ''}</div>
        <div class="brief-title" data-a="open">${D.$U.esc(it.title)}</div>
        ${descLine(it, 120) ? `<div class="brief-why"><span>${descLine(it,120)}</span></div>` : ''}
      </div>
      <div class="brief-acts">
        <button class="mini-act" data-a="open" title="원문 열기">${ic('i-open',11)} 원문 보기</button>
        <button class="mini-act ok ${liked?'on':''}" data-a="like" title="관심있음 — 이 뉴스를 다 봤어요. 같은 관심사의 다음 뉴스를 가져옵니다">${ic('i-heart',11)} ${liked?'good! ✓':'good!'}</button>
        <button class="mini-act danger" data-a="mute" title="마음에 안 들어요 — 지금 새 기사를 실시간으로 가져와 교체해요">${ic('i-x',11)} 관심없음</button>
      </div>
    </article>`;
  }
  function weatherBriefCard(t, n){
    const p = payloadOf(t);
    const meta = briefMeta('weather', t);
    const d = (p && p.data) || {};
    const cond = d.cond || '확인 중';
    const icon = /비|눈|뇌|소나기/.test(cond) ? 'i-drop' : (/(흐림|구름)/.test(cond) ? 'i-sun' : 'i-sun');
    const chip = (p && p.status === 'ok' && d.max != null)
      ? `<span class="qchip">최고 ${Math.round(d.max)}° · 최저 ${Math.round(d.min != null ? d.min : 0)}°</span>` : '';
    return `<article class="brief is-weather" style="--c1:${meta.c[0]};--c2:${meta.c[1]};" data-tid="${D.$U.esc(t.id)}">
      <div class="brief-media"><span class="bm-glow"></span><span class="brief-no">${D.$U.pad(n)}</span>
        <span class="brief-chip"><span class="brief-cat">${ic(meta.icon,10)} ${D.$U.esc(D.topicShort(t.label))}</span></span>
        <span class="bm-ic" style="transform:none">${ic(icon,44)}</span></div>
      <div class="brief-main">
        <div class="brief-cap"><span class="brief-meta muted">실시간 기상 관측</span>${chip ? '<div style="margin-left:auto">' + chip + '</div>' : ''}</div>
        <div class="brief-title" style="cursor:default">${D.$U.esc(cond)}${d.t !== undefined ? ` · <b style="font-size:19px">${d.t}°</b>` : ''}</div>
        ${(p && p.status==='ok') ? `<div class="brief-why"><span>습도 ${d.humidity!==undefined?d.humidity+'%':'—'} · 바람 ${d.wind!==undefined?d.wind+'m/s':'—'} ${d.pm!==undefined?'· 미세먼지 '+d.pm:''}</span></div>` : `<div class="brief-why"><span>날씨 데이터를 불러오는 중이에요…</span></div>`}
      </div>
    </article>`;
  }
  /* 스포츠 브리핑 — 종목별(F1 vs 리그) 맞춤 4칸 그리드 + 1위/우승/최다득점/MVP 명예 배지 */
  function sportBriefCard(t, n, p){
    const meta = briefMeta('sport', t);
    const d = (p && p.status === 'ok' && p.data) || null;
    const no = `<span class="brief-chip"><span class="brief-cat">${ic(meta.icon, 10)} ${D.$U.esc(D.topicShort(t.label))}</span></span>`;
    if (!d){
      const loading = p && (p.status === 'loading' || p.status === 'off');
      return `<article class="brief is-sport" style="--c1:${meta.c[0]};--c2:${meta.c[1]};" data-tid="${D.$U.esc(t.id)}">
        <div class="brief-media"><span class="bm-glow"></span><span class="brief-no">${D.$U.pad(n)}</span>${no}
          <span class="bm-ic" style="transform:none">${ic('i-flag', 42)}</span></div>
        <div class="brief-main">
          <div class="brief-cap"><span class="brief-meta muted">${loading ? '실시간 경기 소스 연결 중' : '경기 소스 확인됨'}</span></div>
          <div class="brief-title" style="cursor:default">${D.$U.esc(D.topicShort(t.label))} — ${loading ? '일정을 불러오는 중' : '지금 예정된 경기가 없어요'}</div>
          <div class="brief-why"><span>${loading ? '리그·팀을 확인하면 킥오프 시각·구장·최근 결과가 이 카드에 표시됩니다.' : D.$U.esc((p && p.note) || '등록된 리그에 최근·예정 경기가 없어요.')}</span></div>
        </div>
      </article>`;
    }

    // F1 / 모터스포츠 브리핑
    if (d.discipline === 'motorsport'){
      const lead = d.leader, next = d.next, lr = d.lastRace;
      const dd = next ? Math.max(0, Math.ceil((next.ts - Date.now()) / 86400000 + 0.0001)) : null;
      const left = next ? D.durTxt(next.ts - Date.now()) : '';
      const pod0 = lr && lr.podium && lr.podium[0] ? lr.podium[0].driver.split(' ').pop() : '—';
      return `<article class="brief is-sport" style="--c1:${meta.c[0]};--c2:${meta.c[1]};" data-tid="${D.$U.esc(t.id)}">
        <div class="brief-media"><span class="bm-glow"></span><span class="brief-no">${D.$U.pad(n)}</span>${no}
          <span class="bm-ic" style="transform:none">${ic('i-flag', 42)}</span></div>
        <div class="brief-main">
          <div class="brief-cap"><span class="brief-meta muted">F1 세계선수권 · ${d.round ? d.round + 'R' : '2026'}</span>
            ${next ? `<span class="read-prog">${D.$U.esc(left)} 남음</span>` : ''}</div>
          <div class="brief-title" style="cursor:default">선두 <b>${lead ? D.$U.esc(lead.name) : '—'}</b> (${lead ? lead.points : 0}점) · 다음 ${next ? D.$U.esc(next.name) : '시즌 진행'}</div>
          <div class="sport-grid">
            <div class="sg"><span>다음 본선</span><b>${next ? D.$U.esc(next.when || '—') : '—'}</b></div>
            <div class="sg"><span>서킷</span><b>${next ? D.$U.esc(next.circuit || '—') : '—'}</b></div>
            <div class="sg"><span>직전 우승(포디엄)</span><b>1위 ${D.$U.esc(pod0)}</b></div>
            <div class="sg"><span>2위와 격차</span><b style="color:${K.sport.c1}">+${d.gap || 0}점 (잔여 ${d.roundsLeft || 0}R)</b></div>
          </div>
        </div>
        <div class="brief-acts"><button class="mini-act" data-a="edit">${ic('i-edit', 11)} 카드 설정</button></div>
      </article>`;
    }

    // 리그 종목 (축구 / 야구 / 농구) 브리핑
    const live = d.live, next = d.next;
    const team = d.team || D.topicShort(t.label);
    const honors = d.honors || [];
    const mainHonor = honors[0] || null;
    const stat = live
      ? { big: `${live.hs} - ${live.as}`, who: `${live.home} vs ${live.away}`, sub: (live.status || '진행 중'), venue: live.venue || d.homeGround || '—' }
      : next ? { big: 'D-' + Math.max(0, Math.ceil((next.ts - Date.now()) / 86400000 + 0.0001)), who: `${next.home} vs ${next.away}`, sub: next.when || '일정 미정', venue: next.venue || d.homeGround || '—' }
             : null;
    const left = next && !live ? D.durTxt(next.ts - Date.now()) : '';
    const last = (d.results || [])[0];
    const form = (d.form || []).map(f => `<i class="sf sf-${f === 'W' ? 'w' : f === 'L' ? 'l' : 'd'}">${f}</i>`).join('');
    const std = d.standings;
    return `<article class="brief is-sport ${live ? 'is-live' : ''}" style="--c1:${meta.c[0]};--c2:${meta.c[1]};" data-tid="${D.$U.esc(t.id)}">
      <div class="brief-media"><span class="bm-glow"></span><span class="brief-no">${D.$U.pad(n)}</span>${no}
        <span class="bm-ic" style="transform:none">${ic('i-flag', 42)}</span></div>
      <div class="brief-main">
        <div class="brief-cap"><span class="brief-meta muted">${D.$U.esc(d.league || '스포츠')} · ${D.$U.esc(d.source || '실시간')}</span>
          ${live ? '<span class="live-tag">● LIVE</span>' : (next ? `<span class="read-prog">${D.$U.esc(left)} 남음</span>` : '')}</div>
        <div class="brief-title" style="cursor:default">${stat ? `<b style="font-size:19px">${D.$U.esc(stat.big)}</b> · ${D.$U.esc(stat.who)}` : `${D.$U.esc(team)} — 시즌 진행 중`}</div>
        <div class="sport-grid">
          <div class="sg"><span>${live ? '상태' : '킥오프/일정'}</span><b>${stat ? D.$U.esc(stat.sub) : (std ? `${std.rank}위 (${std.points}점)` : '—')}</b></div>
          <div class="sg"><span>경기장</span><b>${stat ? D.$U.esc(stat.venue) : (d.homeGround || '—')}</b></div>
          <div class="sg"><span>최근 결과</span><b>${last ? D.$U.esc(`${last.home} ${last.score || ''} ${last.away}`) : (std ? `선두 ${D.$U.esc((std.leader||{}).team||'—')}` : '—')}</b></div>
          <div class="sg"><span>${mainHonor ? D.$U.esc(mainHonor.title) : '최근 5경기'}</span><b>${mainHonor ? `${D.$U.esc(mainHonor.name)} (${D.$U.esc(mainHonor.value)})` : (form ? `<span class="sform">${form}</span>` : '—')}</b></div>
        </div>
      </div>
      <div class="brief-acts"><button class="mini-act" data-a="edit">${ic('i-edit', 11)} 카드 설정</button></div>
    </article>`;
  }
  function personalBriefCard(t, n){
    const meta = briefMeta('personal', t);
    return `<article class="brief is-personal" style="--c1:${meta.c[0]};--c2:${meta.c[1]};" data-tid="${D.$U.esc(t.id)}">
      <div class="brief-media"><span class="bm-glow"></span><span class="brief-no">${D.$U.pad(n)}</span>
        <span class="brief-chip"><span class="brief-cat">${ic(meta.icon,10)} ${D.$U.esc(D.topicShort(t.label))}</span></span>
        <span class="bm-ic">${ic('i-link',34)}</span></div>
      <div class="brief-main">
        <div class="brief-cap"><span class="brief-meta muted">개인 데이터</span></div>
        <div class="brief-title" style="cursor:default">아직 연결된 소스가 없어요</div>
        <div class="brief-why"><span>운동 앱·건강 데이터를 연결하면 이 카드에 진짜 수치가 표시돼요. 지금은 수치를 만들지 않아요.</span></div>
      </div>
      <div class="brief-acts"><button class="mini-act" data-a="edit">${ic('i-edit',11)} 카드 설정</button></div>
    </article>`;
  }
  function loadingBriefCard(t, n){
    const meta = briefMeta(t.kind, t);
    return `<article class="brief is-loading" style="--c1:${meta.c[0]};--c2:${meta.c[1]};" data-tid="${D.$U.esc(t.id)}">
      <div class="brief-media"><span class="bm-glow"></span><span class="brief-no">${D.$U.pad(n)}</span>
        <span class="brief-chip"><span class="brief-cat">${ic(meta.icon,10)} ${D.$U.esc(D.topicShort(t.label))}</span></span>
        <span class="bm-ic" style="opacity:.25">${ic(meta.icon,40)}</span></div>
      <div class="brief-main">
        <div class="skline w70"></div><div class="skline w95"></div><div class="skline w55" style="margin-top:6px"></div>
      </div>
    </article>`;
  }
  function emptyBriefCard(t, n){
    const meta = briefMeta(t.kind, t);
    return `<article class="brief is-nomatch" data-tid="${D.$U.esc(t.id)}">
      <div class="brief-media"><span class="brief-no brief-no-dim">${D.$U.pad(n)}</span>
        <span class="brief-chip">${D.$U.esc(D.topicShort(t.label))}</span></div>
      <div class="brief-main" style="padding-top:10px">
        <div class="brief-title" style="opacity:.85;cursor:default">지금 ${D.$U.esc(D.topicShort(t.label))}의 새 소식이 없어요</div>
        <div class="brief-why"><span>잠시 뒤 자동 갱신되거나, 아래에서 새로 수집할 수 있어요.</span></div>
      </div>
      <div class="brief-acts">
        <button class="mini-act" data-a="load" title="지금 새 기사 재수집">${ic('i-reload',11)} 지금 다시 수집</button>
        <button class="mini-act" data-a="edit">${ic('i-edit',11)} 카드 설정</button>
      </div>
    </article>`;
  }
  function noLivePanel(){
    return `<div class="editor-empty fadeUp">
      <div class="brief-ed-big">실시간 소스에 연결돼 있지 않아요</div>
      <p class="muted">뉴스레터·시세·날씨는 <b>실제 데이터가 연결될 때만</b> 채워져요 — 가짜 정보로 채우지 않아요.</p>
      <p class="muted" style="margin-top:4px">지금 실행 중인 미니 라이브 서버(또는 Windows 앱)에 연결되면 이 화면이 자동으로 실제 데이터를 표시해요. 아래 명령으로 서버를 띄운 뒤 이 주소를 다시 여세요.</p>
      <div class="code-box">cd briefing-board && node tools/live-server.js --dir dist<br/>→ http://localhost:8420</div>
      <button class="btn primary" id="briefNoLiveRetry" style="margin-top:8px">${ic('i-reload',13)} 다시 확인</button>
    </div>`;
  }
  /* 뉴스레터 카드는 한 장씩 ‘brief’ 스코프 패치를 적용해 다시 그린다 (패치 없으면 원본 그대로) */
  function applyBriefScopes(rows, topics){
    if (!window.BPatch || !window.BPatch.applyHtml || !window.BPatch.count()) return rows;
    return rows.map((html, i) => {
      const t = topics[i];
      if (!t) return html;
      try { return window.BPatch.applyHtml(t, payloadOf(t), html, 'brief'); } catch (e) { return html; }
    });
  }
  function drawBrief(){
    const rail = $('#briefRail');
    if (!rail) return;
    const t = now(), info = D.todayInfo(t);
    if (!LIVE){ rail.innerHTML = noLivePanel(); $('#newsCount').textContent = 0; $('#briefMeta').textContent = `${info.month}월 ${info.day}일 · 실시간 연결 전`; const rb=$('#briefNoLiveRetry'); if(rb) rb.onclick=()=>{ liveBase().then(()=>{ if(!LIVE) return toast({t:'연결 안 됨', m:'미니 서버가 꺼져 있어요(위 명령 참고).', ic:'i-x'}); renderBrief(true); toast({t:'실시간 연결됨', m:'관심사 데이터를 불러옵니다.', ic:'i-check', g:['#22c55e','#a3e635']}); }); }; return; }
    const rows = [];
    state.topics.forEach((tp, i) => {
      const n = i + 1;
      if (tp.kind === 'personal'){ rows.push(personalBriefCard(tp, n)); return; }
      if (tp.kind === 'weather'){ rows.push(weatherBriefCard(tp, n)); return; }
      if (tp.kind === 'sport'){ rows.push(sportBriefCard(tp, n, payloadOf(tp))); return; }
      const p = payloadOf(tp);
      if (!p || p.status !== 'ok' || p.status === 'loading'){ rows.push(loadingBriefCard(tp, n)); return; }
      const it = currentItem(tp);
      if (!it){ rows.push(emptyBriefCard(tp, n)); return; }
      rows.push(newsBriefCard(tp, it, n, p));
    });
    rail.innerHTML = (window.BPatch && window.BPatch.count && window.BPatch.count() ? applyBriefScopes(rows, state.topics) : rows).join('');
    $('#newsCount').textContent = rows.length;
    const srcTag = '실시간';
    $('#briefMeta').textContent = `${info.month}월 ${info.day}일 · 관심사 ${state.topics.length}개 중 ${rows.length}건 · ${srcTag} 소스`;
    $('#briefMeta').title = '각 카드는 해당 관심사의 실시간 소스 최신 항목입니다.';
    const bn = $('#briefNote');
    if (bn) bn.remove();
    bindBrief();
  }
  function renderBrief(fresh){
    if (fresh && LIVE){ refreshBriefData(true); }
    else drawBrief();
  }
  async function refreshBriefData(fresh){
    if (!LIVE){ drawBrief(); return; }
    try { await ensureAllTopics(!!fresh); } catch (e) {}
    drawBrief();
  }
  function scrollBrief(dir){
    const rail = $('#briefRail');
    if (!rail) return;
    const card = rail.firstElementChild;
    const step = (card ? card.offsetWidth : 308) + 9;
    const maxScroll = Math.max(0, rail.scrollWidth - rail.clientWidth);
    if (dir > 0 && rail.scrollLeft >= maxScroll - 12){
      if (typeof rail.scrollTo === 'function') rail.scrollTo({ left: 0, behavior: 'smooth' });
      else rail.scrollLeft = 0;
    } else if (dir < 0 && rail.scrollLeft <= 10){
      if (typeof rail.scrollTo === 'function') rail.scrollTo({ left: maxScroll, behavior: 'smooth' });
      else rail.scrollLeft = maxScroll;
    } else {
      if (typeof rail.scrollBy === 'function') rail.scrollBy({ left: dir * step, behavior: 'smooth' });
      else rail.scrollLeft = Math.max(0, rail.scrollLeft + dir * step);
    }
  }
  let briefAutoTimer = null;
  let briefHovered = false;
  function startBriefAutoSlide(){
    if (briefAutoTimer) clearInterval(briefAutoTimer);
    briefAutoTimer = setInterval(() => {
      if (briefHovered) return;
      const rail = $('#briefRail');
      if (!rail || !rail.children || rail.children.length <= 1) return;
      scrollBrief(1);
    }, 10000); // 10초마다 다음 관심사 뉴스로 자동 슬라이드
  }
  function bindBrief(){
    const rail = $('#briefRail');
    if (!rail) return;
    if (!rail._hoverBound){
      rail._hoverBound = true;
      rail.addEventListener('mouseenter', () => { briefHovered = true; });
      rail.addEventListener('mouseleave', () => { briefHovered = false; });
      rail.addEventListener('pointerdown', () => { briefHovered = true; });
      rail.addEventListener('pointerup', () => { setTimeout(() => { briefHovered = false; }, 4000); });
    }
    rail.onclick = e => {
      const el = e.target.closest('[data-a]');
      if (!el) return;
      const card = el.closest('.brief');
      const act = el.dataset.a;
      const tid = card && card.dataset.tid;
      const id = card && card.dataset.id;
      const t = tid && state.topics.find(x => x.id === tid);
      if (act === 'open'){
        const it = t && (currentItem(t) || {}); 
        if (it && it.id === id) openBriefArticle(t, it);
      } else if (act === 'like'){ likeStory(t, id, el); }
      else if (act === 'mute'){ muteStory(t, id); }
      else if (act === 'edit'){ if (t) openTopicEditor(t.id); }
      else if (act === 'load'){ if (t && LIVE){ el.innerHTML = ic('i-reload',11) + ' 수집 중…'; loadTopicPayload(t, { fresh: true }); } }
    };
  }
  /* 관심없음 → 그 관심사의 새 기사를 “지금” 실시간 재수집해 교체 */
  function muteStory(t, id){
    if (!t) return;
    if (!state.mutedIds) state.mutedIds = [];
    if (!state.mutedIds.includes(id)){ pushUndo(); state.mutedIds.push(id); save(); }
    const wasOnRail = currentItem(t);            // 교체 전 어떤 기사였는지
    if (!LIVE){ drawBrief(); return; }
    pushLog(`관심없음 → <b>${D.$U.esc(t.label)}</b>의 지금 새 기사를 실시간으로 수집해 교체`);
    toast({ t:'관심없음 · 새 기사 수집 중', m:`${D.$U.esc(t.label)} — 지금 발행된 다른 새 기사로 교체할게요.`, ic:'i-reload', ms:2600 });
    fetchFreshForTopic(t).then(() => drawBrief());
  }
  /* good! = “이 기사 다 봤다” → 같은 관심사의 아직 안 읽은 다음 뉴스로 넘긴다 */
  function advanceTopic(t){
    const stat = Lg.advanceAfterRead(((liveFeed[t.id] || {}).items) || [], state.mutedIds || [], state.readIds || [], t.id);
    if (stat.action === 'next'){ drawBrief(); return true; }
    if (stat.action === 'fetch'){
      pushLog(`<b>${D.$U.esc(t.label)}</b>의 안 읽은 뉴스가 없어요 — 지금 새 기사를 다시 수집해 이어서 보여드립니다`);
      fetchFreshForTopic(t).then(items => {
        if (!items || !items.length){                 // 소스에 정말 없으면 읽음 표시를 지우고 처음부터 순환
          state.readIds = (state.readIds || []).filter(k => String(k).indexOf(t.id + '|') !== 0);
          save(); pushLog('새 뉴스도 아직 없어요 — 읽은 뉴스부터 다시 보여드립니다');
        }
        drawBrief();
      });
      return true;
    }
    drawBrief(); return false;
  }
  function likeStory(t, id, btn){
    if (!t || !id) return;
    const it = ((liveFeed[t.id] || {}).items || []).find(i => i.id === id);
    const meta = (it && it.title) || '';
    const idx = (state.likes || []).findIndex(l => l.id === id && l.tid === t.id);
    const wasLiked = idx >= 0;
    if (wasLiked){ state.likes.splice(idx, 1); markRead(t.id, id, false); pushLog('good! 해제 — 그 기사를 다시 읽을 수 있어요'); }
    else {
      if (!state.likes) state.likes = [];
      state.likes.push({ id, tid: t.id, kind: t.kind, src: (it && it.src) || '', title: meta.slice(0,80), at: Date.now() });
      if (state.likes.length > 200) state.likes = state.likes.slice(-200);
      markRead(t.id, id, true);
      pushLog(`good! → <b>${D.$U.esc(t.label)}</b> 취향으로 기억 · 같은 관심사의 다음 뉴스로 넘깁니다`);
    }
    save();
    if (!wasLiked) advanceTopic(t); else drawBrief();
    if (btn){
      const on = (state.likes || []).some(l => l.id === id && l.tid === t.id);
      btn.classList.toggle('on', on);
      btn.innerHTML = ic('i-heart',11) + (on ? ' good! ✓' : ' good!');
    }
  }
  function openBriefArticle(t, it){
    if (!t || !it) return;
    const meta = briefMeta(t.kind, t);
    const body = (it.desc || '').replace(/\s+/g,' ').trim();
    const liked = (state.likes||[]).some(l => l.id === it.id && l.tid === t.id);
    const linkBtn = it.link
      ? `<a class="btn primary" href="${D.$U.esc(it.link)}" target="_blank" rel="noopener">${ic('i-open',12)} 원문에서 읽기 ↗</a>`
      : `<button class="btn primary" data-c>원문 없음 (미리보기만)</button>`;
    openModal({
      title:`${D.topicShort(t.label)} · 최신 브리핑`, ic:'i-open', wide:true,
      body:`<div class="m-sub" style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">
              <span class="brief-cat" style="color:${meta.c[0]};font-weight:800">${ic(meta.icon,10)} ${D.$U.esc(D.topicShort(t.label))}</span>
              <span class="muted">${D.$U.esc(it.src||'')} · ${it.ago||''}</span>
              <span class="why-tag">실시간 소스에서 가져온 최신 항목</span>
            </div>
            <h2 style="font-size:18px;line-height:1.5;letter-spacing:-.02em">${D.$U.esc(it.title)}</h2>
            ${body ? `<div class="log-box" style="max-height:none;background:var(--glass-weak)"><div class="m-sub" style="font-size:12.5px;line-height:1.85;color:var(--ink);white-space:pre-line">${D.$U.esc(body)}</div></div>` : ''}
            ${it.img ? `<img src="${D.$U.esc(it.img)}" style="width:100%;border-radius:12px;margin-top:8px" alt="" referrerpolicy="no-referrer"/>` : ''}
            <div class="m-sub">${ic('i-heart',11)} <b>good!</b>를 누르면 이 주제·매체를 취향으로 기억해요. “관심없음”은 이 소식만 제외하고 지금 새 기사로 교체해요.</div>`,
      foot:`<button class="btn" data-a="like-article" style="color:var(--good)">${ic('i-heart',12)} ${liked?'good! ✓':'good!'}</button>
            <button class="btn" data-a="mute-article" style="color:var(--bad)">관심없음</button><div style="flex:1"></div>
            <button class="btn ghost" data-c>닫기</button>${linkBtn}`
    });
    const likeBtn = $('#modalBox [data-a="like-article"]');
    if (likeBtn) likeBtn.onclick = () => {
      likeStory(t, it.id, null);
      if ((state.likes || []).some(l => l.id === it.id && l.tid === t.id)){
        closeModal();
        toast({ t:'다음 뉴스로', m:`${D.$U.esc(D.topicShort(t.label))} — 아직 안 읽은 뉴스를 앞으로 불렀어요.`, ic:'i-check', g:['#22c55e','#a3e635'], ms:3400 });
      }
    };
    const muteBtn = $('#modalBox [data-a="mute-article"]');
    if (muteBtn) muteBtn.onclick = () => { closeModal(); muteStory(t, it.id); };
  }

  /* ============================================================
     피드백 반영 칸 (바로 피드백 → 즉시 반영)
     ============================================================ */
  function showHints(){
    const examples = [
      '날씨를 오전/오후로 나눠서 표시해줘','미세먼지도 표시해줘','맨시티 카드에 경기장도 보여줘',
      '글자 크게 해줘','다크 모드로 바꿔줘','일정을 왼쪽 크게','주식은 초록이 상승이야','소수점 1자리로만 보여줘'
    ];
    $('#fbHints').innerHTML = examples.map(e => `<button class="fh" data-f="${D.$U.esc(e)}">${D.$U.esc(e)}</button>`).join('');
    $('#fbHints').querySelectorAll('[data-f]').forEach(b => b.onclick = () => { $('#fbInput').value = b.dataset.f; submitFeedback(); });
  }

  /* 요청 문장을 서버의 패치 엔진에 보내 **실제 JS 코드를 생성·빌드**하게 한다.
     ok=false 면 정직하게 “못 한다”고 알린다(미리 만든 답을 골라주지 않는다). */
  async function applyFeedbackToCode(text){
    try {
      const r = await apiPost('/api/feedback/apply', {
        text, topics: state.topics.map(t => ({ id: t.id, label: t.label, kind: t.kind })),
      });
      if (r && r.rebuild && r.rebuild.hash) BUILD_HASH = r.rebuild.hash;
      return r;
    } catch (e){ return { ok: false, error: String((e && e.message) || e), offline: true }; }
  }
  function showPatchResult(patch, text){
    const rows = (patch.applied || []).map(a => `<div class="log-row"><span class="lm"><b>${D.$U.esc(a.title || a.op)}</b> — ${D.$U.esc(a.log || '')} <span class="muted">→ src/patches/${D.$U.esc(a.file || '')}</span></span></div>
      <div class="code-box" style="max-height:170px;overflow:auto;white-space:pre-wrap;font-size:10px;line-height:1.6">${D.$U.esc(a.code || '')}</div>`).join('');
    openModal({
      title: '요청을 처리하는 코드를 새로 만들었어요', ic: 'i-edit', wide: true,
      body: `<div class="m-sub">“${D.$U.esc(text)}” — 설정 값을 고른 게 아니라, <b>${(patch.applied || []).length}개의 렌더 코드</b>를 <code>src/patches/</code> 에 쓰고 <code>dist/index.html</code> 을 다시 빌드했어요. <b>새로고침하면 그대로 반영</b>됩니다.</div>
        ${rows}
        <div class="m-sub" style="font-size:11px">터미널에서 <code>node tools/patch-engine.js list</code> 로 확인하고, <code>rm &lt;id&gt;</code> 또는 <code>clear</code> 후 새로고침하면 되돌아갑니다.</div>`,
      foot: `<button class="btn primary" data-a="bp-reload">${ic('i-reload', 12)} 지금 새로고침해서 반영</button>
             <button class="btn" data-a="bp-undo">방금 만든 코드 되돌리기</button><div style="flex:1"></div>
             <button class="btn ghost" data-a="bp-reload">나중에</button>`,
    });
    const box = $('#modalBox');
    box.querySelectorAll('[data-a="bp-reload"]').forEach(b => b.onclick = () => { closeModal(); setTimeout(() => location.reload(), 240); });
    const un = box.querySelector('[data-a="bp-undo"]');
    if (un) un.onclick = async () => {
      un.textContent = '되돌리는 중…';
      const ids = (patch.applied || []).map(a => a.id);
      const r = await apiPost('/api/feedback/undo', { ids }).catch(() => ({ ok: false }));
      closeModal();
      if (r && r.ok){ toast({ t:'되돌림', m:`코드 패치 ${ids.length}개를 삭제하고 다시 빌드했어요.`, ic:'i-check' }); setTimeout(() => location.reload(), 400); }
      else toast({ t:'되돌리지 못했어요', m:'서버에 연결할 수 없어요. 터미널에서 node tools/patch-engine.js clear 후 새로고침하세요.', ic:'i-x' });
    };
  }
  function submitFeedback(){
    const text = $('#fbInput').value.trim();
    if (!text) { $('#fbInput').focus(); return; }
    lastFeedCount++;
    $('#fbSendLabel').textContent = '반영 중';
    $('#fbSend').disabled = true;

    // AI 처리 지연 시뮬레이션
    setTimeout(async () => {
      const patch = LIVE ? await applyFeedbackToCode(text) : null;
      const plan = Lg.planFromFeedback(text, state.topics);
      const topicsLabel = state.topics.map(t=>t.label).join('·');
      const done = [];

      const apply = (rule) => {
        switch(rule.t){
          case 'theme': state.autoTheme = false; state.themeOverride = rule.v; applyTheme(true); break;
          case 'stockColor': state.stockRule = rule.v; applyStockRule(); renderTopics(); break;
          case 'scale': state.scale = D.$U.clamp((state.scale||1)+rule.v, .85, 1.25); applyScale(); break;
          case 'clean':
            document.body.classList.add('clean-mode');
            state.clean = true; render(); break;
          case 'layout': state.layout = rule.v || plan.layout || state.layout; decideGrid(); break;
          case 'topicTop': {
            const i = state.topics.findIndex(x=>x.id===rule.tid);
            if (i > 0){ const [tp] = state.topics.splice(i,1); state.topics.unshift(tp); }
            break;
          }
          case 'hideElement': if (rule.el==='weather'){ document.body.classList.add('no-wx'); state.hideWeather=true; } break;
        }
        done.push(rule.log);
      };
      const hasChange = !!((plan.rules && plan.rules.length) || plan.layout);
      if (hasChange) pushUndo();               // 변경 전 상태 백업 (되돌리기)
      (plan.rules||[]).forEach(apply);

      if (plan.layout && !plan.rules.length){ apply({t:'layout', log:'위젯 위치를 요청대로 재배치' }); }
      const patched = patch && patch.ok && (patch.applied || []).length;
      if (patched){
        $('#fbSendLabel').textContent = '반영 요청';
        $('#fbSend').disabled = false;
        $('#fbInput').value = '';
        state.lastFeedback = { text, at: Date.now() }; save();
        (patch.applied || []).forEach(a => pushLog(`[코드 반영] ${D.$U.esc(a.log || a.title || a.op)}`));
        try { sessionStorage.setItem('bpPatchNote', JSON.stringify({ text, titles: (patch.applied || []).map(a => a.title || a.op), at: Date.now() })); } catch (e) {}
        render(); renderBrief(false);
        showPatchResult(patch, text);
        renderPatchFoot();
        return;
      }
      if (done.length){
        $('#undoChip').classList.add('show');
        state.lastFeedback = { text, at: Date.now() };
        save(); render(); renderBrief();
        done.forEach(d => pushLog(`[피드백] “${D.$U.esc(text)}” → ${d}`));
        toast({ t:'피드백 반영 완료', m:`“${D.$U.esc(text.slice(0,42))}${text.length>42?'…':''}” → ${done.length}가지 변경을 적용했어요.`, ic:'i-check', g:['#22c55e','#6366f1'] });
        $('#undoChip').classList.add('show');
      } else if (plan.ask){
        toast({ t:'조금 더 알려주세요', m: plan.ask, ic:'i-chat', ms:7000 });
        pushLog(`[피드백] “${D.$U.esc(text)}” → 해석 대기 (명확한 지시 필요)`);
      } else if (patch && !patch.ok && !patch.offline){
        const can = (patch.catalog || []).map(c => c.nm).join(' · ');
        openModal({
          title: '아직 코드 untuk 만들지 못한 요청이에요', ic: 'i-chat',
          body: `<div class="m-sub">“${D.$U.esc(text)}”</div>
            <div class="log-box" style="max-height:none"><div class="m-sub" style="font-size:11.5px">패치 엔진은 이 연산자까지 코드로 생성할 수 있어요:</div>
            <div style="display:flex;flex-wrap:wrap;gap:5px;margin-top:4px">${(patch.catalog || []).map(c => `<span class="why-tag"><b>${D.$U.esc(c.op)}</b> · ${D.$U.esc(c.nm)}</span>`).join('')}</div>
            <div class="m-sub" style="font-size:11px;margin-top:6px">이 범위를 넘는 요청은 <code>tools/patch-engine.js</code> 의 OPS/FIELDS 사전을 늘리면 새 연산자로 추가돼요. (없는 답을 골라 드리는 일은 없어요)</div></div>`,
          foot: `<button class="btn primary" data-c>닫기</button>`,
        });
        pushLog(`[피드백] “${D.$U.esc(text)}” → 생성 가능한 코드가 없어요 (카탈로그 ${ (patch.catalog||[]).length }종만 지원)`);
      } else {
        // 규칙에 안 걸리면: 반영 후보 제안 모달 (실서비스 = GPT 처리)
        const suggestions = heuristicSuggestions(text, topicsLabel);
        const chips = suggestions.map(s => `<button class="fh" data-s="${D.$U.esc(s)}">${D.$U.esc(s)}</button>`).join(' ');
        openModal({
          title:'피드백 해석 — 반영 가능한 변경 후보', ic:'i-chat',
          body:`<div class="m-sub">“${D.$U.esc(text)}”</div>
                <div class="log-box">${logRows()}</div>
                <div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center"><span class="kicker">변경 후보</span>${chips||'<span class="muted">후보 없음</span>'}</div>
                <div class="m-sub" style="font-size:11px">데모 모드에서는 키워드 규칙만 실행해요. 실제 앱에선 이 문장이 GPT를 통해 위젯 구성/스타일/데이터로 해석·반영됩니다.</div>`,
          foot:`<button class="btn primary" data-c>확인</button>`
        });
        $('#modalBox').querySelectorAll('[data-s]').forEach(b=>b.onclick=()=>{ $('#fbInput').value=b.dataset.s; closeModal(); submitFeedback(); });
        pushLog(`[피드백] “${D.$U.esc(text)}” → 후보 제안 ${suggestions.length}개`);
        setAI('방금 피드백을 해석해서 후보를 정리했어요. 클릭하면 바로 적용됩니다.');
      }
      $('#fbSendLabel').textContent = '반영 요청';
      $('#fbSend').disabled = false;
      $('#fbInput').value = '';
    }, lastFeedCount*420 + 500);
  }

  function heuristicSuggestions(text, label){
    const out = [];
    if (/브리핑|뉴스|기사/.test(text)) out.push('브리핑을 왼쪽 크게 배치');
    if (/주식|종목|코인|주가/.test(text)) out.push('관심 종목 카드 늘리기');
    if (/날씨/.test(text)) out.push('날씨 카드를 오늘 위젯 위로');
    if (/일정/.test(text)) out.push('일정 카드를 가장 위로 고정');
    if (/운동|러닝|헬스/.test(text)) out.push('운동 주간 그래프로 표시');
    if (/어두|밝/.test(text)) out.push('화면 테마 조절');
    if (/글자/.test(text)) out.push('글자 크기 조절');
    if (!out.length){
      // 관심사 중 언급된 것을 맨 위로 옮기기 제안
      const hits = state.topics.filter(t => text.includes(t.label.slice(0, 2)) && t.label.length <= 8);
      if (hits.length) out.push(`「${hits[0].label}」를 맨 위에`);
      else out.push('더 간결한 브리핑 카드로');
    }
    return out.slice(0,3);
  }

  /* ============================================================
     네이티브(Host) 설정 연동 — 네이티브 모드에서만 표시/동작
     ============================================================ */
  function hostBase(){
    const h = window.__BRIEFING_HOST__;
    return (h && h.apiBase) ? String(h.apiBase).replace(/\/+$/, '') : null;
  }
  async function hostCall(path, method, body){
    const base = hostBase();
    if (!base) return null;
    try {
      const r = await fetch(base + path, { method: method || 'GET',
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined });
      if (!r.ok) return null;
      return await r.json();
    } catch (e) { return null; }
  }
  function setSwitchSel(id, on){ const el = document.querySelector(id); if (el) el.classList.toggle('on', !!on); }
  function nativeSettingsHTML(){
    if (!hostBase()) return '';
    return `
        <div class="m-sub" style="margin:10px 0 2px;padding-top:9px;border-top:1px solid var(--stroke);display:flex;align-items:center;gap:6px"><b>iCloud 일정 (실데이터)</b><span class="muted">Apple 계정 + 앱 특수 암호로 이 PC에서 바로 연결</span></div>
        <div style="font-size:11px;line-height:1.7;color:var(--ink-3);margin:0 0 6px;background:var(--glass-weak);border:1px solid var(--stroke);border-radius:10px;padding:8px 10px">
          연결 순서: ① 아래 링크에서 <b>Apple ID 계정 관리</b> 열기 → ② <b>로그인 및 보안 → 앱 암호</b>에서 새 암호 생성(이름 아무거나) → ③ 아래 <b>Apple ID</b> 칸에 이메일, <b>앱 특수 암호</b>(xxxx-xxxx-xxxx-xxxx) 칸에 발급받은 16자리를 붙여넣고 <b>연결 저장</b> → ④ <b>일정 표시</b> 켜기. 저장된 값은 이 서버가 쓰는 로컬 파일에만 보관됩니다.<br/>
          <a class="fh" style="margin-top:4px" id="stAppleGuide" href="https://appleid.apple.com/account/manage" target="_blank" rel="noopener">${ic('i-open',10)} appleid.apple.com/account/manage 열기</a>
          <span class="muted" style="margin-left:6px">(앱 특수 암호는 Apple ID 비밀번호와 별개인 16자리 전용 암호예요)</span>
        </div>
        <div class="rowitem" style="flex-direction:column;align-items:stretch;gap:7px">
          <div style="display:flex;gap:6px;flex-wrap:wrap">
            <input class="textin" id="stMail" style="flex:1.2;min-width:180px" placeholder="Apple ID (이메일)" autocomplete="off"/>
            <input class="textin" id="stPw" type="password" style="flex:1;min-width:170px" placeholder="앱 특수 암호 xxxx-xxxx-xxxx-xxxx" autocomplete="new-password"/>
            <button class="btn primary" id="stCredSave" style="align-self:center">연결 저장</button>
          </div>
          <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;font-size:11px;flex-wrap:wrap">
            <span id="stCalState" class="muted">확인 중…</span>
            <button class="fh" id="stCredClear" style="opacity:.72">연결 해제</button>
          </div>
        </div>
        <div class="rowitem"><div class="ri-t"><b>일정 표시</b><span>연결된 iCloud 캘린더를 오늘 위젯에</span></div>
          <button class="switch" id="stCal"></button></div>
        <div class="rowitem"><div class="ri-t"><b>로그인 시 자동 시작</b><span>부팅 후 트레이에서 실행</span></div>
          <button class="switch" id="stAuto"></button></div>
        <div class="rowitem"><div class="ri-t"><b>항상 위 (기본)</b><span>위젯이 다른 창 위에 머무름</span></div>
          <button class="switch" id="stTop"></button></div>
        <div class="rowitem"><div class="ri-t"><b>뉴스 새로고침 주기</b><span>라이브 브리핑 갱신 간격</span></div>
          <div class="seg" id="stNewsInt"><button data-v="5">5분</button><button data-v="15">15분</button><button data-v="30">30분</button><button data-v="60">60분</button></div></div>`;
  }
  async function bindNativeSettings(){
    const base = hostBase(); if (!base) return;
    const prefs = await hostCall('/api/prefs');
    const creds = await hostCall('/api/credentials');
    if (prefs){
      setSwitchSel('#stCal', !!prefs.calendarEnabled);
      setSwitchSel('#stAuto', !!prefs.autoStart);
      setSwitchSel('#stTop', !!prefs.topmost);
      const seg = document.querySelector('#stNewsInt');
      if (seg){ const cur = String(prefs.newsPollMinutes || '15'); [...seg.querySelectorAll('button')].forEach(b => b.classList.toggle('on', b.dataset.v === cur)); }
    }
    const stMail = document.querySelector('#stMail'), stPw = document.querySelector('#stPw'), stState = document.querySelector('#stCalState');
    if (stMail && prefs && prefs.calendarEmail) stMail.value = prefs.calendarEmail;
    if (stState) stState.textContent = (creds && creds.hasPassword)
      ? `연결됨 · ${(creds.email) || (prefs && prefs.calendarEmail) || '계정'}` : '미연결 — 이메일과 앱 특수 암호를 저장하세요.';
    const sv = document.querySelector('#stCredSave');
    if (sv) sv.onclick = async () => {
      const em = (stMail ? stMail.value : '').trim(), pw = stPw ? stPw.value : '';
      if (!em || !pw) return toast({ t:'입력 필요', m:'Apple ID와 앱 특수 암호를 입력하세요.', ic:'i-bell' });
      const r = await hostCall('/api/credentials', 'POST', { email: em, password: pw });
      if (!r || !r.ok) return toast({ t:'연결 실패', m:'이메일·앱 특수 암호를 다시 확인해 주세요.', ic:'i-x' });
      if (stPw) stPw.value = '';
      const on = await hostCall('/api/prefs', 'POST', { calendarEnabled: true });   // 연결되면 일정 표시 자동 ON
      setSwitchSel('#stCal', true);
      if (window.__hostRefresh) window.__hostRefresh.refreshEvents();
      toast({ t:'iCloud 연결 완료', m:`${em} — 실제 일정을 불러오고 있어요. 몇 초 안에 오늘 위젯에 표시됩니다.`, ic:'i-check', g:['#22c55e','#a3e635'], ms:5200 });
      bindNativeSettings();
    };
    const clr = document.querySelector('#stCredClear');
    if (clr) clr.onclick = async () => {
      await hostCall('/api/credentials', 'POST', { delete: true });
      await hostCall('/api/prefs', 'POST', { calendarEnabled: false, calendarEmail: '' });
      toast({ t:'연결 해제됨', m:'iCloud 연결을 끊고 일정 표시를 껐어요.', ic:'i-x' });
      bindNativeSettings();
    };
    const cal = document.querySelector('#stCal');
    if (cal) cal.onclick = async () => {
      const want = !cal.classList.contains('on');
      if (want && !(creds && creds.hasPassword)) return toast({ t:'계정 먼저 연결', m:'위에서 Apple ID와 앱 특수 암호를 저장해 주세요.', ic:'i-bell' });
      const r = await hostCall('/api/prefs', 'POST', { calendarEnabled: want });
      if (r && r.ok){
        setSwitchSel('#stCal', want);
        toast({ t: want ? '일정 표시 켬' : '일정 표시 끔', m: want ? 'iCloud 일정을 불러옵니다.' : '데모/로컬 일정으로 돌아갑니다.', ic:'i-cal' });
        if (window.__hostRefresh) window.__hostRefresh.refreshEvents();
      }
      bindNativeSettings();
    };
    const at = document.querySelector('#stAuto');
    if (at) at.onclick = async () => { const want = !at.classList.contains('on'); const r = await hostCall('/api/prefs','POST',{ autoStart: want }); if (r && r.ok) setSwitchSel('#stAuto', want); };
    const tp = document.querySelector('#stTop');
    if (tp) tp.onclick = async () => { const want = !tp.classList.contains('on'); const r = await hostCall('/api/prefs','POST',{ topmost: want }); if (r && r.ok) setSwitchSel('#stTop', want); };
    const ni = document.querySelector('#stNewsInt');
    if (ni) [...ni.querySelectorAll('button')].forEach(b => b.onclick = async () => {
      const v = +b.dataset.v;
      const r = await hostCall('/api/prefs','POST',{ newsPollMinutes: v });
      if (r && r.ok){ [...ni.querySelectorAll('button')].forEach(x => x.classList.toggle('on', x === b)); toast({ t:'새로고침 주기 변경', m:`뉴스를 ${v}분마다 갱신합니다.`, ic:'i-reload' }); }
    });
  }

  /* ============================================================
     설정 모달
     ============================================================ */
  /* 하늘 자동 전환이 '실제로' 어떤 값으로 판정됐는지 보여주는 줄 (비 안 와도 검증 가능) */
  function skyLiveHTML(){
    const w = liveWxForSky();
    const alert = skyAlertNow();
    const dec = skyDecision();
    if (!w) return `<div class="sl-line">${ic('i-sun', 11)} 실측 날씨 없음 — 서버 연결 후 자동으로 판단해요. <span class="muted">지금 하늘: ${D.$U.esc(dec.base)}</span></div>`;
    const bits = [`기온 ${Math.round(w.temp != null ? w.temp : 0)}°`, `강수 ${w.precip != null ? w.precip : 0}mm`, `확률 ${w.rainPct != null ? w.rainPct : 0}%`, w.pm10 != null ? `PM10 ${Math.round(w.pm10)}` : null, `상태 ${w.cond || '—'}`].filter(Boolean).join(' · ');
    return `<div class="sl-line">${ic(alert ? 'i-drop' : 'i-sun', 11)} 실시간 판정: <b>${D.$U.esc(bits)}</b>
        → ${alert ? `<b class="sl-on">${D.$U.esc((Lg.SKY_ALERT_LABEL || {})[alert] || alert)} 하늘로 자동 전환됨</b>` : '<span class="muted">경보 없음 → 시간대 하늘</span>'}
        ${dec.manual ? '<span class="muted">· 수동 선택이 우선</span>' : ''}</div>
      <div class="sl-line muted">잠깐 확인: 아래 “비” 버튼을 누르면 실제 강수 판정과 같은 렌더링(빗줄기·창유리 물방울)을 바로 볼 수 있어요.</div>`;
  }
  function paintSkyLive(){
    const box = $('#stSkyLive');
    if (box) box.innerHTML = skyLiveHTML();
  }
  function openSettings(){
    openModal({
      title:'설정', ic:'i-settings',
      body:`
      <div class="rowset">
        <div class="rowitem"><div class="ri-t"><b>표시 이름</b><span>인사말에 사용</span></div>
          <input class="textin" id="stName" style="width:130px" value="${D.$U.esc(state.userName)}"/></div>
        <div class="rowitem"><div class="ri-t"><b>시간 표시</b><span>일정/시계 형식</span></div>
          <div class="seg" id="stFmt">
            <button data-v="12" class="${state.timeFormat==='12'?'on':''}">12시간</button>
            <button data-v="24" class="${state.timeFormat==='24'?'on':''}">24시간</button></div></div>
        <div class="rowitem"><div class="ri-t"><b>자동 테마</b><span>아침엔 밝게 · 저녁엔 어둡게 (시간대 기반)</span></div>
          <button class="switch ${state.autoTheme?'on':''}" id="stTheme"></button></div>
        <div class="rowitem"><div class="ri-t"><b>뉴스 소스 지역</b><span>편집자가 우선 참고할 매체 지역</span></div>
          <div class="seg" id="stRegion">
            <button data-v="KR" class="${(state.topicFocus||'KR')==='KR'?'on':''}">국내</button>
            <button data-v="GLOBAL" class="${(state.topicFocus||'KR')==='GLOBAL'?'on':''}">글로벌</button></div></div>
        <div class="rowitem"><div class="ri-t"><b>배경 하늘 (분위기)</b><span>시간대별 햇빛/달빛 그라데이션 · 경보 버튼은 기상특보 효과 미리보기(실제론 특보 수신 시 자동)</span></div>
          <div style="display:flex;flex-direction:column;gap:5px;align-items:flex-end;min-width:0">
            <div class="seg" id="stSky">
              <button data-v="auto" class="${(state.skyMode||'auto')==='auto'?'on':''}">자동</button>
              <button data-v="day" class="${(state.skyMode||'auto')==='day'?'on':''}">낮</button>
              <button data-v="sunset" class="${(state.skyMode||'auto')==='sunset'?'on':''}">노을</button>
              <button data-v="night" class="${(state.skyMode||'auto')==='night'?'on':''}">밤</button></div>
            <div class="seg" id="stAlerts" style="flex-wrap:wrap;row-gap:4px;justify-content:flex-end">
              <button data-v="rain" class="${(state.skyMode||'auto')==='rain'?'on':''}">비</button>
              <button data-v="storm" class="${(state.skyMode||'auto')==='storm'?'on':''}">폭풍</button>
              <button data-v="dust" class="${(state.skyMode||'auto')==='dust'?'on':''}">황사·미세먼지</button>
              <button data-v="heat" class="${(state.skyMode||'auto')==='heat'?'on':''}">폭염</button>
              <button data-v="cold" class="${(state.skyMode||'auto')==='cold'?'on':''}">한파</button>
              <button data-v="snow" class="${(state.skyMode||'auto')==='snow'?'on':''}">대설</button></div>
          </div></div>
        <div class="sky-live" id="stSkyLive"></div>
      </div>
      ${nativeSettingsHTML()}
      ${!hostBase() ? `<div class="rowitem"><div class="ri-t"><b>iCloud 일정 (실데이터)</b><span>미니 라이브 서버를 켜면 여기서 바로 Apple 계정으로 연결돼요</span></div><button class="fh" id="stICloudHelp">지금 연결하는 법</button></div>` : ''}
      <div class="m-sub">${ic('i-pin',12)} 윈도우 위젯 모드: 창 위치·크기 저장됨 · <button class="fh" id="stReset">데이터 초기화</button></div>`,
      foot:`<button class="btn" data-c>닫기</button>`
    });
    bindNativeSettings();
    paintSkyLive();
    const ico = $('#stICloudHelp');
    if (ico) ico.onclick = openICloudGuide;
    $('#stName').addEventListener('change', e=>{ state.userName = e.target.value.trim()||'민준'; save(); renderSchedule(); pushLog('표시 이름 변경'); });
    $$('#stFmt button').forEach(b=>b.onclick=()=>{ state.timeFormat=b.dataset.v; save(); applySettingsUI(); closeModal(); openSettings(); });
    $$('#stRegion button').forEach(b=>b.onclick=()=>{ state.topicFocus=b.dataset.v; save(); closeModal(); openSettings(); toast({t:'설정 저장됨', m:'지역 우선순위를 반영할게요.',ic:'i-check'}); });
    function pickSky(btn){
      const v = btn.dataset.v;
      state.skyMode = v; save(); paintSkyLive();
      $$('#stSky button, #stAlerts button').forEach(x => x.classList.toggle('on', x === btn));
      applyAmbience(true);
      const label = SKY_MODE[v] || v;
      if (ALERT_KEYS[v]){
        toast({ t:'기상경보 효과 미리보기', m:`${label} — 실제 버전에선 기상 특보가 내려올 때만 자동으로 이 배경·효과가 적용돼요.`, ic: ALERT_ICON[v], g:['#6366f1','#22d3ee'], ms:5600 });
      } else {
        toast({ t:'배경 하늘 변경', m:`${label}로 바꿨어요.`, ic:'i-sun' });
      }
    }
    $$('#stSky button').forEach(b => b.onclick = () => pickSky(b));
    $$('#stAlerts button').forEach(b => b.onclick = () => pickSky(b));
    $('#stTheme').onclick = () => { state.autoTheme = !state.autoTheme; if(!state.autoTheme){ state.themeOverride = themeOf()==='light'?'dark':'light'; } save(); applyTheme(); closeModal(); openSettings(); };
    $('#stReset').onclick = () => { S.reset(); location.reload(); };
  }
  function applySettingsUI(){ applyTheme(true); }

  /* ============================================================
     모달 공용
     ============================================================ */
  function openModal(o){
    const box = $('#modalBox');
    box.className = 'modal' + (o.wide ? ' wide':'');
    box.innerHTML = `
      ${o.ic?`<div class="m-head">`:`<div class="m-head">`}
        ${o.ic?`<div class="wd-dot" style="background:var(--accent-grad)">${ic(o.ic,15)}</div>`:''}
        <div style="min-width:0"><div class="t">${D.$U.esc(o.title)}</div>${o.sub?`<div class="m-sub" style="margin-top:1px">${o.sub}</div>`:''}</div>
        <button class="m-close" data-c>${ic('i-x',13)}</button>
      </div>
      ${o.body?`<div class="m-body">${o.body}</div>`:''}
      ${o.foot!==undefined?`<div class="m-foot">${o.foot}</div>`:''}`;
    $('#ovl').classList.add('show');
    bindClose();
    if (o.body) box.querySelectorAll('.m-body').forEach(b=>b.scrollTop=0);
  }
  function bindClose(){
    $$('#ovl [data-c], #modalBox .m-close').forEach(el => el.onclick = () => closeModal());
    $('#ovl').onclick = e => { if (e.target.id==='ovl') closeModal(); };
  }
  function closeModal(){ $('#ovl').classList.remove('show'); $('#modalBox').innerHTML=''; $('#ovl').onclick=null; }

  /* ============================================================
     렌더 전체
     ============================================================ */
  function render(){
    applyTheme(true);
    applyScale(); applyStockRule();
    if (state.clean) document.body.classList.add('clean-mode');
    if (state.hideWeather) document.body.classList.add('no-wx');
    decideGrid();
    renderSchedule();
    renderTopics();
    renderBrief(false);
  }

  /* ============ 시계/태스크바 ============ */
  function tick(){
    const t = now(), info = D.todayInfo(t);
    $('#tbClock b').textContent = fmtClock(t);
    $('#tbDate').textContent = `${t.getFullYear()}. ${t.getMonth()+1}. ${t.getDate()}. (${info.weekday})`;
    applyAmbience(); // 시간/테마/모드 변화 시에만 스카이·기상효과 갱신
  }

  /* ============ 리사이즈 (이동/드래그는 제거 — 보드는 항상 중앙 고정) ============ */
  function resizeHandle(){
    const b = $('#board');
    const h = document.createElement('div');
    h.style.cssText = 'position:absolute;right:-6px;bottom:-6px;width:20px;height:20px;cursor:nwse-resize;z-index:5;';
    b.appendChild(h);
    let sx=0, sw=0;
    h.addEventListener('pointerdown', e => {
      e.preventDefault(); e.stopPropagation();
      const r = b.getBoundingClientRect();
      boardResize = { sx:e.clientX, sw:r.width };
      h.setPointerCapture(e.pointerId);
    });
    h.addEventListener('pointermove', e => {
      if (!boardResize) return;
      const w = D.$U.clamp(boardResize.sw + (e.clientX - boardResize.sx), 560, window.innerWidth - 40);
      b.style.width = w+'px';
    });
    const end = () => { if (boardResize){ state.boardSize = { w: b.offsetWidth }; save(); boardResize=null; } };
    h.addEventListener('pointerup', end); h.addEventListener('pointercancel', end);
  }

  /* ============ 위젯 세로 높이 조절 (관심사 & 뉴스레터) ============ */
  function applyWidgetHeights(){
    const wt = document.querySelector('.wd[data-w="topics"]');
    const wn = document.querySelector('.wd[data-w="news"]');
    if (wt){
      if (state.topicsHeight){
        wt.style.height = state.topicsHeight + 'px';
        wt.style.maxHeight = 'none';
      } else {
        wt.style.height = '';
        wt.style.maxHeight = '';
      }
    }
    if (wn){
      if (state.newsHeight){
        wn.style.height = state.newsHeight + 'px';
        wn.style.maxHeight = 'none';
      } else {
        wn.style.height = '';
        wn.style.maxHeight = '';
      }
    }
  }

  function toggleWidgetHeight(name){
    const el = document.querySelector(`.wd[data-w="${name}"]`);
    if (!el) return;
    const isTopics = name === 'topics';
    const isExpanded = isTopics ? (state.topicsHeight && state.topicsHeight > 360) : (state.newsHeight && state.newsHeight > 300);
    if (isExpanded){
      if (isTopics) delete state.topicsHeight;
      else delete state.newsHeight;
    } else {
      if (isTopics) state.topicsHeight = 520;
      else state.newsHeight = 360;
    }
    save();
    applyWidgetHeights();
    toast({ t: '위젯 크기 변경', m: `${isTopics ? '관심사 현황' : '뉴스레터'} 높이를 ${isExpanded ? '기본 크기로' : '넓게 확장'} 변경했어요.`, ic: 'i-spark', ms: 1600 });
  }

  function setupWidgetVerticalResizers(){
    applyWidgetHeights();
    ['topics', 'news'].forEach(name => {
      const el = document.querySelector(`.wd[data-w="${name}"]`);
      if (!el || el.querySelector('.wd-v-handle')) return;
      const h = document.createElement('div');
      h.className = 'wd-v-handle';
      h.setAttribute('title', '아래로 드래그하여 세로 크기 조절');
      h.innerHTML = '<span class="v-grip"></span>';
      el.appendChild(h);

      let sy = 0, sh = 0, dragging = false;
      h.addEventListener('pointerdown', e => {
        e.preventDefault(); e.stopPropagation();
        sy = e.clientY;
        sh = el.offsetHeight;
        dragging = true;
        h.setPointerCapture(e.pointerId);
        document.body.classList.add('resizing-v');
      });
      h.addEventListener('pointermove', e => {
        if (!dragging) return;
        const nh = Math.max(160, Math.min(1100, sh + (e.clientY - sy)));
        el.style.height = nh + 'px';
        el.style.maxHeight = 'none';
      });
      const end = () => {
        if (dragging){
          dragging = false;
          document.body.classList.remove('resizing-v');
          if (name === 'topics') state.topicsHeight = el.offsetHeight;
          if (name === 'news') state.newsHeight = el.offsetHeight;
          save();
        }
      };
      h.addEventListener('pointerup', end);
      h.addEventListener('pointercancel', end);
    });
  }

  /* ============ 보드 배치 복원 ============
     드래그 이동 기능 제거에 따라 저장된 위치값은 무시하고 항상 중앙으로 복원.
     과거에 화면 밖으로 밀려나 있던 값이 있어도 다시 가운데로 되돌린다. */
  function restoreGeometry(){
    const b = $('#board');
    if (state.boardPos){ delete state.boardPos; S.save(state); } // 오래된 오프셋 제거
    b.style.left = ''; b.style.top = ''; b.style.transform = ''; b.style.margin = '';
    if (state.boardSize && state.boardSize.w){
      const w = D.$U.clamp(state.boardSize.w, 560, Math.max(560, window.innerWidth - 40));
      b.style.width = w + 'px';
    }
    applyWidgetHeights();
  }

  /* ============================================================
     이벤트 바인딩
     ============================================================ */
  function bind(){
    $('#btnTopicsManage').onclick = openTopicsManage;
    $('#btnTopicAdd').onclick = openTopicsManage;     // 현황 위젯 우상단 + 추가
    $('#btnSettings').onclick = openSettings;
    $('#btnRefresh').onclick = () => {
      const r = $('#refreshIco'); r.style.transform='rotate(180deg)'; r.style.transition='transform .6s';
      setTimeout(()=>{ r.style.transform=''; },700);
      state.demoEvents = null; save();
      render(); renderBrief(true);
      pushLog('모든 데이터를 새로고침했습니다');
      toast({t:'새로고침 완료', m:'iCloud 일정·관심사·브리핑을 최신 상태로 갱신했어요.', ic:'i-reload', g:['#6366f1','#22d3ee']});
    };
    $('#btnNewsReload').onclick = () => { renderBrief(true); toast({t:'브리핑 다시 편집', m:'관심사 기준으로 편집자가 소식을 다시 골랐어요.', ic:'i-mag'}); };
    $('#schedSync').onclick = () => {
      if (window.__hostRefresh){ window.__hostRefresh.refreshEvents(); renderSchedule(); }
      else { openICloudGuide(); }
    };
    $('#btnAddEvent').onclick = addDemoEventModal;
    $('#tbCal').onclick = () => { renderSchedule(); toast({t:'오늘 일정', m:'일정 위젯을 최신화했어요.', ic:'i-cal'}); };
    $('#tbStartBtn').onclick = () => { $('#board').scrollIntoView({behavior:'smooth', block:'center'}); };
    $('#tbTopics').onclick = openTopicsManage;
    $('#tbMail').onclick = () => { renderBrief(true); toast({t:"TODAY'S BRIEFING", m:'편집자가 관심사별 소식을 다시 골랐어요.', ic:'i-mail', g:['#f59e0b','#ef4444']}); };
    $('#tbTheme').onclick = toggleTheme;

    /* 브리핑 가로 레일 */
    $('#railPrev').onclick = () => scrollBrief(-1);
    $('#railNext').onclick = () => scrollBrief(1);

    /* 피드백 반영 받기 : 버튼 → 확장 챗바 */
    $('#fbPill').onclick = openFeedback;
    $('#fbClose').onclick = closeFeedback;
    if ($('#btnTopicsHeight')) $('#btnTopicsHeight').onclick = () => toggleWidgetHeight('topics');
    if ($('#btnNewsHeight')) $('#btnNewsHeight').onclick = () => toggleWidgetHeight('news');
    setupWidgetVerticalResizers();
    startBriefAutoSlide();

    $('#undoChip').onclick = undo;
    $('#fbSend').onclick = submitFeedback;
    $('#fbInput').addEventListener('keydown', e => {
      if (e.key === 'Enter'){ submitFeedback(); }
      else if (e.key === 'Escape'){ closeFeedback(); }
    });
    window.addEventListener('keydown', e => {
      if (e.key === 'Escape' && document.querySelector('#fbRoot').classList.contains('open')) closeFeedback();
    });
    showHints();
    renderPatchFoot();
    watchBuild();
    setInterval(watchBuild, 15000);
    setInterval(autoRefreshTopics, 5000);
    setInterval(tick, 1000);
    setInterval(() => { renderSchedule(); }, 30000);
  }

  /* ============ 자동 갱신 (관심사별 실제 갱신 주기에 맞춰 백그라운드 실시간 동기화) ============
     - 주식/코인: 20초 · 환율: 30초 · 스포츠: 3분 · 날씨/뉴스: 5분
     - 브리핑 레일이나 화면 깜빡임 없이 해당 타일의 실시간 숫자·스파크만 제자리에서 갱신 */
  const lastTopicFetch = {};
  function autoRefreshTopics(){
    if (!LIVE) return;
    const n = Date.now();
    state.topics.forEach(t => {
      const p = payloadOf(t);
      const cadence = (p && p.cadence) || (
        t.kind === 'coin' ? 20000 : (t.kind === 'stock' ? 20000 : (t.kind === 'fx' ? 30000 : (t.kind === 'sport' ? 180000 : 300000)))
      );
      const last = lastTopicFetch[t.id] || 0;
      if (n - last >= cadence){
        lastTopicFetch[t.id] = n;
        loadTopicPayload(t, { fresh: true, single: true, background: true });
      }
    });
  }

  /* 새로고침 후: 방금 코드에 반영된 내용을 이어서 알려준다 */
  function announcePendingPatch(){
    let note = null;
    try { note = JSON.parse(sessionStorage.getItem('bpPatchNote') || 'null'); sessionStorage.removeItem('bpPatchNote'); } catch (e) {}
    if (!note || !note.titles || !note.titles.length) return;
    setTimeout(() => {
      toast({ t: '피드백이 코드로 반영됨', m: `“${note.text.slice(0, 30)}${note.text.length > 30 ? '…' : ''}” → ${note.titles.join(', ')} 이(가) 화면에 적용됐어요.`, ic: 'i-check', g: ['#22c55e', '#6366f1'], ms: 8000 });
      pushLog(`[코드 반영] 화면 갱신 완료 — ${D.$U.esc(note.titles.join(' · '))}`);
    }, 700);
  }
  /* 서버에서 빌드가 바뀌었으면(예: 터미널에서 패치 적용) 자동으로 다시 그린다 */
  async function watchBuild(){
    if (!LIVE || !/^https?:$/.test(location.protocol)) return;
    try {
      const r = await apiGet('/api/build');
      if (!r || !r.hash) return;
      if (!BUILD_HASH){ BUILD_HASH = r.hash; return; }
      if (r.hash === BUILD_HASH) return;
      const inp = $('#fbInput');
      if (inp && inp.value.trim()){ setTimeout(watchBuild, 9000); return; }     // 입력 중이면 기다린다
      if (document.querySelector('#ovl.show')) { setTimeout(watchBuild, 9000); return; }
      BUILD_HASH = r.hash;
      pushLog('코드 빌드가 갱신됐어요 — 화면을 새로 그립니다');
      setTimeout(() => location.reload(), 350);
    } catch (e) {}
  }
  /* 피드백 칸 아래: 적용된 코드 패치 개수/관리 */
  async function renderPatchFoot(){
    const box = $('#fbPatchFoot');
    if (!box) return;
    if (!LIVE){ box.innerHTML = ''; return; }
    let r = null;
    try { r = await apiGet('/api/feedback/patches'); } catch (e) {}
    const n = (r && r.patches && r.patches.length) || 0;
    box.innerHTML = n
      ? `<button class="fh patch" id="fbPatchBtn">${ic('i-edit', 11)} 적용된 코드 패치 <b>${n}</b>개 — 보기·되돌리기</button>`
      : `<span class="muted" style="font-size:10.5px">${ic('i-spark', 10)} 요청을 문자로 적으면 <b>코드를 새로 만들어</b> 반영해요 — 예: “날씨를 오전/오후로 나눠서”</span>`;
    const b = $('#fbPatchBtn');
    if (b) b.onclick = openPatchManager;
  }
  async function openPatchManager(){
    let r = null;
    try { r = await apiGet('/api/feedback/patches'); } catch (e) {}
    const rows = (r && r.patches) || [];
    openModal({
      title: '적용된 코드 패치', ic: 'i-edit', wide: true,
      body: `<div class="m-sub">피드백에서 생성된 코드 파일입니다. 삭제하면 바로 되돌려집니다.</div>
        ${rows.length ? rows.map(x => `<div class="log-row"><span class="lm"><b>${D.$U.esc(x.title || x.op)}</b> — ${D.$U.esc(x.log || '')}
            <div class="muted" style="font-size:10px;margin-top:2px">요청: “${D.$U.esc(String(x.request || '').slice(0, 70))}” · src/patches/${D.$U.esc(x.file || '')}</div></span>
          <span style="margin-left:auto;display:flex;gap:4px"><button class="btn" data-code="${D.$U.esc(x.id)}">코드</button><button class="btn" data-del="${D.$U.esc(x.id)}">삭제</button></span></div>`).join('')
          : `<div class="m-sub">아직 생성된 코드가 없어요.</div>`}`,
      foot: `<button class="btn" data-clear>모두 되돌리기</button><div style="flex:1"></div><button class="btn ghost" data-c>닫기</button>`,
    });
    const box = $('#modalBox');
    box.querySelectorAll('[data-code]').forEach(b => b.onclick = async () => {
      const src = await apiGet('/api/feedback/patch?id=' + encodeURIComponent(b.dataset.code));
      openModal({ title: b.dataset.code + '.js', ic: 'i-edit', wide: true,
        body: `<div class="code-box" style="max-height:52vh;overflow:auto;white-space:pre-wrap;font-size:10px;line-height:1.65">${D.$U.esc((src && src.code) || '코드를 읽을 수 없어요')}</div>`,
        foot: `<button class="btn primary" data-c>닫기</button>` });
    });
    box.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => {
      await apiPost('/api/feedback/undo', { ids: [b.dataset.del] }).catch(() => ({}));
      closeModal(); renderPatchFoot();
      toast({ t: '패치를 되돌렸어요', m: '파일을 지우고 다시 빌드했습니다. 새로고침하면 원래 표시로 돌아갑니다.', ic: 'i-check' });
    });
    const cl = box.querySelector('[data-clear]');
    if (cl) cl.onclick = async () => {
      await apiPost('/api/feedback/clear', {}).catch(() => ({}));
      closeModal(); renderPatchFoot();
      toast({ t: '모든 코드 패치를 되돌렸어요', ic: 'i-check', m: '새로고침하면 초기 코드로 표시됩니다.' });
    };
  }
  function openFeedback(){
    const root = document.querySelector('#fbRoot');
    root.classList.add('open');
    setTimeout(() => { const i = $('#fbInput'); if (i) i.focus(); }, 420);
  }
  function closeFeedback(){
    const root = document.querySelector('#fbRoot');
    root.classList.remove('open');
    const i = $('#fbInput'); if (i) i.blur();
  }

  /* ============ BOOT ============ */
  function boot(){
    if (!state.topics || !state.topics.length){
      state.topics = D.defaultTopics();
      pushLog('시작: 관심사 기본값 등록 (맨시티 · 비트코인 · 마인크래프트 · 조류 — 실제 소식 연결)');
    }
    restoreGeometry();
    bind();
    announcePendingPatch();
    resizeHandle();
    render();
    tick();
    renderBrief(true);
    setAI('편집 준비 완료. 관심사(맨시티·비트코인 등)를 추가하면 실제 소식이 카드와 브리핑에 반영돼요.');
    toast({ t:"TODAY'S BRIEFING", m:'뉴스를 모아주는 게 아니라, 당신 관심사 기준으로 편집해 드립니다. 카드의 “관심없음”으로 편집 취향을 가르쳐 주세요.', ic:'i-mag', g:['#f59e0b','#ef4444'] });
  }

  /* 네이티브(Host) 어댑터용 공개 API — 라이브 데이터 수신 후 최소 재렌더 */
  window.__boardApi = {
    rerenderBrief: () => renderBrief(true),
    rerenderSchedule: () => renderSchedule(),
    livePayloads: () => Object.fromEntries(Object.keys(livePayload).map(k => [k, { status: livePayload[k].status, kind: livePayload[k].kind, err: livePayload[k].err, hasData: !!livePayload[k].data }])),
  };
  boot();
})();
