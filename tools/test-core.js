/* 코어 스모크테스트 — data.js (라이브 우선 콘텐츠 엔진, DOM 불필요)
   실행: node tools/test-core.js  (npm test 포함)
   원칙 검증: 실데이터 payload 만 숫자 표시, 없으면 연결 안내/스켈레톤 — 가짜 수치 금지
*/
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const src = path.join(__dirname, '..', 'src');
const sandbox = { window: null, console, Date, Math, JSON, String, Array, Object, parseInt, isNaN, RegExp, Set, Map, encodeURIComponent };
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(src, 'data.js'), 'utf8'), sandbox, { filename: 'data.js' });

let pass = 0, fail = 0;
function t(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra ? '  → ' + extra : '')); }
}
const D = sandbox.Data;

// 1) 카탈로그(라이브 5종)
t('KIND = news·coin·stock·weather·sport·fx·personal', Object.keys(D.KIND).join() === 'news,coin,stock,weather,sport,fx,personal');
t('CAT_META 에 시안 장식용 색/아이콘', ['sport','crypto','game','nature','stock','weather','personal','news'].every(k => D.CAT_META[k] && D.CAT_META[k].c));

// 2) 분류 — AI가 종류만 판단(문자열), 미리보기/편집은 템플릿에서
const cls = (l) => D.classifyLabel(l);
t('맨시티 → sport(4라운드: 경기 데이터 우선)', cls('맨시티') === 'sport');
t('비트코인 → coin', cls('비트코인') === 'coin');
t('이더리움 시세 → coin', cls('이더리움 시세') === 'coin');
t('달러환율 → fx', cls('달러환율') === 'fx');
t('엔화 → fx', cls('엔화') === 'fx');
t('위안 환율 → fx', cls('위안 환율') === 'fx');
t('유로환율 → fx', cls('유로환율') === 'fx');
t('미국 달러 → fx', cls('미국 달러') === 'fx');
t('엔터테인먼트 → fx 아님', cls('엔터테인먼트') !== 'fx');
// 회사 이름 → 주식 유연 인식(사전 + 사명 규칙)
t('Alphabet → stock', cls('Alphabet') === 'stock');
t('apple → stock', cls('apple') === 'stock');
t('Tesla → stock', cls('Tesla') === 'stock');
t('애플 → stock', cls('애플') === 'stock');
t('테슬라 → stock', cls('테슬라') === 'stock');
t('알파벳 → stock', cls('알파벳') === 'stock');
t('엔비디아 → stock', cls('엔비디아') === 'stock');
t('롯데케미칼(사명 접미사) → stock', cls('롯데케미칼') === 'stock');
t('minecraft → stock 아님(뉴스/게임 유지)', cls('minecraft') !== 'stock');
t('F1 → stock 아님', cls('F1') !== 'stock');
t('맨시티 → sport(경기 일정·결과형 위젯)', cls('맨시티') === 'sport');
t('리버풀 · LA 다저스 · 레이커스 → sport', ['리버풀', 'LA 다저스', '레이커스'].every(l => cls(l) === 'sport'));
t('주 3회 러닝은 sport 아님(personal 유지)', cls('주 3회 러닝') === 'personal');
t('축구 뉴스 = news·stock 혼동 없음', cls('KBO 리그 뉴스') !== 'stock');
t('삼성전자 → stock', cls('삼성전자') === 'stock');
t('코스피 → stock', cls('코스피') === 'stock');
t('서울 날씨 → weather', cls('서울 날씨') === 'weather');
t('주 3회 러닝 → personal', cls('주 3회 러닝') === 'personal');
t('걷기 → personal', cls('걷기') === 'personal');
t('수면 관리 → personal', cls('수면 관리') === 'personal');
t('AI 트렌드 → news', cls('AI 트렌드') === 'news');

// 3) 레거시 스키마 정규화 (crypto→coin, fitness/health→personal)
const legacy = D.normalizeTopic({ label: '비트코인', kind: 'crypto', cfg: { preset: 'price' } });
t('crypto → coin', legacy.kind === 'coin' && legacy.tpl === 'a');
const health = D.normalizeTopic({ label: '수면', kind: 'health' });
t('health → personal', health.kind === 'personal');
const newsK = D.normalizeTopic({ label: '맨시티', kind: 'news', key: 'mancity', brief: false });
t('news 유지 + key + brief 보존', newsK.kind === 'news' && newsK.key === 'mancity' && newsK.brief === false);

// 4) 기본 관심사 — 실제 라이브 키 4종, brief 기본 포함
const topics = D.defaultTopics();
t('기본 관심사 4종(맨시티·비트코인·마인크래프트·조류)', topics.map(x => x.label).join() === '맨시티,비트코인,마인크래프트,조류');
t('전부 kind/시안/brief 지정', topics.every(x => x.kind && x.tpl === 'a' && x.brief === true && x.key));

// 5) 타일 HTML 상태 분기
const mci = topics[0];
const offHtml = D.buildTileHTML(mci, { status: 'off', kind: 'news', data: null });
t('off → “연결 필요” 안내 (가짜 기사 금지)', offHtml.includes('연결 필요') && !/기사제목|뉴스 헤드라인/.test(offHtml));
const loadHtml = D.buildTileHTML(mci, { status: 'loading', kind: 'news', data: null });
t('loading → 스켈레톤(sk) 표시', loadHtml.includes('sk') && loadHtml.includes('불러오는 중'));

const newsPayload = {
  status: 'ok', kind: 'news',
  data: { items: [
    { id: 'a1', title: 'Haaland double gives City ideal start', link: 'https://ex.com/1', src: 'The Guardian', pub: new Date(Date.now() - 3600000).toUTCString(), img: null, desc: '실제 기사 요약 문장이 여기 두 줄로 표시됩니다.' },
  ] },
};
const newsHtml = D.buildTileHTML(mci, newsPayload);
t('news ok → 실기사 제목·매체 표시', newsHtml.includes('Haaland double') && newsHtml.includes('The Guardian'));

const btc = topics[1];
const quotePayload = {
  status: 'ok', kind: 'coin',
  data: { market: 'KRW-BTC', name: 'BTC', price: 123450000, prev: 120000000, chgPct: 2.87, chgAbs: 3450000, high: 125000000, low: 119000000, spark: Array.from({ length: 20 }, (_, i) => 119000000 + i * 240000) },
};
const qHtml = D.buildTileHTML(btc, quotePayload);
t('quote ok → 큰 숫자 + 등락 ▲/▼ + 스파크 svg', qHtml.includes('억') && /▲|▼/.test(qHtml) && qHtml.includes('<svg'));

const personal = D.normalizeTopic({ label: '걷기', kind: 'personal' });
const perHtml = D.buildTileHTML(personal, { status: 'ok', kind: 'personal', data: {} });
// '걸음 8,432회' 같은 가짜 수치 단위가 없어야 한다 (진행 게이지 틀 0%·-- 는 허용)
const fakeMetric = /(걸음|보|회|km|kg)\s*[:：]?\s*\d|[0-9],[0-9]{3}/.test(perHtml);
t('personal → 연결 안내(가짜 수치 금지)', perHtml.includes('연결') && !fakeMetric);

const weather = D.normalizeTopic({ label: '서울 날씨', kind: 'weather' });
const wxHtml = D.buildTileHTML(weather, { status: 'ok', kind: 'weather', data: { temp: 20.4, cond: '구름 조금', humidity: 63, wind: 3, max: 26, min: 14 } });
t('weather ok → 실온·조건 표시', wxHtml.includes('20') && wxHtml.includes('구름 조금'));

const fx = D.normalizeTopic({ label: '달러환율', kind: 'fx' });
const fxQ = { name: '미국 달러', pair: 'USD/KRW', price: 1338.29, prev: 1340.08, chgPct: -0.133, chgAbs: -1.79, high: 1346, low: 1330, spark: Array.from({ length: 22 }, (_, i) => 1330 + i * 0.8), date: '2026-09-09' };
const fxA = D.buildTileHTML(fx, { status: 'ok', kind: 'fx', data: fxQ });
t('fx(달러환율) ok → 큰 숫자+등락+일봉 스파크', fxA.includes('1,338.29') && /▼/.test(fxA) && fxA.includes('<svg'));
const fxB = D.buildTileHTML({ ...fx, tpl: 'b' }, { status: 'ok', kind: 'fx', data: fxQ });
t('fx 시안 B → 기간 고가/저가 표시', fxB.includes('고가/저가') && fxB.includes('1,346.00'));
const fxC = D.buildTileHTML({ ...fx, tpl: 'c' }, { status: 'ok', kind: 'fx', data: fxQ });
t('fx 시안 C → 컴팩트(숫자+등락)', fxC.includes('▼ 0.13%') && !fxC.includes('기준일'));
const fxOff = D.buildTileHTML(fx, { status: 'off', kind: 'fx', data: null });
t('fx offline → 연결 안내(가짜 수치 금지)', fxOff.includes('연결 필요') && !fxOff.includes('1,338'));

// 해외 주식(USD) 표시 — Alphabet 예시
const alphabet = D.normalizeTopic({ label: 'Alphabet', kind: 'stock' });
const googl = { kind: 'stock', code: 'GOOGL', name: 'Alphabet', price: 329.34, prev: 338.37, chgPct: -2.67, chgAbs: -9.03, high: 339.2, low: 327.4, currency: 'USD', spark: Array.from({ length: 20 }, (_, i) => 327 + i * 0.6) };
const usdHtml = D.buildTileHTML(alphabet, { status: 'ok', kind: 'stock', data: googl });
t('Alphabet(USD 주식) ok → 2자리 소수 + 달러 단위 표시', usdHtml.includes('329.34') && usdHtml.includes('달러'), usdHtml.replace(/<[^>]+>/g, ' ').slice(0, 140));

// 6) 요약/도우미
t('summaryOf — 태그·링크 제거, 실제 요약만', (D.summaryOf({ title: '정책 브리핑', desc: '<p>오늘 오후 두 시에 열리는 정책 브리핑에서 <a href="https://x.com">새 규제안</a>의 세부 내용이 처음 공개될 예정입니다 https://t.co/abc</p>' }) || '').length >= 10);
t('topicShort 서울 날씨', D.topicShort('서울 날씨') === '서울 날씨');
t('topicShort 비트코인 시세 → 비트코인', D.topicShort('비트코인 시세') === '비트코인');
t('$U.esc XSS 방어', D.$U.esc('<b onclick="x">') === '&lt;b onclick=&quot;x&quot;&gt;');
t('$U.fmtKR 억 단위', D.$U.fmtKR(123450000) === '1.23억');
t('$U.ago 분/시간', /분|시간|일/.test(D.$U.ago(new Date(Date.now() - 5 * 60000).toUTCString())));
t('todayInfo 요일', D.todayInfo(new Date(2026, 8, 7, 12, 0, 0)).weekdayLong === '월요일');

// 7) 일정 — 가짜 시드 제거(빈 배열), 인사말은 실제 데이터 기반
t('buildDemoEvents → [] (가짜 시드 없음)', Array.isArray(D.buildDemoEvents(new Date())) && D.buildDemoEvents(new Date()).length === 0);
const g = D.greet(new Date(2026, 8, 7, 10, 0, 0), [], '민준');
t('greet 인사말', g.hello.includes('민준'));


// 8) 하늘 자동 전환(실측 → 경보) + 읽음 큐 + 스포츠 렌더 — logic.js/DurTxt 와 함께 검증
{
  const vm2 = require('vm');
  const sb2 = { window: null, console, Date, Math, JSON, String, Number, Array, Object, RegExp, isNaN, parseInt, Set, Map };
  sb2.window = sb2;
  vm2.createContext(sb2);
  vm2.runInContext(fs.readFileSync(path.join(src, 'logic.js'), 'utf8'), sb2, { filename: 'logic.js' });
  const L = sb2.Logic;

  t('실측 비(code 61) → rain 하늘', L.skyAlertFromWeather({ code: 61, cond: '비', precip: 0.4 }) === 'rain');
  t('강수량 0.6mm(상태 모호) → rain', L.skyAlertFromWeather({ precip: 0.6, cond: '' }) === 'rain');
  t('뇌우(96) → storm(비보다 강한 우선)', L.skyAlertFromWeather({ code: 96, cond: '뇌우' }) === 'storm');
  t('눈(75) → snow', L.skyAlertFromWeather({ code: 75, cond: '눈' }) === 'snow');
  t('PM10 180 → dust', L.skyAlertFromWeather({ pm10: 180, cond: '흐림' }) === 'dust');
  t('PM10 40(보통) → 경보 없음', L.skyAlertFromWeather({ pm10: 40, cond: '맑음' }) === null);
  t('맑음 22° → 경보 없음(비가 와야 바뀜)', L.skyAlertFromWeather({ code: 0, cond: '맑음', precip: 0, rainPct: 0, temp: 22, pm10: 20 }) === null);
  t('35° 이상 → heat', L.skyAlertFromWeather({ temp: 36.2, cond: '맑음' }) === 'heat');

  const d1 = L.decideSky('auto', 'rain', 14);
  t('자동 + 실측 비 → 하늘·효과 모두 rain', d1.base === 'rain' && d1.weath === 'rain' && d1.auto === 1);
  const d2 = L.decideSky('auto', null, 14);
  t('자동 + 경보 없음 → 시간대 하늘(day)·효과 없음', d2.base === 'day' && d2.weath === null);
  const d3 = L.decideSky('day', 'rain', 14);
  t('수동 “낮” 선택은 실측보다 우선(강요하지 않음)', d3.base === 'day' && d3.weath === null && d3.manual === 1);
  const d4 = L.decideSky('rain', null, 23);
  t('수동 미리보기(비 버튼)도 동일 경로로 렌더', d4.base === 'rain' && d4.weath === 'rain' && d4.manual === 1);
  const d5 = L.decideSky('auto', null, 23);
  t('자동 · 밤 23시 → night', d5.base === 'night');

  // 읽음 큐 — good! = 읽음 → 같은 관심사의 다음 기사
  const items = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  t('읽음 없음 → 첫 기사', L.pickUnread(items, [], [], 't1').item.id === 'a');
  t('a 읽음 → b 로 자동 진행', L.pickUnread(items, [], [L.readKey('t1', 'a')], 't1').item.id === 'b');
  t('관심없음(mute)은 읽음과 별개로 건너뜀', L.pickUnread(items, ['b'], [L.readKey('t1', 'a')], 't1').item.id === 'c');
  t('다른 관심사 읽음은 영향 없음', L.pickUnread(items, [], [L.readKey('t2', 'a')], 't1').item.id === 'a');
  t('전부 읽음 → 새로 수집(fetch) 지시', L.advanceAfterRead(items, [], ['t1|a', 't1|b', 't1|c'], 't1').action === 'fetch');
  t('안 읽은 기사 남아있으면 next', L.advanceAfterRead(items, [], ['t1|a'], 't1').action === 'next');
  t('피드 없으면 empty', L.advanceAfterRead([], [], [], 't1').action === 'empty');
}
{
  // 스포츠 렌더 — 경기 일정·남은 시간·경기장·결과가 한 장에
  const now = Date.now();
  const sport = {
    status: 'ok', kind: 'sport', data: {
      team: 'Manchester City', sport: 'Soccer', league: 'English Premier League', homeGround: 'Etihad Stadium',
      next: { id: 'e1', home: 'Manchester United', away: 'Manchester City', venue: 'Old Trafford', ts: now + 3 * 86400000, when: '9월 14일 (월) 00:30', status: 'NS', hs: null, as: null, score: null, isHome: 0, round: 4, league: 'English Premier League' },
      live: null, upcoming: [], results: [{ id: 'e0', home: 'Manchester City', away: 'Coventry City', venue: 'Etihad Stadium', ts: now - 5 * 86400000, when: '9월 5일 (토) 23:00', status: 'FT', hs: 1, as: 0, score: '1 - 0', isHome: 1 }],
      today: [], form: ['W', 'W', 'D', 'L', 'W'], source: 'TheSportsDB',
    },
  };
  const html = D.tileBody({ id: 'm', label: '맨시티', kind: 'sport', tpl: 'a' }, sport);
  t('스포츠 카드: 리그·상대·구장·D-day·남은 시간', /English Premier League/.test(html) && /Manchester United/.test(html) && /Old Trafford/.test(html) && /D-[34]/.test(html) && /남음/.test(html));
  t('스포츠 카드: 최근 결과 + 폼(승패 점 5개)', /1 - 0/.test(html) && (html.match(/class="sf /g) || []).length === 5);
  const live = { status: 'ok', kind: 'sport', data: Object.assign({}, sport.data, { live: { home: 'Manchester City', away: 'Everton', venue: 'Etihad Stadium', ts: now - 33 * 60000, status: '75', hs: 2, as: 1, score: '2 - 1', isHome: 1, when: '' }, next: null }) };
  const lhtml = D.tileBody({ id: 'm', label: '맨시티', kind: 'sport', tpl: 'a' }, live);
  t('진행 중이면 점수·경과 시간 우선 표시', /2 - 1/.test(lhtml) && /33분 경과/.test(lhtml));
  const empty = { status: 'ok', kind: 'sport', data: { team: '맨시티', league: 'English Premier League', homeGround: 'Etihad Stadium', next: null, live: null, upcoming: [], results: [], today: [], form: [] } };
  const ehtml = D.tileBody({ id: 'm', label: '맨시티', kind: 'sport', tpl: 'a' }, empty);
  t('경기 없으면 “예정된 경기 없음” + 숫자 조작 없음', /예정된 경기가 없어요/.test(ehtml) && !/D-\d/.test(ehtml));
  const skel = D.tileBody({ id: 'm', label: '맨시티 축구', kind: 'news', tpl: 'a' }, { status: 'ok', kind: 'news', data: { items: [] } });
  t('뉴스형 스포츠 라벨·기사 없음 → 미리보기 시안(골격) 표시', /시안/.test(skel) && /경기장/.test(skel));
  const payloadless = D.tileBody({ id: 'm', label: '맨시티', kind: 'sport', tpl: 'a' }, null);
  t('실데이터 없으면 스켈레톤(가짜 점수 금지)', /불러오는 중/.test(payloadless) && !/1 - 0/.test(payloadless));
  t('durTxt 단위(일/시간/분)', D.durTxt(3 * 86400000).includes('일') && D.durTxt(50 * 60000) === '50분' && D.durTxt(30 * 1000) === '지금');
}


{
  // 5라운드: F1(모터스포츠) 인터페이스 및 등수/우승/최다득점/MVP 명예 검증
  const f1Payload = {
    status: 'ok', kind: 'sport', data: {
      discipline: 'motorsport', series: 'f1', sport: '포뮬러 1', league: 'FIA F1 세계선수권', season: 2026, round: 14, roundsTotal: 23, roundsLeft: 9,
      leader: { rank: 1, name: 'Andrea Kimi Antonelli', code: 'ANT', team: 'Mercedes', points: 292, wins: 8 },
      rival: { rank: 2, name: 'George Russell', team: 'Mercedes', points: 211 }, gap: 81, clinched: false,
      honors: { type: 'points', title: '드라이버즈 선두', name: 'Andrea Kimi Antonelli', team: 'Mercedes', value: '292점 · 2위와 +81' },
      next: { name: 'Azerbaijan Grand Prix', round: 15, circuit: 'Baku City Circuit', ts: Date.now() + 5 * 86400000, when: '9월 26일 (토) 20:00', sessions: [{ label: '1차 연습', when: '9/24 17:30' }, { label: '예선', when: '9/25 21:00' }] },
      lastRace: { name: 'Spanish Grand Prix', podium: [{ pos: 1, driver: 'Andrea Kimi Antonelli', team: 'Mercedes' }, { pos: 2, driver: 'Max Verstappen', team: 'Red Bull' }] },
      standings: [{ rank: 1, name: 'Andrea Kimi Antonelli', team: 'Mercedes', points: 292 }, { rank: 2, name: 'George Russell', team: 'Mercedes', points: 211 }],
      constructors: [{ rank: 1, team: 'Mercedes', points: 503 }, { rank: 2, team: 'Ferrari', points: 358 }],
    },
  };
  const f1Html = D.tileBody({ id: 'f1', label: 'F1', kind: 'sport', tpl: 'a' }, f1Payload);
  t('F1 모터스포츠: 1위 드라이버(선두)·승점·2위 격차·다음 GP·서킷 표시', /Andrea Kimi Antonelli/.test(f1Html) && /292점/.test(f1Html) && /Azerbaijan Grand Prix/.test(f1Html) && /Baku City Circuit/.test(f1Html) && /\+81점/.test(f1Html));
  t('F1 모터스포츠: 연습/예선 세션 타임라인 표시', /1차 연습/.test(f1Html) && /예선/.test(f1Html));
  const f1TplB = D.tileBody({ id: 'f1', label: 'F1', kind: 'sport', tpl: 'b' }, f1Payload);
  t('F1 모터스포츠 시안 B: 드라이버 순위표 5인 + 팀 1위 표시', /드라이버 챔피언십/.test(f1TplB) && /Mercedes/.test(f1TplB) && /503점/.test(f1TplB));

  // 축구 최다 득점 / 리그 1위 명예 배지 검증
  const mcScorer = {
    status: 'ok', kind: 'sport', data: {
      discipline: 'league', team: 'Manchester City', league: 'English Premier League',
      standings: { rank: 1, points: 15, leader: { team: 'Manchester City', points: 15, rank: 1 }, gapToLeader: 0 },
      honors: [
        { type: 'points', title: '리그 선두(우승 레이스 1위)', name: 'Manchester City', value: '1위 · 승점 15' },
        { type: 'scorer', title: '최다 득점(골든부츠 경쟁)', name: 'Erling Haaland', value: '5골', team: 'Manchester City' },
      ],
      next: null, results: [{ home: 'Manchester City', away: 'Sunderland', score: '5 - 3' }],
    },
  };
  const scHtml = D.tileBody({ id: 'mancity', label: '맨시티', kind: 'sport', tpl: 'a' }, mcScorer);
  t('스포츠 점수형: 최다 득점 선수(Erling Haaland 5골) 명예 배지 노출', /Erling Haaland/.test(scHtml) && /5골/.test(scHtml) && /최다 득점/.test(scHtml));
  t('스포츠 등수형: 리그 선두(1위 · 승점 15) 명예 배지 노출', /리그 선두/.test(scHtml) && /1위 · 승점 15/.test(scHtml));
}

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
