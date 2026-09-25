# 브리핑 보드 — 실서비스 구현 설계서 (WebView2 위젯)

> 버전: v1 설계 확정안 + 구현 진행 반영(2026-09-08)
> 이 문서는 프로토타입(v4)이 데스크톱 위젯으로 전환될 때의 **아키텍처·화면·데이터·일정·뉴스** 설계를 확정한다.
> 구현은 `native/` 에서 진행 중 — 현재 상태는 **§7 구현 현황(2026-09-08)** 참조(섹션 0~6은 설계 기준).

---

## 0. 사용자 확정 사항 (이 문서의 입력)

| 항목 | 결정 |
|---|---|
| 실행 형태 (③) | **WebView2 네이티브**(MSIX 패키지). Windows 10/11 기본 엔진 사용 → 설치본 수 MB |
| iCloud 일정 (②) | **읽기 전용 동기화** — iCloud 캘린더 일정을 보드에 표시. 추가/수정은 기존 캘린더 앱에서 |
| 뉴스 수집 (①) | **앱 안에서 내장 폴링** — 이 PC에서 단독 실행, 외부 서버 없음 |
| 산출 수준 | 구현 설계서 먼저, 구현은 다음 턴 |

유지 원칙 (기존 UI 지시): 관심사 현황=숫자 카드 / 브리핑=가로 레일 뉴스카드(사진 포함) / 피드백=확장 챗바 / 뉴스="편집자가 고르는" 컨셉 / 일정 UI=iCloud 기준 / 관심없음 시 편집자가 대체 소식 제공.

---

## 1. 실행 아키텍처 개요

### 1.1 구성 요소

```
┌────────────────────────────────────────────────────────────┐
│  Windows 10/11                                              │
│                                                             │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  Host App (.NET 8, WPF, MSIX 패키지)                 │   │
│  │  ┌───────────────────┐   ┌────────────────────────┐  │   │
│  │  │ News Fetcher      │   │ iCloud CalDAV Client   │  │   │
│  │  │ (RSS 폴링+og:image│   │ (읽기 전용 동기화)       │  │   │
│  │  │  스크랩·디스크 캐시)│   │ (폴링·ETag 증분 캐시)   │  │   │
│  │  └────────┬──────────┘   └──────────┬─────────────┘  │   │
│  │           └──── JSON push ──────────┘                │   │
│  │                    ▼                                 │   │
│  │  ┌───────────────────────────────────────────────┐   │   │
│  │  │ WebView2 Core (Chromium)                      │   │   │
│  │  │  · 현재 dist/index.html (단일 파일 UI) 그대로   │   │   │
│  │  │  · window.__bridge__ 로 Host와 통신             │   │   │
│  │  │  · position/size/zoom 저장 → Host에 위임        │   │   │
│  │  └───────────────────────────────────────────────┘   │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                             │
│  저장: %LOCALAPPDATA%\BriefingBoard\ (상태·뉴스캐시·이미지)     │
│  인증: Windows Credential Manager (iCloud 앱 특수 암호)        │
└─────────────────────────────────────────────────────────────┘
```

### 1.2 선택 근거

- **WebView2 vs Electron**: 이미 만들어진 단일 HTML/CSS/JS를 거의 그대로 재사용 가능 + 설치본이 수 MB(WebView2 런타임은 Win10/11 대부분 기본 탑재). Electron(≈200MB)은 개인용 바탕화면 위젯에 과함.
- **호스트에서 뉴스/CalDAV를 처리**: 렌더러(웹)는 CORS·인증 저장에 부적합. 호스트가 네트워크·인증·파일을 전담하고, 완성된 JSON을 렌더러에 push → UI 로직(큐레이션·피드백)은 지금 코드를 그대로 유지.

### 1.3 창(Window) 동작 — "바탕화면 위젯" 요구

| 요구 | 구현 |
|---|---|
| 테두리 없는 글라스 위젯 | `WindowStyle=None`, `AllowsTransparency=true`, WebView2 `DefaultBackgroundColor=Transparent` + UI의 반투명 CSS 유지 |
| 항상 위 / 바탕화면 위젯 느낌 | `Topmost=true` (토글: 고정/해제), 설정에 "다른 창에 가려도 위에" 스위치 |
| 위치·크기 저장 | 현재 `state.boardPos/boardSize` → Host가 창 좌표로 저장 (레지스트리 `%APPDATA%` 또는 상태 파일) |
| DPI / 모니터 | WebView2 자동 DPI, 종료 시 모니터·작업영역 clamp(화면 밖 방지) |
| 자동 시작 | MSIX 시작 등록(설정 토글). 부팅 시 **시스템 트레이**로 들어가고 단축키(예: Win+Shift+B)로 표시/숨김 |
| 테마 | 기존 시간대 자동 테마 유지 + 시스템 테마 연동 옵션 추가 |

### 1.4 렌더러↔호스트 브리지

```
window.__bridge = {
  // 렌더러 → 호스트
  minimize(), togglePin(), hideToTray(), notify({title,body}),
  savePrefs(partialState),     // boardPos/size/zoom 등 (디바운스)
  // 호스트 → 렌더러 (window.chrome.webview.postMessage → onMessage)
  pushEvents(eventsJson),      // ② iCloud 결과 (기존 state.demoEvents와 동일 스키마)
  pushNews(newsItemsJson),     // ① RSS 폴링 결과 (rss-snapshot 스키마와 동일)
  pushSyncStatus({source:'icloud|news', state:'ok|error|offline', detail})
};
```
기존 단일 파일은 **모듈 분리 없이** `window.__RSS_SNAPSHOT__` 인라인 대신 `pushNews()` 수신만 바꾸는 얇은 어댑터로 전환한다 (`data.js`의 `RSS_SNAPSHOT` 로더가 `window.__LIVE_NEWS__` 캐시 참조). UI 코드 수정을 최소화.

---

## 2. iCloud 일정 — 읽기 전용 CalDAV 동기화 (②)

### 2.1 인증

1. 사용자가 appleid.apple.com에서 **앱 특수 암호** 발급 (보안: iCloud 암호 자체는 저장하지 않음).
2. 설정 UI에서 `Apple ID(이메일)` + `앱 특수 암호` 입력 → 호스트가 **Windows Credential Manager**에 저장(렌더러 localStorage 금지).
3. 매 동기화는 `Authorization: Basic base64(email:apppw)` 로 CalDAV 요청.

### 2.2 캘린더 발견 (1회, 설정 저장)

```
1) PROPFIND https://caldav.icloud.com/  Depth:0  → current-user-principal
2) PROPFIND {principal}/                → calendar-home-set
3) PROPFIND {calendar-home-set}/ Depth:1 → 캘린더 목록(displayname, color, resourcetype)
```
설정 화면에 **캘린더 체크리스트**(예: "기본", "업무", "건강"…)와 표시 색상 매핑을 제공한다. (사용자는 캘린더 앱처럼 색 연동 가능)

### 2.3 일정 조회 — 범위 기반 + 증분

- **초기/주기 조회**: `CALDAV:calendar-query` REPORT, `time-range` = [오늘 00:00, +7일], `comp-filter VEVENT`.
- **주기 반복 일정**: `RRULE`을 클라이언트에서 확장 → "다음 발생" 목록 (demo의 9건 타임라인처럼 표시).
- **증분 갱신**: 각 캘린더의 `sync-token`/리소스 `ETag` 기반. 변경 없으면 네트워크 조회 생략, 오프라인에서도 **마지막 캐시**로 렌더.
- **폴링 주기**: 포커스 시 즉시 1회 + 이후 60초(활성)/15분(숨김). WebDAV `push`는 iCloud가 미지원이므로 폴링이 표준.
- **표준 시간대**: 모든 날짜를 UTC→`Asia/Seoul` 변환. 종일(all-day) 이벤트는 `VEVENT` 기간 규칙에 따라 처리.

### 2.4 스키마 매핑 (현 UI와 1:1)

```
CalDAV VEVENT ─────────────►  UI 이벤트 (state.demoEvents[i] 형식)
UID(+RECURRENCE-ID)             id
DTSTART/DTEND (로컬 tz)          st / en  (Date)
SUMMARY                          title
LOCATION                         meta 에 "장소" 추가
CATEGORIES                       kind: meet|work|health|personal 추정 규칙 + 색상
TRANSP/STATUS                    (읽기 전용이라 상태 저장 안 함)
```
"완료 체크"는 **로컬 UI 상태**로만 관리(읽기 전용이므로 iCloud엔 미반영 — 완료 표시는 내부 오늘 관리). 이 정책은 설정 문구로 명시.

### 2.5 오류·오프라인

- 실패 시 보드에 작은 상태: "iCloud 연결 안 됨 — 마지막 동기화 09:12" + 마지막 캐시 표시 유지.
- 앱 특수 암호 만료/변경 시 재인증 안내(설정 진입 유도).

---

## 3. 뉴스 — 앱 내장 폴링 (①)

### 3.1 폴링 설계 (호스트 책임, 렌더러 무관)

```
관심사 토픽 목록(렌더러) ──► 검색어 맵(현재 THESAURUS/카테고리 규칙 재사용)
        ▼
Google 뉴스 RSS  ──q=(토픽 OR 관련어) when:3d, hl=ko&gl=KR──► 정규화 items
Economist RSS    ──고정 섹션 4개 ──────────────────────────► 정규화 items(글로벌 풀)
        ▼
item = { title, link, pub, src, desc, img, topic, kind:'rss' }  // 스냅샷과 동일 스키마
        ▼
og:image 스크랩 (기사 링크마다 1회, 디스크 캐시) ──► 썸네일 url(로컬 file:// or data URI)
        ▼
pushNews() → 렌더러 curateNews()가 그대로 편집
```

- **폴링 주기**: 15분(활성)·60분(숨김). 새 기사 있을 때만 push(많으면 toast 1건 "새 소식 N건").
- **빈도 제한**: Google 뉴스 RSS는 언론사별 1건으로 뉴스 중복 최소화. `when:` 구간으로 과거 기사 반복 방지.
- **실패 폴백**: 네트워크 실패 시 **마지막 성공 캐시**(디스크)를 그대로 렌더하고 상태만 표시 — 데모의 스냅샷이 그 "시드 캐시" 역할.

### 3.2 뉴스카드 썸네일 (최종 빌드 필수)

- RSS에 이미지 없음(실측) → 기사 원문 `<meta property="og:image">` 를 **호스트에서 스크랩**.
- 호스트는 `Referer: https://news.google.com/` 등을 흉내 내는 대신 **뉴스 제공자별 정책 준수** 최소화: 브라우저 UA로 단순 GET 1회, 타임아웃 8s, 실패 시 그라데이션+아이콘 폴백(현 디자인 유지).
- 이미지 캐시 폴더: `%LOCALAPPDATA%\BriefingBoard\img\{feedId}\{hash}.jpg`, 7일 LRU 정리. *(선택 과제 — §7.6)*
- 렌더러 DOM: 기존 `.brief-media` 위 `<img>` 삽입 (`background-image` 대신 `<img loading="lazy">`로 전환, 카드 구조 변경 없음).

> **구현 반영(2026-09-08)**: `OgImageEnricher`(Core)가 수집 직후 대표 9건까지 원문 og:image 를 스크랩해 `img`로 캐시에 저장한다. 렌더러는 기존 `background-image` 경로를 그대로 사용(구조 변경 최소화) — 원문 URL 직접 노출이므로 핫링크 차단/오프라인 시 그라데이션 폴백. 시도한 URL 은 기억해 폴링 중복 네트워크 방지.

### 3.3 소스 확정 및 제외 근거

| 소스 | 상태 | 비고 |
|---|---|---|
| Google 뉴스 RSS (ko/KR) | ✅ 메인 | 토픽→검색어, 언어 gl=KR |
| The Economist RSS | ✅ 글로벌 풀 | 경제·해외 관심사에서 노출, "RSS 실소스" 배지 |
| New Scientist (주제 피드 3) | ✅ 글로벌 풀(ns-*) | space·technology·health. **2026-09 실측: .NET HttpClient 는 200·섹션당 10건 정상 수신(수신 전량을 풀에 반영 — TakeLimit 10).** curl/node 는 406(봇 차단) → 브라우저 데모 스냅샷 생성기에는 미포함(폴백 대체 금지 원칙). 실패 시 상태 err 만 기록하고 다른 소스는 정상 진행 |

---

## 4. 데이터·저장 설계

### 4.1 상태 파일 (store.js 어댑터 교체)

```
%LOCALAPPDATA%\BriefingBoard\
├─ state.json          # UI 상태(관심사/설정/레이아웃/제외기록/위치)  ← localStorage에서 이동
├─ prefs.json          # 창 위치·크기·핀 고정 (렌더러 savePrefs 경유)  ※구현: host.json(Preferences DTO)
├─ news-cache.json     # 마지막 폴링 결과 (스냅샷 스키마, generated 포함)
├─ icloud-cache.json   # 마지막 CalDAV 결과 + sync-token/ETag
└─ img\                # og:image 캐시
```

> 구현 반영: `JsonStore`가 루트 디렉터리를 받아 파일별 원자적 저장을 담당. `host.json`은
> `{ width, height, left?, top?, topmost, autoStart, newsPollMinutes, calendarEnabled,
> calendarEmail?, calendarDisplay?, calendarPollSeconds }`. `news-cache.json`/`icloud-cache.json` 이름은 설계대로 사용.
- `state.json` 스키마는 **현재 localStorage 상태와 동일** (마이그레이션 1회: 있으면 읽어 이동 후 삭제).
- 저장은 JSON 직렬화 원자적 쓰기(tmp 후 rename)로 손상 방지.

### 4.2 뉴스 아이템 스키마 (불변)

```
{ id, cat, k[], src, h(0|1), rss:true, ago, title, url, img(null|로컬경로),
  desc, rk[], why }        // briefPool() 과 동일. id는 title 해시로 결정적
```

### 4.3 보안·개인정보 요약

- iCloud 앱 특수 암호만 보관(Credential Manager), 일반 비밀번호 미저장.
- 모든 데이터·수집은 로컬. 외부 전송 없음 (서버 설계 없음).
- Google 뉴스 링크는 리다이렉트 URL — 원문 오픈은 Host `WebView2` 별도 창(또는 기본 브라우저) 처리.

---

## 5. UI/UX 유지 + 추가 요소

- 현재 v4 화면·동작 유지: 관심사 현황 숫자카드 / 가로 레일 뉴스카드(사진) / 확장 챗바 피드백 / 제외 복구 칩.
- **추가 (최소 침습)**:
  - 보드 하단/헤더 상태 도트: ① 뉴스 폴링, ② iCloud 각각 "실시간/오프라인/오류".
  - 설정: iCloud 계정·캘린더 선택 / 새로고침 간격 / 자동 시작·트레이 / New Scientist(미지원 안내).
  - 오늘 일정 위젯 제목줄 문구: "iCloud 캘린더 동기화 · 오늘 n건" → 실측 기준으로 유지.
- 알림: "오늘 일정 시작 전" + "새 브리핑 도착" 선택적 toast(Windows 알림).

---

## 6. 개발·검증 로드맵 (다음 턴부터)

| 단계 | 산출 | 검증 |
|---|---|---|
| **M1 위젯 셸** | .NET8 WPF + WebView2 로 dist 로드, 투명·항상위·트레이·위치저장, 브리지 정의 | 수동 스모크 + 기존 test-core/dom 재사용 |
| **M2 뉴스 실시간** | 호스트 RSS 폴링 + og:image 스크랩 + pushNews + 캐시 | 스냅샷 스키마 대비 단위 비교, 오프라인 폴백 |
| **M3 iCloud 읽기** | CalDAV 인증·발견·범위조회·ETag 증분·캐시 → pushEvents | 테스트 계정의 실제 캘린더로 수동 검증 + 시간대/반복 |
| **M4 마감** | MSIX 패키지(아이콘·자동시작·서명 옵션), 오류처리, 설정 완성 | 설치→실행→재부팅 후 자동 시작 확인 |

오픈 리스크: CalDAV 응답 상세(RRULE 종류·여러 캘린더)는 실제 계정 검증 시 보정 · WebView2 투명창은 일부 GPU 드라이버에서 잔상 → 폴백으로 불투명 옵션.

---

## 7. 구현 현황 (2026-09-08) — Core 데이터 계층 + Windows 셸 1차 완성

### 7.1 디렉터리 구조

```
briefing-board/native/
├─ src/BriefingBoard.Core/          # 순수 C# (net8.0, 플랫폼 무관, 리눅스에서도 테스트)
│  ├─ Rss/      RssParser(네임스페이스 무관 매칭·GeneratedRegex) · NewsProviders(Google 토픽 5 + Economist 섹션)
│  ├─ News/     NewsCollector(동시수집·중복id 방지·상태 보고) · OgImageScraper(1GET·2MB 반복 읽기)
│  │            · OgImageEnricher(대표 기사 제한 스크랩·시도 URL 기억·전체 상한)
│  ├─ ICloud/   CalDavClient(principal→calendar-home-set→캘린더목록, calendar-query REPORT,
│  │                        XML 중첩 calendar-data→line 정규화, 반복확장) · Recurrence(RRULE)
│  ├─ Models/   NewsItem(렌더러 스키마 호환) · CalEvent(st/en ISO 파생)
│  ├─ Storage/  JsonStore(원자적 쓰기)  └─ Text/ StringExtensions(Clip/Ellipsis)
│  └─ Notify/   NotifyPlanner(순수 판정: 일정 임박 멱등 · 새 헤드라인 감지)
├─ src/BriefingBoard.Host/          # net8.0-windows · WPF + WinForms + WebView2
│  ├─ AppBoot(진입·단일인스턴스 뮤텍스) · MainWindow(위젯창·트레이 풍선 알림)
│  ├─ NativeServer(로컬 HTTP: 정적+API, 캐시, 백그라운드 폴링·리마인더 루프, 알림 이벤트)
│  ├─ HttpMini(TcpListener 경량 HTTP — HttpListener URL ACL 불필요·chunked 지원)
│  ├─ Bridge(메시지 JSON) · Preferences(host.json) · AppPaths · CredentialUtil(Win32 CredWrite/Read)
│  │  · CredentialSafe(Windows 자격증명/리눅스 파일 폴백) · AutoStart(Run 키)
│  └─ assets/app.ico (앱 아이콘 7종 — csproj ApplicationIcon)
├─ checks/CoreCheck/               # Core 라이브 검증   → 18 통과(오프라인 13, 알림 판정 포함)
├─ checks/ServerCheck/             # Host 서버 검증     → 20/17 (리눅스에서도 실행 가능)
├─ packaging/msix/                 # MSIX 준비: AppxManifest.xml·아이콘 PNG 에셋·Build-Msix.ps1
└─ scripts/ build-win.ps1·build-run.cmd   # Windows 원클릭 빌드·실행 → briefing-board/publish/win-x64
```

빌드/실행(Windows): `powershell -ExecutionPolicy Bypass -File native/scripts/build-win.ps1 -Run`
(= `dotnet publish src/BriefingBoard.Host -c Release -r win-x64` + `dist/index.html`을 `web/`으로 자동 복사,
 WebView2가 `http://127.0.0.1:{동적포트}/`로 로드. `-SelfContained`면 .NET 설치 불필요)
검증(리눅스): `dotnet run -c Release --project checks/ServerCheck [--webroot <dist>]`
(리눅스에서도 win-x64 publish 검증 완료 — 출력이 `publish/win-x64/BriefingBoard.exe`)

### 7.2 셸(Window) 동작

| 설계(§1.3) | 구현 상태 |
|---|---|
| WebView2 로드 | ✅ `MainWindow` — 네이티브 서버가 정적 UI 제공(파일:// 회피, CORS 불필요) |
| 항상 위 토글 | ✅ 트레이 메뉴 + 렌더러 메시지(`toggle-top`), `Topmost` 저장 |
| 위치·크기 저장 | ✅ 종료/숨김 시 `host.json`(Left/Top null=미기억) |
| 시스템 트레이 | ✅ 열기/숨기기·뉴스 새로고침·항상 위·종료 (WinForms NotifyIcon) |
| 자동 시작 | ✅ `AutoStart`(Run 키) — 설정 UI(네이티브 패널) 토글과 동기화 |
| 알림 | ✅ 트레이 풍선 — 새 브리핑 N건 · 다가오는 일정 임박(시작 N분 전). 첫 로드는 알림 없음 |
| 테두리 없는 글라스 | ⏳ 창 스타일은 기본 크롬으로 1차 오픈(잔상 리스크 회피), UI 반투명은 기존 CSS 유지 |

창 닫기(X)는 트레이로 숨김(위젯 특성), 트레이의 **종료**만 앱 종료.

### 7.3 렌더러↔호스트 (§1.4 구현 규약)

- `window.__BRIEFING_HOST__ = { apiBase, native:true, version }` 를 문서 생성 시점에 주입(프로브 전용, 없어도 UI 동작).
- `chrome.webview.postMessage({type,...})` 명령 구현: `hide|minimize|close|topmost|toggle-top|refresh-news|devtools|open-external`.
- **렌더러 어댑터 완료(v6.3, `src/host.js`)**: `__BRIEFING_HOST__`(또는 개발용 `?host=1`) 감지 시에만 동작 —
  `/api/news` → `Data.setLiveNews()`(풀 재구성·브리핑 재편집), `/api/events` → 오늘 겹침 일정만 분류(done/now/up)해
  `window.__liveEvents`로 주입 후 `renderSchedule()`. 실패/미설정이면 조용히 인라인 스냅샷·데모 시드 폴백(오프라인 안전).
  순수 단일파일 모드(프로브 없음)는 **기존 동작 100% 유지**.

### 7.4 로컬 API (NativeServer)

| 엔드포인트 | 동작 |
|---|---|
| `GET /` | `dist/index.html`(없으면 안내 폴백 페이지) |
| `GET /api/health` | 앱·버전·뉴스 캐시 수명·캘린더 설정 상태 |
| `GET /api/news` | 캐시(기본 15분) 반환, 없으면 실수집 |
| `POST /api/news/refresh` | 강제 수집 → `{ok, generated, count, status, items[]}` |
| `GET /api/events` | 캘린더 미설정 → `{enabled:false}` · 인증 없음 → `{needsAuth:true}` · 정상 → 캐시/수집 |
| `POST /api/events/refresh` | 강제 CalDAV 동기화(캘린더 자동 발견, RRULE 확장, 범위 -1일~+14일) |
| `GET/POST /api/prefs` | 설정 조회/부분 갱신(범위 clamp), 저장 후 창에 즉시 반영 (`notificationsEnabled`·`remindLeadMinutes` 포함) |
| `GET/POST /api/credentials` | iCloud 계정 상태 조회(이메일·`hasPassword`) / 앱 특수 암호 저장·삭제 |

iCloud 앱 특수 암호는 `CredentialSafe`(Windows 자격 증명 관리자, 리눅스 검증용은 파일 폴백)에만 보관 → 응답으로 절대 미노출.
알림: NativeServer 가 새 헤드라인/임박 일정을 감지하면 `NewsArrived`/`RemindersDue` 이벤트 발행 → MainWindow 가 트레이 풍선 표시(클릭 시 보드 열기).
첫 로드는 기준점(notify-state.json)만 저장해 알림 0건 — 재시작 후에도 새 소식만 감지.

### 7.5 검증 결과(2026-09-08 실측)

- Core: 0경고/0오류 빌드. CoreCheck 라이브 — Google 5토픽 `ok:100`, Economist 4섹션 `ok:300`, **New Scientist 3섹션 `ok:10`(2026-09 추가, 전량 반영 10씩)**, 전체 84건 수집, og:image 스크랩 1건 성공(폴백 허용), RRULE 확장 통과.
- ServerCheck 20/17 — 정적 UI 서빙(255KB) · health · prefs GET/POST/400 · events 미설정 경로 · 뉴스 강제 수집 84건(NS 섹션당 10 반영 포함) · 캐시 즉시 반환 · 자격증명 저장/조회/삭제 + autoStart 설정 왕복 · og:image 픽스처 · 404 처리.
  (이 과정에서 `HttpMini`에 **chunked Transfer-Encoding** 수신 지원 추가 — .NET HttpClient의 POST 본문 처리용.)
- Host 크로스 컴파일(리눅스 → win-x64): 0경고/0오류. (WPF·WebView2 코드 검증)
- **어댑터 자동 테스트 `test-native` 38** (A: 소스 분기 라이브 반영 · B: 순수 매핑 · C: 폴링 · D: 설정 UI 패널 E2E) + 기존 test-core/test-dom 포함 `npm test` 전체 105개 통과.
- **M4 설정 UI 네이티브 패널 E2E**(fetch 스텁 + 실서버 왕복): iCloud 계정(앱 특수 암호) 연결·해제, 일정 표시, 로그인 시 자동 시작, 항상 위, 뉴스 새로고침 주기(5/15/30/60분) — 각 설정이 `/api/prefs`·`/api/credentials`로 실제 저장되고 UI·서버 상태 일치 확인. 데모(호스트 없음)는 패널 미표시 회귀 확인.
- **실서버 E2E**(서버가 서빙한 dist를 jsdom에서 부팅, `__BRIEFING_HOST__`+fetch 주입): 라이브 뉴스 반영·브리핑 카드·RSS 배지 확인 — 캘린더 미설정 시 데모 시드 유지 확인.
- **알림 판정(CoreCheck, 오프라인 13/13·온라인 18)**: `NotifyPlanner` — 임박 일정(시작 전 리드분)만 선별, 멱등(같은 일정 중복 발송 없음), 새로 임박해진 일정 재발송, 첫 로드 기준점(알림 0건), 이후 새 항목만 카운트, 중복 재카운트 없음, 키 함수. notify-state.json(seen 84·멱등 키) 실측 저장 확인.
- **MSIX 준비**: `AppxManifest.xml`(runFullTrust·appExecutionAlias·VisualElements) well-formed 검증, 아이콘 PNG 5종(44/50/150/310·wide310x150) 생성 확인, `Build-Msix.ps1`(publish→makeappx pack→signtool 서명·테스트 인증서 자동 생성 옵션). 패킹/설치는 Windows SDK에서 실행.
- **og:image 실측**(2026-09-08): Google 뉴스 5개 토픽(헤드라인) 썸네일 확보 → DOM 4개 뉴스카드 전부 실제 배경 이미지 표시 E2E 확인. 과정에서 두 버그 수정:
  1) `OgImageScraper`가 `ReadAsync` 1회만 호출 → 스트림 분할 도착 시 놓침. **반복 읽기(상한 2MB)** 로 교체.
  2) Google 뉴스 리다이렉트 페이지는 og:image 메타가 페이지 끝(≈590KB)에 위치 → 2MB 상한으로 해결.
  Economist는 Cloudflare/페이월로 og:image 없음(대부분) → 폴백 유지. ServerCheck og:image 4종(픽스처) 통과.

### 7.6 남은 작업

| 항목 | 상태 |
|---|---|
| M2: dist 어댑터(뉴스·일정 라이브 소비·폴백) | ✅ 구현·자동/E2E 검증 완료 — Windows 셸에서 5분 스모크만 남음(§7.7) |
| M2-2: 뉴스카드 og:image 원문 썸네일 | ✅ `OgImageEnricher` — 수집 시 h=1 대표 9건까지 제한 스크랩(시도 URL 기억·재시도 없음). 캐시에 img 포함 저장. 렌더러는 기존 background-image 경로 그대로. 실측: Google 5토픽 헤드라인 썸네일 확보, Economist는 차단/페이월 → 그라데이션 폴백 |
| M3: 실제 iCloud 계정 검증 | ⏳ 코드 완성·자격증명 있으면 수동 검증(캘린더 선택 저장은 host.json `calendarEnabled/email/display`) |
| M4: MSIX·설정 화면·알림·AutoStart 토글 UI | ✅ 아이콘·원클릭 빌드(scripts/). ✅ **HTML 설정 UI 네이티브 패널**: iCloud 계정/앱 특수 암호(`/api/credentials`→CredentialSafe, 비밀번호 응답 미노출)·일정 표시·자동 시작(AutoStart Run 키)·항상 위·새로고침 주기 — 실서버 E2E 통과. ✅ **Windows 알림**: `NotifyPlanner`(순수 판정)+NativeServer 30초 리마인더/폴링 감지→트레이 풍선(새 브리핑 N건·다가오는 일정, 클릭 시 보드 열기, 첫 로드 알림 없음, notify-state.json 멱등) — CoreCheck 8종 통과, 표시는 Windows 확인. ✅ **MSIX 준비**: `packaging/msix/`(AppxManifest·아이콘 PNG·Build-Msix.ps1) — 패킹/설치 실행은 Windows SDK에서 수행 |
| 뉴스 썸네일 로컬 이미지 캐시(`img\`, LRU) | ⏳ 선택 과제 — 원문 URL 직접 노출로 충분(오프라인·핫링크 차단 시 폴백). 오프라인 가용성 필요 시 도입 |

### 7.7 Windows 스모크·패키징 준비 (사용자 PC — 최종 시각 확인만)

로직·API·어댑터는 자동/E2E 검증으로 완료됨. **WebView2 시각 확인만** Windows에서 수행한다.
원클릭 스크립트 제공(리눅스에서 `dotnet publish -r win-x64` 가 유효함을 이미 검증 — `publish/win-x64/BriefingBoard.exe` + `web/index.html` 생성 확인):

```powershell
# PowerShell (repo 루트)
powershell -ExecutionPolicy Bypass -File native/scripts/build-win.ps1 -Run
#   옵션: -Run 실행 / -SelfContained(런타임 내장, .NET 설치 불필요 ~100MB)
# 또는 더블클릭: native/scripts/build-run.cmd
```

- 산출: `publish\win-x64\BriefingBoard.exe` — 앱 아이콘(`Host/assets/app.ico`, 7종 크기)이 exe에 내장.
- 기본 빌드는 프레임워크 의존 → Windows에 `.NET 8 Desktop Runtime` 필요, 없으면 `-SelfContained`.

확인 항목:
1. 보드가 뜨고 우상단 토글 스위치가 켜짐(항상 위) — 창 이동/리사이즈 후 재시작에도 위치 기억.
2. X(닫기) → 트레이로 숨김. 트레이 아이콘 더블클릭 → 복귀. 작업 표시줄/Alt-Tab 아이콘 표시.
3. 브리핑 하단이 실제 소스 배지를 동적으로 표시(`Google·Economist·New Scientist RSS` 등, RSS_LABEL) + 메타 툴팁 "라이브 편집 소스 · 갱신 …"
   (뉴 사이언티스트 포함 시 "RSS" 배지 — 소스는 Core 기본 계획에 NS 3섹션 포함됨).
4. (선택) iCloud 연결: **설정 → 네이티브 위젯 연동**에서 Apple ID(이메일)와 **앱 특수 암호**(appleid.apple.com 계정 → 로그인 및 보안 → 앱별 암호 생성)를 '연결 저장' → '일정 표시' 켜기. 저장 위치는 Windows 자격 증명 관리자(`cmdkey /generic:BriefingBoard:iCloud ...` 와 호환)이며 응답으로 비밀번호를 되돌려주지 않음(`hasPassword`만 노출).
   재시작 후 오늘 일정이 실제 iCloud 일정으로 바뀌고(`__liveEvents`), 오프라인이면 마지막 캐시/데모 유지.
5. 회귀: 단일 파일로 열어도(`dist/index.html`) 기존 데모가 그대로 동작(프로브 없음 → 무해).
6. **알림(트레이 풍선)**: 실행 중 새 뉴스 폴링이 새 항목을 감지하면 \"새 브리핑 도착 — 새 소식 N건\" 풍선(첫 실행 기준점 후부터), iCloud 연결 시 시작 10분 전 일정 \"다가오는 일정\" 풍선. 풍선 클릭 → 보드 열기. 알림 수신 확인은 알림 센터 대신 트레이 아이콘 부근 풍선.
7. **(선택) MSIX 패키지**: Windows SDK 설치 후 `native/packaging/msix/Build-Msix.ps1 -NewTestCert` → `Add-AppxPackage -Path ...\BriefingBoard_0.1.0.0_x64.msix`.
   ※ MSIX 격리로 자동 시작(Run 키)·자격증명 `cmdkey` 경로가 제한될 수 있음 — 트레이 자동 시작/자격증명이 핵심이면 기본 loose 배포(`build-win.ps1`) 권장.

---

## 부록 A. 기존 자산 재사용 맵

| 현재 | 전환 |
|---|---|
| `dist/index.html` 단일 파일 | WebView2에 로드되는 UI (변경 최소) |
| `data.js briefPool()` + `__RSS_SNAPSHOT__` | `__LIVE_NEWS__`(Host push) 로 같은 스키마 소비 |
| `data.js buildDemoEvents()` | Host CalDAV 결과(동일 이벤트 스키마) |
| `store.js`(localStorage) | Host 파일 어댑터 (`window.__bridge__.savePrefs`) |
| `tools/fetch-rss.js` | C# `NewsFetcher` 로 이식(URL·파싱 규칙 그대로) |
| `tools/build.js / test-*.js` | 개발 시 그대로 사용(웹 빌드=디자인 시안), 통합 테스트는 M1 이후 |
