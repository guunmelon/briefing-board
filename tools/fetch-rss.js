/* RSS 스냅샷 생성기 v8 (하이브리드) — 실제 소스에서 가져와 src/rss-snapshot.json 생성
   실행: node tools/fetch-rss.js
   정책:
   - 관심사(맨시티·비트코인·마인크래프트·조류) = "사진을 RSS에 싣는" 매체 피드 우선 수집
     (실기사 대표 사진이 카드에 보이도록) → 부족분은 Google 뉴스 검색으로 보강.
   - The Economist 글로벌 풀(econ-*) = 섹션 RSS(사진은 이 환경에서 403이라 폴백).
   데모/오프라인용 스냅샷. 네이티브 앱은 같은 주제를 실시간 수집 + 원문 og:image 채움으로 처리.
*/
'use strict';
const fs = require('fs');
const path = require('path');
const https = require('https');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

/* ---------- HTTP ---------- */
function get(url, timeout = 12000, redirects = 4){
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request({ hostname: u.hostname, path: u.pathname + u.search,
      method: 'GET', headers: { 'User-Agent': UA, 'Accept': 'application/rss+xml, application/xml, text/xml, */*' } }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects > 0){
        res.resume();
        resolve(get(new URL(res.headers.location, url).href, timeout, redirects - 1));
        return;
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.setTimeout(timeout, () => { req.destroy(new Error('timeout')); });
    req.end();
  });
}
const clean = s => String(s || '').replace(/<!\[CDATA\[|\]\]>/g, '').replace(/<[^>]*>/g, ' ')
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&#\d+;/g, ' ').replace(/\s+/g, ' ').trim();

function imgFromXml(itemXml){
  // media:thumbnail(선호) → media:content → enclosure → <img src> 순으로 첫 사진
  const cand =
    itemXml.match(/<media:thumbnail[^>]+url="([^"]+)"/i) ||
    itemXml.match(/<media:content[^>]+url="([^"]+)"/i) ||
    itemXml.match(/<enclosure[^>]+url="([^"]+)"/i) ||
    itemXml.match(/<img[^>]+src="([^"]+)"/i) ||
    itemXml.match(/<media:thumbnail[^>]+url='([^']+)'/i);
  return cand ? cand[1].replace(/&amp;/g, '&').trim() : null;
}

function parseItems(xml, fallbackSrc){
  const out = [];
  const ch = ((xml.match(/<channel>([\s\S]*)<\/channel>/i) || [])[1]) || xml;
  const feedTitle = clean((ch.match(/<title>\s*([\s\S]*?)\s*<\/title>/i) || [])[1]);
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
    // BBC 팀 피드처럼 <title>이 팀명(일반명)뿐일 때 desc 첫 문장을 제목으로 승격
    if (title.length < 12 && desc){
      const d = clean(desc);
      if (d && d.length > title.length && !title.startsWith(d)) title = d.slice(0, 150) || title;
    }
    // Google 뉴스: 제목 끝 ' - 언론사' 와 source 중복 제거
    let title2 = title;
    if (src && title2.endsWith(' - ' + src)) title2 = title2.slice(0, -(src.length + 3)).trim();
    const img = imgFromXml(it);
    out.push({ title: title2, link, pub, src, desc, img });
  }
  return out;
}

function gnewsUrl(q, hl, gl){
  const ceid = hl === 'ko' ? 'KR:ko' : 'US:en';
  return `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=${hl}&gl=${gl}&ceid=${ceid}`;
}

/* ---------- 원문 og:image/og:description 시도 (이미지 없는 기사 폴백 보강) ---------- */
function firstOf(regex, html){ const m = regex.exec(html); return m && m[1] ? m[1].trim().replace(/&amp;/g,'&') : null; }
async function getPage(u, timeout = 8000, maxBytes = 2_500_000, redirects = 4){
  return new Promise((resolve) => {
    const url = new URL(u);
    const req = https.request({ hostname: url.hostname, path: url.pathname + url.search,
      method: 'GET',
      headers: {
        'User-Agent': UA,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'ko,en;q=0.8',
        'Referer': url.origin + '/',
      } }, res => {
      if (!res.statusCode) { resolve(null); return; }
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects > 0){
        res.resume();
        resolve(getPage(new URL(res.headers.location, u).href, timeout, maxBytes, redirects - 1));
        return;
      }
      if (res.statusCode >= 400){ resolve(null); return; }
      const chunks = []; let total = 0;
      res.on('data', c => { total += c.length; if (total <= maxBytes) chunks.push(c); });
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    });
    req.on('error', () => resolve(null));
    req.setTimeout(timeout, () => { req.destroy(); resolve(null); });
    req.end();
  });
}
async function googleFinalUrl(u){
  const html = await getPage(u, 7000, 3_000_000);
  if (!html) return null;
  const ogUrl  = firstOf(/<meta[^>]+property=["']og:url["'][^>]+content=["']([^"']+)["']/i, html);
  const canon  = firstOf(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i, html);
  const dataAu = firstOf(/data-n-au=["']([^"']+)["']/i, html);
  for (const c of [ogUrl, canon, dataAu]){
    if (c && /^https?:\/\//i.test(c) && !/news\.google\.com/i.test(c)) return c;
  }
  return null;
}
async function ogMetaOf(articleUrl){
  const html = await getPage(articleUrl);
  if (!html) return null;
  const img = firstOf(/<meta[^>]+property=["'](?:og:image|twitter:image)["'][^>]+content=["']([^"']+)["']/i, html)
    || firstOf(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["'](?:og:image|twitter:image)["']/i, html)
    || firstOf(/<link[^>]+rel=["']image_src["'][^>]+href=["']([^"']+)["']/i, html);
  const desc = firstOf(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i, html)
    || firstOf(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i, html);
  const abs = rel => { try { return new URL(rel, articleUrl).href; } catch (e) { return null; } };
  return { img: img ? (abs(img) || img) : null, desc: desc ? clean(desc).slice(0, 260) : null };
}

async function fetchTopicGroup(grp){
  /* grp = { key, google:{q,hl,gl,take}, media:[{url,src,filter:(item)=>bool, brand?}], take } */
  const out = [];
  const seen = new Set();
  const pushItem = it => {
    const sig = (it.title || '').toLowerCase().replace(/\s+/g, ' ').slice(0, 60);
    if (!sig || seen.has(sig)) return;
    seen.add(sig);
    out.push(it);
  };
  // 1) 사진 포함 매체 피드 (최신순 → 키워드 필터 → 토픽 상한)
  for (const feed of (grp.media || [])){
    try {
      const { status, body } = await get(feed.url);
      if (status !== 200) { grp.status.push(feed.url + ' HTTP ' + status); continue; }
      const items = parseItems(body, feed.src || 'RSS')
        .sort((a, b) => Date.parse(b.pub) - Date.parse(a.pub))   // 최신 먼저
        .filter(feed.filter || (() => true));
      for (const it of items){ pushItem(it); if (out.length >= grp.take) break; }
      if (out.length >= grp.take) break;
    } catch (e){ grp.status.push(String(e.message || e).slice(0, 60)); }
    await sleep(400);
  }
  // 2) 부족분: Google 뉴스 (주제 정합성 보강, 사진은 없음 → 뒤쪽 배치)
  if (out.length < grp.take && grp.google){
    try {
      const { status, body } = await get(gnewsUrl(grp.google.q, grp.google.hl, grp.google.gl));
      if (status === 200){
        const JUNK = /^(YouTube|Facebook|TikTok|Instagram|Twitter|Reddit|Mshale)$/i;
        for (const it of parseItems(body, 'Google 뉴스')){
          if (JUNK.test(it.src)) continue;   // 유튜브 채널/클립·SNS 재게시 노이즈
          pushItem(it); if (out.length >= grp.take) break;
        }
      } else grp.status.push('google HTTP ' + status);
    } catch (e){ grp.status.push('google ' + String(e.message || e).slice(0, 40)); }
  }
  // 매체 사진 기사가 앞(headline)으로 오도록 정렬(같은 토픽 내)
  out.sort((a, b) => (b.img ? 1 : 0) - (a.img ? 1 : 0) || Date.parse(b.pub) - Date.parse(a.pub));
  return out.slice(0, grp.take);
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ---------- 토픽 구성 (하이브리드) ---------- */
const GUARDIAN_FOOTBALL = 'https://www.theguardian.com/football/rss';
const TOPIC_GROUPS = [
  {
    key: 'mancity', take: 6,
    media: [
      { url: GUARDIAN_FOOTBALL, src: 'The Guardian',
        filter: it => /manchester city|man city/i.test(it.title) },
    ],
    google: { q: '(맨체스터 시티 OR 맨시티 OR MCFC) when:3d', hl: 'ko', gl: 'KR' },
  },
  {
    key: 'bitcoin', take: 6,
    media: [
      { url: 'https://cointelegraph.com/rss', src: 'CoinTelegraph',
        filter: it => /bitcoin|btc/i.test(it.title + ' ' + it.desc) },
    ],
    google: { q: '(비트코인 OR "비트코인 가격") when:2d', hl: 'ko', gl: 'KR' },
  },
  {
    key: 'minecraft', take: 6,
    media: [
      { url: 'https://www.eurogamer.net/feed', src: 'Eurogamer',
        filter: it => /minecraft|마인크래프트/i.test(it.title) },
      { url: 'https://www.pcgamer.com/rss/', src: 'PC Gamer',
        filter: it => /minecraft|마인크래프트/i.test(it.title) },
      { url: 'https://www.pcgamesn.com/feed', src: 'PCGamesN',
        filter: it => /minecraft|마인크래프트/i.test(it.title) },
    ],
    google: { q: '(Minecraft OR 마인크래프트 OR Mojang) when:7d -\"Mike Tomlin\" -Steelers', hl: 'en', gl: 'US' },
  },
  {
    key: 'birds', take: 6,
    media: [
      { url: 'https://www.birdwatchingdaily.com/feed/', src: 'BirdWatching Daily',
        filter: it => /bird|birding|migration|ornitholog|species|nest|owl|hawk|warbler|cardinal|woodpecker|goldfinch/i.test(it.title) },
    ],
    google: { q: '(birding OR birdwatching OR ornithology OR wild birds) when:7d', hl: 'en', gl: 'US' },
  },
];

const ECONOMIST = [
  { key: 'econ-business',  sec: 'business' },
  { key: 'econ-science',   sec: 'science-and-technology' },
  { key: 'econ-techq',     sec: 'technology-quarterly' },
  { key: 'econ-leaders',   sec: 'leaders' },
];

(async () => {
  const result = { generated: new Date().toISOString(), sources: [], topics: {}, feeds: {}, items: [] };

  for (const grp of TOPIC_GROUPS){
    grp.status = [];
    const items = await fetchTopicGroup(grp);
    items.forEach(it => result.items.push({ ...it, topic: grp.key, kind: 'rss' }));
    result.feeds['hybrid:' + grp.key] = { ok: items.length > 0, count: items.length, notes: grp.status.slice(0, 3) };
    await sleep(500);
  }

  for (const e of ECONOMIST){
    try {
      const { status, body } = await get('https://www.economist.com/' + e.sec + '/rss.xml');
      if (status !== 200) throw new Error('HTTP ' + status);
      const items = parseItems(body, 'The Economist')
        .sort((a, b) => Date.parse(b.pub) - Date.parse(a.pub)).slice(0, 3);
      result.items.push(...items.map(it => ({ ...it, topic: e.key, kind: 'rss' })));
      result.feeds['economist:' + e.sec] = { ok: true, count: items.length };
    } catch (err){
      result.feeds['economist:' + e.sec] = { ok: false, err: String(err.message || err).slice(0, 60) };
    }
    await sleep(500);
  }

  /* 사진 없는 항목 폴백: 원문 og:image 시도 (Economist 는 이 환경에서 403 → 건너뜀) */
  const econHosts = /economist\.com/i;
  const imageless = [];
  result.items.forEach((it, i) => { if (!it.img && !econHosts.test(it.link)) imageless.push(i); });
  const gFirst = {}, gRest = [];
  imageless.forEach(i => { const k = result.items[i].topic; if (!gFirst[k]) gFirst[k] = i; else gRest.push(i); });
  const order = Object.values(gFirst).concat(gRest).slice(0, 14);
  for (let i = 0; i < order.length; i += 3){
    await Promise.all(order.slice(i, i + 3).map(async (idx) => {
      const it = result.items[idx];
      try {
        let target = it.link;
        let googleFallback = false;
        if (/news\.google\.com\/rss\/articles/i.test(target)){
          const fin = await googleFinalUrl(target);
          if (fin) target = fin; else googleFallback = true;
        }
        if (!/^https?:/i.test(target)) return;
        const meta = await ogMetaOf(target);
        if (!meta) return;
        // 최종 원문이 안 풀린 구글 리다이렉트는 '전 기사 공통 기본 썸네일/범용 desc'만 있어 대표 이미지로 쓰지 않는다
        if (googleFallback) return;
        if (meta.img) it.img = meta.img;
        if (!meta.desc || /Google 뉴스|종합한/.test(meta.desc)) return;
        const d = String(it.desc || '');
        const linkOnly = !d.replace(/<[^>]*>/g, ' ').replace(/https?:\/\/\S+/g, '').replace(/\s+/g, '');
        if (linkOnly || d.length < 12) it.desc = meta.desc;
      } catch (e) { /* 개별 실패 무시 */ }
    }));
    if (i > 0 && i % 9 === 0) await sleep(300);
  }

  /* 토픽별 사진 기사가 앞에 오도록 재정렬 (보존: 토픽 순서 그룹 유지) */
  const byTopic = {};
  result.items.forEach(it => (byTopic[it.topic] = byTopic[it.topic] || []).push(it));
  const finalItems = [];
  for (const it of result.items){
    if (!byTopic[it.topic]) continue;
    const arr = byTopic[it.topic];
    arr.sort((a, b) => (b.img ? 1 : 0) - (a.img ? 1 : 0));
    finalItems.push(...arr);
    delete byTopic[it.topic];
  }
  result.items = finalItems;

  fs.writeFileSync(path.join(__dirname, '..', 'src', 'rss-snapshot.json'), JSON.stringify(result, null, 1));
  console.log('items:', result.items.length);
  const g = {};
  result.items.forEach(it => (g[it.topic + (it.img ? '*' : '')] = (g[it.topic + (it.img ? '*' : '')] || 0) + 1));
  console.log('topics:', JSON.stringify(g));
  for (const k of Object.keys(result.feeds)) console.log(' ', k, JSON.stringify(result.feeds[k]));
})().catch(e => { console.error(e); process.exit(1); });
