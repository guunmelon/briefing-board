/* ============================================================
   PATCH RUNTIME — 자동 생성된 코드 패치(src/patches/*.js)를 실행하는 훅
   ------------------------------------------------------------
   · 피드백 엔진(tools/patch-engine.js)이 생성한 코드는 이 런타임의 register() 만 호출한다.
   · 렌더 데이터(payload)와 렌더 HTML 두 지점에 훅을 제공한다.
   · 패치 하나를 못 읽어board가 깨지면 안 된다 → 모든 fn은 try/catch, 실패는 errors 에 남기고 원본을 유지.
   ============================================================ */
(function (global) {
  'use strict';

  const R = { list: [], errors: [], cssDone: false };

  /* ---------- 생성된 코드가 쓰는 공통 헬퍼 ---------- */
  const H = {
    esc(s){ return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); },
    num(v){
      if (v == null || isNaN(v)) return null;
      const n = Number(v);
      return Math.abs(n) >= 1000 ? Math.round(n).toLocaleString('ko-KR') : (Math.round(n * 10) / 10).toLocaleString('ko-KR');
    },
    money(v){ if (v == null || isNaN(v)) return null; const n = Number(v); return n >= 1e8 ? (n / 1e8).toFixed(1).replace(/\.0$/, '') + '억' : n.toLocaleString('ko-KR'); },
    fx(v){ return v == null || isNaN(v) ? null : Number(v).toLocaleString('ko-KR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); },
    /* 대기질 등급 — 환경부/US AQI 구분(판정표는 코드에 인라인으로 남긴다) */
    pmGrade(v){ return v >= 150 ? '매우 나쁨' : v >= 80 ? '나쁨' : v >= 30 ? '보통' : '좋음'; },
    aqiGrade(v){ return v >= 200 ? '매우 나쁨' : v >= 150 ? '나쁨' : v >= 100 ? '민감군 나쁨' : v >= 50 ? '보통' : '좋음'; },
    line(k, v){
      if (v == null || v === '') return '';
      return `<div class="minirow"><span class="k">${H.esc(k)}</span><span class="v">${typeof v === 'number' ? H.num(v) : H.esc(v)}</span></div>`;
    },
    spark(vals, h, color){
      const D = global.Data;
      if (!D || !D.$U || !Array.isArray(vals) || vals.length < 2) return '';
      return D.$U.sparkSvg(vals, 26, h, color || '#38bdf8', color || '#38bdf8', 'bpspark' + Math.round(vals.length * 7 + h));
    },
    shortWhen(w){
      const s = String(w || '');
      return s.replace(/\s*\(.+?\)\s*/, ' ').trim().slice(0, 12);
    },
  };

  /* ---------- 매칭 ---------- */
  /* 스코프: 'tile'(관심사 카드·기본) · 'strip'(오늘 일정 위젯의 날씨 줄) · 'brief'(뉴스레터 카드).
     스코프를 밝히지 않은 패치는 카드·스트립 양쪽에 적용되고 뉴스레터는 명시한 경우에만 적용된다. */
  function matches(target, topic, payload, scope){
    scope = scope || 'tile';
    if (target && target.scope && target.scope !== scope) return false;
    if (!target.scope && scope === 'brief') return false;          // 위치를 안 밝힌 요청은 카드·스트립에만
    if (scope === 'strip' && target.tid) return false;              // 스트립은 특정 카드 지정과 무관
    if (!target.kind && !target.tid) return true;
    if (target.tid && String(topic && topic.id) === String(target.tid)) return true;
    const tk = (topic && topic.kind) || (payload && payload.kind);
    if (scope === 'strip' && target.kind === 'weather') return true;   // 오늘 위젯의 날씨 줄 = 날씨 데이터
    return !!target.kind && tk === target.kind;
  }


  /* ---------- 스타일 주입(css 필드) ---------- */
  function injectCss(){
    if (R.cssDone) return;
    const css = R.list.filter(p => p.css).map(p => `/* ${p.id} */\n${p.css}`).join('\n');
    if (css && global.document && global.document.head){
      const st = global.document.createElement('style');
      st.id = 'bpStyles'; st.textContent = css;
      global.document.head.appendChild(st);
      R.cssDone = true;
    }
  }
  function bump(){
    const doc = global.document;
    if (!doc) return;
    const box = doc.getElementById && doc.getElementById('bpStyles');
    if (box){ R.cssDone = false; box.remove(); injectCss(); }
  }

  function register(p){
    if (!p || !p.id || typeof p.html !== 'function' && typeof p.data !== 'function' && !p.css) return;
    const i = R.list.findIndex(x => x.id === p.id);
    if (i >= 0) R.list.splice(i, 1, p); else R.list.push(p);
    R.cssDone = false; injectCss();
  }

  /* ---------- 데이터 훅(payload → payload) ---------- */
  function applyData(topic, payload, scope){
    if (!payload) return payload;
    let out = payload;
    for (const p of R.list){
      if (typeof p.data !== 'function' || !matches(p.target, topic, out, scope)) continue;
      try { const r = p.data({ payload: out, topic, scope: scope || 'tile', kind: (topic && topic.kind) || out.kind, h: H, now: Date.now() }); if (r) out = r; }
      catch (e){ R.errors.push({ id: p.id, where: 'data', msg: String((e && e.message) || e) }); }
    }
    return out;
  }
  /* ---------- 렌더 훅(html → html) ---------- */
  function applyHtml(topic, payload, html, scope){
    let out = html;
    for (const p of R.list){
      if (typeof p.html !== 'function' || !matches(p.target, topic, payload, scope)) continue;
      try { const r = p.html({ html: out, payload, topic, scope: scope || 'tile', kind: (topic && topic.kind) || (payload && payload.kind), h: H, now: Date.now() }); if (typeof r === 'string') out = r; }
      catch (e){ R.errors.push({ id: p.id, where: 'html', msg: String((e && e.message) || e) }); }
    }
    return out;
  }

  global.BPatch = {
    version: 1,
    register, applyData, applyHtml, bump,
    helpers: H,
    count(){ return R.list.length; },
    errors(){ return R.errors.slice(-6); },
    list(){ return R.list.map(p => ({ id: p.id, title: p.title || p.id, kind: (p.target && p.target.kind) || null, tid: (p.target && p.target.tid) || null, scope: (p.target && p.target.scope) || null, hasData: typeof p.data === 'function', hasHtml: typeof p.html === 'function', hasCss: !!p.css })); },
  };
})(window);
