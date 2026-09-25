/* ============================================================
   Store — 로컬 저장 추상화
   - 데모(브라우저 파일)에서는 localStorage
   - 실제 Windows 위젯 앱에서는 이 계층을 파일/전역 스토리지로 교체
   (또는 아래 FORCE_DEFAULTS=true 로 두면 항상 초기 시드로 시작)
   ============================================================ */
(function (global) {
  'use strict';

  const KEY = 'aibrief.board.v3';   // v3: 실데이터 우선(가짜 시드 제거) — 데모 모드 OFF 기본, 취향(good!) 저장
  const FORCE_DEFAULTS = false; // true 로 바꾸면 매번 기본 상태로 시작(개발용)

  const defaults = {
    version: 1,
    userName: '민준',               // 휴대폰 연락처에 표시된 사용자 이름
    timeFormat: '12',
    autoTheme: true,
    demoMode: false,                // 기본 OFF — 실데이터 우선. 켜면 데모 시드 일정/숫자 미리보기
    themeOverride: null,            // 'light' | 'dark' | null(auto)
    layout: 'today-hero',           // AI가 정한 위젯 배치
    topicFocus: 'KR',               // 뉴스 검색 국가
    topics: [],
    aiCfg: {},                      // 위젯별 사용자 확정 설정 {topicId:{...}}
    boardPos: null,                 // 창 위치
    boardSize: null,                // 창 크기
    latestTopicEditor: [],          // 마지막 AI 토픽 에디터 스냅샷(되돌리기용)
    lastFeedback: null,
    readIds: [],                   // good! 로 읽은 기사 키(tid|id) — 같은 관심사의 다음 뉴시를 부르는 기준
  };

  function loadRaw() {
    try {
      const s = localStorage.getItem(KEY);
      return s ? JSON.parse(s) : null;
    } catch (e) { return null; }
  }

  global.BStore = {
    KEY: KEY,
    FORCE_DEFAULTS: FORCE_DEFAULTS,

    load() {
      const raw = loadRaw();
      if (FORCE_DEFAULTS || !raw) return JSON.parse(JSON.stringify(defaults));
      const d = JSON.parse(JSON.stringify(defaults));
      return Object.assign(d, raw, { version: 1 });
    },

    save(state) {
      try { localStorage.setItem(KEY, JSON.stringify(state)); }
      catch (e) { /* 데모 제약 무시 */ }
    },

    reset() { try { localStorage.removeItem(KEY); } catch (e) {} },

    clone(state) { return JSON.parse(JSON.stringify(state)); },
  };
})(window);
