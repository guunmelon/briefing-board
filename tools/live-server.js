/* 실시간 미니 서버 — 브라우저 데모(단일파일)에 '실시간 데이터 파이프라인' 제공
   실행: node tools/live-server.js [--port 8420] [--dir <webroot>]
   - dist/ (또는 지정 웹 루트) 를 정적 제공
   - /api/health
   - /api/live/interest?label=...&topic=...  → 관심사 분류 + 실제 데이터
       kind: news(항목 목록) / coin·stock·fx(실시간 시세+스파크) / weather(기상) / personal(개인연결 안내)
   - /api/live/news?label=...&topic=...&exclude=id1,id2  → 그 관심사 실시간 새 기사(제외분 걸러서)
   - /api/credentials (GET/POST — iCloud 연결 저장/해제)  → 웹 브라우저 설정에서도 연결 가능
   - /api/events (GET — iCloud 일정 → 오늘 일정)          → 웹 브라우저 데모도 실제 일정 표시
   실데이터 소스(메이저 무료):
     가상자산: Upbit API (KRW)  ·  증시: Yahoo Finance chart/검색 + 종목코드 사전
     환율: currency-api(jsDelivr 일일 미러, ECB 기반) + 날짜 태그 히스토리
     날씨: Open-Meteo(키 없음) (OpenWeatherMap 키 시 tools/keys.json 전환)
     뉴스: 기본 관심사=사진 포함 미디어 피드, 그 외=Google 뉴스 RSS(짧은 캐시로 속도·차단 완화)
     일정: Apple iCloud CalDAV(읽기 전용 — 모든 캘린더 병합, 반복 규칙 확장)
*/
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = parseInt(process.argv.find(a => a.startsWith('--port='))?.split('=')[1] || process.env.PORT || '8420', 10);
const ROOT = (() => {
  const i = process.argv.findIndex(a => a === '--dir');
  return i >= 0 ? path.resolve(process.argv[i + 1]) : path.resolve(__dirname, '..', 'dist');
})();
const DATA_DIR = path.resolve(__dirname, '.cache');      // 자격증명/러닝데이터 — 스냅샷 제외(비밀번호 보호)
const MIME = { '.html':'text/html; charset=utf-8', '.js':'application/javascript', '.css':'text/css', '.json':'application/json', '.svg':'image/svg+xml', '.png':'image/png', '.jpg':'image/jpeg', '.ico':'image/x-icon', '.woff2':'font/woff2' };

/* ================= 기본 관심사 → 사진 포함 미디어 피드 (fetch-rss 와 동일 구성) ================= */
const DEFAULT_INTERESTS = {
  mancity:   { feeds: [['https://www.theguardian.com/football/rss', 'The Guardian', ['manchester city', 'man city']]] },
  bitcoin:   { feeds: [['https://cointelegraph.com/rss', 'CoinTelegraph', ['bitcoin', 'btc']]] },
  minecraft: { feeds: [
    ['https://www.eurogamer.net/feed', 'Eurogamer', ['minecraft', '마인크래프트']],
    ['https://www.pcgamer.com/rss/', 'PC Gamer', ['minecraft', '마인크래프트']],
    ['https://www.pcgamesn.com/feed', 'PCGamesN', ['minecraft', '마인크래프트']],
  ] },
  birds:     { feeds: [['https://www.birdwatchingdaily.com/feed/', 'BirdWatching Daily', ['bird', 'migration', 'ornitholog', 'species', 'nest', 'owl', 'hawk', 'warbler', 'cardinal', 'woodpecker', 'goldfinch']]] },
};
const JUNK_SRC = /^(YouTube|Facebook|TikTok|Instagram|Twitter|Reddit|Mshale|Youtube)$/i;
const HASH = s => { let x = 0; for (let i = 0; i < s.length; i++) x = (x * 31 + s.charCodeAt(i)) >>> 0; return x.toString(36); };

/* ================= 캐시 · 소스 예절 =================
   - cachedInfo(key, ttl, fn, {force}) : force(=사용자 새로고침) 이면 캐시를 무시하고 실제 재요청한다.
     실패하면 직전 값을 stale 로 되돌려 준다 → 카드가 비거나 로딩만 돌지 않는다.
   - HOST_BLOCK : 429/5xx 를 돌려준 호스트는 90초간 두드리지 않는다 (연타 금지).
   - CADENCE    : kinds별 "이 데이터가 실제로 바뀌는 주기" — 클라이언트 자동 갱신 스케줄의 기준. */
const CACHE = new Map();        // key -> {at, data}
const HOST_BLOCK = new Map();   // host -> untilTs
const SERIES = new Map();       // key -> [{t, v}]  (polling 동안의 실측 틱 = 인트라데이 스파크)
const CADENCE = {               // ms — 이 시간이 지나면 '새로 고칠 때'다 (사실 근거: 소스 갱신 주기)
  coin: 20_000, stock: 20_000, fx: 30_000, weather: 8 * 60_000,
  sport: 3 * 60_000, sportLive: 30_000, news: 5 * 60_000, personal: 0,
};
const hostOf = u => { try { return new URL(u).host; } catch (e) { return 'local'; } };
const srcBlocked = host => { const t = HOST_BLOCK.get(host); return !!(t && Date.now() < t); };
function noteSourceBlock(host, msg){
  if (/429|50[0-4]|Too Many|rate|unavailable|가 잠시/i.test(String(msg || '')))
    HOST_BLOCK.set(host, Date.now() + 90_000);
}
function pushSeries(key, v, cap = 90){
  if (v == null || isNaN(v)) return (SERIES.get(key) || []).map(x => x.v);
  const arr = SERIES.get(key) || [];
  const cut = Date.now() - 6 * 3600_000;
  const keep = arr.filter(x => x.t > cut);
  if (!keep.length || Date.now() - keep[keep.length - 1].t >= 4000 || keep[keep.length - 1].v !== v) keep.push({ t: Date.now(), v });
  while (keep.length > cap) keep.shift();
  SERIES.set(key, keep);
  return keep.map(x => x.v);
}
async function cachedInfo(key, ttlMs, fn, opts){
  opts = opts || {};
  const hit = CACHE.get(key);
  if (!opts.force && hit && Date.now() - hit.at < ttlMs) return { data: hit.data, at: hit.at, fromCache: true };
  try {
    const data = await fn();
    if (data != null) CACHE.set(key, { at: Date.now(), data });
    return { data, at: data && data.updated ? Date.parse(data.updated) || Date.now() : Date.now(), fromCache: false };
  } catch (e) {
    const err = String((e && e.message) || e);
    if (hit) return { data: hit.data, at: hit.at, fromCache: true, stale: true, error: err };
    const out = new Error(err); out.cause = err; throw out;
  }
}
function cached(key, ttlMs, fn, opts){ return cachedInfo(key, ttlMs, fn, opts).then(r => r.data); }

/* ================= HTTP fetch ================= */
async function getText(url, headers = {}, timeout = 12000){
  const host = hostOf(url);
  if (srcBlocked(host)) throw new Error('HTTP 429 ' + host + ' (일시 제한 — 자동 재시도 예정)');
  const ctl = AbortSignal.timeout(timeout);
  let r;
  try {
    r = await fetch(url, { signal: ctl, headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36', 'Accept': '*/*', ...headers } });
  } catch (e) { throw new Error('네트워크 실패 ' + host + ' — ' + String((e && e.message) || e)); }
  if (!r.ok){
    const msg = 'HTTP ' + r.status + ' @' + host;
    noteSourceBlock(host, msg);
    throw new Error(msg);
  }
  return await r.text();
}
async function getJson(url, headers = {}, timeout = 12000){
  return JSON.parse(await getText(url, headers, timeout));
}

/* ================= XML(RSS) 파싱 (DOM 라이브러리 없이) ================= */
const clean = s => String(s || '').replace(/<!\[CDATA\[|\]\]>/g, '').replace(/<[^>]*>/g, ' ')
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&#\d+;/g, ' ').replace(/\s+/g, ' ').trim();
function imgFromItem(xml){
  const cand = xml.match(/<media:thumbnail[^>]+url="([^"]+)"/i)
    || xml.match(/<media:content[^>]+url="([^"]+)"/i)
    || xml.match(/<enclosure[^>]+url="([^"]+)"/i)
    || xml.match(/<img[^>]+src="([^"]+)"/i)
    || xml.match(/<media:thumbnail[^>]+url='([^']+)'/i);
  return cand ? cand[1].replace(/&amp;/g, '&').trim() : null;
}
function parseItems(xml, fallbackSrc){
  const ch = ((xml.match(/<channel>([\s\S]*)<\/channel>/i) || [])[1]) || xml;
  const feedTitle = clean((ch.match(/<title>\s*([\s\S]*?)\s*<\/title>/i) || [])[1]);
  const out = [];
  const re = /<item>([\s\S]*?)<\/item>/gi;
  let m;
  while ((m = re.exec(xml))){
    const it = m[1];
    let title = clean((it.match(/<title>([\s\S]*?)<\/title>/i) || [])[1]);
    const link = clean((it.match(/<link>([\s\S]*?)<\/link>/i) || [])[1]);
    if (!title || !link) continue;
    const pub = ((it.match(/<pubDate>([\s\S]*?)<\/pubDate>/i) || [])[1] || '').trim();
    let desc = clean((it.match(/<description>([\s\S]*?)<\/description>/i) || [])[1]).slice(0, 360);
    let src = clean((it.match(/<source[^>]*>([\s\S]*?)<\/source>/i) || [])[1]) || (feedTitle || fallbackSrc);
    if (title.length < 12 && desc){ const d = clean(desc); if (d && d.length > title.length) title = d.slice(0, 150) || title; }
    out.push({ id: HASH(title), title, link, pub, src, desc: desc, img: imgFromItem(it) });
  }
  return out;
}

/* ================= 뉴스 수집 ================= */
const GOOGLE_RSS = (q, hl, gl) => `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=${hl}&gl=${gl}&ceid=${hl === 'ko' ? 'KR:ko' : 'US:en'}`;
const HAS_KR = /[ㄱ-ㅎㅏ-ㅣ가-힣]/;
function mediaItems(feed){
  return getText(feed[0]).then(xml => {
    const items = parseItems(xml, feed[1]).filter(it => {
      const t = it.title;
      if (HAS_KR.test(t)) return false;             // 한국어 피드는 아님(영문 매체)
      return feed[2].some(tok => t.toLowerCase().includes(tok.toLowerCase())) &&
        !JUNK_SRC.test(it.src);
    }).sort((a, b) => Date.parse(b.pub) - Date.parse(a.pub));
    return items.map(i => ({ ...i, src: feed[1] }));
  }).catch(() => []);
}
function googleItems(label, days){
  const ko = HAS_KR.test(label);
  const win = 'when:' + (days || 7) + 'd';
  const q = ko ? `${label} ${win}` : `(${label.split(/[\s·]+/).map(w => `"${w}"`).join(' OR ')}) ${win}`;
  return getText(GOOGLE_RSS(q, ko ? 'ko' : 'en', ko ? 'KR' : 'US')).then(xml =>
    parseItems(xml, 'Google 뉴스').filter(i => !JUNK_SRC.test(i.src))
      .sort((a, b) => Date.parse(b.pub) - Date.parse(a.pub))
  ).catch(() => []);
}
const LABEL_ALIAS = { // 라벨만으로도 기본 관심사(사진 있는 미디어 피드) 연결
  '맨시티': 'mancity', '맨체스터 시티': 'mancity', 'mancity': 'mancity', 'man city': 'mancity', '맨체스터': 'mancity',
  '비트코인': 'bitcoin', 'bitcoin': 'bitcoin', 'btc': 'bitcoin',
  '마인크래프트': 'minecraft', 'minecraft': 'minecraft',
  '조류': 'birds', 'bird': 'birds', 'birding': 'birds', 'birds': 'birds', '새': 'birds',
};
function aliasOf(label){
  const l = label.trim().toLowerCase();
  if (LABEL_ALIAS[l]) return LABEL_ALIAS[l];
  for (const k of Object.keys(LABEL_ALIAS)) if (l.includes(k)) return LABEL_ALIAS[k];
  return null;
}
async function newsFor(label, key, opts = {}){
  opts = opts || {};
  const win = opts.fresh ? 1 : 7;          // '지금 새 기사' 요청 → 24시간 창만 (오래된 기사 재포장 방지)
  // 기본 관심사는 미디어 피드(사진 보장) → 부족분 Google
  const spec = DEFAULT_INTERESTS[key] || DEFAULT_INTERESTS[aliasOf(label)];
  let items = [];
  if (spec){
    for (const feed of spec.feeds){ items = items.concat(await mediaItems(feed)); if (items.length >= 8) break; }
    const got = items.slice(0, 8);
    if (got.length < 4 && !opts.fresh) items = got;
    else if (got.length >= 4) items = got;
  } else {
    items = await googleItems(label, win);
  }
  // 중복·제외 처리 + 최신 정렬
  const seen = new Set(); const out = [];
  for (const it of items){
    if (!it.title) continue;
    if (opts.exclude && opts.exclude.includes(it.id)) continue;
    if (seen.has(it.title.toLowerCase())) continue;
    seen.add(it.title.toLowerCase());
    out.push(it);
  }
  // (미디어 매체 피드에서 4건 미달일 때) Google 보강 — 24시간에 없으면 3일→7일로 창을 넓힌다
  if (!spec || out.length < 4){
    const tries = opts.fresh ? [win, 3, 7] : [7];
    for (const w of tries){
    if (out.length >= 4) break;
    try {
      const g = await googleItems(spec ? { mancity:'(맨체스터 시티 OR 맨시티)', bitcoin:'(비트코인)', minecraft:'(Minecraft)', birds:'(birding OR birdwatching)' }[key] : label, w);
      for (const it of g){
        if (opts.exclude && opts.exclude.includes(it.id)) continue;
        const t = it.title.toLowerCase();
        if (seen.has(t)) continue; seen.add(t);
        out.push(it);
        if (out.length >= 8) break;
      }
    } catch (e) {}
    }
  }
  const list = out.slice(0, 8);
  // 정직 표시: 요청한 '새 기사' 기준과 비교해 실제로 새로워진 게 없으면 noNew
  if (opts.fresh && Array.isArray(opts.seenIds) && opts.seenIds.length){
    const seenSet = new Set(opts.seenIds.map(String));
    list.noNew = list.every(i => seenSet.has(String(i.id)));
  }
  list.fetchedAt = Date.now();
  return list;
}

/* ================= 코인 (Upbit) ================= */
const COIN_ALIAS = {
  '비트코인': 'KRW-BTC', 'btc': 'KRW-BTC', 'bitcoin': 'KRW-BTC', '비트코인 가격': 'KRW-BTC',
  '이더리움': 'KRW-ETH', 'eth': 'KRW-ETH', 'ethereum': 'KRW-ETH',
  '리플': 'KRW-XRP', 'xrp': 'KRW-XRP',
  '도지코인': 'KRW-DOGE', 'doge': 'KRW-DOGE',
  '솔라나': 'KRW-SOL', 'sol': 'KRW-SOL',
  '에이다': 'KRW-ADA', 'ada': 'KRW-ADA', '카르다노': 'KRW-ADA',
  '수이': 'KRW-SUI', 'sui': 'KRW-SUI',
};
async function upbitMarketAll(){
  return cached('upbit-all', 3600_000, () => getJson('https://api.upbit.com/v1/market/all?isDetails=false'));
}
async function resolveCoinMarket(label){
  const lower = label.toLowerCase();
  const direct = Object.entries(COIN_ALIAS).find(([k]) => lower.includes(k.toLowerCase()));
  if (direct) return direct[1];
  const all = await upbitMarketAll();
  const toks = label.split(/[\s·,()]+/).filter(Boolean);
  let best = null;
  for (const t of toks){
    const tt = t.toLowerCase();
    const hit = all.find(m => m.market.startsWith('KRW-') &&
      (m.korean_name === t || m.english_name.toLowerCase() === tt ||
       (tt.length >= 3 && (m.english_name.toLowerCase().includes(tt) || m.korean_name.includes(t)))));
    if (hit && (m => m.market.startsWith('KRW-'))(hit)) { best = hit.market; break; }
  }
  return best;
}
async function coinQuote(label, opts){
  opts = opts || {};
  const market = await resolveCoinMarket(label);
  if (!market) return null;
  const r = await cachedInfo('coin:' + market, CADENCE.coin, async () => {
    const [tk] = await getJson(`https://api.upbit.com/v1/ticker?markets=${market}`, {}, 9000);
    let spark = [];
    try {
      const candles = await getJson(`https://api.upbit.com/v1/candles/minutes/1?market=${market}&count=45`, {}, 9000);
      spark = candles.reverse().map(c => c.trade_price);
    } catch (e) {}
    const q = {
      kind: 'coin', market, name: tk.market.replace('KRW-', ''),
      price: tk.trade_price, prev: tk.prev_closing_price,
      chgPct: +(tk.signed_change_rate * 100).toFixed(2),
      chgAbs: tk.signed_change_price, high: tk.high_price, low: tk.low_price,
      acc24h: tk.acc_trade_price_24h, spark,
      cadence: 'tick', asOf: tk.trade_date_kst ? `${tk.trade_date_kst} ${tk.trade_time_kst}` : null,
      tradeTs: tk.trade_timestamp || null, updated: new Date().toISOString(),
      source: 'Upbit 실거래(1초)',
    };
    return q;
  }, { force: !!opts.force });
  if (!r.data) return null;
  const q = { ...r.data };
  if (r.stale) { q.stale = { at: r.at, error: r.error }; q.note = '시세 소스가 잠시 응답을 막았어요 — 마지막 실측 값을 유지하면서 자동 재시도 중'; }
  return q;
}

/* ================= 환율(FX) — 두 개의 소스를 정직하게 함께 쓴다 =================
   1) 실시간 호가 : api.coinbase.com/v2/exchange-rates (약 1분 갱신, 키 불필요) → '현재가'
   2) 공식 기준환율 : api.frankfurter.dev (ECB, 영업일 1일 1회 확정) → '전일 대비'·일봉 스파크
   3) 폴백 : @fawazahmed0/currency-api (jsDelivr 미러, 일 1회)
   실시간 소스가 막히면(429 등) 마지막 실측 값을 유지하고 cadence:'daily' 로 표시한다 — 숫자를 지어내지 않는다. */
const FX_BASE_KO = { usd:'미국 달러', jpy:'일본 엔', cny:'중국 위안', eur:'유로', gbp:'영국 파운드',
  hkd:'홍콩 달러', aud:'호주 달러', cad:'캐나다 달러', chf:'스위스 프랑' };
const FX_TOKEN_ORDER = ['홍콩달러','캐나다달러','호주달러','스위스프랑','미국 달러','달러','엔화','위안','유로','파운드','usd','jpy','cny','eur','gbp','hkd','aud','cad','chf','엔'];
function fxBaseOf(label){
  const l = String(label || '').trim().toLowerCase();
  if (/환율|환전|외환/.test(l)){
    if (/엔/.test(l) && !/엔터/.test(l)) return 'jpy';
    if (/위안/.test(l)) return 'cny';
    if (/유로/.test(l)) return 'eur';
    if (/파운드/.test(l)) return 'gbp';
    return 'usd';
  }
  const alias = { '홍콩달러':'hkd', '캐나다달러':'cad', '호주달러':'aud', '스위스프랑':'chf',
    '미국 달러':'usd', '달러':'usd', '엔화':'jpy', '위안':'cny', '유로':'eur', '파운드':'gbp',
    usd:'usd', jpy:'jpy', cny:'cny', eur:'eur', gbp:'gbp', hkd:'hkd', aud:'aud', cad:'cad', chf:'chf', '엔':'jpy' };
  for (const tok of FX_TOKEN_ORDER){
    if (!l.includes(tok)) continue;
    if (tok === '엔' && /엔터|엔씨|엔비|엔진|엔도/.test(l)) continue;   // 엔터테인먼트 등 오분류 방지
    return alias[tok];
  }
  return null;
}
const FX_CURR_API = (dateTag) => `https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api${dateTag}/v1/currencies/usd.min.json`;
/* 공식 기준환율(ECB) — 최근 3주 → 전일·일봉 스파크 */
async function fxOfficial(base, force){
  const r = await cachedInfo('fx:off:' + base, 45 * 60_000, async () => {
    const d = new Date(Date.now() - 24 * 7 * 86400000);
    const from = d.toISOString().slice(0, 10);
    const j = await getJson(`https://api.frankfurter.dev/v1/${from}..?base=${base.toUpperCase()}&symbols=KRW`, {}, 16000);
    if (!j || !j.rates) throw new Error('frankfurter 빈 응답');
    const rows = Object.keys(j.rates).sort().map(dt => ({ date: dt, krw: j.rates[dt].KRW })).filter(x => x.krw != null);
    if (!rows.length) throw new Error('frankfurter KRW 없음');
    return { rows, asOf: j.end_date || rows[rows.length - 1].date };
  }, { force });
  return r.data;
}
/* 마지막 수단의 일일 미러(currency-api) */
async function fxFallback(base){
  const latest = await getJson(FX_CURR_API('@latest'), {}, 20000);
  const v = latest && latest.usd && latest.usd[base.toLowerCase()];
  if (!v) return null;
  const rate = base === 'usd' ? v : (latest.usd.krw / v);
  return { rows: [{ date: latest.date || new Date().toISOString().slice(0, 10), krw: rate }], asOf: latest.date, source: 'currency-api (ECB) · 일 1회' };
}
async function fxQuote(label, opts){
  opts = opts || {};
  const base = fxBaseOf(label);
  if (!base) return null;
  const B = base.toUpperCase();
  let official = null, offErr = null;
  try { official = await fxOfficial(base, !!opts.force); } catch (e) { offErr = String(e.message || e); }
  if (!official){
    try { official = await fxFallback(base); } catch (e) { offErr = (offErr ? offErr + ' / ' : '') + String(e.message || e); }
  }
  if (!official) return null;                       // 어느 소스도 안 됨 → 뉴스 폴백(캐시 안 남김)
  const rows = official.rows;
  const last = rows[rows.length - 1], prevRow = rows[rows.length - 2];
  const daily = last.krw;
  // 실시간 호가 (1분 단위) — 실패/제한 시 일일 기준으로 물러선다
  let rt = null, rtErr = null;
  if (!srcBlocked('api.coinbase.com')){
    try {
      const j = await getJson(`https://api.coinbase.com/v2/exchange-rates?currency=${B}`, {}, 9000);
      const v = j && j.data && j.data.rates && j.data.rates.KRW;
      if (v) rt = { price: Number(v), at: j.data.time ? new Date(j.data.time * 1000).toISOString() : new Date().toISOString() };
    } catch (e) { rtErr = String(e.message || e); }
  } else rtErr = 'Coinbase 429 제한 중(자동 재시도 예약)';
  const price = rt ? rt.price : daily;
  const sparkTicks = pushSeries('fx:' + B, rt ? price : null);
  const spark = (sparkTicks.length >= 4 ? sparkTicks.slice(-24) : rows.map(x => x.krw).slice(-22));
  const basePrev = prevRow ? prevRow.krw : daily;
  const chgAbs = +(price - basePrev).toFixed(4);
  return {
    kind: 'fx', base, quoteCur: 'KRW', pair: B + '/KRW', name: FX_BASE_KO[base] || B,
    price, prev: basePrev, chgPct: basePrev ? +((chgAbs / basePrev) * 100).toFixed(3) : 0, chgAbs,
    high: Math.max(...spark), low: Math.min(...spark), spark,
    date: last.date, asOf: rt ? rt.at : (last.date + ' (공식 기준)'), updated: new Date().toISOString(),
    cadence: rt ? 'realtime' : 'daily',
    source: rt ? '실시간 호가 Coinbase(≈1분) · 기준 전일 ECB' : 'ECB 기준환율(영업일 1일 1회)',
    officialDate: last.date,
    note: rt ? (offErr ? '기준환율 소스가 일부 지연됐어요' : '') : ('실시간 호가 소스 미확보 → 공식 기준환율(일 1회)로 표시 · ' + (rtErr || '')),
  };
}

/* ================= 증시 (Yahoo chart + 종목 사전) ================= */
const STOCK_MAP = { // 한글 이름 → (코드)
  '삼성전자': '005930', 'sk하이닉스': '000660', 'lg에너지솔루션': '373220', '삼성바이오로직스': '207940',
  'lg화학': '051910', '삼성sdi': '006400', '현대차': '005380', '기아': '000270', '셀트리온': '068270',
  'posco홀딩스': '005490', '포스코홀딩스': '005490', '네이버': '035420', '카카오': '035720', '카카오뱅크': '323410',
  '신한지주': '055550', 'kb금융': '105560', '하나금융지주': '086790', 'hmm': '011200', '두산에너빌리티': '034020',
  'lg전자': '066570', 'sk텔레콤': '017670', 'kt': '030200', '현대모비스': '012330', '삼성물산': '028260',
  '현대글로비스': '086280', '대한항공': '003490', '아모레퍼시픽': '090430', 'lg생활건강': '051900',
  '넷마블': '251270', '엔씨소프트': '036570', '크래프톤': '259960', '에코프로비엠': '247540', '알테오젠': '196170',
  '삼성전자우': '005935', '우리금융지주': '316140', 'sk이노베이션': '096770', '한화에어로스페이스': '012450',
  '한화솔루션': '009830', '롯데케미칼': '011170', '롯데지주': '004990', '현대건설': '000720', '삼성중공업': '010140',
  '삼성엔지니어링': '028050', 'lg디스플레이': '034220', 'sk바이오팜': '326030', '셀트리온헬스케어': '091990',
  '삼성생명': '032830', '삼성화재': '000810', '현대해상': '001450', 'db손해보험': '005830',
  '카카오페이': '377300', '토스뱅크': '320640', '배달의민족': '320720', '우아한형제들': '320720', '두산에너빌리티': '034020',
  'lg유플러스': '032640', 'kt&g': '033780', '오리온': '271560', '이마트': '139480', '신세계': '004170',
};
/* 해외 대표 종목(영문/한글 이름 → 야후 심볼) — 관심사에서 회사 이름만 써도 주식 인식 */
const WORLD_STOCKS = {
  alphabet: 'GOOGL', 'alphabet a': 'GOOGL', google: 'GOOGL', apple: 'AAPL', tesla: 'TSLA',
  microsoft: 'MSFT', msft: 'MSFT', nvidia: 'NVDA', amazon: 'AMZN', meta: 'META',
  netflix: 'NFLX', intel: 'INTC', amd: 'AMD', boeing: 'BA', disney: 'DIS', visa: 'V',
  samsung: '005930.KS', 'samsung electronics': '005930.KS', hyundai: '005380.KS', kia: '000270.KS',
};
const WORLD_STOCKS_KO = {  // 한글로 입력한 해외 회사 → 심볼
  '애플': 'AAPL', '테슬라': 'TSLA', '알파벳': 'GOOGL', '구글': 'GOOGL', '마이크로소프트': 'MSFT',
  '엔비디아': 'NVDA', '아마존': 'AMZN', '메타': 'META', '메타플랫폼스': 'META', '넷플릭스': 'NFLX',
  '인텔': 'INTC', 'amd': 'AMD', '보잉': 'BA', '디즈니': 'DIS',
};
async function yahooSearchEnglish(q){
  try { const j = await getJson(`https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=3&newsCount=0`); return j.quotes || []; }
  catch (e) { return []; }
}
/* 회사처럼 보이는지 — 종목 해석 시도 여부 판단(그냥 뉴스 키워드는 스킵) */
const ASCII_CONTENT_STOP = new Set(['minecraft','football','soccer','music','movie','film','camera','youtube','gaming','game','games','science','space','nasa','f1','bird','birds','birding','travel','food','fashion','art','books','kpop','drama','anime','crypto','weather','news','stock','technology','fitness','cooking','coding','language']);
const KR_COMPANY_TAIL = /(전자|화학|제약|바이오|생명|보험|증권|카드|지주|항공|철강|에너지|모터스|모비스|물산|건설|조선|중공업|소프트|테크|테크놀로지|케미칼|디스플레이|솔루션|엔터|푸드|리테일|마트|글로비스|모터|에어로스페이스|바이오로직스)$/;
function looksLikeCompanyName(label){
  const l = String(label || '').trim();
  if (!l) return false;
  if (HAS_KR.test(l)){
    if (KR_COMPANY_TAIL.test(l)) return true;
    for (const k of Object.keys(STOCK_MAP)) if (l.toLowerCase().includes(k)) return true;
    for (const k of Object.keys(WORLD_STOCKS_KO)) if (l.includes(k)) return true;
    return false;
  }
  const tok = l.toLowerCase().replace(/[^a-z0-9&. ]+/g, ' ').trim().split(/\s+/).filter(Boolean);
  if (!tok.length) return false;
  if (tok.length === 1 && tok[0].length < 4) return false;      // ai / f1 등 짧은 건 제외
  if (tok.some(t => ASCII_CONTENT_STOP.has(t))) return false;
  return true;
}
async function resolveStockCode(label){
  const lower = label.toLowerCase().replace(/\s+/g, '');
  // 1) '005930' / '005930.KS' 직접
  let m = label.match(/(\d{6})(?:\.KS|\.KQ)?/i);
  if (m) return m[1] + (m[0].endsWith('.KQ') ? '.KQ' : '.KS');
  // 2) 국내 종목 사전
  if (STOCK_MAP[lower]) return STOCK_MAP[lower] + '.KS';
  // 3) 한글 해외 회사(애플·테슬라·알파벳…) / 영문 해외 회사 사전
  for (const k of Object.keys(WORLD_STOCKS_KO)) if (label.includes(k)) return WORLD_STOCKS_KO[k];
  for (const k of Object.keys(WORLD_STOCKS)) if (lower.includes(k)) return WORLD_STOCKS[k];
  // 4) ASCII 일반 이름 → Yahoo 검색(스코어 매칭): 한국 상장(.KS/.KQ) 우선, 없으면 미국 EQUITY
  if (!HAS_KR.test(label) && looksLikeCompanyName(label)){
    const qs = await yahooSearchEnglish(label);
    const equity = qs.filter(q => q.quoteType === 'EQUITY');
    const pri = lower.replace(/[^a-z0-9]/g, '');
    const score = q => {
      const hay = ((q.symbol || '') + ' ' + (q.longname || '') + ' ' + (q.shortname || '')).toLowerCase().replace(/[^a-z0-9]/g, ' ');
      let sc = 0;
      for (const word of pri.split(/\s+/).filter(w => w.length >= 4)) if (hay.includes(word)) sc += 4;
      if (q.symbol && pri.length >= 3 && hay.includes(pri)) sc += 6;
      return sc;
    };
    const kr = equity.filter(q => /\.(KS|KQ)$/.test(q.symbol));
    const best = (kr.length ? kr : equity).map(q => ({ q, sc: score(q) })).filter(x => x.sc > 0)
      .sort((a, b) => b.sc - a.sc)[0];
    if (best) return best.q.symbol;
  }
  return null;
}
/* --- KRX 실세시세(네이버 모바일 API · 키 불필요 · 장중 초 단위) --- */
const krwNum = v => { const t = String(v == null ? '' : v).replace(/[^0-9.\-]/g, ''); if (!t || t === '-' || t === '.') return null; const n = Number(t); return isNaN(n) ? null : n; };
async function naverStock(code){
  const j = await getJson(`https://m.stock.naver.com/api/stock/${code}/basic`, { Referer: 'https://m.stock.naver.com/' }, 9000);
  if (!j || j.closePrice == null) throw new Error('naver 빈 응답');
  const pc = j.compareToPreviousPrice || {};
  // 네이버 부호 규칙: 1 상한·2 상승 = +, 4 하한·5 하락 = -, 3 보합 = 0
  const dir = /[12]/.test(String(pc.code || '')) ? 1 : (/[45]/.test(String(pc.code || '')) ? -1 : 0);
  const mag = v => (v == null ? null : Math.abs(Number(String(v).replace(/[^0-9.\-]/g, '')) || 0));
  const ex = j.stockExchangeType || {};
  return {
    price: krwNum(j.closePrice), chgAbs: mag(j.compareToPreviousClosePrice) * dir,
    chgPct: +(mag(j.fluctuationsRatio) * dir).toFixed(2),
    name: j.stockName || '', market: j.stockExchangeName || ex.nameKor || '', marketStatus: j.marketStatus || '',
    tradeStop: ((j.tradeStopType || {}).text) || '', tradable: j.tradableStatus || '',
    asOf: j.localTradedAt || null, open: ex.startTime || '0900', close: ex.endTime || '1530', delay: ex.delayTime || 0,
    high: krwNum(((j.overMarketPriceInfo || {}).highPrice) ?? j.highPrice), low: krwNum(((j.overMarketPriceInfo || {}).lowPrice) ?? j.lowPrice),
  };
}
/* --- KRX 일봉(fchart XML · 30거래일) — 스파크·최근 흐름용 --- */
async function naverDaily(code, count){
  const xml = await getText(`https://fchart.stock.naver.com/sise.nhn?symbol=${code}&timeframe=day&count=${count || 30}&requestType=0`, { Referer: 'https://stock.naver.com/' }, 12000);
  const rows = [];
  const re = /data="([^"]+)"/g; let m;
  while ((m = re.exec(xml))){
    const p = m[1].split('|');
    if (p.length < 5) continue;
    rows.push({ date: p[0], open: Number(p[1]), hi: Number(p[2]), lo: Number(p[3]), v: Number(p[4]), vol: Number(p[5] || 0) });
  }
  return rows;
}
async function stockQuote(label, opts){
  opts = opts || {};
  const code = await resolveStockCode(label);
  if (!code) return null;
  const isKrx = /\.(KS|KQ)$/.test(code);
  const r = await cachedInfo('stk:' + code, CADENCE.stock, async () => {
    if (isKrx){
      const raw = code.replace(/\.(KS|KQ)$/, '');
      try {
        const nv = await naverStock(raw);
        let daily = [];
        try { daily = await cachedInfo('stk:day:' + raw, 30 * 60_000, () => naverDaily(raw, 30), { force: !!opts.force }); if (daily && daily.data) daily = daily.data; } catch (e) {}
        const closes = daily.map(d => d.v);
        const spark = pushSeries('stk:' + raw, nv.price, 120);
        const last = daily[daily.length - 1] || null;
        return {
          kind: 'stock', code, name: nv.name || label, market: nv.market,
          price: nv.price, prev: nv.price != null && nv.chgAbs != null ? +(nv.price - nv.chgAbs).toFixed(0) : null,
          dir: (q => q > 0 ? 'up' : q < 0 ? 'down' : 'flat')(nv.chgPct),
          chgPct: nv.chgPct, chgAbs: nv.chgAbs, currency: 'KRW',
          spark: (spark.length >= 5 ? spark : closes).slice(-45),
          marketState: nv.marketStatus === 'OPEN' ? 'open' : (nv.marketStatus || '').toLowerCase() || 'closed',
          session: nv.tradeStop || '', openAt: nv.open, closeAt: nv.close, delay: nv.delay,
          dayHi: nv.high != null ? nv.high : (last ? last.hi : null), dayLo: nv.low != null ? nv.low : (last ? last.lo : null),
          prevClose: last && daily.length >= 2 ? daily[daily.length - 2].v : null,
          asOf: nv.asOf, updated: new Date().toISOString(), source: 'KRX 실세시세(네이버)', tz: 'Asia/Seoul',
          sessions: daily.slice(-6).map(d => ({ date: d.date, close: d.v, vol: d.vol })),
        };
      } catch (e) { /* 네이버 실패 → 야후로 */ }
    }
    const j = await getJson(`https://query1.finance.yahoo.com/v8/finance/chart/${code}?interval=1d&range=10d`, {}, 12000);
    const res = j.chart.result[0]; const meta = res.meta;
    const closes = (res.indicators && res.indicators.quote && res.indicators.quote[0].close || []).filter(v => v != null);
    const price = meta.regularMarketPrice;
    const prev = meta.chartPreviousClose || meta.previousClose || price;
    const currency = meta.currency || 'KRW';
    const spark = pushSeries('stk:' + code, price, 120);
    const ts = meta.regularMarketTime ? new Date(meta.regularMarketTime * 1000).toISOString() : new Date().toISOString();
    const ageMin = meta.regularMarketTime ? (Date.now() / 1000 - meta.regularMarketTime) / 60 : null;
    return {
      kind: 'stock', code, name: label, market: meta.exchangeName || (code.endsWith('.KS') ? 'KOSPI' : (currency === 'USD' ? 'US' : '')),
      price, prev, chgPct: prev ? +(((price - prev) / prev) * 100).toFixed(2) : 0, chgAbs: +(price - prev).toFixed(currency === 'USD' ? 4 : 0),
      currency, spark: (spark.length >= 5 ? spark : closes).slice(-45),
      marketState: ageMin != null && ageMin > 20 ? 'closed' : 'open',
      asOf: ts, updated: new Date().toISOString(), source: 'Yahoo Finance(지연 시 15분)', tz: meta.exchangeTimezoneName || 'Asia/Seoul',
    };
  }, { force: !!opts.force });
  if (!r.data) return null;
  const q = { ...r.data };
  if (r.stale) { q.stale = { at: r.at, error: r.error }; q.note = '시세 소스 제한(429 등) — 마지막 실측 값을 유지하고 자동 재시도 중'; }
  return q;
}

/* ================= 날씨 (Open-Meteo 기본 / 키 시 OpenWeatherMap) ================= */
const CITY_COORD = { '서울': [37.5665, 126.9780], '부산': [35.1796, 129.0756], '인천': [37.4563, 126.7052], '대구': [35.8714, 128.6014], '대전': [36.3504, 127.3845], '광주': [35.1595, 126.8526], '울산': [35.5384, 129.3114], '수원': [37.2636, 127.0286], '제주': [33.4996, 126.5312], '세종': [36.4801, 127.2890] };
function cityOf(label){
  for (const c of Object.keys(CITY_COORD)) if (label.includes(c)) return c;
  return '서울';
}
/* WMO 날씨코드 → 한글 상태 (현재·시간별 동일 표기) */
const WMO_KO = (() => {
  const m = {};
  m[0] = '맑음'; m[1] = '구름 조금'; m[2] = '구름 많음'; m[3] = '흐림';
  m[45] = '안개'; m[48] = '착빙 안개';
  [51, 53, 55, 56, 57].forEach(c => m[c] = '이슬비');
  [61, 63, 65, 66, 67].forEach(c => m[c] = '비');
  [71, 73, 75, 77, 85, 86].forEach(c => m[c] = '눈');
  [80, 81, 82].forEach(c => m[c] = '소나기');
  [95, 96, 99].forEach(c => m[c] = '뇌우');
  return m;
})();
async function weatherFor(label){
  const city = cityOf(label);
  const [lat, lon] = CITY_COORD[city] || CITY_COORD['서울'];
  const keys = (() => { try { return JSON.parse(fs.readFileSync(path.join(__dirname, 'keys.json'), 'utf8')); } catch (e) { return {}; } })();
  // 1) OpenWeatherMap(키 보유 시) — 사용자 지정 메이저 소스
  if (keys.openweather){
    const j = await getJson(`https://api.openweathermap.org/data/2.5/forecast?q=${encodeURIComponent(city)}&units=metric&lang=kr&appid=${keys.openweather}`);
    const days = {};
    for (const it of j.list || []){ const d = it.dt_txt.slice(0, 10); if (!days[d]) days[d] = []; if (days[d].length < 4) days[d].push(it); }
    const today = days[Object.keys(days)[0]] || [];
    const cur = j.list?.[0];
    return { kind: 'weather', city, temp: cur?.main?.temp ?? null, cond: cur?.weather?.[0]?.description ?? '', icon: cur?.weather?.[0]?.main ?? '', min: Math.min(...today.map(i => i.main.temp_min)), max: Math.max(...today.map(i => i.main.temp_max)), updated: new Date().toISOString(), source: 'OpenWeatherMap' };
  }
  // 2) Open-Meteo(키 불필요 — 기본) + 대기질(공기질 API, 키 불필요)
  const [om, aq] = await Promise.all([
    getJson(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}`
      + `&current=temperature_2m,relative_humidity_2m,weather_code,apparent_temperature,wind_speed_10m,precipitation`
      + `&hourly=temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,precipitation_probability,weather_code,precipitation`
      + `&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset,precipitation_sum`
      + `&timezone=Asia%2FSeoul&forecast_days=4`),
    getJson(`https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat}&longitude=${lon}&current=pm10,pm2_5,us_aqi`, {}, 9000)
      .catch(() => null),      // 대기질 실패는 날씨 표시를 막지 않는다
  ]);
  const wc = om.current.weather_code;
  const cond = WMO_KO[wc] || '기타';
  const today = String(om.current.time || '').slice(0, 10);
  // 오늘 24개 시간대 실측/예보 — '오전/오후로 나눠서' 같은 코드 생성이 소비하는 원시 데이터
  const hourly = (om.hourly?.time || []).map((iso, i) => ({
    iso, h: Number(String(iso).slice(11, 13)),
    t: om.hourly.temperature_2m?.[i] ?? null,
    feels: om.hourly.apparent_temperature?.[i] ?? null,
    humidity: om.hourly.relative_humidity_2m?.[i] ?? null,
    wind: om.hourly.wind_speed_10m?.[i] ?? null,
    pp: om.hourly.precipitation_probability?.[i] ?? null,
    pr: om.hourly.precipitation?.[i] ?? null,
    wc: om.hourly.weather_code?.[i] ?? null,
    cond: WMO_KO[om.hourly.weather_code?.[i]] || '',
  })).filter(x => String(x.iso).slice(0, 10) === today);
  return {
    kind: 'weather', city, temp: om.current.temperature_2m, feels: om.current.apparent_temperature,
    humidity: om.current.relative_humidity_2m, wind: om.current.wind_speed_10m, cond, icon: wc, code: wc,
    precip: om.current.precipitation ?? 0,                    // 현재 강수(mm) — 하늘 자동 전환 판정
    min: om.daily.temperature_2m_min[0], max: om.daily.temperature_2m_max[0],
    weekMin: om.daily.temperature_2m_min, weekMax: om.daily.temperature_2m_max,
    weekRain: om.daily.precipitation_probability_max,
    rainPct: om.daily.precipitation_probability_max[0],
    rainSum: om.daily.precipitation_sum?.[0] ?? null,
    sunrise: String(om.daily.sunrise?.[0] || '').slice(11, 16),
    sunset: String(om.daily.sunset?.[0] || '').slice(11, 16),
    pm10: aq?.current?.pm10 ?? null, pm25: aq?.current?.pm2_5 ?? null, aqi: aq?.current?.us_aqi ?? null,   // 대기질(실시간)
    hourly,
    updated: new Date().toISOString(), source: 'Open-Meteo(키 없이)', airSource: aq ? 'Open-Meteo AirQuality' : null,
  };
}

/* ================= 스포츠 (TheSportsDB — 팀 → 리그 → 경기) =================
   라벨에서 팀을 찾아 searchteams → idLeague 로 오늘/다음/지난 경기 를 묶는다.
   실데이터가 없으면(팀 미확인·리그 비공개) news 로 우회한다 — 점수·일정을 만들지 않는다. */
const SPORT_LEAGUE_ALIAS = {   // 리그/팀명이 없어도 자주 쓰는 리그 키워드 → 리그 id
  '프리미어리그': '4328', 'epl': '4328', '분데스리가': '4331', '세리에a': '4330', '라리가': '4335', '리그앙': '4334',
  'nba': '4387', 'mlb': '4424',
};
const KNOWN_TEAM_INFO = {
  'Manchester City': { leagueId: '4328', league: 'English Premier League', sport: 'Soccer', stadium: 'Etihad Stadium', short: '맨시티' },
  'Manchester United': { leagueId: '4328', league: 'English Premier League', sport: 'Soccer', stadium: 'Old Trafford', short: '맨유' },
  'Liverpool': { leagueId: '4328', league: 'English Premier League', sport: 'Soccer', stadium: 'Anfield', short: '리버풀' },
  'Arsenal': { leagueId: '4328', league: 'English Premier League', sport: 'Soccer', stadium: 'Emirates Stadium', short: '아스널' },
  'Chelsea': { leagueId: '4328', league: 'English Premier League', sport: 'Soccer', stadium: 'Stamford Bridge', short: '첼시' },
  'Tottenham': { leagueId: '4328', league: 'English Premier League', sport: 'Soccer', stadium: 'Tottenham Hotspur Stadium', short: '토트넘' },
  'Real Madrid': { leagueId: '4335', league: 'Spanish La Liga', sport: 'Soccer', stadium: 'Santiago Bernabéu', short: '레알 마드리드' },
  'Barcelona': { leagueId: '4335', league: 'Spanish La Liga', sport: 'Soccer', stadium: 'Camp Nou', short: '바르셀로나' },
  'Bayern Munich': { leagueId: '4331', league: 'German Bundesliga', sport: 'Soccer', stadium: 'Allianz Arena', short: '바이에른 뮌헨' },
  'Paris Saint-Germain': { leagueId: '4334', league: 'French Ligue 1', sport: 'Soccer', stadium: 'Parc des Princes', short: 'PSG' },
  'Los Angeles Dodgers': { leagueId: '4424', league: 'MLB', sport: 'Baseball', stadium: 'Dodger Stadium', short: 'LA 다저스' },
  'New York Yankees': { leagueId: '4424', league: 'MLB', sport: 'Baseball', stadium: 'Yankee Stadium', short: 'NY 양키스' },
  'Los Angeles Lakers': { leagueId: '4387', league: 'NBA', sport: 'Basketball', stadium: 'Crypto.com Arena', short: 'LA 레이커스' },
  'Golden State Warriors': { leagueId: '4387', league: 'NBA', sport: 'Basketball', stadium: 'Chase Center', short: '골든스테이트' },
};

const SPORT_TEAM_ALIAS = {     // 한국어 관용칭 → TheSportsDB 팀 검색어
  '맨시티': 'Manchester City', '맨체스터 시티': 'Manchester City', '맨유': 'Manchester United', '리버풀': 'Liverpool',
  '아스널': 'Arsenal', '아스날': 'Arsenal', '첼시': 'Chelsea', '토트넘': 'Tottenham Hotspur', '스퍼': 'Tottenham Hotspur',
  '아스톤빌라': 'Aston Villa', '뉴캐슬': 'Newcastle United', '맨체스터': 'Manchester City',
  '레알': 'Real Madrid', '레알마드리드': 'Real Madrid', '바르샤': 'Barcelona', '바르셀로나': 'Barcelona',
  '아틀레티코': 'Atletico Madrid', '뮌헨': 'Bayern Munich', '바이에른': 'Bayern Munich', '도르트문트': 'Borussia Dortmund',
  'psg': 'Paris Saint-Germain', '파리생제르맹': 'Paris Saint-Germain', '인터밀란': 'Inter', '인테르': 'Inter',
  '밀란': 'AC Milan', '유벤투스': 'Juventus', '나폴리': 'Napoli', 'roma': 'AS Roma', '아약스': 'Ajax',
  '셀틱': 'Celtic', '레인저스': 'Rangers',
  '다저스': 'Los Angeles Dodgers', 'la다저스': 'Los Angeles Dodgers', '양키스': 'New York Yankees', '레드삭스': 'Boston Red Sox',
  '보스턴': 'Boston Red Sox', '컵스': 'Chicago Cubs', '메츠': 'New York Mets', '애스트로스': 'Houston Astros',
  '레이커스': 'Los Angeles Lakers', '셀틱스': 'Boston Celtics', '워리어스': 'Golden State Warriors', '골든스테이트': 'Golden State Warriors',
  ' 너겟츠': 'Denver Nuggets', '닉스': 'New York Knicks', '불스': 'Chicago Bulls', '히트': 'Miami Heat', '선스': 'Phoenix Suns',
  '토론토': 'Toronto Raptors', '벅스': 'Milwaukee Bucks', '세븐티식서스': 'Philadelphia 76ers',
};
const SPORT_HINT = /(축구|야구|농구|핸드볼|아이스하키|하키|배구|테니스|ufc|권투|복싱|리그|컵|챔피언스|epl|kbo|nba|mlb|nhl|분데스리가|세리에|라리가|리그앙|fc|유나이티드|city|united|rovers|더비|더비카운티|스퍼|구단|클럽|원정|홈경기|킥오프|프리미어)/i;
function teamQueryOf(label){
  const l = String(label || '').trim();
  const low = l.toLowerCase().replace(/\s+/g, '');
  for (const k of Object.keys(SPORT_TEAM_ALIAS)){
    const kk = k.toLowerCase();
    if (low === kk || low.includes(kk)) return SPORT_TEAM_ALIAS[k];
  }
  const cleaned = l.replace(/축구|야구|농구|구단|클럽|팀|뉴스|소식|최신|실시간|인기|시세|경기|일정|결과|응원|팬|리뷰|·|,/g, ' ')
    .replace(/[()[\]{}"'`]/g, '').replace(/\s+/g, ' ').trim();
  if (!cleaned) return null;
  if (SPORT_LEAGUE_ALIAS[cleaned.toLowerCase()]) return null;      // 리그 키워드만 → 아래 leagueFor 에서 처리
  return cleaned;
}
let _sportLastAt = 0, _sportBlockUntil = 0;
let SPORT_LAST_ERROR = null;             // 'rate-limit' | 'no-team' — UI 안내 문구를 구분
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function sportSearch(url){
  // TheSportsDB 무료 키는 버스트 요청을 429로 막는다 → 간격 확보 + 제한 감지 시 쿨다운(두드리지 않음)
  if (Date.now() < _sportBlockUntil){ SPORT_LAST_ERROR = 'rate-limit'; return null; }
  for (let attempt = 0; attempt < 2; attempt++){
    const wait = _sportLastAt + 340 - Date.now();
    if (wait > 0) await sleep(wait);
    _sportLastAt = Date.now();
    try {
      const j = await getJson(url, {}, 11000);
      if (j && Array.isArray(j.events)) return j.events;
      if (j && Array.isArray(j.teams)) return j.teams;
      return null;                       // events:null — 그날 경기 없음(정상)
    } catch (e) {
      const msg = String((e && e.message) || e);
      if (/429/.test(msg)){ _sportBlockUntil = Date.now() + 60_000; SPORT_LAST_ERROR = 'rate-limit'; return null; }
      if (attempt === 1) return null;
      await sleep(600);
    }
  }
  return null;
}
function kstParts(ms){
  const d = new Date(ms);
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short', hourCycle: 'h23' });
  const o = {}; for (const x of fmt.formatToParts(d)) o[x.type] = x.value;
  return { ymd: `${o.year}-${o.month}-${o.day}`, hm: `${o.hour}:${o.minute}`, dow: o.weekday, month: Number(o.month), day: Number(o.day), hour: Number(o.hour), min: Number(o.minute) };
}
const KST_DOW = { Sun: '일', Mon: '월', Tue: '화', Wed: '수', Thu: '목', Fri: '금', Sat: '토' };
function isoOf(e){ return e.strTimestamp ? e.strTimestamp + 'Z' : (e.dateEvent || '') + 'T' + (e.strTime || '15:00:00') + 'Z'; }
function flatEvent(e, team){
  const home = e.strHomeTeam || '', away = e.strAwayTeam || '';
  const hs = e.intHomeScore == null || e.intHomeScore === '' ? null : Number(e.intHomeScore);
  const as = e.intAwayScore == null || e.intAwayScore === '' ? null : Number(e.intAwayScore);
  const ts = Date.parse(isoOf(e));
  return {
    id: e.idEvent, league: e.strLeague || '', sport: e.strSport || '', season: e.strSeason || '', round: e.intRound || '',
    home, away, isHome: team ? (home === team ? 1 : 0) : null, venue: e.strVenue || '', city: e.strCity || '',
    ts: isNaN(ts) ? null : ts,
    status: e.strStatus || (hs == null ? 'NS' : 'FT'),
    hs, as, score: (hs == null || as == null) ? null : `${hs} - ${as}`,
    badgeHome: e.strHomeTeamBadge || '', badgeAway: e.strAwayTeamBadge || '', poster: e.strPoster || '',
  };
}
async function leagueEdge(leagueId, force){
  const r = await cachedInfo('edge:' + leagueId, 2 * 60_000, async () => {
    const nx = await sportSearch(`https://www.thesportsdb.com/api/v1/json/3/eventsnextleague.php?id=${leagueId}`);
    await sleep(320);
    const ps = await sportSearch(`https://www.thesportsdb.com/api/v1/json/3/eventspastleague.php?id=${leagueId}`);
    return { next: (nx && nx[0]) || null, past: (ps && ps[0]) || null };
  }, { force }).catch(() => null);
  return r && r.data ? r.data : null;
}
async function sportDay(leagueId, ymd){
  // 리그+날짜별 전체 경기 (무료 키는 eventsnext/past 가 1건만 반환 → eventsday 사용)
  const todayY = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' });
  const ttl = ymd < todayY ? 6 * 3600_000 : (ymd === todayY ? 3 * 60_000 : 15 * 60_000);
  return cached(`sport:${leagueId}:${ymd}`, ttl, () => sportSearch(`https://www.thesportsdb.com/api/v1/json/3/eventsday.php?d=${ymd}&l=${leagueId}`));
}
function ymdOffset(days){
  const d = new Date(Date.now() + days * 86400_000 + 9 * 3600_000);   // KST 기준 날짜
  return d.toISOString().slice(0, 10);
}
async function sportDays(leagueId, offsets){
  const out = [];
  for (const o of offsets) out.push(await sportDay(leagueId, ymdOffset(o)));   // 순차(슬로틀 보호) — 결과는 캐시됨
  return out;
}
async function sportsFor(label, force){
  SPORT_LAST_ERROR = null;
  const key = 'sport:built:' + String(label || '').trim().toLowerCase();
  const hit = CACHE.get(key);
  // 이미 수집된 결과에 '진행 중' 경기가 있으면 30초로 짧게 (점수가 움직이는 동안은 자주 본다)
  const liveNow = !!(hit && hit.data && hit.data.live);
  const ttl = liveNow ? CADENCE.sportLive : (MOTORSPORT_RE.test(String(label || '')) ? CADENCE.sport : 4 * 60_000);
  const r = await cachedInfo(key, ttl, () => buildSports(label, force), { force });
  if (r.data) r.data.ttl = ttl;
  return r.data;
}
async function buildSports(label, force){
  // 종목 판별(1단계): 모터스포츠(등수·포인트) → 전용 소스
  if (disciplineOf(label, '') === 'motorsport'){
    const mo = await motorsportFor(label, force).catch(() => null);
    if (mo) return mo;
    if (!SPORT_LAST_ERROR) SPORT_LAST_ERROR = 'no-team';
    return null;
  }
  const q = teamQueryOf(label);
  const lowAll = String(label || '').toLowerCase().replace(/\s+/g, '');
  let leagueId = null, teamName = null, teamSport = '', stadium = '', leagueName = '';
  const known = KNOWN_TEAM_INFO[q] || (Object.keys(KNOWN_TEAM_INFO).find(k => k.toLowerCase() === (q || '').toLowerCase()) && KNOWN_TEAM_INFO[Object.keys(KNOWN_TEAM_INFO).find(k => k.toLowerCase() === (q || '').toLowerCase())]);
  if (known){
    teamName = q; leagueId = known.leagueId; teamSport = known.sport; stadium = known.stadium; leagueName = known.league;
  }
  if (q && !leagueId){
    const teams = await cached('sport:team:' + q, 12 * 3600_000, () => sportSearch(`https://www.thesportsdb.com/api/v1/json/3/searchteams.php?t=${encodeURIComponent(q)}`));
    const t = teams && teams[0];
    if (t){ teamName = t.strTeam; leagueId = t.idLeague; teamSport = t.strSport || ''; stadium = t.strStadium || ''; leagueName = t.strLeague || ''; }
  }
  if (known && !leagueName) leagueName = known.league;
  if (!leagueId){
    for (const k of Object.keys(SPORT_LEAGUE_ALIAS)) if (lowAll.includes(k.toLowerCase())){ leagueId = SPORT_LEAGUE_ALIAS[k]; break; }
  }
  if (!leagueId){ if (!SPORT_LAST_ERROR) SPORT_LAST_ERROR = 'no-team'; return null; }
  // 좁은 창에서 시작해 없으면 확장 (무료 키 슬로틀 → 요청 수 최소화, 일별 캐시 공유)
  let perDay = await sportDays(leagueId, [0, 1, 2, -1, -2]);
  let all = collectSportDays(perDay, [0, 1, 2, -1, -2], teamName);
  if (!all.some(e => e.ts > Date.now())){
    const moreUp = await sportDays(leagueId, [3, 4, 5, 6, 7]);
    all = all.concat(collectSportDays(moreUp, [3, 4, 5, 6, 7], teamName));
  }
  if (!all.some(e => e.ts > Date.now())){                  // A/S 기간 등 일정이 아직 등록되지 않은 경우 → +2주 더
    const moreUp2 = await sportDays(leagueId, [8, 9, 10, 11, 12, 13, 14]);
    all = all.concat(collectSportDays(moreUp2, [8, 9, 10, 11, 12, 13, 14], teamName));
  }
  if (!all.some(e => e.ts <= Date.now() && e.score != null)){
    const morePast = await sportDays(leagueId, [-3, -4, -5]);
    all = all.concat(collectSportDays(morePast, [-3, -4, -5], teamName));
  }
  all.forEach(e => { if (e.ts){ const p = kstParts(e.ts); e.when = `${p.month}월 ${p.day}일 (${KST_DOW[p.dow] || ''}) ${p.hm}`; e.ymd = p.ymd; } });
  const now = Date.now();
  const mine = all.filter(e => e.ts).sort((a, b) => a.ts - b.ts);
  const upcoming = mine.filter(e => e.ts > now).slice(0, 5);
  const results = mine.filter(e => e.ts <= now && e.score != null).sort((a, b) => b.ts - a.ts).slice(0, 8);
  const live = mine.filter(e => e.ts <= now && e.ts > now - 150 * 60000 && !/FT|AET|PEN|POST|DELAY/i.test(e.status)).pop() || null;
  const todayY = ymdOffset(0);
  const today = mine.filter(e => e.ymd === todayY);
  const form = results.slice(0, 5).map(e => {
    if (e.score == null || !teamName) return '?';
    const mine2 = e.home === teamName ? e.hs : e.as, theirs = e.home === teamName ? e.as : e.hs;
    return mine2 > theirs ? 'W' : (mine2 < theirs ? 'L' : 'D');
  }).reverse();
  const src = mine[0] || {};
  // 무료 소스가 그날 일정을 비워둔 경우 → 리그 next/past 로 보정(우리 팀 경기 여부까지 표시)
  let edgeNote = '';
  if (!upcoming.length || !results.length){
    const edge = await leagueEdge(leagueId, force);
    if (edge){
      for (const [raw, want] of [[edge.next, 'up'], [edge.past, 'down']]){
        if (!raw || !raw.dateEvent) continue;
        const ev = flatEvent(raw, teamName);
        if (ev.ts) { const p = kstParts(ev.ts); ev.when = `${p.month}월 ${p.day}일 (${KST_DOW[p.dow] || ''}) ${p.hm}`; ev.ymd = p.ymd; }
        const involves = teamName && (ev.home === teamName || ev.away === teamName);
        if (want === 'up' && !upcoming.length && (involves || ev.ts > Date.now())){
          upcoming = [ev]; all.push(ev); edgeNote = involves ? '' : '리그 전체 일정 기준 — 우리 팀의 그날 경기는 아직 등록 전';
        }
        if (want === 'down' && !results.length && ev.score != null) results = [ev];
      }
    }
  }
  const seasonForTable = (src.season || (upcoming[0] && upcoming[0].season) || (results[0] && results[0].season) || '');
  const lgName = src.league || leagueName || '';
  const [tbl, scorers, mlb] = await Promise.all([
    leagueTableFor(leagueId, lgName, seasonForTable, teamName, force).catch(() => null),
    topScorersFor(lgName, seasonForTable, force).catch(() => null),
    (/baseball|야구/i.test(teamSport + ' ' + lgName) ? mlbFor(teamName, leagueId, force).catch(() => null) : Promise.resolve(null)),
  ]);
  const honors = [];
  if (tbl && (tbl.rank != null || tbl.leader)){
    honors.push({
      type: 'points', title: tbl.rank === 1 ? '리그 선두(우승 레이스 1위)' : '리그 순위',
      name: tbl.team || teamName || '', value: `${tbl.rank}위 · 승점 ${tbl.points}` + (tbl.gapToLeader ? ` · 1위와 -${tbl.gapToLeader}` : ''),
      team: (tbl.leader || {}).team || '', note: `선두 ${(tbl.leader || {}).team || '—'} ${((tbl.leader || {}).points) || '—'}점 · ${(tbl.rows || []).length}팀 중`,
    });
  }
  if (scorers && scorers.rows && scorers.rows.length){
    const t = scorers.rows[0];
    honors.push({
      type: 'scorer', title: '최다 득점(골든부츠 경쟁)', name: t.player, value: `${t.value}골`,
      team: t.club, note: `2위 ${scorers.rows[1] ? scorers.rows[1].player + ' ' + scorers.rows[1].value + '골' : '—'} · 출처 위키피디아 시즌 문서`,
      rows: scorers.rows, mine: !!(teamName && scorers.rows.some(x => x.club === teamName)),
    });
  }
  if (mlb){
    if (mlb.standing) honors.push({
      type: 'points', title: 'MLB 디비전 순위', name: teamName || '', value: `${mlb.standing.rank}위 · ${mlb.standing.wins}승 ${mlb.standing.losses}패` + (mlb.standing.gb && mlb.standing.gb !== '-' ? ` · 1위와 -${mlb.standing.gb}` : ''),
      team: '', note: 'MLB StatsAPI(공식)' + (mlb.standing.streak ? ` · 최근 ${mlb.standing.streak}` : ''),
    });
    (mlb.leaders || []).forEach(x => honors.push({
      type: 'scorer', title: x.label, name: x.name, value: x.value, team: x.team, note: 'MLB 시즌 리더(리그 전체 1위)',
    }));
  }
  return {
    kind: 'sport', discipline: 'league', label: String(label || '').trim(), team: teamName || leagueName || q, teamShort: teamName || '',
    sport: teamSport || 'Soccer', league: lgName, leagueId, homeGround: stadium, season: seasonForTable,
    live, next: upcoming[0] || null, results, upcoming, today, form,
    standings: tbl, honors, edgeNote,
    updated: new Date().toISOString(),
    note: edgeNote || '', source: 'TheSportsDB' + (tbl ? ' + 순위표' : '') + (mlb ? ' + MLB StatsAPI' : ''),
  };
}
function collectSportDays(lists, offsets, teamName){
  const all = [];
  lists.forEach((list, i) => {
    for (const e of (list || [])){
      const ev = flatEvent(e, teamName);
      ev.dayKey = offsets[i];
      if (!teamName || ev.home === teamName || ev.away === teamName) all.push(ev);
    }
  });
  return all;
}
/* ============================================================
   스포츠 — 종목(discipline)별 인터페이스을 위한 데이터 레이어
   · 등수·포인트로 경쟁하는 종목(모터스포츠) → Jolpica(F1) : 선두/격차/시즌 잔여/세션/포디엄
   · 점수가 나는 종목(리그)          → TheSportsDB 경기 + 순위표(lookuptable) + 최다 득점(위키피디아)
   · 야구(MLB)              → MLB StatsAPI(공식) 순위·리더(홈런/타점) 로 보강
   소스가 없으면 해당 블록을 통째로 뺀다 — 숫자를 짓지 않는다.
   ============================================================ */
const MOTORSPORT_RE = /(\bf1\b|formula\s*-?\s*1|포뮬러|motogp|모토피|그랑프리|grand\s*prix|indycar|인디카|\bnascar\b|\bwrc\b|rally|랠리|모터스포츠|레이싱|racing|스프린트\s*레이스)/i;
const LEAGUE_SPORT_RE = /(축구|야구|농구|배구|아이스하키|핸드볼|foot\s*ball|soccer|baseball|\bmlb\b|\bkbo\b|basketball|\bnba\b|ice\s*hockey|\bnhl\b|volleyball)/i;
function disciplineOf(label, strSport){
  const l = String(label || '') + ' ' + String(strSport || '');
  if (MOTORSPORT_RE.test(l) && !LEAGUE_SPORT_RE.test(String(label || ''))) return 'motorsport';
  return 'league';
}
/* --- F1 (Jolpica/Ergast 호환 · 키 불필요) --- */
const JOLPICA = 'https://api.jolpi.ca/ergast/f1';
async function jolpi(path, ttl, force){
  const r = await cachedInfo('f1:' + path, ttl, async () => {
    const j = await getJson(`${JOLPICA}${path}`, {}, 14000);
    const md = j && j.MRData;
    if (!md) throw new Error('jolpi 빈 응답 ' + path);
    return md;
  }, { force });
  return r.data;
}
const nationalityKo = n => ({ Italian:'이탈리아', German:'독일', British:'영국', Dutch:'네덜란드', Spanish:'스페인', Monegasque:'모나코', French:'프랑스', Belgian:'벨기에', Dane:'덴마크', Danish:'덴마크', Finn:'핀란드', Finnish:'핀란드', Canadian:'캐나다', American:'미국', Mexican:'멕시코', Brazilian:'브라질', Japanese:'일본', Australian:'호주', Austrian:'오스트리아', Swiss:'스위스', Swedish:'스웨덴', Thai:'태국', Bahraini:'바레인', Argentine:'아르헨티나' }[n] || n || '');
const driverName = d => ((d.givenName || '') + ' ' + (d.familyName || '')).trim();
async function motorsportFor(label, force){
  const [season, standings, cStand, last, next] = await Promise.all([
    jolpi('/current.json', 12 * 3600_000, force).catch(() => null),
    jolpi('/current/driverStandings.json?limit=5', 25 * 60_000, force).catch(() => null),
    jolpi('/current/constructorStandings.json?limit=3', 25 * 60_000, force).catch(() => null),
    jolpi('/current/last/results.json', 3 * 3600_000, force).catch(() => null),
    jolpi('/current/next.json', 30 * 60_000, force).catch(() => null),
  ]);
  const list = standings && standings.StandingsTable && standings.StandingsTable.StandingsLists && standings.StandingsTable.StandingsLists[0];
  const rows = ((list || {}).DriverStandings) || [];
  if (!rows.length && !next && !last) return null;              // 소스 확인 불가 → 뉴스 폴백
  const roundNow = Number((list && list.round) || (season && season.StandingsTable && season.StandingsTable.round) || 0) || null;
  const roundsTotal = season && season.total ? Number(season.total) : null;
  const cList = cStand && cStand.StandingsTable && cStand.StandingsTable.StandingsLists && cStand.StandingsTable.StandingsLists[0];
  const cRows = ((cList || {}).ConstructorStandings) || [];
  const pts = x => Number(x.points || 0);
  const lead = rows[0] ? {
    rank: Number(rows[0].position) || 1, name: driverName(rows[0].Driver), code: rows[0].Driver.code || '',
    team: ((rows[0].Constructors || [])[0] || {}).name || '', points: pts(rows[0]), wins: Number(rows[0].wins || 0),
    nat: nationalityKo(rows[0].Driver.nationality), driverId: rows[0].Driver.driverId,
  } : null;
  const rival = rows[1] ? { rank: 2, name: driverName(rows[1].Driver), team: ((rows[1].Constructors || [])[0] || {}).name || '', points: pts(rows[1]) } : null;
  const gap = lead && rival ? lead.points - rival.points : null;
  const roundsLeft = roundsTotal && roundNow ? Math.max(0, roundsTotal - roundNow) : null;
  const maxLeft = roundsLeft == null ? null : roundsLeft * 25 + 1;         // 우승 확정은 남은 최대치(25점+패스티스트랩 1점)와 비교
  const clinched = !!(lead && maxLeft != null && gap != null && gap > maxLeft);
  const raceOf = md => { const T = md && md.RaceTable; return (T && T.Races && T.Races[0]) || null; };
  const nr = raceOf(next), lr = raceOf(last);
  const sessKeys = [['FirstPractice','1차 연습'],['SecondPractice','2차 연습'],['ThirdPractice','3차 연습'],['Sprint','스프린트'],['Qualifying','예선'],['SprintQualifying','스프린트 예선']];
  const sessions = nr ? sessKeys.filter(([k]) => nr[k] && nr[k].date).map(([k, ko]) => ({
    key: k, label: ko, ts: Date.parse(`${nr[k].date}T${(nr[k].time || '00:00:00Z').replace('Z', '')}Z`), raw: nr[k],
  })).filter(x => !isNaN(x.ts)) : [];
  const nextRace = nr ? {
    name: nr.raceName, round: Number(nr.round) || null, circuit: (nr.Circuit || {}).circuitName || '', locality: ((nr.Circuit || {}).Location || {}).locality || '',
    country: ((nr.Circuit || {}).Location || {}).country || '', ts: Date.parse(`${nr.date}T${nr.time || '00:00:00Z'}`), date: nr.date, time: nr.time,
    sessions, url: nr.url || '',
  } : null;
  if (nextRace && !isNaN(nextRace.ts)) { const p = kstParts(nextRace.ts); nextRace.when = `${p.month}월 ${p.day}일 (${KST_DOW[p.dow] || ''}) ${p.hm}`; }
  sessions.forEach(x => { const p = kstParts(x.ts); x.when = `${p.month}/${p.day} (${KST_DOW[p.dow] || ''}) ${p.hm}`; });
  const podium = lr ? (lr.Results || []).filter(x => Number(x.position) <= 3).map(x => ({
    pos: Number(x.position), driver: driverName(x.Driver), code: x.Driver.code || '', team: (x.Constructor || {}).name || '',
    points: Number(x.points || 0), status: x.status || '', flRank: ((x.FastestLap || {}).rank != null ? Number(x.FastestLap.rank) : null),
  })) : [];
  const lastRace = lr ? { name: lr.raceName, round: Number(lr.round) || null, date: lr.date, circuit: (lr.Circuit || {}).circuitName || '', podium } : null;
  return {
    kind: 'sport', discipline: 'motorsport', series: 'f1', sport: '포뮬러 1',
    label: String(label || '').trim(), team: lead ? lead.name : 'F1', teamShort: lead ? (lead.code || lead.name.split(' ').pop()) : 'F1',
    league: 'FIA F1 세계선수권', season: Number((list && list.season) || (nr && nr.season) || new Date().getFullYear()),
    round: roundNow, roundsTotal, roundsLeft, gap, clinched,
    leader: lead, rival, standings: rows.map(x => ({
      rank: Number(x.position), name: driverName(x.Driver), code: x.Driver.code || '', team: ((x.Constructors || [])[0] || {}).name || '',
      points: pts(x), wins: Number(x.wins || 0),
    })),
    constructors: cRows.map(x => ({ rank: Number(x.position), team: (x.Constructor || {}).name || '', points: pts(x), wins: Number(x.wins || 0) })),
    next: nextRace, lastRace, live: null, results: [], upcoming: nextRace ? [nextRace] : [], today: [], form: [],
    honors: lead ? {
      type: 'points', title: clinched ? '드라이버즈 우승 확정' : '드라이버즈 선두', name: lead.name, team: lead.team,
      value: `${lead.points}점${gap != null ? ` · 2위와 +${gap}` : ''}`, note: `직전 ${lr ? lr.raceName : '레이스'} 1위 ${podium[0] ? podium[0].driver : '—'}`,
    } : null,
    updated: new Date().toISOString(), source: 'Jolpica F1 (Ergast 호환)',
  };
}
/* --- 리그 순위표 (TheSportsDB lookuptable + Wikipedia 보강) --- */
async function wikiTableFor(leagueName, season, force){
  const title = wikiSeasonTitle(leagueName, season);
  if (!title) return null;
  const r = await cachedInfo('wiki:tbl:' + title, 3 * 3600_000, async () => {
    const meta = await getJson(`https://en.wikipedia.org/w/api.php?action=parse&format=json&prop=sections&page=${encodeURIComponent(title)}`, { 'Accept': 'application/json' }, 14000);
    const secs = (((meta || {}).parse || {}).sections) || [];
    const hit = secs.find(x => /^(league table|standings|table|순위표)/i.test(String(x.line || '').trim()));
    if (!hit) throw new Error('Wiki 순위표 섹션 없음');
    const d = await getJson(`https://en.wikipedia.org/w/api.php?action=parse&format=json&prop=text&section=${hit.index}&page=${encodeURIComponent(title)}`, { 'Accept': 'application/json' }, 14000);
    const html = (((d || {}).parse || {}).text || {})['*'] || '';
    const reTr = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    const reTd = /<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi;
    const rows = [];
    let tm;
    while ((tm = reTr.exec(html))){
      const trHtml = tm[1];
      const cells = [];
      let cm;
      while ((cm = reTd.exec(trHtml))){
        cells.push(cm[1].replace(/<[^>]*>/g, '').replace(/&#\d+;/g, '').replace(/&[a-z]+;/g, ' ').replace(/\s+/g, ' ').trim());
      }
      if (cells.length >= 10 && /^\d+$/.test(cells[0])){
        const rank = Number(cells[0]);
        const team = cells[1].replace(/\[[^\]]*\]/g, '').trim();
        const pld = Number(cells[2]), w = Number(cells[3]), dr = Number(cells[4]), l = Number(cells[5]);
        const gf = Number(cells[6]), ga = Number(cells[7]), gd = Number(cells[8].replace('+', ''));
        const pts = Number(cells[9]);
        if (rank && team && !isNaN(pts)) rows.push({ rank, team, played: pld, win: w, draw: dr, loss: l, gf, ga, gd, points: pts });
      }
    }
    if (!rows.length) throw new Error('Wiki 순위표 파싱 실패');
    return rows;
  }, { force }).catch(() => null);
  return r && r.data ? r.data : null;
}
async function leagueTableFor(leagueId, leagueName, season, teamName, force){
  season = season || '2026-2027';
  let rows = null, srcTag = '';
  // 1) TheSportsDB 시도
  if (leagueId && !srcBlocked('www.thesportsdb.com')){
    try {
      const j = await cachedInfo(`tbl:${leagueId}:${season}`, 40 * 60_000, async () => {
        const d = await getJson(`https://www.thesportsdb.com/api/v1/json/3/lookuptable.php?l=${leagueId}&s=${encodeURIComponent(season)}`, {}, 11000);
        return d && d.table;
      }, { force });
      if (j && Array.isArray(j.data) && j.data.length){
        const n = v => (v == null || v === '' ? null : Number(v));
        rows = j.data.map(x => ({
          rank: n(x.intRank), team: x.strTeam, played: n(x.intPlayed), win: n(x.intWin), draw: n(x.intDraw), loss: n(x.intLoss),
          gf: n(x.intGoalsFor), ga: n(x.intGoalsAgainst), gd: n(x.intGoalDifference), points: n(x.intPoints), form: x.strForm || '',
        })).sort((a, b) => (a.rank || 99) - (b.rank || 99));
        srcTag = 'TheSportsDB 순위표';
      }
    } catch (e) {}
  }
  // 2) TheSportsDB 실패 시 Wikipedia 시즌 문서 순위표로 폴백
  if (!rows && leagueName){
    try {
      const wk = await wikiTableFor(leagueName, season, force);
      if (wk && wk.length){ rows = wk; srcTag = '위키피디아 시즌 순위표'; }
    } catch (e) {}
  }
  if (!rows || !rows.length) return null;
  const teamLow = String(teamName || '').toLowerCase().replace(/\s+/g, '');
  const mine = teamName ? (rows.find(x => x.team === teamName) || rows.find(x => x.team.toLowerCase().replace(/\s+/g, '').includes(teamLow))) : null;
  const lead = rows[0] || null;
  return {
    team: mine ? mine.team : (lead ? lead.team : ''), rank: mine ? mine.rank : (teamName ? null : 1), points: mine ? mine.points : (lead ? lead.points : null),
    played: mine ? mine.played : null, win: mine ? mine.win : null, draw: mine ? mine.draw : null, loss: mine ? mine.loss : null,
    gf: mine ? mine.gf : null, ga: mine ? mine.ga : null, gd: mine ? mine.gd : null, form: mine ? mine.form : '',
    leader: lead ? { team: lead.team, points: lead.points, rank: 1 } : null,
    gapToLeader: (mine && lead && mine.rank !== 1 && mine.points != null) ? (lead.points - mine.points) : (mine && lead ? 0 : null),
    rows: rows.slice(0, 8), total: rows.length, season, source: srcTag,
  };
}
/* --- 최다 득점(리그 시즌 문서의 Top scorers 표) --- */
const WIKI_LEAGUE = {
  'English Premier League': 'Premier League', 'Premier League': 'Premier League',
  'Spanish La Liga': 'La Liga', 'La Liga': 'La Liga', 'German Bundesliga': 'Bundesliga', 'Bundesliga': 'Bundesliga',
  'Italian Serie A': 'Serie A', 'Serie A': 'Serie A', 'French Ligue 1': 'Ligue 1', 'Ligue 1': 'Ligue 1',
  'UEFA Champions League': 'UEFA Champions League', 'Championship': 'EFL Championship',
  'Portuguese Primeira Liga': 'Primeira Liga', 'Saudi Pro League': 'Saudi Pro League', 'Scottish Premiership': 'Scottish Premiership',
};
function wikiSeasonTitle(leagueName, season){
  const short = WIKI_LEAGUE[leagueName];
  if (!short || !season) return null;
  const m = String(season).match(/(\d{4})[^0-9]+(\d{2,4})/);
  if (!m) return `${season} ${short}`;
  const y2 = String(Number(m[2]) % 100).padStart(2, '0');
  return `${m[1]}-${y2} ${short}`.replace('-', '\u2013');   // 2026-27 → 2026–27
}
function wikiCells(row){
  return row.split('\n').map(x => x.trim()).filter(x => x.startsWith('|') && !x.startsWith('|-') && !x.startsWith('|}'))
    .map(x => x.replace(/^\|/, '').replace(/^rowspan="\d+"\s*\|?/, '').replace(/^align="\w+"\s*\|/, '').trim());
}
function parseScorersWikitext(wt){
  const out = [];
  const rows = wt.split(/\n\|-/);
  for (const raw of rows){
    const cells = wikiCells(raw).map(c => {
      let t = c.replace(/\{\{[^{}]*\}\}/g, '').replace(/<ref[^>]*>[\s\S]*?<\/ref>/g, '').replace(/<ref[^\/]*\/>/g, '').trim();
      const link = t.match(/\[\[(?:[^\]|]*\|)?([^\]]+)\]\]/);
      if (link) t = link[1];
      return t.replace(/\{\{[^{}]*\}\}/g, '').trim();
    }).filter(Boolean);
    if (cells.length < 3) continue;
    const rank = Number(cells[0]); const val = Number(cells[cells.length - 1]);
    if (!isFinite(rank) || !isFinite(val) || rank < 1 || rank > 40 || val < 1 || val > 90) continue;
    const club = cells.length >= 4 ? cells[cells.length - 2] : '';
    const player = cells.length >= 4 ? cells[1] : cells[1];
    if (!player || !/[A-Za-z가-힣\u00C0-\u024F]/.test(player)) continue;
    if (!out.some(o => o.player === player)) out.push({ rank, player, club, value: val });
  }
  return out.slice(0, 6);
}
async function topScorersFor(leagueName, season, force){
  const title = wikiSeasonTitle(leagueName, season);
  if (!title) return null;
  const r = await cachedInfo('wiki:scorers:' + title, 3 * 3600_000, async () => {
    const meta = await getJson(`https://en.wikipedia.org/w/api.php?action=parse&format=json&prop=sections&page=${encodeURIComponent(title)}`, { 'Accept': 'application/json' }, 15000);
    const secs = (((meta || {}).parse || {}).sections) || [];
    const hit = secs.find(x => /^(top scorers|scorers|top goals|leading scorers|득점)/i.test(String(x.line || '').trim()));
    if (!hit) throw new Error('Top scorers 섹션 없음');
    const w = await getJson(`https://en.wikipedia.org/w/api.php?action=parse&format=json&prop=wikitext&section=${hit.index}&page=${encodeURIComponent(title)}`, { 'Accept': 'application/json' }, 15000);
    const wt = ((((w || {}).parse || {}).wikitext) || {})['*'] || '';
    const rows = parseScorersWikitext(wt);
    if (!rows.length) throw new Error('득점 표 파싱 실패');
    return { rows, title, section: hit.line };
  }, { force }).catch(() => null);
  return r && r.data ? r.data : null;
}
/* --- MLB 공식 API(순위·리더·라이브) --- */
const MLB_ID = { 'Los Angeles Dodgers': 119, 'New York Yankees': 147, 'Boston Red Sox': 136, 'San Francisco Giants': 137, 'Chicago Cubs': 112, 'St. Louis Cardinals': 138, 'Houston Astros': 117, 'Atlanta Braves': 144, 'Philadelphia Phillies': 143, 'New York Mets': 121, 'San Diego Padres': 139, 'Toronto Blue Jays': 141, 'Los Angeles Angels': 108, 'Seattle Mariners': 136 - 0 };
async function mlbFor(teamName, leagueId, force){
  const r = await cachedInfo(`mlb:teams`, 12 * 3600_000, async () => {
    const j = await getJson('https://statsapi.mlb.com/api/v1/teams?sportId=1', {}, 14000);
    const out = {};
    for (const t of (j && j.teams) || []) out[t.name] = t.id;
    return out;
  }, {}).catch(() => null);
  const ids = (r && r.data) || {};
  const teamId = ids[teamName] || MLB_ID[teamName] || null;
  if (!teamId) return null;
  const season = new Date().getFullYear();
  const q = async (path, key, ttl) => { const x = await cachedInfo(`mlb:${key}`, ttl, () => getJson('https://statsapi.mlb.com/api/v1' + path, {}, 14000), { force }).catch(() => null); return x && x.data; };
  const [std, lead] = await Promise.all([
    q(`/standings?season=${season}&leagueId=103,104&includePlayoffSeeds=true`, 'standings:' + season, 30 * 60_000),
    q(`/stats/leaders?season=${season}&statType=season&group=hitting&leaderCategories=homeRuns,runsBattedIn,battingAverage&limit=3&sportId=1`, 'leaders:' + season, 45 * 60_000),
  ]);
  let mine = null;
  if (std && std.records){
    for (const rec of std.records) for (const tr of (rec.teamRecords || [])){
      if (tr.team && tr.team.id === teamId) mine = {
        rank: tr.divisionRank || tr.leagueRank || null, leagueRank: tr.leagueRank || null,
        wins: tr.wins, losses: tr.losses, pct: tr.winningPercentage, gb: tr.gamesBack, streak: (tr.streak || {}).streakCode || '',
        div: ((rec.division || {}).id) || '', seeds: tr.playoffSeed ? 'PO 시드 ' + tr.playoffSeed : '',
      };
    }
  }
  const leaders = [];
  if (lead && lead.leagueLeaders){
    const nm = { homeRuns: '홈런 1위', runsBattedIn: '타점 1위', battingAverage: '타율 1위' };
    for (const L of lead.leagueLeaders){
      const p = (L.leaders || [])[0];
      if (!p) continue;
      leaders.push({ key: L.leaderCategory, label: nm[L.leaderCategory] || L.leaderCategory, rank: p.rank, name: ((p.person || {}).fullName) || '', value: p.value, team: ((p.team || {}).name) || '' });
    }
  }
  return { teamId, standing: mine, leaders, source: 'MLB StatsAPI(공식)', season };
}

/* ================= 분류 ================= */
const SPORT_KIND_RE = /(축구|야구|농구|배구|핸드볼|하키|테니스|골프|권투|ufc|kbo|nba|mlb|nhl|epl|분데스리가|세리에a|라리가|리그앙|프리미어리그|챔피언스리그|유로파|구단|토트넘|맨시티|맨유|리버풀|아스널|첼시|레알마드리드|바르셀로나|뮌헨|도르트문트|파리생제르맹|juventus|napoli|tottenham|arsenal|chelsea|liverpool|\bf1\b|formula\s?-?\s?1|포뮬러|motogp|그랑프리|grand\s?prix|indycar|nascar|wrc|랠리|rally|모터스포츠|레이싱|scuderia|mclaren|ferrari|mercedes|red\s?bull|rbr|알론소|베르스타펜|노리스|르클레르|해밀턴|hamilton|leclerc|piastri|antonelli|sainz)/i;
function isSportsLabel(label){
  const l = String(label || '').trim();
  if (!l) return false;
  const low = l.toLowerCase().replace(/\s+/g, '');
  if (Object.keys(SPORT_TEAM_ALIAS).some(k => low.includes(k.toLowerCase().replace(/\s+/g, '')))) return true;
  if (Object.keys(SPORT_LEAGUE_ALIAS).some(k => low.includes(k.toLowerCase()))) return true;
  return SPORT_KIND_RE.test(low);
}
function classify(label){
  const l = label.toLowerCase();
  if (/날씨|기상|온도|강수/.test(l) || (!/뉴스|소식/.test(l) && Object.keys(CITY_COORD).some(c => label.includes(c)) && label.replace(new RegExp('(' + Object.keys(CITY_COORD).join('|') + ')'), '').trim().length <= 2)) return 'weather';
  if (isSportsLabel(label)) return 'sport';            // 팀·리그가 확인되는 스포츠 → 경기 데이터 우선
  if (/비트코인|이더리움|리플|도지|솔라나|에이다|수이|코인|가상자산|암호화폐|bitcoin|ethereum|btc|eth|xrp/.test(l)) return 'coin';
  if (/환율|환전|외환/.test(l)) return 'fx';
  if (fxBaseOf(l)) return 'fx';
  if (/주식|주가|증시|코스피|코스닥|전자|하이닉스|카카오|네이버|현대차|기아|셀트리온|금융|sk|lg|삼성|posco|포스코|hmm|^\d{6}$/.test(l)) return 'stock';
  if (looksLikeCompanyName(label)) return 'stock';   // 회사 이름 → 주식(사전/Yahoo 해석은 quote 단계)
  return 'news';
}

/* 'news'로 분류됐지만 실제 해석하면 종목인 경우 주식으로 뒤집기(뉴스형으로 잘못 안착 방지) */
const NEWS_NOFLIP_STOP = /(트렌드|소식|뉴스|리그|축구|영화|게임|음악|요리|여행|조류|버드|마인크래프트|minecraft|birds|football|soccer)/i;
async function maybeFlipToStock(label){
  if (NEWS_NOFLIP_STOP.test(String(label || ''))) return false;
  if (!looksLikeCompanyName(label)) return false;
  try { return !!(await resolveStockCode(label)); }
  catch (e) { return false; }
}

/* ================= 관심사 전체 응답 ================= */
async function interestResponse(label, topicKey, opts){
  label = (label || '').trim();
  opts = opts || {};
  const force = !!opts.force;
  // 사용자(UI)가 이미 고른 종류를 최우선 존중, 없으면 이름으로 AI 분류
  const want = (opts.kind || '').toLowerCase();
  let kind = (want && ['news','coin','stock','fx','weather','personal','sport'].includes(want)) ? want : classify(label);
  // 회사 이름처럼 보이는데 뉴스로 잡혔다면, 실제 종목 해석이 되면 주식으로 전환
  if (kind === 'news' && !want && await maybeFlipToStock(label)) kind = 'stock';
  const out = { ok: true, label, kind, topic: topicKey || label, ts: Date.now(), fetchedAt: new Date().toISOString(), cadence: CADENCE[kind] || 60_000 };
  if (kind === 'news'){
    const items = await newsFor(label, topicKey || label, opts);
    out.items = items;
    out.cadence = CADENCE.news;
    if (items && items.noNew) out.noNew = true;
  } else if (kind === 'coin'){
    const q = await coinQuote(label, { force }).catch(() => null);
    if (q) out.quote = q; else { out.kind = 'news'; out.items = await newsFor(label, topicKey || label, opts); out.note = '해당 코인을 Upbit에서 찾지 못해 뉴스로 대체'; }
  } else if (kind === 'fx'){
    const q = await fxQuote(label, { force }).catch(() => null);
    if (q) out.quote = q; else { out.kind = 'news'; out.items = await newsFor(label, topicKey || label, opts); out.note = '환율 소스를 찾지 못해 뉴스로 대체'; }
  } else if (kind === 'stock'){
    const q = await stockQuote(label, { force }).catch(() => null);
    if (q) out.quote = q; else { out.kind = 'news'; out.items = await newsFor(label, topicKey || label, opts); out.note = '종목을 찾지 못해 뉴스로 대체 (예: "삼성전자(005930)")'; }
  } else if (kind === 'weather'){
    out.weather = await cachedInfo('wx:' + cityOf(label), CADENCE.weather, () => weatherFor(label), { force }).then(r => { if (r.stale) r.data.stale = { at: r.at, error: r.error }; return r.data; }).catch(() => null);
    if (!out.weather){ out.kind = 'news'; out.items = await newsFor(label, topicKey || label, opts); out.note = '기상 소스에 연결하지 못해 뉴스로 표시 — 잠시 후 자동 재시도'; }
    else out.cadence = CADENCE.weather;
  } else if (kind === 'sport'){
    const s = await sportsFor(label, force).catch(() => null);
    if (s && (s.discipline === 'motorsport' || s.live || s.next || (s.results || []).length || (s.today || []).length)){
      out.sport = s; out.cadence = s.live ? CADENCE.sportLive : (s.discipline === 'motorsport' ? CADENCE.sport : CADENCE.sport);
    }
    else {
      out.kind = 'news'; out.items = await newsFor(label, topicKey || label, opts);
      out.cadence = CADENCE.news;
      out.note = SPORT_LAST_ERROR === 'rate-limit'
        ? '스포츠 소스(무료)가 잠시 요청을 제한했어요 — 1분 뒤 자동으로 다시 시도하고, 그동안은 뉴스를 표시합니다.'
        : '확인 가능한 리그·팀이 없어 뉴스로 표시합니다 (예: "맨시티 축구", "LA 다저스", "레이커스").';
    }
  }
  return out;
}

/* ================= iCloud(CalDAV) — 읽기 전용 일정 동기화 =================
   자격증명 저장: tools/.livedata/cred.json (로컬 — 이 PC 전용)
   - 모든 캘린더 병합(VEVENT 보유) + 반복 규칙(RRULE) 확장
   - /api/credentials(GET/POST) · /api/events(GET) 로 브라우저/네이티브 공용
*/
function loadCred(){
  try { const j = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'cred.json'), 'utf8')); return j && j.email ? j : null; }
  catch (e) { return null; }
}
/* 설정 저장(일정 표시 스위치 등) — tools/.cache/prefs.json */
const PREFS_FILE = () => path.join(DATA_DIR, 'prefs.json');
function loadPrefs(){
  try { return JSON.parse(fs.readFileSync(PREFS_FILE(), 'utf8')) || {}; } catch (e) { return {}; }
}
function savePrefs(p){
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(PREFS_FILE(), JSON.stringify(p, null, 2), { mode: 0o600 });
}
function saveCred(cred){
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(path.join(DATA_DIR, 'cred.json'), JSON.stringify(cred, null, 2), { mode: 0o600 });
}
function caldavHostFor(target){
  const m = String(target || '').match(/^https?:\/\/[^/]+/);
  return m ? m[0] : 'https://caldav.icloud.com';
}
async function caldavRequest(method, email, pw, target, body, depth){
  const host = caldavHostFor(target);
  const url = target.startsWith('http') ? target : host + target;
  const headers = { Authorization: 'Basic ' + Buffer.from(`${email}:${pw}`).toString('base64'), 'User-Agent': 'BriefingBoard/1.0 (Windows; read-only CalDAV)', 'Content-Type': 'text/xml; charset=utf-8' };
  if (depth) headers.Depth = depth;
  const ctl = AbortSignal.timeout(35000);
  const r = await fetch(url, { method, headers, body: body || undefined, signal: ctl });
  const text = await r.text();
  if (!r.ok) throw new Error(`CalDAV ${method} → HTTP ${r.status}`);
  return text;
}
/* 네임스페이스 프리픽스(d:/c:/cal:) 허용 XML 태그 추출 */
const PX = t => `(?:[A-Za-z0-9_]+:)?${t}`;
function tagMatch(xml, tag){ return new RegExp(`<${PX(tag)}[^>]*>([\\s\\S]*?)<\\/${PX(tag)}>`, 'i').exec(xml); }
function tagAll(xml, tag){
  const out = []; const re = new RegExp(`<${PX(tag)}[^>]*>([\\s\\S]*?)<\\/${PX(tag)}>`, 'gi');
  let m; while ((m = re.exec(xml))) out.push(m[1].trim());
  return out;
}
function firstHref(innerXml){
  const m = tagMatch(innerXml || '', 'href');
  return m ? m[1].trim() : null;
}
function xmlUnescape(s){
  return String(s || '').replace(/<!\[CDATA\[|\]\]>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;|&#39;/g, "'").replace(/&amp;/g, '&');
}
async function discoverCalendars(email, pw){
  const principal = await caldavRequest('PROPFIND', email, pw, '/',
    '<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:current-user-principal/></d:prop></d:propfind>', '0');
  const prHref = firstHref(tagMatch(principal, 'current-user-principal')?.[1]);
  if (!prHref) throw new Error('iCloud 계정 인증/발견 실패(이메일·앱 특수 암호 확인).');
  const home = await caldavRequest('PROPFIND', email, pw, prHref,
    '<?xml version="1.0"?><d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><d:calendar-home-set/></d:prop></d:propfind>', '0');
  const homeHref = firstHref(tagMatch(home, 'calendar-home-set')?.[1]);
  if (!homeHref) return [];
  const list = await caldavRequest('PROPFIND', email, pw, homeHref,
    '<?xml version="1.0"?><d:propfind xmlns:d="DAV:" xmlns:cs="http://calendarserver.org/ns/" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><d:displayname/><c:supported-calendar-component-set/></d:prop></d:propfind>', '1');
  const out = [];
  for (const resp of tagAll(list, 'response')){
    const href = firstHref(resp);
    if (!href) continue;
    if (/\/inbox\/|\/outbox\/|\/notifications\/|\/dropbox\//i.test(href)) continue;
    const disp = (tagMatch(resp, 'displayname')?.[1] || '').trim();
    const compSet = tagMatch(resp, 'supported-calendar-component-set')?.[1] || '';
    const hasVevent = /(?:name|NAME)\s*=\s*"VEVENT"/.test(compSet) || /VEVENT/i.test(compSet);
    if (compSet && !hasVevent) continue;          // 종일메모/할일 전용 캘린더는 제외
    out.push({ href, name: xmlUnescape(disp) || '캘린더' });
  }
  return out;
}
function icsUnfold(text){
  return text.split(/\r?\n/).reduce((acc, line) => {
    if ((line.startsWith(' ') || line.startsWith('\t')) && acc.length) acc[acc.length - 1] += line.slice(1);
    else acc.push(line);
    return acc;
  }, []).join('\n');
}
function parseIcsDateTime(raw){
  const value = raw.trim();
  if (!/^\d{8}(T\d{6}Z?)?$/.test(value)) return null;
  const p = (a, b) => +value.slice(a, b);
  const isDate = value.length === 8;
  const y = p(0, 4), mo = p(4, 6), d = p(6, 8);
  if (isDate) return { dt: new Date(Date.UTC(y, mo - 1, d)), allDay: true };
  return { dt: new Date(Date.UTC(y, mo - 1, d, p(9, 11), p(11, 13))), allDay: false };
}
function icsEvents(ics, calendarName){
  const out = [];
  const blocks = ics.split(/BEGIN:VEVENT/i);
  for (const blk of blocks.slice(1)){
    const cut = blk.indexOf('END:VEVENT');
    const body = icsUnfold(cut >= 0 ? blk.slice(0, cut) : blk);
    const prop = (name) => { const m = body.match(new RegExp('^' + name + '(?:;[^:\\r\\n]*)?:(.*)$', 'mi')); return m ? m[1].trim() : null; };
    const rawStart = (body.match(/^DTSTART(?:;[^:\r\n]*)?:([^\r\n]+)$/mi) || [])[1];
    if (!rawStart) continue;
    const st = parseIcsDateTime(rawStart);
    if (!st) continue;
    const rawEnd = (body.match(/^DTEND(?:;[^:\r\n]*)?:([^\r\n]+)$/mi) || [])[1];
    const en = rawEnd ? parseIcsDateTime(rawEnd) : { dt: new Date(st.dt.getTime() + 3600000), allDay: st.allDay };
    out.push({
      uid: prop('UID') || '', title: prop('SUMMARY') || '(제목 없음)', location: prop('LOCATION') || '',
      st: st.dt.toISOString(), en: (en && en.dt ? en.dt : st.dt).toISOString(),
      allDay: st.allDay || (en ? en.allDay : false),
      rrule: prop('RRULE'), calendar: calendarName,
    });
  }
  return out;
}
function startOfWeekMs(d){ const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())); const dow = (x.getUTCDay() + 6) % 7; x.setUTCDate(x.getUTCDate() - dow); return x.getTime(); }
function expandRRule(ev, from, to){
  if (!ev.rrule) return [ev];
  const parts = {};
  for (const p of ev.rrule.split(';')){ const i = p.indexOf('='); if (i > 0) parts[p.slice(0, i).toUpperCase()] = p.slice(i + 1).toUpperCase(); }
  const freq = parts.FREQ || 'DAILY';
  const interval = Math.max(1, parseInt(parts.INTERVAL, 10) || 1);
  const count = parts.COUNT ? Math.min(parseInt(parts.COUNT, 10) || Infinity, 400) : Infinity;
  const byday = new Set((parts.BYDAY || '').split(',').map(x => x.trim().replace(/^[-+]/, '')).filter(Boolean));
  const until = parts.UNTIL;
  const start = new Date(ev.st);
  const dur = new Date(ev.en).getTime() - start.getTime();
  const limit = until ? new Date(until.endsWith('Z') ? until : until + 'Z') : null;
  const out = [];
  const occ = (s) => { const o = { ...ev, st: s.toISOString(), en: new Date(s.getTime() + dur).toISOString(), recurring: true }; out.push(o); };
  let made = 0;
  if (freq === 'WEEKLY'){
    const anchorWeek = startOfWeekMs(start);
    for (let t = Math.max(from.getTime() - 7 * 86400000, start.getTime()); t <= to.getTime() + 7 * 86400000 && made < count; t += 86400000){
      const d = new Date(t);
      const weekDelta = Math.round((startOfWeekMs(d) - anchorWeek) / (7 * 86400000));
      if (weekDelta < 0 || weekDelta % interval !== 0) continue;
      if (byday.size){
        const wd = ['SU','MO','TU','WE','TH','FR','SA'][d.getUTCDay()];
        if (!byday.has(wd)) continue;
      }
      const s = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), start.getUTCHours(), start.getUTCMinutes()));
      if (s < from || s > to) continue;
      if (limit && s > limit) break;
      occ(s); made++;
    }
  } else if (freq === 'MONTHLY'){
    for (let i = 0; i < 120 && made < count; i++){
      const s = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + i * interval, Math.min(start.getUTCDate(), 28), start.getUTCHours(), start.getUTCMinutes()));
      if (limit && s > limit) break;
      if (s >= from && s <= to){ occ(s); made++; }
    }
  } else { // DAILY
    for (let s = start; s.getTime() <= to.getTime() && made < count; s = new Date(s.getTime() + interval * 86400000)){
      if (limit && s > limit) break;
      if (s >= from){ occ(s); made++; }
    }
  }
  return out;
}
async function fetchTodayEvents(){
  const cred = loadCred();
  if (!cred) return null;
  const now = new Date();
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const to = new Date(from.getTime() + 86400000);
  const p2 = n => String(n).padStart(2, '0');
  const fmt = d => `${d.getUTCFullYear()}${p2(d.getUTCMonth() + 1)}${p2(d.getUTCDate())}T${p2(d.getUTCHours())}${p2(d.getUTCMinutes())}00Z`;
  const reportBody =
    '<?xml version="1.0"?>' +
    '<c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">' +
    '<d:prop><d:getetag/><c:calendar-data/></d:prop>' +
    '<c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="VEVENT">' +
    `<c:time-range start="${fmt(from)}" end="${fmt(to)}"/>` +
    '</c:comp-filter></c:comp-filter></c:filter></c:calendar-query>';
  const calendars = await discoverCalendars(cred.email, cred.password);
  const events = [];
  for (const cal of calendars){
    try {
      const xml = await caldavRequest('REPORT', cred.email, cred.password, cal.href, reportBody, '1');
      for (const raw of tagAll(xml, 'calendar-data')){
        const ics = xmlUnescape(raw);
        for (const ev of icsEvents(ics, cal.name)){
          for (const occ of expandRRule(ev, from, to)){
            if (occ.st < to.toISOString() && occ.en > from.toISOString()) events.push(occ);
          }
        }
      }
    } catch (e) { /* 캘린더별 실패는 무시(부분 병합) */ }
  }
  return events;
}

/* ================= 피드백 → 코드 셀프 패치 엔진 =================
   브라우저의 피드백 칸에서 받은 문장을 tools/patch-engine.js 로 해석해
   src/patches/<id>.js 를 **실제로 쓰고** dist 를 다시 빌드한다. → 새로고침하면 반영.
   GET  /api/feedback/patches   : 적용된 코드 패치 목록
   GET  /api/feedback/patch?id= : 생성된 소스 보기
   POST /api/feedback/plan      : dry-run (어떤 연산자로 해석됐는지)
   POST /api/feedback/apply     : 생성·저장·재빌드
   POST /api/feedback/undo      : {ids:[...]} 삭제·재빌드  |  POST /api/feedback/clear : 전부 되돌리기
   GET  /api/build              : 현재 dist/index.html 해시(화면 자동 갱신 판정용) */
let PE = null, PE_ERR = null;
try { PE = require('./patch-engine.js'); } catch (e) { PE_ERR = String((e && e.message) || e); }
function buildInfo(){
  const fp = path.join(ROOT, 'index.html');
  try {
    const b = fs.readFileSync(fp);
    const st = fs.statSync(fp);
    return { hash: require('crypto').createHash('md5').update(b).digest('hex').slice(0, 12), size: b.length, at: st.mtimeMs };
  } catch (e) { return { hash: null, size: 0, at: 0, error: '빌드 파일이 없어요 — node tools/build.js' }; }
}

/* ================= HTTP 서버 ================= */
const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Max-Age': '86400',
      });
      res.end();
      return;
    }
    const u = new URL(req.url, 'http://x');
    const pathname = decodeURIComponent(u.pathname);
    const q = Object.fromEntries(u.searchParams);
    const sendJson = (code, obj) => { const b = Buffer.from(JSON.stringify(obj)); res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' }); res.end(b); };
    const sendFile = (p) => {
      if (p.endsWith('/')) p += 'index.html';
      const fp = path.join(ROOT, p);
      if (!fp.startsWith(ROOT) || !fs.existsSync(fp)){ res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('404'); return; }
      const b = fs.readFileSync(fp);
      res.writeHead(200, { 'Content-Type': MIME[path.extname(fp)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
      res.end(b);
    };
    const readBody = () => new Promise((resolve) => { let b = ''; req.on('data', c => { b += c; if (b.length > 1e6) req.destroy(); }); req.on('end', () => resolve(b)); });

    if (pathname === '/api/health'){ sendJson(200, { ok: true, live: true, name: 'BriefingBoard Live Server', ts: Date.now() }); return; }

    if (pathname === '/api/prefs'){
      if (req.method === 'POST'){
        const body = JSON.parse((await readBody()) || '{}');
        const prefs = loadPrefs();
        for (const k of ['calendarEnabled','autoStart','topmost','newsPollMinutes','calendarEmail'])
          if (body[k] !== undefined) prefs[k] = body[k];
        savePrefs(prefs);
        sendJson(200, { ok: true, calendarEnabled: !!prefs.calendarEnabled, newsPollMinutes: prefs.newsPollMinutes || 15, calendarEmail: prefs.calendarEmail || null });
        return;
      }
      const p = loadPrefs();
      sendJson(200, { ok: true, calendarEnabled: !!p.calendarEnabled, autoStart: false, topmost: false, newsPollMinutes: p.newsPollMinutes || 15, calendarEmail: p.calendarEmail || null });
      return;
    }

    if (pathname === '/api/credentials'){
      if (req.method === 'POST'){
        const cred = JSON.parse((await readBody()) || '{}');
        if (cred.delete){
          try { fs.unlinkSync(path.join(DATA_DIR, 'cred.json')); } catch (e) {}
          const pr2 = loadPrefs(); pr2.calendarEnabled = false; pr2.calendarEmail = ''; savePrefs(pr2);
          sendJson(200, { ok: true, connected: false }); return;
        }
        const email = String(cred.email || '').trim(), password = String(cred.password || '');
        if (!email || !password){ sendJson(400, { ok: false, error: '이메일과 앱 특수 암호를 입력하세요.' }); return; }
        // 검증: 실제 캘린더 1회 발견 시도
        let discovered = [];
        try { discovered = await discoverCalendars(email, password); }
        catch (e){ sendJson(400, { ok: false, error: '연결 실패 — ' + ((e && e.message) || e) }); return; }
        saveCred({ email, password, calendars: discovered.length, at: new Date().toISOString() });
        const prefs = loadPrefs(); prefs.calendarEnabled = true; prefs.calendarEmail = email;   // 연결되면 일정 표시 자동 ON(네이티브와 동일)
        savePrefs(prefs);
        sendJson(200, { ok: true, connected: true, calendars: discovered.length, email });
        return;
      }
      // GET (probe 포함)
      const cred = loadCred();
      sendJson(200, { ok: true, connected: !!cred, hasPassword: !!cred, email: cred ? cred.email : null, calendars: cred ? cred.calendars : 0 });
      return;
    }

    if (pathname === '/api/events'){
      const cred = loadCred();
      const prefsEv = loadPrefs();
      if (!cred){ sendJson(200, { ok: true, enabled: false, reason: 'not-configured' }); return; }
      if (!prefsEv.calendarEnabled){ sendJson(200, { ok: true, enabled: false, reason: 'disabled' }); return; }
      try {
        const items = await fetchTodayEvents();
        sendJson(200, { ok: true, enabled: true, email: cred.email, items: items || [], ts: Date.now() });
      } catch (e) {
        sendJson(200, { ok: true, enabled: false, reason: 'sync-error', error: String((e && e.message) || e) });
      }
      return;
    }

    if (pathname === '/api/build'){ sendJson(200, Object.assign({ ok: true }, buildInfo())); return; }
    if (!PE){
      if (pathname.startsWith('/api/feedback')){ sendJson(503, { ok: false, error: '패치 엔진을 불러오지 못했어요 — ' + PE_ERR }); return; }
    }
    if (pathname === '/api/feedback/patches'){ sendJson(200, { ok: true, patches: PE.list(), ops: Object.keys(PE.OPS), fields: Object.keys(PE.FIELDS) }); return; }
    if (pathname === '/api/feedback/patch'){ sendJson(200, PE.source(q.id) || { ok: false, error: 'not found' }); return; }
    if (pathname === '/api/feedback/plan' && req.method === 'POST'){
      const body = JSON.parse((await readBody()) || '{}');
      sendJson(200, Object.assign({ ok: true }, PE.plan(String(body.text || ''), body.topics || []))); return;
    }
    if (pathname === '/api/feedback/apply' && req.method === 'POST'){
      const body = JSON.parse((await readBody()) || '{}');
      const text = String(body.text || '').trim();
      if (!text){ sendJson(400, { ok: false, error: 'text required' }); return; }
      const res2 = PE.apply(text, { topics: body.topics || [] });
      const rebuilt = res2.ok ? PE.build() : { skipped: true };
      sendJson(200, Object.assign({ ok: !!res2.ok, request: text, build: rebuilt, rebuild: Object.assign({}, rebuilt, buildInfo()), error: res2.ok ? null : 'no-code' },
        { applied: res2.applied || [], replaced: res2.replaced || [], ambiguous: res2.ambiguous || [], catalog: res2.catalog || [], plan: res2.plan || null }));
      return;
    }
    if (pathname === '/api/feedback/undo' && req.method === 'POST'){
      const body = JSON.parse((await readBody()) || '{}');
      const ids = Array.isArray(body.ids) ? body.ids : (body.id ? [body.id] : []);
      const removed = ids.map(id => ({ id, ok: PE.remove(String(id)) }));
      sendJson(200, { ok: removed.every(r => r.ok), removed, rebuild: Object.assign({}, PE.build(), buildInfo()) }); return;
    }
    if (pathname === '/api/feedback/clear' && req.method === 'POST'){
      PE.clearAll();
      sendJson(200, { ok: true, rebuild: Object.assign({}, PE.build(), buildInfo()) }); return;
    }

    if (pathname === '/api/live/interest'){
      if (!q.label){ sendJson(400, { ok: false, error: 'label required' }); return; }
      const fresh = q.fresh === '1' || q.force === '1';          // 카드의 새로고침 = 실제 재요청(캐시 무력화)
      const seenIds = (q.seen || '').split(',').filter(Boolean);
      const data = await interestResponse(q.label, q.topic, {
        fresh, force: fresh, kind: q.kind,
        exclude: (q.exclude || '').split(',').filter(Boolean), seenIds,
      });
      sendJson(200, Object.assign({ serverTs: Date.now() }, data)); return;
    }
    if (pathname === '/api/live/news'){
      if (!q.label && !q.topic){ sendJson(400, { ok: false, error: 'label or topic required' }); return; }
      const key = q.topic || q.label;
      const label = q.label || key;
      const fresh = q.fresh === '1' || q.force === '1';   // 카드 새로고침·관심없음 → 캐시 무시 + 24h 창
      const exclude = (q.exclude || '').split(',').filter(Boolean);
      const seenIds = (q.seen || '').split(',').filter(Boolean);
      const items = fresh
        ? await newsFor(label, key, { fresh: true, exclude, seenIds })
        : await cached('news:' + key, 45_000, () => newsFor(label, key, { exclude, seenIds }));
      sendJson(200, { ok: true, kind: 'news', topic: key, label, items, ts: Date.now(), cadence: CADENCE.news, noNew: !!(items && items.noNew), fetchedAt: new Date().toISOString() });
      return;
    }

    if (req.method === 'GET'){ sendFile(pathname); return; }
    res.writeHead(405); res.end();
  } catch (e) {
    try { const b = Buffer.from(JSON.stringify({ ok: false, error: String(e && e.message || e) })); res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(b); } catch (err) {}
  }
});
fs.mkdirSync(DATA_DIR, { recursive: true });
server.listen(PORT, '0.0.0.0', () => console.log('[live] http://0.0.0.0:' + PORT + '  root=' + ROOT));
