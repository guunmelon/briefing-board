/* 브라우저(단일파일 dist) 오프라인 스모크테스트 — jsdom
   - 미니 서버가 없는 환경(file:// / 순수 jsdom)에서:
     가짜 숫자 없이 연결 안내/스켈레톤만 보이는지, 핵심 UI 흐름이 에러 없이 도는지
   실행: node tools/test-dom.js  (npm test 포함) — dist 빌드 후 실행할 것
*/
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const html = fs.readFileSync(path.join(__dirname, '..', 'dist', 'index.html'), 'utf8');
let pass = 0;
function assert(name, cond, extra) {
  console.log('  ' + (cond ? '✓ ' : '✗ ') + name + (cond ? '' : (extra ? '  → ' + extra : '')));
  if (!cond) process.exitCode = 1;
  if (cond) pass++;
}
const wait = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => errors.push(String(e.message || e)));
  vc.on('error', (...a) => errors.push('console.error: ' + a.join(' ')));

  const dom = new JSDOM(html, {
    url: 'http://localhost:9/',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    virtualConsole: vc,
    beforeParse(w) {
      // 오프라인 시뮬레이션 — fetch 없음 → 연결 안내 상태
      w.__TEST_OFFLINE__ = true;
      if (!w.AbortController) w.AbortController = globalThis.AbortController;
    },
  });
  const w = dom.window, d = w.document;
  await wait(1500);

  assert('부팅 에러 없음', errors.length === 0, errors.join(' | '));
  assert('기본 관심사 타일 4개', d.querySelectorAll('.tile').length === 4, String(d.querySelectorAll('.tile').length));
  const tiles = [...d.querySelectorAll('.tile')];
  assert('offline 타일 = 연결 안내(가짜 숫자 금지)', tiles.every(x => x.textContent.includes('연결 필요')), tiles.map(x => x.textContent.slice(0, 30)).join());
  assert('브리핑 레일 = 실시간 연결 안내 패널', /연결돼 있지 않아요/.test(d.querySelector('#briefRail').textContent || ''));
  assert('날씨 칩 = 서울 · 실시간 연결 필요(숫자 없음)', /서울 · 실시간 연결 필요/.test(d.querySelector('#wxChip').textContent || ''));
  assert('topicCount = 4', d.querySelector('#topicCount').textContent === '4');

  // 관리창 → 관심사 추가(걷기=개인) 에디터 흐름
  d.querySelector('#btnTopicsManage').click();
  await wait(200);
  assert('관리창 열림', !!d.querySelector('.modal') && (d.querySelector('.modal .t').textContent || '').includes('관심사 관리'));
  const rows = d.querySelectorAll('.rowset .rowitem').length;
  assert('관리창 행 = 4', rows === 4, String(rows));
  const inp = d.querySelector('#mqLabel');
  inp.value = '걷기';
  d.querySelector('#mqAdd').click();
  await wait(250);
  const kindOn = [...(d.querySelectorAll('#tpKind button') || [])].find(b => b.classList.contains('on'));
  assert('AI 분류: 걷기 → 개인 상태', kindOn && /개인 상태/.test(kindOn.textContent || ''), kindOn && kindOn.textContent);
  assert('시안 버튼 3종(a·b·c)', d.querySelectorAll('#tpTpls .tpl-pick').length === 3);
  const preview = d.querySelector('#tpPreview');
  assert('미리보기(개인) = 연결 안내, 가짜 수치 없음', !!preview && /연결|연동/.test(preview.textContent || ''), preview && preview.textContent.replace(/\s+/g, ' ').slice(0, 80));
  // 취소 후 다시 관리창
  const close = d.querySelector('#modalBox [data-c], .modal .m-close');
  if (close) close.click();
  await wait(150);

  // 설정 열기/닫기
  d.querySelector('#btnSettings').click();
  await wait(200);
  assert('설정 모달 열림', !!d.querySelector('#modalBox') && (d.querySelector('.modal .t').textContent || '').includes('설정'));
  assert('데모 시뮬레이션 행 제거됨', !(d.querySelector('#modalBox .m-body').textContent || '').includes('데모 시뮬레이션'));
  d.querySelector('#modalBox .m-close').click();
  await wait(150);

  // 피드백 키워드: 스케일 증가 → 되돌리기 바 노출 (오프라인 규칙 실행)
  const fb = d.querySelector('#fbInput');
  fb.value = '글자 크게 해줘';
  d.querySelector('#fbSend').click();
  await wait(1600);
  assert('피드백(글자 크게) → 변경 적용(undo 바)', d.querySelector('#undoChip').classList.contains('show'));
  // 위젯 세로 크기 조절 시 하단 뉴스 위젯 밀림 및 겹침 방지 검증
  const wt = d.querySelector('.wd[data-w="topics"]');
  const wn = d.querySelector('.wd[data-w="news"]');
  assert('관심사 & 뉴스레터 위젯 존재', !!wt && !!wn);
  d.querySelector('#btnTopicsHeight').click();
  await wait(200);
  assert('관심사 높이 확장 시 wt.style.height 설정됨', wt.style.height === '520px', wt.style.height);
  const gridCS = w.getComputedStyle(d.querySelector('#grid'));
  assert('그리드 행 템플릿 auto auto (겹침 없이 아래로 밀림)', !/minmax\(0,\s*0?\.\d+fr\)/.test(gridCS.gridTemplateRows), gridCS.gridTemplateRows);

  // 아이폰 스타일 드래그 앤 드롭 핸들 및 관리창 드래그 핸들 검증
  const handles = d.querySelectorAll('.tile .tile-drag-handle');
  assert('관심사 타일 드래그 핸들 존재 (4개)', handles.length === 4, String(handles.length));
  d.querySelector('#btnTopicsManage').click();
  await wait(200);
  const rowHandles = d.querySelectorAll('#modalBox .rowitem .row-drag-handle');
  assert('관심사 관리창 행 드래그 핸들 존재 (4개)', rowHandles.length === 4, String(rowHandles.length));
  const modalClose = d.querySelector('#modalBox .m-close, #modalBox [data-c]');
  if (modalClose) modalClose.click();
  await wait(150);

  // GitHub Pages 정적 호스팅 무결성 검증 (외부 의존성 제로 & 단일 파일 번들)
  assert('GitHub Pages 번들: 인라인 CSS 및 자바스크립트 내장', html.includes('<style>') && html.includes('<script>'));
  assert('GitHub Pages 번들: 외부 CDN 링크 태그 없음 (차단 방지)', !/<link[^>]+rel=["']stylesheet["'][^>]+href=["']https?:/i.test(html));
  assert('GitHub Pages 번들: 단일 배포 파일 용량 건전 (100KB~1MB)', html.length > 100000 && html.length < 1000000, String(html.length) + ' bytes');

  assert('에러 누적 없음', errors.length === 0, errors.join(' | '));

  dom.window.close();
  console.log(`\nRESULT: ${pass} passed`);
  process.exit(process.exitCode || 0);
})();
