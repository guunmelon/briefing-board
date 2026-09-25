/* 피드백 → 코드 셀프 패치 엔진 통합 테스트 (실제 파일 생성 → 실제 빌드 → 실제 렌더)
   ------------------------------------------------------------
   재현되는 것:
     1) 자연어 요청 → src/patches/<id>.js 가 생성되고 dist/index.html 에 그 코드가 들어가는지
     2) 생성된 코드가 브라우저와 같은 경로(BPatch.applyData → Data.tileBody)로 그려지는지
     3) 요청한 표시(오전/오후·미세먼지·일출·단위·자리수·경기 일정)가 실제 값으로 나오는가
     4) 되돌리면(clear + 재빌드) 원복되는가
     5) 만들 수 없는 요청은 정직하게 ok:false + 파일 무변화인가
   실행: node tools/test-patch.js   (npm test 포함) — 저장된 패치를 전부 지우고 재빌드하므로 단독 실행용
*/
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const cp = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'src');
const PDIR = path.join(SRC, 'patches');
const PE = require('./patch-engine.js');

let pass = 0, fail = 0;
function t(name, cond, extra){
  if (cond){ pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra ? '  → ' + extra : '')); }
}
const build = () => cp.spawnSync(process.execPath, [path.join(ROOT, 'tools', 'build.js')], { encoding: 'utf8' });

/* ---------- 픽스처: 서버 weatherFor 응답 형태 그대로 (가짜 수치가 아니라 "들어와야 할 실측 모양") ---------- */
function hourlyFix(){
  const out = [];
  for (let h = 0; h < 24; h++) out.push({ iso: `2026-09-10T${String(h).padStart(2, '0')}:00`, h, t: 14 + h * 0.4, pp: h * 3, pr: (h === 13 || h === 14) ? 0.6 : 0, wc: h >= 13 && h <= 14 ? 61 : 1, cond: h >= 13 && h <= 14 ? '비' : '구름 조금', feels: 13.5 + h * 0.4, humidity: 60 + (h % 5), wind: 1 + h * 0.1 });
  return out;
}
function wxPayload(){
  return { status: 'ok', kind: 'weather', at: Date.now(), data: {
    city: '서울', temp: 22.4, feels: 23.1, humidity: 64, wind: 2.3, cond: '비', code: 61, precip: 1.2,
    min: 19, max: 24, weekMin: [19, 18, 17], weekMax: [24, 23, 22], weekRain: [80, 60, 20], rainPct: 80, rainSum: 4.2,
    sunrise: '06:09', sunset: '18:48', pm10: 87, pm25: 43.46, aqi: 152, hourly: hourlyFix(), source: 'Open-Meteo(키 없이)',
  } };
}
function sportPayload(){
  const now = Date.now();
  const mk = (day, home, away, venue, hs, as, status) => ({ id: 'e' + day, home, away, venue, isHome: home === 'Manchester City' ? 1 : 0, ts: now + day * 86400000, when: `9월 ${14 + day}일 (월) 20:00`, status, hs, as, score: hs == null ? null : `${hs} - ${as}`, league: 'English Premier League', round: 4 });
  return { status: 'ok', kind: 'sport', at: Date.now(), data: {
    team: 'Manchester City', sport: 'Soccer', league: 'English Premier League', homeGround: 'Etihad Stadium',
    next: mk(3, 'Manchester United', 'Manchester City', 'Old Trafford', null, null, 'NS'),
    live: null, upcoming: [mk(3, 'Manchester United', 'Manchester City', 'Old Trafford', null, null, 'NS'), mk(7, 'Manchester City', 'Everton', 'Etihad Stadium', null, null, 'NS'), mk(12, 'Brentford', 'Manchester City', 'Gtech Community Stadium', null, null, 'NS')],
    results: [mk(-5, 'Manchester City', 'Coventry City', 'Etihad Stadium', 1, 0, 'FT'), mk(-12, 'Wolves', 'Manchester City', 'Molineux', 0, 2, 'FT')],
    today: [], form: ['W', 'W'], source: 'TheSportsDB',
  } };
}
function newsPayload(){
  const items = Array.from({ length: 6 }, (_, i) => ({ id: 'n' + i, title: ` 기사 제목 ${i + 1}`, desc: '', src: 'Guardian', pub: new Date(Date.now() - i * 3600_000).toISOString(), link: 'https://x/' + i }));
  return { status: 'ok', kind: 'news', at: Date.now(), data: { items } };
}

/* ---------- 브라우저와 동일한 실행 환경(런타임 + data.js + 생성된 패치) ---------- */
function makeWorld(){
  const sb = { console, Date, Math, JSON, String, Number, Array, Object, RegExp, Error, isNaN, parseInt, parseFloat, Intl, Set, Map, encodeURIComponent, decodeURIComponent, document: undefined, setTimeout, clearTimeout };
  sb.window = sb; sb.self = sb; sb.globalThis = sb;
  vm.createContext(sb);
  for (const f of ['patch-runtime.js', 'data.js', 'logic.js']){
    vm.runInContext(fs.readFileSync(path.join(SRC, f), 'utf8'), sb, { filename: f });
  }
  let ix = { patches: [] };
  try { ix = JSON.parse(fs.readFileSync(path.join(PDIR, 'index.json'), 'utf8')); } catch (e) {}
  for (const p of ix.patches || []){
    try { vm.runInContext(fs.readFileSync(path.join(PDIR, p.file), 'utf8'), sb, { filename: p.file }); }
    catch (e) { t('패치 파일이 브라우저에서 파싱된다', false, p.file + ' → ' + e.message); }
  }
  return sb;
}
function render(w, topic, payload, scope){
  const p2 = w.BPatch && w.BPatch.applyData ? w.BPatch.applyData(topic, payload, scope || 'tile') : payload;
  if (scope === 'strip'){
    const base = '';
    return w.BPatch && w.BPatch.applyHtml ? w.BPatch.applyHtml(topic, p2, base, 'strip') : base;
  }
  return w.Data.tileBody(topic, p2);
}

/* ================= 실행 ================= */
console.log('\n[패치 엔진] 저장 → 빌드 → 렌더 통합');
// 0) 시작 상태 정리(이 테스트는 패치를 전부 지운 뒤 다시 쌓는다)
PE.clearAll(); build();

const w0 = makeWorld();
t('패치 없음 → 원본 렌더(오전/오후 없음)', !render(w0, { id: 'w1', label: '서울 날씨', kind: 'weather', tpl: 'a' }, wxPayload()).includes('bp-split'));

// 1) 해석(plan) — 사용자가 예로 든 문장들이 연산자로 이어지는가
const p1 = PE.plan('날씨를 오전/오후로 나눠서 표시해줘');
t('“오전/오후로 나눠서” → split-daypart', p1.directives.some(d => d.op === 'split-daypart') && p1.target.kind === 'weather');
const p2 = PE.plan('미세먼지도 표시해줘');
t('“미세먼지도 표시” → field.add pm10·pm25', p2.directives.some(d => d.op === 'field.add' && d.args.fields.includes('pm10') && d.args.fields.includes('pm25')));
const p3 = PE.plan('일정위젯의->날씨를 오전/오후로 나눠서 표시 해줘');
t('“일정위젯의->” 위치 지정 → scope=strip', p3.target.scope === 'strip' && p3.target.kind === 'weather' && p3.directives.length > 0);
const p4 = PE.plan('비행기 표 예약해줘');
t('못 만드는 요청 → 연산자 0개(정직)', p4.directives.length === 0);
const p5 = PE.plan('맨시티 다음 경기 일정도 보여줘');
t('스포츠 요청 → section.fixtures', p5.target.kind === 'sport' && p5.directives.some(d => d.op === 'section.add' && d.args.section === 'fixtures'));

// 2) 실제 생성·빌드 — 무대 A: 표시 추가 계열 (분리·필드·스트립·스포츠·건수)
const r1 = PE.apply('날씨를 오전/오후로 나눠서 표시해줘', { topics: [] });
const r2 = PE.apply('미세먼지도 표시해줘', { topics: [] });
const r3 = PE.apply('일정위젯의->날씨를 오전/오후로 나눠서 표시 해줘', { topics: [] });
const r4 = PE.apply('맨시티 카드에 경기장도 보여줘', { topics: [{ id: 'mancity', label: '맨시티', kind: 'sport' }] });
const r7 = PE.apply('브리핑 기사 3건만 보여줘', { topics: [] });
const bA = build();
t('5개 요청 모두 코드 생성', [r1, r2, r3, r4, r7].every(r => r.ok && r.applied.length >= 1), JSON.stringify([r1, r2, r3, r4, r7].map(r => r.reason || r.error || 'ok')));
t('재빌드 성공', bA.status === 0, String(bA.stderr || '').slice(0, 160));
const distA = fs.readFileSync(path.join(ROOT, 'dist', 'index.html'), 'utf8');
t('생성된 코드가 산출물(bundle)에 들어간다', /BPatch\.register\(/.test(distA) && /bp-split/.test(distA));
t('패치 파일이 src/patches 에 실재', fs.readdirSync(PDIR).filter(f => f.endsWith('.js')).length >= 5, String(fs.readdirSync(PDIR).length));

const w = makeWorld();
t('5개 요청 → 코드 패치 5장이 각자 등록(서로 덮어쓰지 않음)', w.BPatch.count() === 5, String(w.BPatch.count()));
const wxHtml = render(w, { id: 'w1', label: '서울 날씨', kind: 'weather', tpl: 'a' }, wxPayload());
t('오전/오후 분리: 시간대별 실측 최대·최소(18°~16° / 23°~19°)', /오전[\s\S]{0,60}?18° ~ 16°/.test(wxHtml) && /오후[\s\S]{0,60}?23° ~ 19°/.test(wxHtml), wxHtml.slice(-360));
t('오전/오후 각각 강수확률(33% / 69%)', /강수확률 33%/.test(wxHtml) && /강수확률 69%/.test(wxHtml));
t('빗줄기 관측 시간대는 강조(wet) 표시', /bpc wet/.test(wxHtml));
t('미세먼지 PM10 실측 + 등급(나쁨)', /미세먼지 PM10/.test(wxHtml) && /87 ㎍\/m³ · 나쁨/.test(wxHtml));
t('초미세먼지 PM2.5 실측(농도는 정수 표기) + 등급', /초미세먼지 PM2\.5/.test(wxHtml) && /43 ㎍\/m³ · 보통/.test(wxHtml), (wxHtml.match(/초미세[^<]*<\/span><span class="v">[^<]*/) || [''])[0]);
const stripHtml = render(w, { id: '_strip', label: '서울 날씨', kind: 'weather' }, wxPayload(), 'strip');
t('일정위젯 날씨 줄에도 오전/오후가 붙는다', /bp-split/.test(stripHtml) && /오전/.test(stripHtml) && /오후/.test(stripHtml), stripHtml.slice(0, 220));
const sp = render(w, { id: 'mancity', label: '맨시티', kind: 'sport', tpl: 'a' }, sportPayload());
t('맨시티 카드에 경기장 라인(Old Trafford)', /경기장/.test(sp) && /Old Trafford/.test(sp), sp.slice(-260));
t('팬 한눈에: D-day·남은 시간·상대·구장·최근 결과·폼', /D-[34]/.test(sp) && /남음/.test(sp) && /Manchester United/.test(sp) && /Old Trafford/.test(sp) && /최근 결과/.test(sp) && /sf-w/.test(sp), sp.slice(-320));
const nHtml = render(w, { id: 'mc2', label: '마인크래프트', kind: 'news', tpl: 'b' }, newsPayload());
t('“기사 3건만” → 뉴스 목록 3건', (nHtml.match(/display:flex;gap:6px;align-items:flex-start/g) || []).length === 3, String((nHtml.match(/display:flex;gap:6px/g) || []).length));
const other = render(w, { id: 'x9', label: '비트코인', kind: 'coin', tpl: 'a' }, { status: 'ok', kind: 'coin', data: { name: 'BTC', price: 90000000, prev: 89000000, chgPct: 1.1, high: 0, low: 0 } });
t('다른 종류 카드는 영향을 받지 않는다', !/bp-split|bp-rows/.test(other));

// 런타임 견고성 — 고장난 패치가 보드를 깨지 않는다
w.BPatch.register({ id: 'broken', title: '고장', target: { kind: 'weather' }, html: () => { throw new Error('boom'); } });
const safeHtml = render(w, { id: 'w1', label: '서울 날씨', kind: 'weather', tpl: 'a' }, wxPayload());
t('패치 예외 → 원본 렌더 유지 + 오류 기록', /bp-split/.test(safeHtml) && w.BPatch.errors().some(e => e.id === 'broken'), JSON.stringify(w.BPatch.errors()));

// 3) 무대 B: 데이터 변환 계열(단위·자리수) — payload 를 코드가 실제로 고친다
const r5 = PE.apply('화씨로 바꿔줘', { topics: [] });
const r6 = PE.apply('소수점 1자리로만 보여줘', { topics: [] });
build();
const wB = makeWorld();
const conv = { status: 'ok', kind: 'weather', data: { temp: 22.4, pm25: 43.46, pm10: 87, hourly: [] } };
const after = wB.BPatch.applyData({ id: 'w1', kind: 'weather' }, conv, 'tile');
t('화씨 변환 코드 실행(22.4℃ → 72.3℉)', after && after.data && Math.abs(after.data.temp - 72.3) < 0.15, JSON.stringify(after && after.data && after.data.temp));
t('미세먼지 값은 소수점 1자리로 반올림', after && after.data && after.data.pm25 === 43.5, JSON.stringify(after && after.data && after.data.pm25));
t('단위 태그가 데이터에 남는다(℉)', after && after.data && after.data.unit === '℉');
const htmlB = render(wB, { id: 'w1', label: '서울 날씨', kind: 'weather', tpl: 'a' }, wxPayload());
t('단위·자리수·분리·필드가 한 카에서 함께 동작', /bp-split/.test(htmlB) && /bp-rows/.test(htmlB) && /72°/.test(htmlB), htmlB.slice(-300));

// 4) 되돌리기·안정성
PE.clearAll();
const bC = build();
const wC = makeWorld();
const gone = render(wC, { id: 'w1', label: '서울 날씨', kind: 'weather', tpl: 'a' }, wxPayload());
t('clear 후 렌더에 생성 코드가 없다(원복)', !/bp-split|bp-rows/.test(gone) && bC.status === 0);
t('clear 후 bundle 에서 패치 등록문이 사라진다', !/BPatch\.register\(/.test(fs.readFileSync(path.join(ROOT, 'dist', 'index.html'), 'utf8')));
const rA = PE.apply('날씨를 오전/오후로 나눠서 표시해줘', { topics: [] });
const rB = PE.apply('날씨를 오전/오후로 나눠서 표시해줘', { topics: [] });
t('같은 요청 반복 → 중복 없이 교체', rA.ok && rB.ok && PE.list().length === 1 && rB.replaced.length === 1, JSON.stringify(PE.list().map(x => x.id)));
const rC = PE.apply('비행기 표 예약해줘', { topics: [] });
t('못 만드는 요청 → ok:false + 파일 무변화', rC.ok === false && PE.list().length === 1 && (rC.catalog || []).length >= 6, JSON.stringify({ ok: rC.ok, n: PE.list().length, cat: (rC.catalog || []).length }));
const rD = PE.apply('일출 일몰도 보여줘', { topics: [] });
build();
const wD = makeWorld();
const htmlD = render(wD, { id: 'w1', label: '서울 날씨', kind: 'weather', tpl: 'a' }, wxPayload());
t('“일출·일몰” 요청 → 실측 시각 라인(06:09/18:48)', rD.ok && /일출/.test(htmlD) && /06:09/.test(htmlD) && /18:48/.test(htmlD), htmlD.slice(-200));

// 5) 생성된 코드는 사람이 읽을 수 있는 형태인가
const f = path.join(PDIR, PE.list()[0].file);
const code = fs.readFileSync(f, 'utf8');
t('생성 코드에 요청 원문·되돌리는 법 주석', code.includes('날씨를 오전/오후로 나눠서') && code.includes('patch-engine.js rm'));
t('생성 코드는 단독 파싱 가능', cp.spawnSync(process.execPath, ['--check', f], { encoding: 'utf8' }).status === 0);

// 6) 최종 정리
PE.clearAll(); build();
t('테스트 후 저장 패치 0개(워크스페이스 원복)', PE.list().length === 0);

console.log(`\n패치 엔진: ${pass} passed, ${fail} failed`);
if (fail) process.exitCode = 1;
