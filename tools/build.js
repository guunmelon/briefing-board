/* 단일 파일 빌드: src/* -> dist/index.html (오프라인 실행용)
   RSS 스냅샷(src/rss-snapshot.json)이 있으면 window.__RSS_SNAPSHOT__ 로 인라인. */
'use strict';
const fs = require('fs');
const path = require('path');

const src = path.join(__dirname, '..', 'src');
const dist = path.join(__dirname, '..', 'dist');
fs.mkdirSync(dist, { recursive: true });

let html = fs.readFileSync(path.join(src, 'structure.html'), 'utf8');

// 1) 외부 CSS -> 인라인 (함수형 리플레이서)
const css = fs.readFileSync(path.join(src, 'style.css'), 'utf8');
html = html.replace(/<link rel="stylesheet" href="style.css"\/>/, () => `<style>\n${css}\n</style>`);

// 1.5) RSS 스냅샷 인라인 (store.js 보다 앞에)
let snapTag = '';
try {
  const snap = fs.readFileSync(path.join(src, 'rss-snapshot.json'), 'utf8');
  const snapEsc = snap.replace(/<\/script/gi, '<\\/script');
  snapTag = `<script>window.__RSS_SNAPSHOT__=${snapEsc};</script>\n`;
} catch (e) { snapTag = ''; }
html = html.replace('<script src="store.js"></script>', () => snapTag + '<script src="store.js"></script>');

// 1.8) 자동 생성된 코드 패치(src/patches/*.js) 인라인 — 피드백 엔진의 결과가 코드로서 빌드에 반영된다
let patchTag = '';
try {
  const dir = path.join(src, 'patches');
  const ix = JSON.parse(fs.readFileSync(path.join(dir, 'index.json'), 'utf8'));
  const files = (ix.patches || []).map(p => p.file).filter(Boolean);
  patchTag = files.map(f => {
    const code = fs.readFileSync(path.join(dir, f), 'utf8');
    return `<script>\n${code.replace(/<\/script/gi, '<\\/script')}\n</script>`;
  }).join('\n');
} catch (e) { patchTag = ''; }
html = html.replace('<!--PATCHES-->\n', () => patchTag + '\n');
html = html.replace('<!--PATCHES-->', () => patchTag);

// 2) 외부 스크립트 -> 인라인 (함수형 리플레이서 사용)
for (const f of ['store.js', 'patch-runtime.js', 'data.js', 'logic.js', 'app.js', 'host.js']) {
  const js = fs.readFileSync(path.join(src, f), 'utf8');
  html = html.replace(new RegExp(`<script src="${f}"></script>`), () => `<script>\n${js}\n</script>`);
}

// 남은 외부 참조 확인
const leftovers = html.match(/<(?:link|script)\s+[^>]*(?:href|src)="[^"]*\.(?:css|js)"/g) || [];
if (leftovers.length) { console.warn('외부 참조가 남았습니다:', leftovers); process.exit(1); }

const out = path.join(dist, 'index.html');
fs.writeFileSync(out, html);
console.log(`built ${out} (${(html.length/1024).toFixed(1)} KB)`);
