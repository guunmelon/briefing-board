/* ============================================================
   DATA — 콘텐츠 엔진 (라이브 우선)
   ─────────────────────────────────────────────────────────────
   원칙: 실데이터가 아니면 "가짜 수치/껍데기"를 만들지 않는다.
   - 관심사 타일·뉴스레터는 실시간 소스(live-server / 네이티브 API)로부터 받은
     payload 를 그대로 그린다. 로딩 중엔 스켈레톤, 서버가 없으면 연결 안내만.
   - 관심사 종류: news(실시간 뉴스) · coin(코인 시세) · stock(주식 시세)
                  · weather(날씨) · personal(개인 상태 — 소스 연결 전 안내)
   - 개인 데이터(운동·건강·습관·프로젝트)는 실소스 연결 전 숫자를 만들지 않고
     진행 게이지 틀 + "연결 필요"만 보여준다.
   ============================================================ */
(function (global) {
  'use strict';

  const $U = {
    pad: n => String(n).padStart(2, '0'),
    fmtKR(n){
      const s = Math.abs(n);
      if (s >= 1e12) return (n / 1e12).toFixed(2).replace(/\.00$/, '') + '조';
      if (s >= 1e8)  return (n / 1e8).toFixed(2).replace(/\.00$/, '') + '억';
      if (s >= 1e4)  return (n / 1e4).toFixed(1).replace(/\.0$/, '') + '만';
      return n.toLocaleString('ko-KR');
    },
    fmt(n){ return n.toLocaleString('ko-KR'); },
    esc(s){ return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])); },
    uid(p){ return (p || 'x') + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6); },
    clamp(n,a,b){ return Math.min(b, Math.max(a, n)); },
    ago(pub){
      const t = Date.parse(String(pub || ''));
      if (isNaN(t)) return '';
      const m = Math.round((Date.now() - t) / 60000);
      if (m < 1) return '방금';
      if (m < 60) return m + '분';
      const h = Math.round(m / 60);
      if (h < 24) return h + '시간';
      return Math.round(h / 24) + '일';
    },
    sparkSvg(spark, w, h, c1, c2, id){
      if (!Array.isArray(spark) || spark.length < 2) return '';
      const min = Math.min(...spark), max = Math.max(...spark), rng = (max - min) || 1;
      const pad = rng === 0 ? 2 : 0;
      const lo = min - pad, hi = max + pad;
      const n = spark.length;
      const pts = spark.map((v, i) => `${((i / (n - 1)) * (w - 2) + 1).toFixed(1)},${((h - 2) * (1 - (v - lo) / (hi - lo)) + 1).toFixed(1)}`).join(' ');
      return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">
        <defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="${c1}" stop-opacity=".30"/><stop offset="1" stop-color="${c1}" stop-opacity="0"/>
        </linearGradient></defs>
        <polygon points="0,${h} ${pts} ${w},${h}" fill="url(#${id})"/>
        <polyline points="${pts}" fill="none" stroke="${c1}" stroke-width="1.7" stroke-linejoin="round" stroke-linecap="round"/>
      </svg>`;
    },
  };
  const esc = $U.esc;

  /* ---------- 일정 도우미 ---------- */
  const WEEK_KO = ['일','월','화','수','목','금','토'];
  const WD = ['일요일','월요일','화요일','수요일','목요일','금요일','토요일'];
  function todayInfo(now){
    const t = new Date(now);
    return { date: now, ymd:`${t.getFullYear()}. ${t.getMonth()+1}. ${t.getDate()}.`,
      weekday: WEEK_KO[t.getDay()], weekdayLong: WD[t.getDay()],
      month: t.getMonth()+1, day: t.getDate(), dow: t.getDay(), hour: t.getHours(), min: t.getMinutes() };
  }
  function greet(now, events, userName){
    const h = now.getHours();
    const hello = h < 5 ? '깊은 밤이에요' : h < 11 ? '좋은 아침이에요' : h < 17 ? '안녕하세요' : h < 22 ? '좋은 저녁이에요' : '안녕히 주무세요';
    const nowEv = events.find(e => e.state === 'now');
    const up = events.filter(e => e.state === 'up');
    const done = events.filter(e => e.state === 'done').length;
    let sub;
    if (nowEv) sub = `지금은 <b>${esc(nowEv.title)}</b> 시간이에요.`;
    else if (up.length){
      const next = up[0];
      const mins = Math.round((next.st - now) / 60000);
      sub = `다음 일정 <b>${esc(next.title)}</b> ${mins < 60 ? mins + '분' : (mins / 60).toFixed(1) + '시간'} 전이에요.`;
    } else sub = `오늘 일정은 모두 끝났어요 (${done}건 완료). 편안한 저녁 되세요.`;
    return { hello: `${hello}, ${userName || ''} 님`, sub, dayPart: '', done, total: events.length, up };
  }
  function blockName(now){
    const x = now.getHours() * 60 + now.getMinutes();
    if (x < 9 * 60) return '아침 루틴';
    if (x < 12 * 60) return '오전 업무';
    if (x < 13 * 60) return '점심';
    if (x < 18 * 60) return '오후 업무';
    if (x < 20 * 60) return '저녁 전';
    return '저녁/휴식';
  }
  function buildDemoEvents(now){ return []; }   // 가짜 일정 시드 제거 — 실데이터(iCloud)만

  /* ---------- 관심사 종류 카탈로그 (라이브 대응 5종) ---------- */
  const KIND = {
    news:     { label: '뉴스/트렌드', icon: 'i-mag',  c1: '#f472b6', c2: '#f59e0b', ch: '소식' },
    coin:     { label: '코인 시세',   icon: 'i-spark', c1: '#8b5cf6', c2: '#f472b6', ch: '코인' },
    stock:    { label: '주식 시세',   icon: 'i-bars',  c1: '#f59e0b', c2: '#ef4444', ch: '주식' },
    weather:  { label: '날씨',        icon: 'i-sun',   c1: '#38bdf8', c2: '#818cf8', ch: '날씨' },
    sport:    { label: '스포츠',      icon: 'i-flag',  c1: '#3b82f6', c2: '#22d3ee', ch: '경기' },
    fx:       { label: '환율',        icon: 'i-bars',  c1: '#3b82f6', c2: '#06b6d4', ch: '환율' },
    personal: { label: '개인 상태',   icon: 'i-heart', c1: '#22c55e', c2: '#14b8a6', ch: '개인' },
  };
  const LEGACY_KIND = { crypto:'coin', fitness:'personal', health:'personal', habit:'personal', project:'personal' };
  function normalizeTopic(t){
    const kind = KIND[t.kind] ? t.kind : (LEGACY_KIND[t.kind] || (t.kind ? 'news' : 'news'));
    const o = { id: t.id || $U.uid('t'), label: String(t.label || '주제'), kind, tpl: t.tpl || 'a',
      cfg: t.cfg || {}, interest: t.interest || t.label || '' };
    if (t.key) o.key = t.key;
    if (t.brief !== undefined) o.brief = !!t.brief;
    return o;
  }

  /* 기본 관심사 — server(live) 키와 id 를 맞춘다 */
  function defaultTopics(){
    return [
      { id: 'mancity',   key: 'mancity',   label: '맨시티',      kind: 'sport', tpl: 'a', brief: true,  interest: '맨시티 · 프리미어리그 축구' },
      { id: 'bitcoin',   key: 'bitcoin',   label: '비트코인',    kind: 'coin',  tpl: 'a', brief: true,  interest: '비트코인 · 암호화폐' },
      { id: 'minecraft', key: 'minecraft', label: '마인크래프트', kind: 'news', tpl: 'a', brief: true,  interest: '마인크래프트 · 게임' },
      { id: 'birds',     key: 'birds',     label: '조류',        kind: 'news',  tpl: 'a', brief: true,  interest: '조류 · 새 관찰(버드워칭)' },
    ].map(normalizeTopic);
  }

  /* ---------- 카테고리 색상 메타 (카드/뉴스레터 장식) ---------- */
  const CAT_META = {
    sport:   { nm: '스포츠',   c: ['#3b82f6', '#22d3ee'], icon: 'i-flag' },
    crypto:  { nm: '코인',     c: ['#8b5cf6', '#ec4899'], icon: 'i-spark' },
    game:    { nm: '게임',     c: ['#34d399', '#0ea5e9'], icon: 'i-spark' },
    nature:  { nm: '자연·조류', c: ['#10b981', '#a3e635'], icon: 'i-sun' },
    stock:   { nm: '주식',     c: ['#f59e0b', '#ef4444'], icon: 'i-bars' },
    weather: { nm: '날씨',     c: ['#38bdf8', '#818cf8'], icon: 'i-sun' },
    fx:      { nm: '환율',     c: ['#3b82f6', '#22d3ee'], icon: 'i-bars' },
    science: { nm: '과학·기술', c: ['#06b6d4', '#8b5cf6'], icon: 'i-spark' },
    global:  { nm: '글로벌',   c: ['#0ea5e9', '#6366f1'], icon: 'i-open' },
    personal:{ nm: '개인',     c: ['#22c55e', '#14b8a6'], icon: 'i-heart' },
    news:    { nm: '소식',     c: ['#f472b6', '#f59e0b'], icon: 'i-mag' },
    default: { nm: '소식',     c: ['#64748b', '#94a3b8'], icon: 'i-mag' },
  };
  const TOPIC_LABEL_CAT = {
    '맨시티':'sport', '비트코인':'crypto', '마인크래프트':'game', '조류':'nature',
    '버드워칭':'nature', '조류 관찰':'nature',
  };
  function catOf(cat){ return CAT_META[cat] || CAT_META.default; }
  function catForTopic(topic){
    const lbl = topic.label || '';
    if (TOPIC_LABEL_CAT[lbl]) return TOPIC_LABEL_CAT[lbl];
    if (KIND[topic.kind]){
      if (topic.kind === 'coin') return 'crypto';
      if (topic.kind === 'stock') return 'stock';
      if (topic.kind === 'weather') return 'weather';
      if (topic.kind === 'fx') return 'fx';
      if (topic.kind === 'personal') return 'personal';
      if (topic.kind === 'sport') return 'sport';
    }
    // 카테고리 사전 매칭(과학/경제/게임 등)
    const newsCat = [['과학','science'],['기술','science'],['경제','global'],['정치','global'],['게임','game'],['축구','sport'],['음악','news']];
    for (const [w, c] of newsCat) if (lbl.includes(w)) return c;
    return 'news';
  }

  /* ---------- 관심사 라벨 분류 (로컬 1차 추정 — 서버가 최종 판정/데이터) ---------- */
  const CITY_NAMES = ['서울','부산','인천','대구','대전','광주','울산','수원','제주','세종'];
  /* 회사 이름처럼 보이는지(주식 후보) — 서버가 실제 종목 해석, 여기선 1차 분류용 */
  const KR_COMPANY_TAIL = /(전자|화학|제약|바이오|생명|보험|증권|카드|지주|항공|철강|에너지|모터스|모비스|물산|건설|조선|중공업|소프트|테크|테크놀로지|케미칼|디스플레이|솔루션|엔터|푸드|리테일|마트|글로비스|모터|에어로스페이스|바이오로직스)$/;
  const WORLD_KO_STOCK = ['애플','테슬라','알파벳','구글','마이크로소프트','엔비디아','아마존','메타','넷플릭스','인텔','보잉','디즈니'];
  const EN_CONTENT_STOP = new Set(['minecraft','football','soccer','music','movie','film','camera','youtube','gaming','game','games','science','space','nasa','f1','bird','birds','birding','travel','food','fashion','art','books','kpop','drama','anime','crypto','weather','news','stock','technology','fitness','cooking','coding','language']);
  function isCompanyish(label){
    const l = String(label || '').trim();
    if (!l) return false;
    if (/[가-힣]/.test(l)){
      if (KR_COMPANY_TAIL.test(l)) return true;
      return WORLD_KO_STOCK.some(k => l.includes(k));
    }
    const toks = l.toLowerCase().replace(/[^a-z0-9&. ]+/g, ' ').trim().split(/\s+/).filter(Boolean);
    if (!toks.length) return false;
    if (toks.length === 1 && toks[0].length < 4) return false;
    return !toks.some(t => EN_CONTENT_STOP.has(t));
  }
  const SPORT_TEAM_KO = ['맨시티','맨체스터 시티','맨유','리버풀','아스널','아스날','첼시','토트넘','스퍼','뉴캐슬','아스톤빌라','레알','레알마드리드','바르샤','바르셀로나','뮌헨','바이에른','도르트문트','파리생제르맹','psg','인터밀란','인테르','유벤투스','나폴리','셀틱','다저스','양키스','레드삭스','보스턴','컵스','메츠','애스트로스','레이커스','셀틱스','워리어스','골든스테이트','너겟츠','닉스','불스','선스','벅스','kbo','nba','mlb','nhl','epl','프리미어리그','분데스리가','세리에a','라리가','리그앙','챔피언스리그','유로파'];
  const SPORT_WORD_RE = /(축구|야구|농구|배구|핸드볼|하키|테니스|골프|권투|ufc|구단|킥오프|원정|홈경기|경기 일정|리그)/i;
  function isSportsLabel(label){
    const low = String(label || '').toLowerCase().replace(/\s+/g, '');
    if (!low) return false;
    if (SPORT_TEAM_KO.some(k => low.includes(k.toLowerCase()))) return true;
    return SPORT_WORD_RE.test(low);
  }
  /* 밀리초 → 사람이 읽는 남은 시간 ('3일 4시간', '4시간 12분', '12분', '지금') */
  function durTxt(ms){
    if (ms == null || isNaN(ms)) return '--';
    const abs = Math.abs(ms);
    const d = Math.floor(abs / 86400000), h = Math.floor(abs % 86400000 / 3600000), m = Math.floor(abs % 3600000 / 60000);
    if (d >= 2) return `${d}일 ${h}시간`;
    if (d === 1) return `${d}일 ${h}시간`;
    if (h >= 1) return `${h}시간 ${m}분`;
    if (m >= 1) return `${m}분`;
    return '지금';
  }
  function classifyLabel(label){
    const l = String(label || '').trim().toLowerCase();
    if (/(습관|루틴|독서|명상|스트릭|달성|목표|프로젝트|걸음|수면|체중|기록|운동|헬스|러닝|달리기|만보|걷기|요가|스트레칭)/.test(l) || /주\s*\d+\s*회/.test(l)) return 'personal';
    if (/날씨|기상|온도|강수/.test(l)) return 'weather';
    if (isSportsLabel(label)) return 'sport';      // 팀·리그 확인 → 경기 일정/결과형 위젯
    if (/비트코인|이더리움|리플|도지|솔라나|에이다|수이|코인|가상자산|암호화폐|bitcoin|ethereum|btc|eth|xrp/.test(l)) return 'coin';
    if (/환율|환전|외환/.test(l)) return 'fx';
    if (/미국 달러|홍콩달러|캐나다달러|호주달러|달러|엔화|위안|유로|파운드|usd|jpy|cny|eur|gbp/.test(l)) return 'fx';
    if (/엔/.test(l) && !/엔터|엔씨|엔비|엔진/.test(l) && /(^|[^가-힣a-z])엔([^가-힣a-z]|$)/.test(l)) return 'fx';
    if (/주식|주가|증시|코스피|코스닥|전자|하이닉스|카카오|네이버|현대차|기아|셀트리온|금융지주|lg|sk|삼성|포스코|posco|hmm|^\d{6}$/.test(l)) return 'stock';
    if (isCompanyish(label)) return 'stock';      // 애플·테슬라·알파벳·삼성전자 등 회사명 → 주식
    return 'news';
  }
  function topicShort(label){
    const l = String(label || '');
    for (const c of CITY_NAMES) if (l.includes(c) && /날씨|기상/.test(l)) return c + ' 날씨';
    const cut = l.replace(/시세|가격|뉴스|소식|트렌드|관찰|최신|주가|정보/g, '').trim();
    return cut || l || '이 주제';
  }

  /* ============================================================
     타일 본문 — payload {status, kind, data} 를 받아 실제 카드를 그린다
     status: 'loading' | 'ok' | 'error' | 'off'   (data 는 서버/API 실데이터)
     ============================================================ */
  const ic = (n, w = 13) => `<svg width="${w}" height="${w}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><use href="#${n}"/></svg>`;

  function tileSkeleton(kind){
    const kindMeta = KIND[kind] || KIND.news;
    return `<div class="live-skel">
      <span class="sk sh" style="width:58%"></span><span class="sk sh" style="width:34%"></span>
      <span class="sk big" style="width:46%"></span><span class="sk sh" style="width:70%"></span>
      <span class="sk bar" style="width:100%"></span>
      <div class="minirow"><span class="k" style="color:${kindMeta.c1}">불러오는 중</span><span class="v" style="font-size:10.5px;color:var(--ink-3)">실시간 소스 연결…</span></div>
    </div>`;
  }
  /* 스포츠 미리보기 시안 — 실데이터 연결 전 골격(숫자·팀승부 만들지 않음) */
  function sportDraftInner(topic){
    const slot = (label) => `<div class="minirow"><span class="k">${label}</span><span class="v" style="color:var(--ink-3)">—</span></div>`;
    return `<div style="display:flex;gap:8px;align-items:flex-end">
        <span class="kicker" style="color:${KIND.sport.c1}">시안 · 경기 데이터 연결 전</span>
        <span class="kicker muted" style="margin-left:auto">실시간 소스 연결 후 채워짐</span></div>
      <div class="goal-line" style="font-size:13px;margin-top:3px">${esc(topicShort(topic.label))} — 다음 경기</div>
      <div class="skline w70" style="margin:6px 0 0"></div>
      ${slot('킥오프')}${slot('남은 시간')}${slot('경기장')}${slot('최근 결과')}${slot('최근 5경기')}`;
  }
  function tileOffline(kindMeta, topic){
    return `<div class="goal-line">실시간 서버 연결 필요</div>
      <div class="goal-sub" style="margin-top:4px">브라우저 데모는 미니 실시간 서버가 있어야 실제 데이터가 표시돼요. (아래 명령 실행 후 새로고침)</div>
      <div class="minirow" style="flex-wrap:wrap"><span class="k">실행</span><span class="v" style="font-family:ui-monospace,monospace;font-size:10px;word-break:break-all">node tools/live-server.js</span></div>`;
  }
  function tileError(kindMeta){
    return `<div class="goal-line">데이터를 불러오지 못했어요</div>
      <div class="goal-sub">잠시 후 카드의 새로고침 아이콘으로 다시 시도해 주세요.</div>
      <div class="minirow"><span class="k">상태</span><span class="v" style="color:var(--bad)">연결 실패</span></div>`;
  }

  /* --- 큰 숫자(+등락+스파크) 공통 --- */
  function bigDelta(price, prev, chgPct, chgAbs, fmt, unitTxt){
    const dir = chgPct > 0.0001 ? 'up' : (chgPct < -0.0001 ? 'down' : 'flat');
    const arrow = chgPct > 0.0001 ? '▲' : (chgPct < -0.0001 ? '▼' : '');
    return `<div class="big" style="letter-spacing:-.02em">${fmt(price)}<small style="font-size:10px;margin-left:2px">${esc(unitTxt || '')}</small></div>
      <div class="delta ${dir}" style="margin-top:2px">${arrow} ${Math.abs(chgPct).toFixed(2)}% <span style="font-weight:500;color:var(--ink-3)">(${chgPct >= 0 ? '+' : ''}${fmt(Math.abs(chgAbs))})</span></div>`;
  }

  function quoteInner(topic, payload){
    const q = payload.data;
    const kindMeta = KIND[topic.kind];
    const c1 = kindMeta.c1, c2 = kindMeta.c2;
    const isCoin = topic.kind === 'coin';
    const isUsd = !isCoin && topic.kind === 'stock' && q.currency === 'USD';
    const fmt = isCoin ? $U.fmtKR : (isUsd
      ? (v => v.toLocaleString('ko-KR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }))
      : $U.fmt);
    const name = q.name || topicShort(topic.label);
    const unitTxt = isCoin ? 'KRW' : (isUsd ? '달러' : '원');
    const gid = 'sp' + (topic.id || '').replace(/[^a-zA-Z0-9]/g, '') + Math.round(q.price || 0);
    const tpl = topic.tpl || 'a';
    const headline = `<div style="display:flex;gap:8px;align-items:flex-start">
        <span class="kicker" style="flex:0 0 auto;margin-top:4px">${esc(name)}${q.code ? ' · ' + esc(q.code) : ''}</span>
        <span class="kicker muted" style="margin-left:auto;padding-top:4px;font-size:9.5px">${esc(q.source || (isCoin ? '실시간·Upbit' : (isUsd ? 'Yahoo 실시간' : 'KRX 실세시세')))}${q.asOf ? ' · ' + esc(q.asOf.replace(/^.*T/, '').replace(/\+.*$/, '').slice(0, 5)) : ''}</span>
      </div>`;
    const sparkBlock = (h) => `<div class="sparkwrap" style="height:${h}px;margin-top:2px">${q.spark && q.spark.length >= 2
      ? $U.sparkSvg(q.spark, 26, h, c1, c2, gid) : '<div class="muted" style="font-size:10px;padding-top:14px">차트 데이터 없음</div>'}</div>`;
    if (tpl === 'b'){  // 시계열 중시(더 넓은 스파크)
      return headline + bigDelta(q.price, q.prev, q.chgPct, q.chgAbs || 0, fmt, unitTxt) + sparkBlock(56)
        + `<div class="minirow"><span class="k">고가/저가(24H)</span><span class="v" style="font-size:10.5px">${fmt(q.high || q.price)} / ${fmt(q.low || q.price)}</span></div>`;
    }
    if (tpl === 'c'){  // 컴팩트 숫자+등락
      return `<div class="tile-mid" style="display:flex;align-items:baseline;gap:8px"><span class="kicker" style="flex:0 0 auto">${esc(name)}</span>
        <div class="big" style="font-size:19px;margin-left:auto">${fmt(q.price)}<small style="font-size:9px"> ${unitTxt}</small></div></div>`
        + `<div class="delta ${q.chgPct > 0 ? 'up' : q.chgPct < 0 ? 'down' : 'flat'}" style="text-align:right">${q.chgPct >= 0 ? '▲' : '▼'} ${Math.abs(q.chgPct).toFixed(2)}%</div>`
        + sparkBlock(30);
    }
    // a: 큰숫자+등락+스파크 기본
    return headline + `<div class="tile-mid" style="display:flex;gap:12px;align-items:flex-end;margin-top:2px">${bigDelta(q.price, q.prev, q.chgPct, q.chgAbs || 0, fmt, unitTxt)}</div>` + sparkBlock(38);
  }

  /* --- 환율(FX): 큰 숫자(2자리)+전일 등락+일봉 스파크 --- */
  function fxInner(topic, payload){
    const q = payload.data;
    const kindMeta = KIND.fx;
    const c1 = kindMeta.c1, c2 = kindMeta.c2;
    const tpl = topic.tpl || 'a';
    const f = v => (v == null ? '--' : v < 1
      ? v.toLocaleString('ko-KR', { minimumFractionDigits: 4, maximumFractionDigits: 4 })
      : v.toLocaleString('ko-KR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
    const name = q.name || topicShort(topic.label);
    const dir = q.chgPct > 0.0001 ? 'up' : (q.chgPct < -0.0001 ? 'down' : 'flat');
    const arrow = q.chgPct > 0.0001 ? '▲' : (q.chgPct < -0.0001 ? '▼' : '');
    const sparkArr = (Array.isArray(q.spark) && q.spark.length >= 2) ? q.spark : null;
    const gid = 'fxs' + (topic.id || '').replace(/[^a-zA-Z0-9]/g, '');
    const asOfTag = q.asOf ? (q.cadence === 'realtime' ? q.asOf.replace(/^.*T/, '').replace(/\..*$/, '').slice(0, 5) + ' 실시간' : (q.date || '') + ' 기준') : '';
    const srcTag = q.cadence === 'realtime' ? '실시간 호가(1분)' : '공식 기준환율';
    const head = `<div style="display:flex;gap:8px;align-items:flex-start">
        <span class="kicker" style="flex:0 0 auto;margin-top:4px">${esc(name)} · ${esc(q.pair || '')}</span>
        <span class="kicker muted" style="margin-left:auto;padding-top:4px;font-size:9.5px">${esc(srcTag)}${asOfTag ? ' · ' + esc(asOfTag) : ''}</span>
      </div>`;
    const unitTag = `<small style="font-size:10px;margin-left:2px">원</small>`;
    const bigLine = `<div class="big" style="letter-spacing:-.02em">${f(q.price)}${unitTag}</div>
      <div class="delta ${dir}" style="margin-top:2px">${arrow} ${Math.abs(q.chgPct).toFixed(2)}% <span style="font-weight:500;color:var(--ink-3)">(전일대비 ${q.chgPct >= 0 ? '+' : ''}${f(Math.abs(q.chgAbs))}원)</span></div>`;
    const sparkBlock = (h) => `<div class="sparkwrap" style="height:${h}px;margin-top:2px">${sparkArr
      ? $U.sparkSvg(sparkArr, 26, h, c1, c2, gid) : '<div class="muted" style="font-size:10px;padding-top:14px">일봉 데이터 없음</div>'}</div>`;
    if (tpl === 'b'){
      return head + bigLine + sparkBlock(58)
        + `<div class="minirow"><span class="k">기간 고가/저가</span><span class="v" style="font-size:10.5px">${f(q.high)} / ${f(q.low)}</span></div>
           <div class="minirow"><span class="k">기준일</span><span class="v" style="font-size:10px;color:var(--ink-3)">${esc(q.date || '')} · ${esc(q.source || '')}</span></div>`;
    }
    if (tpl === 'c'){
      return `<div class="tile-mid" style="display:flex;align-items:baseline;gap:8px"><span class="kicker" style="flex:0 0 auto">${esc(name)}</span>
        <div class="big" style="font-size:19px;margin-left:auto">${f(q.price)}${unitTag}</div></div>
        <div class="delta ${dir}" style="text-align:right">${arrow} ${Math.abs(q.chgPct).toFixed(2)}%</div>` + sparkBlock(26);
    }
    return head + `<div class="tile-mid" style="display:flex;gap:12px;align-items:flex-end;margin-top:2px">${bigLine}</div>` + sparkBlock(38)
      + `<div class="minirow"><span class="k">출처</span><span class="v" style="font-size:10px;color:var(--ink-3)">${esc(q.source || '')} · ${esc(q.date || '')}</span></div>`;
  }

  /* --- 날씨 --- */
  function weatherInner(topic, payload){



    const w = payload.data;
    const kindMeta = KIND.weather;
    const city = w.city || topicShort(topic.label) || '서울';
    const tpl = topic.tpl || 'a';
    const todayMax = (w.weekMax && w.weekMax[0]) || w.max;
    const todayMin = (w.weekMin && w.weekMin[0]) || w.min;
    const head = `<div style="display:flex;gap:8px;align-items:center"><span class="kicker">${esc(city)} · 실시간</span>
      <span class="kicker muted" style="margin-left:auto">${esc(w.cond || '')}</span></div>`;
    if (tpl === 'c'){
      return head + `<div class="tile-mid" style="display:flex;align-items:center;gap:10px">
        <div class="big" style="font-size:30px">${w.temp != null ? Math.round(w.temp) : '--'}°</div>
        <div style="flex:1"><div style="font-size:11px">최고 ${Math.round(todayMax || w.temp)}° / 최저 ${Math.round(todayMin || w.temp)}°</div>
        <div class="muted" style="font-size:10px">습도 ${w.humidity != null ? Math.round(w.humidity) : '--'}% · 바람 ${w.wind != null ? Math.round(w.wind) : '--'}m/s</div></div></div>`
        + `<div class="minirow"><span class="k">체감</span><span class="v">${w.feels != null ? Math.round(w.feels) + '°' : '--'}</span></div>`;
    }
    if (tpl === 'b'){ // 주간 포함
      const days = ['오늘','내일','모레'];
      const bars = (w.weekMax || []).slice(0, 3).map((mx, i) => {
        const mn = (w.weekMin || [])[i];
        const rr = (w.weekRain || [])[i];
        return `<div class="wday" style="min-width:0"><span class="wdt">${days[i]}</span><i></i>
          <b style="font-size:10px">${mn != null ? Math.round(mn) + '°' : ''}/${mx != null ? Math.round(mx) + '°' : ''}</b>${rr != null ? `<span style="font-size:8.5px;color:#38bdf8">${rr}%</span>` : ''}</div>`;
      }).join('');
      return head + `<div class="tile-mid" style="display:flex;align-items:center;gap:10px">
        <div class="big" style="font-size:34px">${w.temp != null ? Math.round(w.temp) : '--'}°</div>
        <div style="flex:1;min-width:0"><div style="font-size:11.5px;font-weight:650">${esc(w.cond || '')}</div>
        <div class="muted" style="font-size:10px">습도 ${w.humidity != null ? w.humidity : '--'}%</div></div></div>
        <div class="wdays" style="margin-top:6px">${bars}</div>`;
    }
    return head + `<div class="tile-mid" style="display:flex;align-items:center;gap:12px">
        <div class="big" style="font-size:34px">${w.temp != null ? Math.round(w.temp) : '--'}°</div>
        <div style="flex:1;min-width:0"><div style="font-size:12.5px;font-weight:700">${esc(w.cond || '')}</div>
          <div style="display:flex;gap:6px;margin-top:5px;flex-wrap:wrap">
            <span class="kicker">최고 ${Math.round(todayMax != null ? todayMax : (w.temp || 0))}°</span>
            <span class="kicker">최저 ${Math.round(todayMin != null ? todayMin : (w.temp || 0))}°</span>
            ${w.humidity != null ? `<span class="kicker">습도 ${Math.round(w.humidity)}%</span>` : ''}
          </div>
        </div>
      </div>
      <div class="minirow"><span class="k">체감</span><span class="v">${w.feels != null ? Math.round(w.feels) + '°' : '--'}</span></div>
      ${w.rainPct != null ? `<div class="minirow"><span class="k">강수(오늘)</span><span class="v">${w.rainPct}%</span></div>` : ''}`;
  }

  /* --- 스포츠: 종목별 맞춤 뷰 (F1/모터스포츠 vs 리그 종목) + 1위/우승/최다득점/MVP 명예의 전당 --- */
  function teamSide(e){ return e.isHome === 1 ? { mine: e.home, opp: e.away, tag: '홈' } : { mine: e.away, opp: e.home, tag: '원정' }; }
  function formDots(form){
    return (form || []).map(f => `<i class="sf sf-${f === 'W' ? 'w' : f === 'L' ? 'l' : 'd'}">${f}</i>`).join('');
  }
  function honorBadgeHtml(h){
    if (!h) return '';
    const isScorer = h.type === 'scorer';
    const isPts = h.type === 'points';
    const icon = isScorer ? 'i-spark' : (isPts ? 'i-flag' : 'i-bars');
    return `<div class="sport-honor-strip">
      <span class="sh-tag">${esc(h.title || (isScorer ? '최다 득점' : '1위'))}</span>
      <b class="sh-name">${esc(h.name || '')}</b>
      <span class="sh-val">${esc(h.value || '')}</span>
      ${h.team ? `<span class="sh-sub">(${esc(h.team)})</span>` : ''}
    </div>`;
  }
  /* F1 / 모터스포츠 전용 카드 */
  function motorsportInner(topic, d, nowMs){
    const tpl = topic.tpl || 'a';
    const lead = d.leader, next = d.next, lr = d.lastRace;
    const rnd = (d.round != null && d.roundsTotal) ? `${d.round}/${d.roundsTotal}R` : (d.round ? `${d.round}R` : '2026 시즌');
    const head = `<div style="display:flex;gap:6px;align-items:center">
        <span class="kicker" style="flex:0 0 auto;color:${KIND.sport.c1}">F1 세계선수권 · ${esc(rnd)}</span>
        <span class="kicker muted" style="margin-left:auto">${d.clinched ? '<b style="color:var(--good)">우승 확정</b>' : '포뮬러 1'}</span></div>`;

    if (tpl === 'c'){ // 컴팩트
      const nextLine = next ? `<span class="big" style="font-size:19px">D-${Math.max(0, Math.ceil((next.ts - (nowMs || Date.now())) / 86400000))}</span><span class="muted" style="font-size:10px">${esc(next.name || '')} · ${esc(next.circuit || '')}</span>` : '';
      return `<div class="tile-mid" style="display:flex;align-items:baseline;gap:8px;flex-wrap:wrap">${nextLine}</div>`
        + (lead ? `<div class="minirow"><span class="k">1위 선두</span><span class="v"><b>${esc(lead.name)}</b> (${lead.points}점 · ${esc(lead.team)})</span></div>` : '');
    }

    if (tpl === 'b'){ // 드라이버 순위표 + 컨스트럭터
      const rows = (d.standings || []).slice(0, 5).map(s => `
        <div class="minirow" style="align-items:baseline">
          <span class="k" style="flex:0 0 20px;font-weight:700;color:${s.rank===1?KIND.sport.c1:'inherit'}">${s.rank}</span>
          <span class="v" style="text-align:left;font-size:11px;flex:1"><b>${esc(s.name)}</b> <span class="muted">(${esc(s.team)})</span></span>
          <span class="v" style="font-weight:700;font-size:11px">${s.points}점</span>
        </div>`).join('');
      const c1 = (d.constructors || [])[0];
      return head + `<div class="sched-h" style="margin:2px 0 1px"><span class="kicker">드라이버 챔피언십 선두권</span></div>`
        + rows
        + (c1 ? `<div class="minirow" style="margin-top:2px"><span class="k">팀 1위</span><span class="v"><b>${esc(c1.team)}</b> (${c1.points}점)</span></div>` : '');
    }

    // a: 팬 한눈에 (드라이버 선두 + 다음 GP 세션 타임라인 + 직전 포디엄)
    const dd = next ? Math.max(0, Math.ceil((next.ts - (nowMs || Date.now())) / 86400000 + 0.0001)) : null;
    const left = next ? next.ts - (nowMs || Date.now()) : null;
    const sessList = (next && next.sessions ? next.sessions.slice(0, 3) : []).map(s => `<span class="sess-chip"><b>${esc(s.label)}</b> ${esc(s.when || '')}</span>`).join('');
    const podiumStr = lr && lr.podium && lr.podium.length ? lr.podium.slice(0, 3).map((p, i) => `${i === 0 ? '🥇' : (i === 1 ? '🥈' : '🥉')} ${esc(p.driver.split(' ').pop())}`).join(' · ') : '';

    return head
      + (d.honors ? honorBadgeHtml(d.honors) : '')
      + (next ? `<div style="display:flex;gap:8px;align-items:flex-end;margin-top:2px">
          <div style="min-width:0;flex:1">
            <span class="kicker" style="color:var(--ink-3)">다음 그랑프리</span>
            <div class="goal-line" style="font-size:13px;margin-top:1px">${esc(next.name)}</div>
          </div>
          <div style="margin-left:auto;text-align:right"><span class="big" style="font-size:24px;line-height:1">D-${dd}</span>
          <div class="muted" style="font-size:9.5px">${esc(durTxt(left))} 남음</div></div></div>
        <div class="minirow"><span class="k">서킷/본선</span><span class="v" style="font-size:10.5px">${esc(next.circuit || '')} · ${esc(next.when || '')}</span></div>
        ${sessList ? `<div class="sess-row">${sessList}</div>` : ''}` : '')
      + (lr ? `<div class="minirow" style="margin-top:2px"><span class="k">직전 포디엄</span><span class="v" style="font-size:10.5px">${podiumStr}</span></div>` : '')
      + (d.gap != null && lead ? `<div class="minirow"><span class="k">2위와 격차</span><span class="v" style="color:${KIND.sport.c1};font-weight:700">+${d.gap}점 ${d.roundsLeft ? `(잔여 ${d.roundsLeft}R)` : ''}</span></div>` : '');
  }

  function sportInner(topic, payload, nowMs){
    const d = payload.data || {};
    const tpl = topic.tpl || 'a';
    if (d.discipline === 'motorsport') return motorsportInner(topic, d, nowMs);

    const team = d.team || topicShort(topic.label);
    const next = d.next, live = d.live;
    const honors = d.honors || [];
    const mainHonor = honors[0] || null;
    const head = `<div style="display:flex;gap:6px;align-items:center">
        <span class="kicker" style="flex:0 0 auto;color:${KIND.sport.c1}">${esc(d.league || '스포츠')}${d.round ? ' · ' + esc(d.round) + 'R' : ''}</span>
        <span class="kicker muted" style="margin-left:auto">${live ? '<b style="color:var(--bad)">● LIVE</b>' : (d.sport ? esc(d.sport) : '실시간')}</span></div>`;

    if (tpl === 'c'){   // 컴팩트
      const line = live
        ? `<span class="big" style="font-size:22px">${esc(live.hs)} - ${esc(live.as)}</span><span class="muted" style="font-size:10px">${esc(live.status || '진행 중')} · ${esc(live.venue || '')}</span>`
        : (next ? `<span class="big" style="font-size:20px">D-${Math.max(0, Math.ceil((next.ts - (nowMs || Date.now())) / 86400000))}</span><span class="muted" style="font-size:10px">${esc(next.when || '')} · ${esc(next.venue || '')}</span>`
                : (mainHonor ? `<span class="big" style="font-size:17px">${esc(mainHonor.name)}</span><span class="muted" style="font-size:10px">${esc(mainHonor.value)}</span>` : `<span class="muted" style="font-size:11px">등록된 경기 없음</span>`));
      return `<div class="tile-mid" style="display:flex;align-items:baseline;gap:8px;flex-wrap:wrap">${line}</div>`
        + (next && !live ? `<div class="muted" style="font-size:10px">${esc(next.home)} vs ${esc(next.away)}</div>` : '');
    }

    if (tpl === 'b'){   // 일정/순위 목록형
      const rows = (d.upcoming || []).slice(0, 3).map(e => {
        const t = teamSide(e);
        return `<div class="minirow" style="align-items:baseline"><span class="k" style="flex:0 0 66px">${esc((e.when || '').replace(/\s*\([^)]*\)\s*/, ' '))}</span>
          <span class="v" style="text-align:left;font-size:11px">${e.isHome === 1 ? 'vs' : '@'} <b>${esc(t.opp)}</b> <span class="muted" style="font-weight:400">· ${esc(e.venue || '')}</span></span></div>`;
      }).join('');
      const last = (d.results || [])[0];
      const std = d.standings;
      return head + `<div class="sched-h" style="margin:2px 0 1px"><span class="kicker">${esc(team)} · 일정 및 순위</span>${d.form && d.form.length ? `<span class="sform">${formDots(d.form)}</span>` : ''}</div>`
        + (rows || (std ? `<div class="minirow"><span class="k">현재 순위</span><span class="v"><b>${std.rank || '—'}위</b> (${std.points || '—'}점 · ${std.source || ''})</span></div>` : `<div class="muted" style="font-size:11px;padding:4px 0">예정 경기 없음</div>`))
        + (honors.length ? honorBadgeHtml(honors[0]) : '')
        + (last ? `<div class="minirow"><span class="k">최근 결과</span><span class="v">${esc(last.hs)} - ${esc(last.as)} ${esc(last.home)} vs ${esc(last.away)}</span></div>` : '');
    }

    // a: 팬 한눈에 (LIVE / 다음 경기 + 1위/최다득점/MVP 명예 배지 + 최근 결과 + 폼)
    const honorHtml = honors.slice(0, 2).map(honorBadgeHtml).join('');
    if (live){
      const t = teamSide(live);
      const mins = Math.max(0, Math.floor(((nowMs || Date.now()) - live.ts) / 60000));
      return head
        + `<div class="tile-mid" style="display:flex;align-items:center;gap:10px;margin-top:2px">
            <div class="big" style="font-size:32px">${esc(live.hs)} - ${esc(live.as)}</div>
            <div style="min-width:0;flex:1">
              <div style="font-size:12px;font-weight:700">${esc(live.home)} vs ${esc(live.away)}</div>
              <div class="muted" style="font-size:10px">${esc(live.status || '진행 중')} · ${mins}분 경과 · ${esc(live.venue || '')}</div></div></div>`
        + honorHtml
        + `<div class="minirow"><span class="k">경기장</span><span class="v">${esc(live.venue || d.homeGround || '—')}</span></div>`
        + (d.form && d.form.length ? `<div class="minirow"><span class="k">최근 5경기</span><span class="v"><span class="sform">${formDots(d.form)}</span></span></div>` : '');
    }

    if (!next){
      const std = d.standings;
      const rankLine = std && std.rank ? `<div class="minirow"><span class="k">리그 순위</span><span class="v"><b>${std.rank}위</b> · 승점 ${std.points}점 ${std.gapToLeader === 0 ? '(선두)' : `(1위와 -${std.gapToLeader})`}</span></div>` : '';
      return head
        + (honorHtml ? honorHtml : `<div class="goal-line" style="font-size:12.5px">${esc(team)} — 지금 예정된 경기가 없어요</div>`)
        + rankLine
        + ((d.results || []).slice(0, 2).map(e => `<div class="minirow"><span class="k">${esc((e.when || '').replace(/\s*\([^)]*\)\s*/, ' '))}</span><span class="v">${esc(e.home)} ${esc(e.score || '')} ${esc(e.away)}</span></div>`).join('') || '')
        + (d.form && d.form.length ? `<div class="minirow"><span class="k">최근 폼</span><span class="v"><span class="sform">${formDots(d.form)}</span></span></div>` : '')
        + `<div class="minirow" style="font-size:9.5px;color:var(--ink-3)"><span class="k">구장</span><span class="v">${esc(d.homeGround || '—')} · ${esc(d.source || '')}</span></div>`;
    }

    const t = teamSide(next);
    const dd = Math.max(0, Math.ceil((next.ts - (nowMs || Date.now())) / 86400000 + 0.0001));
    const left = next.ts - (nowMs || Date.now());
    const badge = next.isHome === 1 ? '홈' : '원정';
    return head
      + (honorHtml ? honorHtml : '')
      + `<div style="display:flex;gap:8px;align-items:flex-end;margin-top:2px">
          <span class="kicker" style="color:var(--ink-3);margin-bottom:4px">다음이 ${esc(badge)}경기</span>
          <div style="margin-left:auto;text-align:right"><span class="big" style="font-size:24px;line-height:1">D-${dd}</span>
          <div class="muted" style="font-size:9.5px">${esc(durTxt(left))} 남음</div></div></div>
        <div class="goal-line" style="font-size:13px;margin-top:1px">${esc(next.home)} <span style="opacity:.55">vs</span> ${esc(next.away)}</div>
        <div class="minirow"><span class="k">킥오프</span><span class="v">${esc(next.when || '—')}</span></div>
        <div class="minirow"><span class="k">경기장</span><span class="v" style="font-size:10.5px">${esc(next.venue || d.homeGround || '—')}</span></div>
        <div class="kick-bar"><i style="width:${Math.max(2, Math.min(100, 100 - Math.min(100, left / (7 * 86400000) * 100))).toFixed(1)}%"></i></div>`
      + ((d.results || []).length ? `<div class="minirow"><span class="k">최근 결과</span><span class="v" style="display:flex;align-items:center;gap:6px;justify-content:flex-end">${esc(d.results[0].home)} ${esc(d.results[0].score || '')} ${esc(d.results[0].away)}${d.form && d.form.length ? `<span class="sform">${formDots(d.form)}</span>` : ''}</span></div>` : '');
  }

  /* --- 개인 상태: 실소스 전 → 진행 게이지 틀 + 연결 안내 (가짜 숫자 없음) --- */
  function personalInner(topic){
    const label = topicShort(topic.label);
    const tpl = topic.tpl || 'a';
    const gauge = `<div class="ring" style="--p:0;"><b>--</b></div>
      <div style="min-width:0"><div class="goal-line">${esc(label)}</div>
        <div class="goal-sub">실데이터 소스(헬스·운동 앱 등)가 연결되면 채워져요.</div></div>`;
    const week = `<div class="wdays">${['월','화','수','목','금','토','일'].map(d => `<div class="wday"><span class="wdt">${d}</span><i></i><b style="font-size:9px;color:var(--ink-3)">--</b></div>`).join('')}</div>
      <div class="muted" style="font-size:10px;margin-top:2px">주간 기록 — 연결 후 표시</div>`;
    if (tpl === 'b') return `<div class="sched-h"><span class="kicker">${esc(label)} · 주간 현황</span></div>${week}
      <div class="minirow"><span class="k">상태</span><span class="v" style="color:var(--ink-3);font-size:10.5px">데이터 소스 대기</span></div>`;
    if (tpl === 'c') return `<div class="goal-line">${esc(label)} — 연결 전</div>
      <div class="goal-sub">개인 데이터는 사용자가 연결할 소스(애플 헬스·삼성 헬스 등)에서만 가져와요. 지금은 실제 값을 만들지 않습니다.</div>
      <div class="minirow"><span class="k">상태</span><span class="v" style="color:var(--ink-3);font-size:10.5px">연결 대기</span></div>`;
    return `<div style="display:flex;gap:11px;align-items:center;margin-top:2px">${gauge}</div>
      <div class="progress" style="margin-top:7px"><i style="width:0%"></i></div>
      <div class="minirow"><span class="k">상태</span><span class="v" style="color:var(--ink-3);font-size:10.5px">개인 데이터 소스 대기</span></div>`;
  }

  /* --- 뉴스/트렌드 타일: 실시간 피드 첫 기사 (사진·제목·요약) --- */
  function summaryOf(item){
    let raw = String(item.desc || '').replace(/<a\b[^>]*>[\s\S]*?<\/a>/gi, ' ').replace(/<[^>]*>/g, ' ')
      .replace(/https?:\/\/\S+/g, ' ').replace(/&(?:amp|nbsp|lt|gt|quot|#39);/gi, ' ').replace(/\s+/g, ' ').trim();
    if (raw.length < 20) return '';
    if (item.title && (raw.startsWith(item.title) || item.title.toLowerCase().startsWith(raw.toLowerCase()))) return '';
    let cut = raw.length;
    for (let i = 36; i < raw.length; i++){ const ch = raw[i]; if ('.!?。…'.includes(ch)){ cut = i + 1; break; } }
    raw = raw.slice(0, cut).trim();
    return raw.length >= 18 ? raw : '';
  }
  function newsTileInner(topic, payload){
    const items = payload.data.items || [];
    const item = items[0];
    const meta = catOf(catForTopic(topic));
    const label = topicShort(topic.label);
    const tpl = topic.tpl || 'a';
    if (tpl === 'b'){ // 헤드라인 목록 3건
      const list = items.slice(0, 3).map(it => `<a href="${esc(it.link)}" target="_blank" rel="noopener" style="display:flex;gap:6px;align-items:flex-start;padding:3px 0;text-decoration:none;color:inherit">
        <i style="width:5px;height:5px;border-radius:99px;background:linear-gradient(135deg,${meta.c[0]},${meta.c[1]});flex:0 0 auto;margin-top:6px"></i>
        <span style="font-size:11px;line-height:1.45;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden">${esc(it.title)}</span></a>`).join('');
      return `<div class="sched-h" style="margin-bottom:2px"><span class="kicker" style="color:${meta.c[0]}">${esc(label)} · 실시간</span></div>${list}
        <div class="minirow"><span class="k">소스</span><span class="v" style="font-size:10px">${esc(items.map(i => i.src).filter((v,i,a)=>a.indexOf(v)===i).slice(0,2).join(' · ') || '—')} · ${items[0] ? esc($U.ago(items[0].pub)) + ' 전' : ''}</span></div>`;
    }
    const hasImg = item && item.img;
    const imgHTML = hasImg ? `<div class="tile-news-thumb"><img src="${esc(item.img)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.closest('.tile-news-thumb')?.remove?.()"/></div>` : '';
    if (tpl === 'c'){ // 제목+한줄
      return `<div class="goal-line" style="font-size:12px;line-height:1.5;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden">${esc(item ? item.title : '새 소식을 불러오는 중…')}</div>
        ${item && summaryOf(item) ? `<div class="goal-sub" style="margin-top:3px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden">${esc(summaryOf(item))}</div>` : ''}
        <div class="minirow"><span class="k">${esc(item ? item.src : '상태')}</span><span class="v" style="font-size:10px;color:var(--ink-3)">${item ? esc($U.ago(item.pub)) + ' 전 · 실시간' : '불러오는 중'}</span></div>`;
    }
    // a: 대표 카드(썸네일+제목+요약2줄)
    return `<div style="display:flex;gap:8px;align-items:flex-start">
        <span class="wd-dot" style="width:20px;height:20px;border-radius:6px;background:linear-gradient(135deg,${meta.c[0]},${meta.c[1]});flex:0 0 auto;margin-top:1px">${ic(meta.icon, 10)}</span>
        <div style="min-width:0;display:flex;gap:7px;width:100%">
          <div style="min-width:0;flex:1">
            <div class="goal-line" style="font-size:12px;line-height:1.5;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden">${esc(item ? item.title : '새 소식 로딩…')}</div>
            ${item && summaryOf(item) ? `<div class="goal-sub" style="margin-top:3px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden">${esc(summaryOf(item))}</div>` : ''}
          </div>
          ${imgHTML}
        </div>
      </div>
      <div class="minirow"><span class="k">${esc(item ? item.src : '상태')}</span><span class="v" style="font-size:10px;color:var(--ink-3)">${item ? esc($U.ago(item.pub)) + ' 전 · 실시간' : ''}${item && item.img ? '' : ''}</span></div>`;
  }

  /* payload.data 를 카드 본문으로 */
  function tileBodyFor(topic, payloadRaw){
    const kindMeta = KIND[topic.kind] || KIND.news;
    if (!payloadRaw) return tileSkeleton(topic.kind);
    if (payloadRaw.status === 'loading') return tileSkeleton(topic.kind);
    if (payloadRaw.status === 'off') return tileOffline(kindMeta, topic);
    if (payloadRaw.status === 'error') return tileError(kindMeta);
    const payload = payloadRaw;          // 데이터 가공 패치는 저장 시점(app)에서 1회 적용 — 이중 변환 방지
    const kind = payload.kind || topic.kind;
    if (kind === 'coin' || kind === 'stock') return quoteInner(topic, payload);
    if (kind === 'fx') return fxInner(topic, payload);
    if (kind === 'weather') return weatherInner(topic, payload);
    if (kind === 'sport') return sportInner(topic, payload, Date.now());
    if (kind === 'personal') return personalInner(topic);
    if (kind === 'news' && isSportsLabel(topic.label) && !(payload.data && payload.data.items && payload.data.items.length)) return sportDraftInner(topic);   // 팀 확인 전·소스 제한 → 시안 골격(숫자 없음)
    return newsTileInner(topic, payload);
  }
  /* 패치 훅까지 거친 최종 본문 */
  function tileBody(topic, payload){
    const body = tileBodyFor(topic, payload);
    if (global.BPatch && global.BPatch.applyHtml && payload && payload.status === 'ok') return global.BPatch.applyHtml(topic, payload, body, 'tile');
    return body;
  }

  /* 타일 전체 HTML (payload: {status, kind, data} | null) */
  function buildTileHTML(topic, payload){
    const kindMeta = KIND[topic.kind] || KIND.news;
    const c1 = kindMeta.c1, c2 = kindMeta.c2, icon = kindMeta.icon;
    const tileTitle = topic.label || kindMeta.label;
    const body = tileBody(topic, payload);
    return `<div class="tile ${topic.kind === 'news' ? 'tile-news' : ''}" data-bp-kind="${esc(topic.kind)}" style="--t1:${c1};--t2:${c2};" data-tid="${esc(topic.id)}">
      <span class="grad-tint"></span>
      <div class="tile-head">
        <span class="tile-drag-handle" title="드래그하여 순서 변경">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><circle cx="8" cy="6" r="1.8"/><circle cx="16" cy="6" r="1.8"/><circle cx="8" cy="12" r="1.8"/><circle cx="16" cy="12" r="1.8"/><circle cx="8" cy="18" r="1.8"/><circle cx="16" cy="18" r="1.8"/></svg>
        </span>
        <span class="tile-name"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><use href="#${icon}"/></svg>${esc(tileTitle)}</span>
        <span class="tile-kind">${kindMeta.label}</span>
        <span style="display:flex;gap:2px;margin-left:auto">
          <button class="icon-btn tile-refresh" data-tid="${esc(topic.id)}" title="최신 데이터로 새로고침" style="width:22px;height:22px;border:none;background:none;opacity:.6">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><use href="#i-reload"/></svg>
          </button>
          <button class="icon-btn tile-edit" data-tid="${esc(topic.id)}" title="이 카드 설정" style="width:22px;height:22px;border:none;background:none;opacity:.75">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><use href="#i-edit"/></svg>
          </button>
        </span>
      </div>
      ${body}
    </div>`;
  }

  global.Data = { tileBody, KIND, CAT_META, sportInner, sportDraftInner, isSportsLabel, durTxt, catOf, catForTopic, normalizeTopic, defaultTopics, classifyLabel,
    topicShort, buildTileHTML, tileSkeleton, summaryOf, todayInfo, greet, blockName, buildDemoEvents,
    WEEK_KO, WD, $U, esc };
})(window);
