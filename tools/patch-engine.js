/* ============================================================
   PATCH ENGINE — "피드백 → 실제 코드" 컴파일러 (자가 반영)
   ------------------------------------------------------------
   이전까지 피드백 반영은 미리 준비된 설정값 중 골라 맞추는 방식이라
   사용자가 요청한 새 표시(예: 날씨를 오전/오후 분리, 미세먼지 추가)를 만들 수 없었다.
   이 엔진은 요청을 해석해 **연산자(op) 목록**으로 바꾸고, 각 연산자에 해당하는
   **JS 소스 코드를 생성**해 src/patches/<id>.js 로 저장한 뒤
   dist/index.html 을 다시 빌드한다. → 브라우저는 새로고침하면 바뀐 코드로 그려진다.

   설계 원칙
   - 답을 미리 만들어 두지 않는다. 표에 없는 요청은 정직하게 "못 한다"고 알린다.
   - 생성 코드는 사람이 읽을 수 있게 남긴다(src/patches/*.js git diff 로 확인 가능).
   - src/patch-runtime.js 의 훅만 사용한다(다른 파일은 수정하지 않는다) → 되돌리기는 파일 삭제 + 재빌드.
   - 데이터가 없으면 라인을 그리지 않는다(가짜 수치 금지).
   연산자(catalog) —— UI의 "할 수 있는 일" 안내는 이 표에서 자동 생성된다.
   ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PDIR = path.join(ROOT, 'src', 'patches');
const INDEX = path.join(PDIR, 'index.json');
const slugId = t => t.toLowerCase().replace(/[^a-z0-9가-힣]+/g, '-').replace(/^-|-$/g, '').slice(0, 28) || 'patch';

/* ============================== 사전 ============================== */
/* 위젯/영역 별칭 → target.kind (패치 런타임이 topic.kind 또는 tid로 일치시킨다) */
const WIDGET_ALIAS = {
  weather: ['날씨', '기상', '기온', '온도', '예보', '미세먼지', '초미세먼지', '대기질', '강수', '비', '눈', '일출', '일몰', '바람', '습도', '체감'],
  stock:   ['주식', '종목', '증시', '주가', '기업', '차트'],
  coin:    ['코인', '비트코인', '암호화폐', '알트'],
  fx:      ['환율', '달러', '엔화', '위안', '유로', '파운드', '원/달러'],
  sport:   ['경기', '축구', '야구', '농구', '킥오프', '원정', '홈경기', '순위', '결과', '일정표', '맨시티', '리버풀', '다저스', '레이커스'],
};
const TARGET_WORDS = {
  weather: ['날씨', '기상', 'wx', 'weather', '미세먼지', '초미세먼지', '대기질', '황사', '일출', '일몰', '강수', '비 확률', '예보', '주간', '화씨', '섭씨', '도씨'],
  stock: ['주식', '종목', '증시'],
  coin: ['코인', '비트코인'],
  fx: ['환율'],
  sport: ['스포츠', '경기', '축구', '야구', '농구'],
  personal: ['일정', '캘린더', '할 일', '플래너'],
  news: ['뉴스', '브리핑', '기사', '소식'],
};

/* 필드 사전 — kind 별로 "추가/제거할 수 있는 데이터 라인"을 정의한다.
   각 항목은 payload.data 의 실Keys를 그대로 읽는다(서버가 이미 실데이터로 채우는 필드만). */
const FIELDS = {
  weather: {
    pm10:    { label: '미세먼지 PM10', unit: '㎍/m³', key: 'pm10',    grade: 'pm',   also: ['미세먼지', 'pm10', 'pm 10', 'fine dust'] },
    pm25:    { label: '초미세먼지 PM2.5', unit: '㎍/m³', key: 'pm25',  grade: 'pm',   also: ['초미세먼지', 'pm2.5', 'pm25', '극초미세먼지'] },
    aqi:     { label: '대기질지수 AQI', unit: '', key: 'aqi', grade: 'aqi',         also: ['에어퀄리티', '대기질', 'aqi', 'us aqi'] },
    humidity:{ label: '습도', unit: '%', key: 'humidity',                             also: ['습도', 'relative humidity'] },
    wind:    { label: '바람', unit: 'm/s', key: 'wind',                               also: ['바람', '풍속', 'wind'] },
    feels:   { label: '체감온도', unit: '°', key: 'feels',                             also: ['체감', 'feels'] },
    rain:    { label: '강수확률', unit: '%', key: 'rainPct',                           also: ['강수확률', '비 확률', '강수'] },
    rainSum: { label: '오늘 강수량', unit: 'mm', key: 'rainSum',                       also: ['강수량', '내린 양', 'precipitation'] },
    sunrise: { label: '일출', unit: '', key: 'sunrise',                               also: ['일출', '해뜨는'] },
    sunset:  { label: '일몰', unit: '', key: 'sunset',                                also: ['일몰', '해지는', '해넘이'] },
    precip:  { label: '현재 강수', unit: 'mm', key: 'precip',                         also: ['지금 비', '현재 강수'] },
  },
  stock: {
    high:  { label: '고가', unit: '', key: 'high', fmt: 'money', also: ['고가', '상단'] },
    low:   { label: '저가', unit: '', key: 'low', fmt: 'money', also: ['저가', '하단'] },
    prev:  { label: '전일종가', unit: '', key: 'prev', fmt: 'money', also: ['전일', '어제 종가'] },
    name:  { label: '종목명', unit: '', key: 'name', also: ['종목 이름', '회사명'] },
    market:{ label: '시장', unit: '', key: 'market', also: ['시장', '거래소', 'nasdaq', 'kRX'] },
  },
  coin: {
    high: { label: '고가(24H)', unit: '', key: 'high', fmt: 'money', also: ['고가'] },
    low:  { label: '저가(24H)', unit: '', key: 'low', fmt: 'money', also: ['저가'] },
    prev: { label: '전일 종가', unit: '', key: 'prev', fmt: 'money', also: ['전일'] },
  },
  fx: {
    high: { label: '고가', unit: '원', key: 'high', fmt: 'fx', also: ['고가'] },
    low:  { label: '저가', unit: '원', key: 'low', fmt: 'fx', also: ['저가'] },
    date: { label: '기준일', unit: '', key: 'date', also: ['기준일', '날짜'] },
  },
  sport: {
    venue:   { label: '경기장', unit: '', expr: '(d.live && d.live.venue) || (d.next && d.next.venue) || d.homeGround || null', also: ['경기장', '스타디움', '구장', '어디서'] },
    kickoff: { label: '킥오프', unit: '', expr: '(d.live && (d.live.status || "진행 중")) || (d.next && d.next.when) || null', also: ['킥오프', '시작 시각', '몇 시', '언제'] },
    dday:    { label: 'D-day', unit: '', expr: 'd.next && d.next.ts ? "D-" + Math.max(0, Math.ceil((d.next.ts - ctx.now) / 86400000)) : null', also: ['디데이', 'd-day', '며칠 남', '얼마 남'] },
    form:    { label: '최근 5경기', unit: '', expr: 'd.form && d.form.length ? d.form.join(" ") : null', also: ['폼', '최근 흐름', '연승', '최근 5'] },
    ground:  { label: '홈 구장', unit: '', expr: 'd.homeGround || null', also: ['홈 구장', '연고지', '홈경기장'] },
    result:  { label: '최근 결과', unit: '', expr: 'd.results && d.results[0] ? (d.results[0].home + " " + (d.results[0].score || "") + " " + d.results[0].away) : null', also: ['최근 결과', '지막 결과', '어제 경기'] },
  },
};

/* 연산자 카탈로그 — "할 수 있는 일" 안내 + 테스트 케이스가 이 표를 읽는다 */
const OPS = {
  'split-daypart': { nm: '오전/오후·시간대 분리 표시', how: ['오전', '오후', '아침', '저녁', '밤', '나눠', '분리', '구역으로', 'parting'] },
  'field.add':     { nm: '데이터 라인 추가', how: ['표시', '보여', '넣어', '추가', '도', '알려', '출력'] },
  'field.hide':    { nm: '데이터 라인 제거', how: ['빼', '지워', '제외', '숨겨', '안 보이', '없애', '삭제'] },
  'section.add':   { nm: '블록 추가(그래프·주간·일몰·다음 경기)', how: ['그래프', '막대', '주간', '이번 주', '이틀', '모레', '일출', '일몰', '다음 경기', '3경기', '일정 목록', '시계열'] },
  'precision':     { nm: '숫자 자리수 조절', how: ['정수', '소수점', '자리', '반올림', '끝말', '자투리'] },
  'unit':          { nm: '단위 변환', how: ['화씨', '섭씨', 'fahrenheit', 'km/h', '킬로미터', '시속'] },
  'rename':        { label: 0, nm: '라벨·제목 바꾸기', how: ['라고 불러', '로 바꿔', '제목', '이름', '표기'] },
  'css':           { nm: '크기·굵기·정돈 스타일', how: ['크게', '작게', '굵게', '볼드', '좁게', '여백', '정렬', '강조'] },
  'list.count':    { nm: '목록 건수 조절', how: ['건만', '개만', '3건', '5건', '최대', '줄여', '늘려'] },
};

/* ============================== 유틸 ============================== */
const uniq = a => a.filter((v, i, s) => v && s.indexOf(v) === i);

/* "A->B", "A의 B", "A에서 B" → (target, instruction) */
function splitTarget(text){
  const t = String(text || '').trim();
  let head = null, rest = t;
  const arrow = t.split(/->|→|=>|▷/);
  if (arrow.length >= 2){ head = arrow[0]; rest = arrow.slice(1).join(' → ').trim(); }
  else {
    const m = /^(.{1,14}?)\s*(?:위젯|카드|타일|영역|칸)?\s*(?:의|에서|에는|엔)\s+(.+)$/.exec(t);
    if (m && m[2].length > 3){ head = m[1]; rest = m[2]; }
  }
  return { head: head || '', rest };
}
/* 대상 종류는 “지시문”이, 위치는 “머리말”이 정한다 — 지시어 가중치를 크게 둔다.
   (예: “일정위젯의 → 날씨를 오전/오후로” → 위치=일정 스트립, 대상=날씨) */
function detectKind(head, rest){
  const h = String(head || '').toLowerCase(), r = String(rest || '').toLowerCase();
  const probe = h + ' ' + r;
  let best = null, score = 0;
  for (const k of Object.keys(TARGET_WORDS)){
    let sc = 0;
    for (const w of TARGET_WORDS[k]){
      const ww = w.toLowerCase();
      if (r.includes(ww)) sc += 2;
      if (h.includes(ww)) sc += 1;
      if (probe.includes(ww)) sc += 0.25;
    }
    if (sc > score){ score = sc; best = k; }
  }
  return score ? best : null;
}
/* 사용자 관심사 라벨 언급 → 그 카드만 겨냥(tid) */
function detectTopic(rest, topics){
  let hit = null;
  for (const tp of topics || []){
    const short = String(tp.label || '').trim();
    if (short.length >= 2 && rest.includes(short)){ hit = tp; break; }
    const w = short.split(/[\s·]/).filter(x => x.length >= 3);
    if (w.some(x => rest.includes(x))){ hit = tp; break; }
  }
  return hit ? { tid: hit.id, label: hit.label, kind: hit.kind } : null;
}
function findFields(kind, text){
  const dict = FIELDS[kind] || {};
  const low = String(text || '').toLowerCase();
  const flat = low.replace(/\s/g, '');
  const out = [];
  for (const key of Object.keys(dict)){
    const f = dict[key];
    const words = [key, f.label, ...f.also].map(x => String(x || '').toLowerCase());
    if (words.some(w => w && (flat.includes(w.replace(/\s/g, '')) || low.includes(w)))) out.push(key);
  }
  return uniq(out);
}

/* ============================== 계획(해석) ============================== */
function plan(text, topics){
  const raw = String(text || '').trim();
  const { head, rest } = splitTarget(raw);
  const body = (rest || raw);
  const low = body.toLowerCase();
  const kind = detectKind(head, body);
  const topic = detectTopic(body, topics);
  const targetKind = topic ? (topic.kind || kind) : kind;
  /* 위치 지정: “일정위젯의 날씨…” → 스트립, “카드/타일” → 카드, “브리핑/뉴스레터” → 레일 */
  const whereTxt = (head + ' ' + body).toLowerCase();
  let scope = null;
  if (/위젯|일정/.test(head.toLowerCase()) && /날씨|기상|기온|온도|미세먼지|대기질/.test(whereTxt)) scope = 'strip';
  else if (/카드|타일|관심사/.test(whereTxt)) scope = 'tile';
  else if (/브리핑|뉴스레터|레일/.test(whereTxt)) scope = 'brief';
  /* “일정 위젯의 날씨 줄”은 곧 날씨 데이터다 — 위치가 정해지면 대상도 확정한다 */
  const targetKind0 = scope === 'strip' ? 'weather' : (kind || null);
  const target = { kind: targetKind0 || targetKind || null, tid: topic ? topic.tid : null, label: topic ? topic.label : null, scope };
  const p = {
    text: raw,
    target,
    directives: [],
    ambiguous: [],
  };
  if (!raw) return p;

  const has = (...ws) => ws.some(w => low.includes(String(w).toLowerCase()));
  const hideIntent = has('빼', '지워', '제외', '숨', '없애', '삭제', '안 보이', '안보이', '필요 없');
  const addIntent = !hideIntent;

  /* 1) 시간대 분리 — 오전/오후(·저녁) 같이 "나눠" + 온도·강수 같은 지표 */
  const dayPart = (/(오전|아침)\D{0,14}(오후|저녁|밤)/.test(body) || has('오.오후', '오오후', '나눠', '분리', '구역'))
    && (targetKind === 'weather' || has('온도', '기온', '날씨', '기상', '강수', '비 확률'));
  if (dayPart && (targetKind === 'weather' || !targetKind)){
    const metric = has('강수', '비 확률', '확률', '비 올') ? 'pp' : (has('체감') ? 'feels' : (has('습도') ? 'humidity' : (has('바람', '풍속') ? 'wind' : 't')));
    p.directives.push({ op: 'split-daypart', target, args: { metric, parts: has('저녁', '밤') ? 3 : 2 } });
  }

  /* 2) 필드 추가/제거 — 필드 사전에 있는 이름만 인식(없는 건 ambiguous) */
  let flds = targetKind ? findFields(targetKind, body) : [];
  if (!targetKind){
    // 종류를 안 적었어도 필드 사전에서 한 종류로만 확정되면 그 종류로 본다 (예: “미세먼지도 표시해줘”)
    const hits = Object.keys(FIELDS).map(k => ({ k, f: findFields(k, body) })).filter(x => x.f.length);
    const only = uniq(hits.map(x => x.k));
    if (only.length === 1){ p.target.kind = only[0]; flds = (hits.find(x => x.k === only[0]) || {}).f || []; }
  }
  if (has('먼지')){                                              // 한국 실사용 표기: 미세먼지 요청은 PM10·PM2.5 짝으로
    flds = uniq(['pm10', 'pm25'].concat(flds)).filter(f => f === 'pm10' || f === 'pm25' || (FIELDS.weather || {})[f] && !/^(humidity|wind|feels|rain|rainSum|sunrise|sunset|precip|aqi)$/.test(f));
    if (!flds.includes('pm10')) flds = ['pm10', 'pm25'];
    if (/초미세먼지\s*만|pm2\.?5\s*만/.test(low)) flds = ['pm25'];
    else if (/미세먼지\s*만|pm10\s*만/.test(low)) flds = ['pm10'];
  }
  if (flds.length){
    if (hideIntent) p.directives.push({ op: 'field.hide', target, args: { fields: flds } });
    else if (addIntent) p.directives.push({ op: 'field.add', target, args: { fields: flds } });
  }

  /* 3) 블록 추가 */
  const secKey = has('그래프', '막대', '시계열', '차트') ? 'hourly-graph'
    : (has('주간', '이번 주', '주중', '3일', '내일', '모레', '이틀') ? 'week3'
    : (has('일출', '일몰', '해뜨', '해지는', '해넘이') ? 'sun'
    : (has('다음 경기', '경기 일정', '3경기', '일정 목록', '원정', '잔여 경기') ? 'fixtures' : null)));
  if (secKey){
    const usable = { 'hourly-graph': targetKind === 'weather', 'week3': targetKind === 'weather', 'sun': targetKind === 'weather', 'fixtures': targetKind === 'sport' }[secKey];
    if (usable) p.directives.push({ op: 'section.add', target, args: { section: secKey } });
    else if (secKey === 'fixtures' && targetKind === 'weather') p.directives.push({ op: 'section.add', target, args: { section: 'hourly-graph' } });
    else p.ambiguous.push(`“${secKey}” 블록은 ${targetKind || '미特定'} 카드에는 데이터가 없어요.`);
  }

  /* 4) 숫자 자리수 */
  if (has('정수', '소수점 없음', '점 없이', '반올림') || /(\d+)\s*자리/.test(body)){
    const m = /(\d+)\s*자리/.exec(body);
    p.directives.push({ op: 'precision', target, args: { digits: m ? Math.min(4, Number(m[1])) : 0 } });
  }
  /* 5) 단위 변환 */
  if (has('화씨', 'fahrenheit')) p.directives.push({ op: 'unit', target, args: { to: 'f' } });
  else if (has('섭씨', 'celsius')) p.directives.push({ op: 'unit', target, args: { to: 'c' } });
  else if (has('km/h', '킬로미터', '시속')) p.directives.push({ op: 'unit', target, args: { to: 'kmh' } });
  /* 6) 라벨 바꾸기 — "XX라고 불러줘" / "YY로 바꿔줘" (인용구 또는 조사 앞 단어) */
  // 인용문으로 명시한 이름 변경은 항상 반영, 맨끝 “XX로 바꿔줘” 식은 다른 연산이 없을 때만(‘화씨로 바꿔줘’ 오인 방지)
  const rnQuote = /[“"'『「]([^”"'』」]{1,18})[”"'』」]\s*(?:라고|로|이래)?\s*(?:불러|표기|바꿔|고쳐|써)/.exec(body);
  const rnBare = /^([가-힣A-Za-z0-9 ·]{2,18})(?:라고|로)\s*(?:불러|바꿔|고쳐)줘?\s*$/.exec(body);
  const rn = rnQuote || (p.directives.length ? null : rnBare);
  if (rn && (targetKind || topic) && !flds.length){
    const to = rn[1].trim();
    if (to) p.directives.push({ op: 'rename', target, args: { to } });
  }
  /* 7) 스타일 — 위젯 한정 크기/굵기 (전역 테마·글자 크기는 Logic 쪽 설정 룰이 처리) */
  const cssBits = [];
  if (has('굵게', '볼드', '강조', ' 진하게', '진하게')) cssBits.push('font');
  if (has('크게', '키워', '늘려', '늘여', '넓게')) cssBits.push('up');
  if (has('작게', '줄여', '줄어', '좁게', '圧축', '압축')) cssBits.push('down');
  if (cssBits.length && (targetKind || topic)) p.directives.push({ op: 'css', target, args: { bits: cssBits } });
  /* 8) 목록 건수 */
  const lc = /(\d{1,2})\s*(?:건|개)(?:만|으로|으로만)?/.exec(body);
  if (lc && (targetKind === 'news' || targetKind === 'sport' || targetKind === 'stock')){
    p.directives.push({ op: 'list.count', target, args: { n: Math.max(1, Math.min(8, Number(lc[1]))) } });
  }
  return p;
}

/* ============================== 코드 생성 ============================== */
/* 각 생성기는 { code, css, log } 를 반환한다. code 는 BPatch.register(...) 호출문. */
const T = (n) => '  '.repeat(n);
function header(p, d){
  return `/* 자동 생성 — tools/patch-engine.js  ·  op: ${d.op}  ·  id: ${p.id}
   요청: "${String(p.request || '').replace(/\n/g, ' ').slice(0, 140)}"
   이 파일은 지우면 되돌려집니다(node tools/patch-engine.js rm ${p.id}). */`;
}
function targetLine(t){
  const bits = [];
  if (t.kind) bits.push(`kind: ${JSON.stringify(t.kind)}`);
  if (t.tid) bits.push(`tid: ${JSON.stringify(t.tid)}`);
  if (t.scope) bits.push(`scope: ${JSON.stringify(t.scope)}`);
  return `  target: { ${bits.join(', ')} },  // ${t.scope === 'strip' ? '오늘 일정 위젯의 날씨 줄' : t.scope === 'brief' ? '뉴스레터 카드' : t.scope === 'tile' ? '관심사 카드' : '카드·일정 위젯 모두'}`;
}

function codegen(d, meta){
  const id = meta.id;
  const tgt = targetLine(meta.target);
  const head = header(meta, d);
  const kind = meta.target.kind;
  const F = k => (FIELDS[kind] || {})[k] || { label: k, unit: '', key: k };

  switch (d.op){
    case 'field.add': {
      const lines = d.args.fields.map(k => {
        const f = F(k);
        const grade = f.grade === 'pm' ? ` + ' · ' + ctx.h.pmGrade(Number(v))` : (f.grade === 'aqi' ? ` + ' · ' + ctx.h.aqiGrade(Number(v))` : '');
        const isInt = f.round || f.unit === '%' || f.unit === '°' || f.unit === '㎍/m³';   // 농도·확률·온도는 정수 표기가 관례
        const fmt = isInt ? `Math.round(v)` : (f.fmt === 'money' ? `ctx.h.money(v)` : (f.fmt === 'fx' ? `ctx.h.fx(v)` : `ctx.h.num(v)`));
        const src = f.expr || `d[${JSON.stringify(f.key)}]`;
        return `      (function () { var d2 = ctx.payload && ctx.payload.data, d = d2, v = ${src}; if (v == null || v === '' || (typeof v === 'number' && isNaN(v))) return ''; return ctx.h.line(${JSON.stringify(f.label)}, (${fmt}) + ${JSON.stringify(f.unit ? ' ' + f.unit : '')}${grade}); })(),`;
      });
      const code = `${head}
BPatch.register({
  id: ${JSON.stringify(id)},
  title: ${JSON.stringify(meta.title)},
${tgt}
  html: function (ctx) {
    var d = ctx.payload && ctx.payload.data;
    if (!d) return ctx.html;
    var add = [
${lines.join('\n')}
    ].join('');
    return add ? ctx.html + '<div class="bp-rows">' + add + '</div>' : ctx.html;
  }
});`;
      return { code, log: `${kind || '관심사'} 카드에 ${d.args.fields.map(k => F(k).label).join('·')} 줄을 그리는 코드를 추가`, css: '' };
    }
    case 'field.hide': {
      const names = d.args.fields.map(k => F(k).label);
      const code = `${head}
BPatch.register({
  id: ${JSON.stringify(id)},
  title: ${JSON.stringify(meta.title)},
${tgt}
  html: function (ctx) {
    var drop = ${JSON.stringify(names)};
    return ctx.html.split('<div class="minirow">').map(function (chunk, i) {
      if (!i) return chunk;
      var label = (chunk.match(/<span class="k">([^<]*)</) || [])[1] || '';
      return (drop.some(function (x) { return label.indexOf(x) >= 0; })) ? '\u0000' : '<div class="minirow">' + chunk;
    }).join('').split('\u0000').join('');
  }
});`;
      return { code, log: `${names.join('·')} 줄을 표시하지 않도록 렌더 코드를 수정`, css: '' };
    }
    case 'split-daypart': {
      const metric = d.args.metric;
      const METRIC = { t:['기온','°'], pp:['강수확률','%'], feels:['체감온도','°'], humidity:['습도','%'], wind:['바람','m/s'] }[metric] || ['기온','°'];
      const unit = METRIC[1], sel = metric === 'pp' ? 'x.pp' : metric === 'feels' ? '(x.feels != null ? x.feels : x.t)' : metric === 'humidity' ? '(x.humidity != null ? x.humidity : x.t)' : metric === 'wind' ? '(x.wind != null ? x.wind : x.t)' : 'x.t';
      const cells = d.args.parts === 3 ? "[[5, 12, '오전'], [12, 19, '오후'], [19, 24, '저녁']]" : "[[5, 12, '오전'], [12, 24, '오후']]";
      const valExpr = unit === '%'
        ? `Math.round(a.hi) + '% + (a.lo < a.hi ? ' ~ ' + Math.round(a.lo) + '%' : '')`
        : `Math.round(a.hi) + '${unit}' + (a.lo < a.hi ? ' ~ ' + Math.round(a.lo) + '${unit}' : '')`;
      const code = `${head}
BPatch.register({
  id: ${JSON.stringify(id)},
  title: ${JSON.stringify(meta.title)},
${tgt}
  css: '.bp-split{display:flex;gap:6px;margin-top:7px}.bp-split .bpc{flex:1 1 0;min-width:0;border-radius:10px;padding:5px 7px 6px;background:var(--glass-weak);border:1px solid var(--line-weak)}.bp-split .bpc b{display:block;font-size:14px;letter-spacing:-.03em;line-height:1.25}.bp-split .bpc span{display:block;font-size:9.5px;color:var(--ink-3);font-weight:700;letter-spacing:.02em}.bp-split .bpc i{display:block;font-size:9.5px;font-style:normal;margin-top:2px}.bp-split .bpc.wet{border-color:rgba(56,189,248,.5)}.bp-split .bpc.wet i{color:#38bdf8}',
  /* ${METRIC[0]}을(를) 시간대(오전/오후)로 쪼갠다 — Open-Meteo 시간별 실측(payload.hourly)만 사용 */
  html: function (ctx) {
    var d = ctx.payload && ctx.payload.data;
    var H = (d && d.hourly) || [];
    if (!H.length) return ctx.html;
    function stat(lo, hi) {
      var rows = H.filter(function (x) { return x.h >= lo && x.h < hi; });
      var v = rows.map(function (x) { return ${sel}; }).filter(function (n) { return n != null && !isNaN(n); });
      if (!v.length) return null;
      var wet = rows.filter(function (x) { return (x.pr || 0) > 0 || (x.wc >= 51 && x.wc <= 67) || (x.wc >= 80 && x.wc <= 82); }).length;
      var pp = rows.map(function (x) { return x.pp; }).filter(function (n) { return n != null; });
      return { hi: Math.max.apply(null, v), lo: Math.min.apply(null, v), wet: wet, pp: pp.length ? Math.max.apply(null, pp) : null };
    }
    var out = '';
    ${cells}.forEach(function (c) {
      var a = stat(c[0], c[1]);
      if (!a) return;
      var val = ${valExpr};
      out += '<div class="bpc' + (a.wet ? ' wet' : '') + '"><span>' + c[2] + '</span><b>' + val + '</b>'
        + '<i>' + (a.pp != null ? '강수확률 ' + Math.round(a.pp) + '%' : (a.wet ? '강수 관측' : '메마름')) + '</i></div>';
    });
    if (!out) return ctx.html;
    return ctx.html + '<div class="bp-split">' + out + '</div>';
  }
});`;
      return { code, log: `${METRIC[0]}을(를) ${d.args.parts === 3 ? '오전·오후·저녁' : '오전·오후'}으로 쪼개는 렌더 코드를 생성`, css: '' };
    }
    case 'section.add': {
      const sec = d.args.section;
      if (sec === 'hourly-graph'){
        const code = `${head}
BPatch.register({
  id: ${JSON.stringify(id)},
  title: ${JSON.stringify(meta.title)},
${tgt}
  css: '.bp-graph{margin-top:6px;height:34px;border-radius:8px;background:var(--glass-weak);padding:3px 4px 0;box-sizing:border-box}.bp-graph .gxl{display:flex;justify-content:space-between;font-size:8.5px;color:var(--ink-3);padding:0 2px}',
  html: function (ctx) {
    var d = ctx.payload && ctx.payload.data, H = (d && d.hourly) || [];
    var vals = H.map(function (x) { return x.pp != null ? x.pp : x.t; }).filter(function (v) { return v != null; });
    if (vals.length < 3) return ctx.html;
    var isPp = H.some(function (x) { return x.pp != null; });
    return ctx.html + '<div class="bp-graph">' + ctx.h.spark(vals, 34, isPp ? '#38bdf8' : '#f59e0b')
      + '<div class="gxl"><span>' + (H[0] ? H[0].h + '시' : '') + '</span><span>${isPp ? '강수확률' : '기온'} 24h</span><span>' + (H[H.length - 1] ? H[H.length - 1].h + '시' : '') + '</span></div></div>';
  }
});`;
        return { code, log: '시간대별 실측(강수확률·기온) 막대 그래프를 그리는 코드를 추가', css: '' };
      }
      if (sec === 'week3'){
        const code = `${head}
BPatch.register({
  id: ${JSON.stringify(id)},
  title: ${JSON.stringify(meta.title)},
${tgt}
  css: '.bp-week{display:flex;gap:5px;margin-top:7px}.bp-week .w{flex:1 1 0;min-width:0;text-align:center;border-radius:9px;padding:5px 4px 6px;background:var(--glass-weak);border:1px solid var(--line-weak)}.bp-week .w b{display:block;font-size:11.5px}.bp-week .w em{display:block;font-style:normal;font-size:9px;color:var(--ink-3)}.bp-week .w i{display:block;font-style:normal;font-size:9px;color:#38bdf8}',
  html: function (ctx) {
    var d = ctx.payload && ctx.payload.data;
    var mx = (d && d.weekMax) || [], mn = (d && d.weekMin) || [], rr = (d && d.weekRain) || [];
    if (mx.length < 2) return ctx.html;
    var nm = ['오늘', '내일', '모레', '나흘', '닷새'];
    var out = '';
    for (var i = 0; i < Math.min(3, mx.length); i++){
      if (mx[i] == null) continue;
      out += '<div class="w"><b>' + Math.round(mn[i] != null ? mn[i] : mx[i]) + '°/' + Math.round(mx[i]) + '°</b>'
        + '<em>' + (nm[i] || ('+' + i)) + '</em>' + (rr[i] != null ? '<i>' + Math.round(rr[i]) + '%</i>' : '') + '</div>';
    }
    return out ? ctx.html + '<div class="bp-week">' + out + '</div>' : ctx.html;
  }
});`;
        return { code, log: '오늘·내일·모레 3일 최고/최저·강수확률 블록 코드를 추가', css: '' };
      }
      if (sec === 'sun'){
        const code = `${head}
BPatch.register({
  id: ${JSON.stringify(id)},
  title: ${JSON.stringify(meta.title)},
${tgt}
  html: function (ctx) {
    var d = ctx.payload && ctx.payload.data;
    if (!d || (!d.sunrise && !d.sunset)) return ctx.html;
    return ctx.html + '<div class="bp-rows">' + ctx.h.line('일출', d.sunrise || null) + ctx.h.line('일몰', d.sunset || null) + '</div>';
  }
});`;
        return { code, log: '일출·일몰 시각 라인 코드를 추가', css: '' };
      }
      // fixtures (sport)
      const code = `${head}
BPatch.register({
  id: ${JSON.stringify(id)},
  title: ${JSON.stringify(meta.title)},
${tgt}
  css: '.bp-fix{margin-top:6px;display:flex;flex-direction:column;gap:3px}.bp-fix .f{display:flex;gap:6px;align-items:baseline;font-size:10.5px;padding:3px 6px;border-radius:8px;background:var(--glass-weak);border:1px solid var(--line-weak)}.bp-fix .f i{font-style:normal;font-size:9px;color:var(--ink-3);flex:0 0 auto;width:64px}.bp-fix .f b{font-weight:650;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.bp-fix .f em{font-style:normal;margin-left:auto;font-size:9px;color:var(--ink-3);flex:0 0 auto}',
  html: function (ctx) {
    var d = ctx.payload && ctx.payload.data, list = (d && d.upcoming) || [];
    if (!list.length) return ctx.html;
    var out = list.slice(0, 3).map(function (e) {
      var home = e.home === (d.team || '') || e.isHome === 1;
      return '<div class="f"><i>' + ctx.h.shortWhen(e.when) + '</i><b>' + (home ? 'vs ' : '@ ') + ctx.h.esc(home ? e.away : e.home) + '</b>' + (e.venue ? '<em>' + ctx.h.esc(e.venue) + '</em>' : '') + '</div>';
    }).join('');
    return ctx.html + '<div class="bp-fix">' + out + '</div>';
  }
});`;
      return { code, log: '앞으로의 경기 일정(상대·구장) 목록 코드를 추가', css: '' };
    }
    case 'precision': {
      const dg = d.args.digits;
      const code = `${head}
BPatch.register({
  id: ${JSON.stringify(id)},
  title: ${JSON.stringify(meta.title)},
${tgt}
  data: function (ctx) {
    var d = ctx.payload && ctx.payload.data;
    if (!d) return ctx.payload;
    var n = ${dg}, out = {};
    Object.keys(d).forEach(function (k) {
      var v = d[k];
      if (typeof v === 'number' && !isNaN(v) && Math.abs(v) < 100000) v = Number(v.toFixed(n));
      out[k] = Array.isArray(v) ? v.map(function (z) { return typeof z === 'number' ? Number(z.toFixed(n)) : z; }) : v;
    });
    return Object.assign({}, ctx.payload, { data: out, bpPrec: n });
  }
});`;
      return { code, log: `숫자를 소수점 ${dg}자리로 반올림하는 데이터 코드를 추가`, css: '' };
    }
    case 'unit': {
      const to = d.args.to;
      const conv = to === 'f' ? `d.temp = Math.round((d.temp * 9 / 5 + 32) * 10) / 10;
      if (d.feels != null) d.feels = Math.round((d.feels * 9 / 5 + 32) * 10) / 10;
      ['weekMax', 'weekMin'].forEach(function (k) { if (Array.isArray(d[k])) d[k] = d[k].map(function (v) { return v == null ? v : Math.round((v * 9 / 5 + 32) * 10) / 10; }); });
      if (Array.isArray(d.hourly)) d.hourly = d.hourly.map(function (h) { return Object.assign({}, h, { t: h.t == null ? h.t : Math.round((h.t * 9 / 5 + 32) * 10) / 10 }); });
      d.unit = '℉';`
    : to === 'c' ? `d.unit = '℃';`
    : `if (d.wind != null) d.wind = Math.round(d.wind * 3.6 * 10) / 10; d.windUnit = 'km/h';`;
      const nm = to === 'f' ? '화씨(℉)' : to === 'c' ? '섭씨(℃)' : '시속 km/h';
      const code = `${head}
BPatch.register({
  id: ${JSON.stringify(id)},
  title: ${JSON.stringify(meta.title)},
${tgt}
  data: function (ctx) {
    var d = ctx.payload && ctx.payload.data;
    if (!d) return ctx.payload;
    d = Object.assign({}, d);
${conv.split('\n').map(l => '    ' + l).join('\n')}
    return Object.assign({}, ctx.payload, { data: d, bpUnit: ${JSON.stringify(to)} });
  }
});`;
      return { code, log: `단위를 ${nm}(으)로 바꾸는 변환 코드를 추가`, css: '' };
    }
    case 'rename': {
      const to = d.args.to;
      const code = `${head}
BPatch.register({
  id: ${JSON.stringify(id)},
  title: ${JSON.stringify(meta.title)},
${tgt}
  html: function (ctx) {
    return ctx.html.replace(/(<span class="tile-name"[^>]*>)([\\s\\S]*?)(<\\/span>)/, function (m, a, inner, c) {
      return a + inner.replace(/>[^<]*<\\/span>\\s*$/, '>' + ${JSON.stringify(to)} + '</span>') + c;
    });
  }
});`;
      return { code, log: `카드 제목 표기를 “${to}”(으)로 바꾸는 코드를 추가`, css: '' };
    }
    case 'css': {
      const bits = d.args.bits;
      const sel = `.tile[data-bp-kind="${kind || 'news'}"]`;
      const rules = [];
      if (bits.includes('font')) rules.push('font-weight:800');
      if (bits.includes('up')) rules.push('zoom:1.12');
      if (bits.includes('down')) rules.push('zoom:.92');
      const css = [`.tile[data-bp-kind="${kind || 'news'}"]{${rules.join(';')}}`,
                   `.tile[data-bp-kind="${kind || 'news'}"] .goal-line,.tile[data-bp-kind="${kind || 'news'}"] .big{font-weight:${bits.includes('font') ? 800 : 650}}`].join('\n');
      const code = `${head}
BPatch.register({
  id: ${JSON.stringify(id)},
  title: ${JSON.stringify(meta.title)},
${tgt}
  css: ${JSON.stringify(css)}
});`;
      return { code, log: `${kind || '해당'} 카드 스타일을 조정하는 CSS를 주입`, css: '' };
    }
    case 'list.count': {
      const n = d.args.n;
      const code = `${head}
BPatch.register({
  id: ${JSON.stringify(id)},
  title: ${JSON.stringify(meta.title)},
${tgt}
  data: function (ctx) {
    var d = ctx.payload && ctx.payload.data;
    if (!d) return ctx.payload;
    var out = Object.assign({}, d);
    if (Array.isArray(out.items)) out.items = out.items.slice(0, ${n});
    if (Array.isArray(out.upcoming)) out.upcoming = out.upcoming.slice(0, ${n});
    if (Array.isArray(out.results)) out.results = out.results.slice(0, ${n});
    return Object.assign({}, ctx.payload, { data: out });
  }
});`;
      return { code, log: `목록을 최대 ${n}건만 보여주는 코드를 추가`, css: '' };
    }
    default: return null;
  }
}

/* ============================== 저장소 ============================== */
function readIndex(){
  try { return JSON.parse(fs.readFileSync(INDEX, 'utf8')); } catch (e) { return { v: 1, patches: [] }; }
}
function writeIndex(ix){ fs.mkdirSync(PDIR, { recursive: true }); fs.writeFileSync(INDEX, JSON.stringify(ix, null, 2)); }
function keyOf(rec){ return [rec.op, JSON.stringify(rec.args || {}), (rec.target && rec.target.kind) || '', (rec.target && rec.target.tid) || '', (rec.target && rec.target.scope) || ''].join('|'); }

/* 텍스트 → 패치 생성·저장. 재빌드는 호출자(server)가 한다. */
function apply(text, opts){
  opts = opts || {};
  const topics = opts.topics || [];
  const pl = plan(text, topics);
  if (!pl.directives.length){
    return { ok: false, reason: pl.ambiguous.length ? 'ambiguous' : 'unsupported', plan: pl, catalog: Object.keys(OPS).map(k => ({ op: k, nm: OPS[k].nm })) };
  }
  const ix = readIndex();
  const created = [], replaced = [], logLines = [];
  const stamp = new Date().toISOString().slice(0, 16).replace(/[T:]/g, '-');
  pl.directives.forEach((d, i) => {
    // id 는 “무엇을(연산자)·어디에(종류/카드/위치)”까지 담아야 서로 다른 요청이 한 파일을 덮어쓰지 않는다
    const base = [slugId(d.target.kind || 'topic'), slugId(d.op), d.target.scope ? slugId(d.target.scope) : '', d.target.tid ? slugId(d.target.tid) : '']
      .filter(Boolean).join('-');
    const rec = { id: `${base}-${stamp}${i ? '-' + i : ''}`, op: d.op, args: d.args, target: d.target, request: pl.text, at: new Date().toISOString(), title: `${OPS[d.op] ? OPS[d.op].nm : d.op}` + (d.target.label ? ` · ${d.target.label}` : (d.target.kind ? ` · ${d.target.kind}` : '')) + (d.target.scope === 'strip' ? ' · 일정 위젯' : d.target.scope === 'brief' ? ' · 뉴스레터' : '') };
    const gen = codegen(d, { id: rec.id, target: d.target, request: pl.text, title: rec.title });
    if (!gen) { replaced.push(rec.id); return; }
    rec.log = gen.log;
    const file = `${rec.id}.js`;
    fs.mkdirSync(PDIR, { recursive: true });
    fs.writeFileSync(path.join(PDIR, file), `'use strict';\n/* 자동 생성 ${rec.at} */\n(function (global) {\n  const BPatch = global.BPatch;\n  if (!BPatch) return;\n${gen.code.split('\n').map(l => '  ' + l).join('\n')}\n})(window);\n`);
    const prev = ix.patches.findIndex(x => keyOf(x) === keyOf(rec));
    if (prev >= 0){
      const oldFile = ix.patches[prev].file;
      ix.patches.splice(prev, 1);
      if (oldFile && oldFile !== file && !ix.patches.some(x => x.file === oldFile)){ try { fs.unlinkSync(path.join(PDIR, oldFile)); } catch (e) {} }
      replaced.push(rec.id);
    }
    ix.patches.push(Object.assign(rec, { file }));
    created.push({ id: rec.id, file, op: rec.op, title: rec.title, log: gen.log, code: gen.code });
    logLines.push(gen.log);
  });
  writeIndex(ix);
  return { ok: created.length > 0, request: pl.text, target: pl.target, applied: created, replaced, ambiguous: pl.ambiguous, logLines };
}
function list(){ return readIndex().patches.map(p => ({ id: p.id, file: p.file, op: p.op, title: p.title, request: p.request, log: p.log, at: p.at })); }
function source(id){
  const p = readIndex().patches.find(x => x.id === id);
  if (!p) return null;
  try { return { id, file: p.file, code: fs.readFileSync(path.join(PDIR, p.file), 'utf8') }; } catch (e) { return { id, file: p.file, code: '(파일이 없어요 — node tools/patch-engine.js clear 후 재빌드)' }; }
}
function remove(id){
  const ix = readIndex();
  const i = ix.patches.findIndex(x => x.id === id);
  if (i < 0) return false;
  const p = ix.patches[i];
  try { fs.unlinkSync(path.join(PDIR, p.file)); } catch (e) {}
  ix.patches.splice(i, 1); writeIndex(ix);
  return true;
}
function clearAll(){
  const ix = readIndex();
  ix.patches.forEach(p => { try { fs.unlinkSync(path.join(PDIR, p.file)); } catch (e) {} });
  ix.patches = []; writeIndex(ix);
  return true;
}
function build(){
  const r = require('child_process').spawnSync(process.execPath, [path.join(__dirname, 'build.js')], { cwd: ROOT, encoding: 'utf8' });
  const html = path.join(ROOT, 'dist', 'index.html');
  let hash = null, size = 0;
  try { const b = fs.readFileSync(html); size = b.length; hash = require('crypto').createHash('md5').update(b).digest('hex').slice(0, 12); } catch (e) {}
  return { ok: r.status === 0, ms: 0, size, hash, out: String(r.stdout || '').trim(), err: String(r.stderr || '').trim() };
}

module.exports = { plan, apply, list, source, remove, clearAll, build, OPS, FIELDS, WIDGET_ALIAS, INDEX, PDIR };

/* CLI: node tools/patch-engine.js <cmd> … */
if (require.main === module){
  const [, , cmd, ...rest] = process.argv;
  if (cmd === 'list'){ console.log(JSON.stringify(list(), null, 2)); }
  else if (cmd === 'apply'){ const r = apply(rest.join(' '), {}); console.log(JSON.stringify(r, null, 2)); console.log(JSON.stringify(build())); }
  else if (cmd === 'show'){ console.log((source(rest[0]) || {}).code || 'not found'); }
  else if (cmd === 'rm'){ console.log(remove(rest[0]) ? 'removed ' + rest[0] : 'not found'); console.log(JSON.stringify(build())); }
  else if (cmd === 'clear'){ clearAll(); console.log('cleared'); console.log(JSON.stringify(build())); }
  else if (cmd === 'plan'){ console.log(JSON.stringify(plan(rest.join(' '), []), null, 2)); }
  else console.log('usage: patch-engine.js list | apply "<text>" | plan "<text>" | show <id> | rm <id> | clear');
}
