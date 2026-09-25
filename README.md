# Briefing Board (`briefing-board`)

> **실시간 일정·기상·주식·스포츠와 뉴스레터를 한곳에 담은 AI 브리핑 보드 위젯 (Windows Native & Web)**  
> 📐 **실서비스 구현 설계서**: [`docs/implementation-spec.md`](docs/implementation-spec.md) | 🚀 **CI/CD 가이드**: [`docs/CI-CD.md`](docs/CI-CD.md)

[![CI Pipeline](https://img.shields.io/badge/CI-GitHub%20Actions-blue?logo=githubactions&logoColor=white)](.github/workflows/ci.yml)
[![Node.js](https://img.shields.io/badge/Node.js-18%20%7C%2020%20%7C%2022-green?logo=nodedotjs)](package.json)
[![Tests](https://img.shields.io/badge/Tests-205%20Passed-brightgreen)](tools/)
[![Platform](https://img.shields.io/badge/Platform-Web%20%7C%20Windows-lightgrey)](publish/win-x64/)

---

## ⚡ 빠른 시작 (Quick Start)

### 1. 원클릭 실행 (Windows)
* 바탕화면 어디서나 **`start.bat`** 파일을 더블클릭하면 네이버 웨일 브라우저(또는 기본 브라우저)로 자동 실행됩니다.

### 2. 개발 및 테스트 실행 (CLI)
```bash
# 의존성 설치
npm install

# 번들 빌드
npm run build

# 전체 205개 테스트 전수 검증
npm test

# 로컬 개발 서버 기동 (포트 8420)
npm start
```

---

바탕화면에 띄워두는 **반투명 브리핑 보드**. 하나의 **Board** 안에 독립 위젯 **3개**가 있고, AI가 보드 전체의 균형(크기·배치)만 관리하는 구조입니다.

## v6.7 (피드백 = 코드 셀프 패치 · good! 다음 뉴스 · 하늘 자동 전환 · 스포츠 경기 카드)
- 🤖 **피드백이 설정 고르기가 아니라 코드를 만듭니다**: 하단 피드백 칸에 “날씨를 오전/오후로 나눠서”, “미세먼지도 표시해줘”,
  “일정위젯의->날씨를 오전/오후로”처럼 적으면 `tools/patch-engine.js`가 요청을 해석해 **`src/patches/<id>.js` 렌더 코드를 새로 쓰고**
  `dist/index.html`을 재빌드 → **새로고침하면 그대로 반영**(빌드 해시 워처가 자동 갱신). 모달에 생성된 코드 전문이 보이고,
  “방금 패치 되돌리기”/`node tools/patch-engine.js clear`로 원복. 만들 수 없는 요청은 정직하게 “못 한다”+지원 연산자 9종만 안내합니다.
  연산자: 오전/오후 분리 · 데이터 라인 추가/제거 · 블록 추가(시간대 그래프·주간·일출일몰·다음 경기) · 소수점 자리 · 단위 변환 · 라벨 · 카드 스타일 · 목록 건수
- 💚 **good! = 그 뉴스 다 봤다는 뜻** → 같은 관심사의 **아직 안 읽은 다음 기사**로 자동 진행. 다 읽으면 그 관심사의 새 기사를 실시간 수집해 이어서 표시,
  소스에 없으면 순환. 카드에 `읽음 1/4` 칩, 다시 누르면 읽음 해제.
- 🌧 **비가 오면 하늘이 저절로 바뀝니다**: `Logic.skyAlertFromWeather`가 실측(WMO 코드·강수량·강수확률·PM10·기온)으로
  `뇌우>눈>비>미세먼지·황사>폭염>한파`를 판정 → 하늘 팔레트·빗줄기·창유리 물방울 자동 전환/해제. 설정 화면에 판정 근거가 그대로 노출됩니다.
- 🏟 **스포츠 관심사 = 팬 한눈에 카드**(new kind `sport`): 리그·라운드, 다음 홈/원정, `D-n`+남은 시간, 킥오프, 경기장,
  진행 중 점수+경과 분, 최근 결과, 최근 5경기 폼. 소스 TheSportsDB(429 슬로틀 대응·리그/일별 캐시). 확인 실패 시 뉴스로 우회하며 **가짜 일정은 만들지 않음**.
  뉴스레터에도 상태·경기장·결과 4칸 격자 카드. 데이터 연결 전엔 `시안` 골격만 표시.
- ✅ 자동 검증 `npm test` = core 84 · patch 34 · dom 15 · native 43(총 176).

## v6.6 (회사명 → 주식 시세 + iCloud 일정표시 스위치·갱신 수리)
- 📈 **회사 이름을 넣으면 주식 시세로**: Alphabet·apple·Tesla·애플·테슬라·삼성전자·엔비디아 등 영문/한글 회사명 →
  종류와 무관하게 **실시세 타일**(심볼·USD/KRW 구분·달러 포맷·등락 스파크). 사전(한글/해외) + Yahoo 스코어매칭.
  뉴스형 관심사(맨시티·마인크래프트·F1)·코인·환율은 기존 분류 유지.
- ☁️ **일정표시 스위치 + 갱신 수리**: 미니 서버에 `/api/prefs`(영속) 신설 — 인증 성공 시 **일정 표시 자동 ON**,
  ON이어야 `/api/events` 활성. 캘린더 변경 → **동기화 클릭 즉시 반영**, 일시 동기화 오류 시 기존 일정 유지.
- ✅ 자동 검증 `npm test` = core 54 · dom 15 · native 21(총 90).

## v6.5 (환율 인식 + iCloud “지금 이 빌드에서 바로 연결”)
- 💱 **환율(FX)**: “달러환율·엔화·위안·유로” 입력 → AI가 **환율**로 분류 → 환율 소스에서 오는 값
  (1外貨=원 현물, 전일 등락률·증감, 최근 22영업일 일봉 스파크)을 **실데이터가 박힌 시안 3종**으로 제시 후 추가.
  소스: currency-api(ECB 기반 일일 미러). 실측: USD/KRW 1,338.29 · JPY/KRW 8.72 · CNY/KRW 199.51 · EUR/KRW 1,556.59.
- ☁️ **iCloud 일정을 “지금 도는 빌드”에서 바로 연결**: CalDAV(읽기 전용)를 미니 서버(Node)에 포팅 —
  자격증명 저장·전체 캘린더 발견/병합·일정 조회·반복 규칙 확장. 브라우저 데모를 `node tools/live-server.js --dir dist`로 열고
  **☰ 설정 → iCloud 일정**에서 Apple ID + 앱 특수 암호 → **연결 저장 → 일정 표시**까지 그 자리에서 동작(저장: `tools/.cache/cred.json`).
  오프라인 단일파일에서는 “지금 연결하는 법” 안내가 이 절차로 연결해 줍니다.
- 🪟 **Windows exe 안내(현실화)**: exe(.NET/WPF)는 Windows에서만 실행됩니다(본 작업 환경은 Linux).
  Windows에서 `native/scripts/build-win.ps1 -Run`(또는 `build-run.cmd` 더블클릭) → `publish\win-x64\BriefingBoard.exe`.
  **동일한 UI와 iCloud 설정창**이 exe에서 그대로 동작합니다. 그 전/대안으로는 위 미니 서버+브라우저가 같은 기능을 지금 제공합니다.

## v6.4 (실시간 라이브 파이프라인 전환 — 가짜 껍데기 제거)
- 🔴 **"가짜정보 껍데기 금지"**: 관심사 타일·뉴스레터는 `tools/live-server.js`(또는 네이티브 `/api/live/*`)의 **실데이터만** 렌더.
  서버 연결 전/로딩 중은 각각 **연결 안내·스켈레톤**만 — 가짜 숫자·채워진 척 없음(개인형도 "연결 필요").
- 🧭 **AI 독단 분류 제거**: 관심사마다 **"TODAY'S BRIEFING 포함" 스위치**(기본 ON)로 사용자가 제어. 관심사 타일엔 항상 표시.
- 🎴 **관심사 추가 = 완성형 시안 3종**: 입력 → AI 종류 분류 → **실데이터가 박힌 시안 A(대표)/B(넓은 뷰)/C(컴팩트)** 제시 → 선택 후 추가.
- ⚡ **"관심없음" = 실시간 새 기사 교체**: 누를 때마다 그 관심사의 지금 새 기사를 `fresh=1`로 재수집해 카드 교체(중복 방지 exclude 포함). 타일 새로고침 아이콘도 실데이터 재수집.
- 🌐 **데이터 소스(실측)**: 코인=Upbit(KRW) ｜ 증시=Yahoo chart + 한글 종목 사전 ｜ 날씨=Open-Meteo(키 없음)/OpenWeatherMap(키 시) ｜ 뉴스=미디어 RSS(사진)+Google 뉴스.
- 🖥 브라우저 데모: `node tools/live-server.js --dir dist` → http://localhost:8420 (상세는 `docs/status-2026-09-09.md`)

## v6.2 (대설 재설계 — 가독성 + 눈 질감)
- ✅ 이전 문제(쌓인 눈이 위젯을 덮어 안 보임) 수정: 눈더미를 **위젯보다 아래 레이어(z1)** 로 깔고,
  위젯·헤더·피드백줄을 **그 위(z3)** 로 올림 → 눈은 위젯 **뒤/사이/가장자리에** 쌓이고 내용은 항상 보임
- ❄️ **눈 질감 강화**: 매끈한 "액체" 그라데이션 대신
  ① 크고 작은 봉우리로 만든 **눈 구릉** ② 고운 **가루 입자(이중 랜덤)** ③ **눈 결정 반짝임**
  ④ 덩어리 **결 층/그늘 음영** ⑤ 봉우리 위 **반짝 하이라이트**
- 위젯별 눈은 하단 16px 가는 테두리 눈으로만 남겨 내용을 가리지 않게

## v6.1 (경보 디테일 조정)
- 🟡 **황사**: 공중에 흩날리는 **미세 먼지 입자(스펙클) 애니메이션** 추가 + 연무가 더 뭉게지듯 질감 강화 + 위젯 가장자리 먼지가 **알갱이로 덕지덕지** 쌓임
- 🔥 **폭염**: 배경 하늘을 **붉은 폭염 톤**으로 교체(라이트/다크 각각) + 아지랑이도 따뜻한 빛으로
- 🧊 **한파**: **고드름 크기·개수 확대**(46–80px, 9줄기) + 입체 하이라이트·불규칙 얼음 테두리 질감 + 떨어지는 물방울 확대
- ❄️ **대설**: **브리핑 보드 자체도 절반 이상 눈에 파묻히는 눈무덤** 추가(보드 상단엔 눈가루, 위젯 눈무더기도 확대)

## v6 반영 (기상경보 6종 — 분위기 배경 확장)
설정 → “배경 하늘”에서 경보 미리보기. 실제론 기상특보 수신 시 자동 적용(경보일 때만 애니메이션 → 최적화).
- **비**: 회색 하늘 + 빗줄 + 창유리 빗방울 ｜ **폭풍**: 짙은 구름 + 빗줄 + 번개 섬광 + 창유리 빗방울
- **황사 · 미세먼지 매우나쁨**: 누런 모래폭풍 배경 + 뿌연 연무가 천천히 떠다니며 **위젯 가장자리에 먼지가 덕지덕지** 쌓이는 애니메이션
- **폭염**: 새하얀 아지랑이가 아래에서 위로 피어오르는 애니메이션(은은한 굴절)
- **한파**: 차가운 창공 + 위젯 가장자리에 **서리가 맺히고**, 보드 위에 **고드름이 달려 방울이 뚝뚝** 떨어지는 효과
- **대설**: 잿빛 하늘 + 바깥에 눈이 내리고, 위젯 아래로 **눈이 퍽퍽 쌓여 살짝 파묻히는** 애니메이션

## v5-1 반영 (보드 이동 고정)
- 🚫 **헤더 드래그 이동 기능 제거** — 위로 끌면 화면 밖으로 나가 다시 잡을 수 없는 문제를 차단.
  보드는 항상 화면 중앙에 고정되고, 저장됐던 위치값도 부팅 시 자동 정리(원상복구 보장).
  크기 조절(우하단 핸들)만 유지하며 폭은 뷰포트 안으로 보정.

## v5 반영 내용 (디자인 디테일 — 분위기 배경)
- 🧹 뉴스 위젯 헤더의 “RSS가 아니라 — …편집자가 고른 뉴스” 문구 제거 → 헤더가 짧아져 **뉴스카드가 더 잘 보임**
  (잘림 방지를 위해 뉴스 위젯 세로 공간도 확대)
- 🌇 **시간대별 하늘 배경(5단계)**: 일출(5–7) · 낮(8–16) · 노을(17–18) · 황혼(19–21) · 밤(22–4)
  시간에 따라 햇빛/노을/달빛이 블러 그라데이션으로 은은하게 비침. 낮/밤 두 개만이 아니라 중간 단계 포함
- ☔ **기상경보 배경**(비·폭풍): 하늘이 흐려지고 빗줄이 내리며, 폭풍엔 번개 섬광 + **창유리에 맺히는 빗방울·흘러내림**
- 🎛️ 설정 → “배경 하늘 (분위기)”에서 자동 / 낮 / 노을 / 밤 / 비 경보 / 폭풍 경보 **미리보기**
- ⚡ **최적화**: 맑은 날은 정적인 그라데이션·광원만(애니메이션 없음). 빗줄·번개·빗방울 효과는 기상경보일 때만 켜짐
  (실서비스에선 기상 특보(기상청 알림)에 자동 연동 예정)

## v4 반영 내용 (뉴스카드형 손질 + RSS 실소스 연결)
- 📰 브리핑 카드를 **뉴스카드형**으로: 상단 **미디어 영역**(사진 자리, 104px)에 번호 배지(01)·카테고리 칩
  → 출처·시간 한 줄 → 제목 → "왜 중요한지" 2줄 → 원문 보기·더 알아보기·관심없음
- 🖼️ 카드 세로 크기 확대·세로 스크롤 제거(내용 잘림 없음). 썸네일은 `og:image` 스크랩 자리로 예약
- 📡 **RSS 실소스 연결**: `tools/fetch-rss.js`로 **Google 뉴스(ko/KR)** 주제별 피드 + **The Economist** 섹션 RSS를 받아
  `src/rss-snapshot.json`을 만들고, 빌드 시 dist에 인라인. 브리핑 4카드가 **실제 기사**로 채워짐
  (Economist 영문 기사는 `글로벌` 풀로 분리 — "해외 경제" 같은 관심사에서 등장)
- 각 RSS 카드의 "원문 보기" 모달엔 **실제 원문 링크**(RSS 실소스 배지 표시) 연결

## v3 반영 내용 (최종 정리 — "덜어내기" 위주)
- ❌ 관심사 위젯의 **빠른 추가 챗바 제거** → 우상단 "+ 관심사 추가"(헤더와 동일 진입점)로 통일
- ✂️ **관심사(현황)와 브리핑(읽을거리) 중복 제거** — 편집형 관심사(F1·AI·음악…)는
  브리핑 위젯에서만 다루고, 관심사 위젯에는 숫자 현황 카드만 표시
- 🧹 중복 요소 정리 — 상시 AI 안내줄·위젯 내 이중 타이틀·장식 배지 제거
- ⬅️ **브리핑 세로 스크롤 → 가로 레일**(카드 스냅 + ◀▶ 버튼)
- ✨ **피드백 반영 받기**: 중앙 버튼 → 클릭 시 테두리가 퍼지며 챗바가 스르륵 확장

## v2 반영 내용 (2차 피드백)
- ☁️ **일정 = iCloud 캘린더** 기준 (데모 시드, 연동 지점 표시)
- ✂️ **뉴스 = "편집자(Curator)" 컨셉** — 관심사별로 1건씩 엄선한
  **TODAY'S BRIEFING** (01·F1 → 헤드라인 → "왜 중요한지 2줄" → `원문 보기 · 관심없음 · 더 알아보기`)

## 지금 바로 실행하기
`dist/index.html` 을 브라우저(Edge/Chrome)에서 열면 끝. 단일 파일 · 오프라인 동작.
- 보드: 헤더 드래그로 이동, 우하단 핸들로 폭 조절 (자동 저장)
- 시간대 자동 테마(아침 라이트 / 저녁 다크), 태스크바 시뮬레이션

## 위젯 3개
| 위젯 | 기능 | 비고 |
|---|---|---|
| ① 오늘 일정 | 인사말·날씨·"다음 일정 N분 전" 카드·타임라인 | **iCloud 캘린더 연동 지점** (`data.js buildDemoEvents`) |
| ② 관심사 카드 | F1·음악·AI·카메라 같은 **편집형 트렌드** + 주식·코인·날씨·운동·수면 같은 **데이터형** | 바로 추가 바 + "AI가 종류 판단" |
| ③ TODAY'S BRIEFING | 관심사 순서대로 01·02·03… **편집자가 대표 소식 1건씩** 큐레이션 | 각 카드: → 왜 중요한지 · 원문 보기 · 더 알아보기 · 관심없음 |

## 핵심 플로우
1. **관심사 추가** — 카드 위젯 하단 "관심사 추가" 바나 헤더 "내 관심사"에서
   `F1`, `음악`, `AI`, `카메라`, `삼성전자`, `수면` 같은 자유 문장 입력 → **AI가 종류를 판단**(편집형/데이터형) 후 카드 + 브리핑 갱신
2. **TODAY'S BRIEFING 편집** — "관심없음"을 누르면 그 소식은 기억되고 **편집자가 다른 소식을 교체**.
   "더 알아보기"로 심층 검색어 제공. 제외 내역은 "제외 n건 되돌리기"로 복구.
3. **피드백 반영 칸** (보드 하단) — "다크 모드로", "주식은 초록이 상승", "AI를 맨 위에" 같은 설정류는 즉시 반영,
   "날씨를 오전/오후로 나눠서"·"미세먼지도 표시해줘"처럼 **미리 준비된 답이 없는 요청은 코드를 새로 만들어** 재빌드 → 새로고침 시 반영(+되돌리기)
4. **AI 균형 조율** — 관심사 5개+면 관심사 카드를 좌측 대형으로 재배치

## 파일 구조
```
briefing-board/
├─ dist/index.html    배포용 단일 파일 (열면 끝)
├─ src/
│   ├─ structure.html 마크업        ├─ style.css   글라스 테마/카드 디자인
│   ├─ store.js       상태 저장(교체 지점)  ├─ data.js    데모 데이터 + 큐레이션 엔진
│   ├─ logic.js       AI 브레인(피드백 규칙·배치·하늘 판정·읽음 큐) ├─ app.js  오케스트레이션
│   ├─ patch-runtime.js 코드 패치 런타임(렌더 데이터/HTML 훅)
│   └─ patches/       피드백이 만든 JS(자동 생성·삭제=되돌리기) + index.json
└─ tools/  build.js(빌드) · patch-engine.js(피드백→코드 컴파일러) · live-server.js(실시간 소스+iCloud+피드백 API)
   · test-core.js(84) · test-patch.js(34) · test-dom.js(15) · test-native.js(43)
```

## 실서비스 전환 지점
- 뉴스: `data.js briefPool()`은 빌드 시 인라인된 **RSS 스냅샷**(`rss-snapshot.json`, Google 뉴스·Economist) 사용.
  네이티브 앱에선 `tools/fetch-rss.js`의 수집 로직을 **실시간 폴링**으로 전환 + 기사 원문 `og:image` 스크랩으로 썸네일
- `data.js buildDemoEvents()` → **iCloud CalDAV**(앱 특수 암호) 연동
- `logic.js planFromFeedback()`(설정 룰) + `tools/patch-engine.js`(연산자 9종 코드젠) → **GPT/LLM 코드로 교체 지점**: `plan()`만 LLM 호출로 바꾸면 되고 저장·빌드·되돌리기·렌더 훅 파이프라인은 그대로 재사용된다

## 스냅샷 갱신
```bash
node tools/fetch-rss.js   # src/rss-snapshot.json 재생성 (네트워크 필요)
node tools/build.js       # dist/index.html 빌드
```

## 테스트
```
npm install && npm run build && npm test
```

## 네이티브 구현 현황 (2026-09-08 — native/)

브라우저 빌드(v6.2 확정)와 별개로, **실서비스 전환의 데이터·셸 계층**이 `native/`에 진행 중입니다.

```
native/
├─ src/BriefingBoard.Core/   순수 C#(net8.0): RSS 파서·Google/Economist/NewScientist 수집·og:image 스크랩·
│                            CalDAV(발견/조회/RRULE 확장)·JsonStore·알림 판정(NotifyPlanner)  → 리눅스에서도 테스트
├─ src/BriefingBoard.Host/   Windows 셸(WPF+WinForms+WebView2):
│                            MainWindow(위젯창·항상위·트레이·풍선 알림) · NativeServer(로컬 HTTP 정적+API)
│                            CredentialSafe(Windows 자격 증명) · AutoStart · host.json 설정
├─ checks/CoreCheck/         Core 라이브 검증      → 18 통과 (오프라인 13: RSS·RRULE·알림 판정)
├─ checks/ServerCheck/       서버·API 검증         → 20/17 (정적 UI/health/prefs/자격증명/뉴스/og)
└─ packaging/msix/           MSIX 준비: 매니페스트·아이콘 PNG·Build-Msix.ps1
```

- 실행(Windows): `dotnet publish native/src/BriefingBoard.Host -c Release -r win-x64 --self-contained false`
  → `dist/index.html`이 자동 복사되어 WebView2에 표시. 닫기(X)=트레이 숨김, 트레이에서 종료.
- 로컬 API: `/api/news`(뉴스 폴링, 캐시 15분), `/api/events`(iCloud CalDAV), `/api/prefs`, `/api/health`.
- **라이브 어댑터(v6.3, `src/host.js`)**: 네이티브에서만 활성화(또는 서버를 띄우고 `?host=1`) —
  뉴스·일정을 API로 받아 기존 큐레이션·일정 UI에 주입, 실패 시 기존 스냅샷/데모 폴백. 순수 단일파일 동작은 불변.
- **og:image 썸네일(M2-2)**: 수집 시 대표 기사(최대 9건)의 원문 og:image를 제한 스크랩해 캐시에 저장
  → 뉴스카드에 실제 사진 표시. 시도한 URL은 기억해 재시도 없음, 실패 시 그라데이션 폴백.
- 자동 검증: `npm test`(기존 + `test-native` 38 = 총 105) · ServerCheck 20/17(자격증명·autoStart 포함) · 실서버 E2E(카드 4장 실제 이미지 확인) · CoreCheck 18(오프라인 13).
- **Windows 알림(M4)**: NativeServer가 새 헤드라인(첫 로드 제외)·시작 임박 일정을 감지 → 트레이 풍선 표시
  (`notify-state.json` 멱등, 풍선 클릭 시 보드 열기). 순수 판정은 CoreCheck로 검증, 표시는 Windows에서 확인.
- **MSIX 준비(M4)**: `native/packaging/msix/` — `AppxManifest.xml`·아이콘 PNG(44/50/150/310·wide)·`Build-Msix.ps1`
  (publish → makeappx pack → signtool 서명, 테스트 인증서 자동 생성). 실행은 Windows SDK에서.
- **Windows 실행(스모크)**: `powershell -ExecutionPolicy Bypass -File native/scripts/build-win.ps1 -Run`
  (또는 `native/scripts/build-run.cmd` 더블클릭) → `publish\win-x64\BriefingBoard.exe`.
  앱 아이콘 내장 · 옵션 `-SelfContained`(런타임 내장) · 자세한 확인 항목은 설계서 §7.7.
- **워크스페이스 다운로드 후 실행 매뉴얼**: `docs/windows-run-manual.md`
  - `Run-Browser.cmd` — 기본 브라우저 모드 (WebView2 창 문제 회피 · 즉시 사용)
  - `Start-BriefingBoard.cmd` — 창(WebView2) 모드
  - `Clean-BriefingBoard.cmd` — 프로세스 종료+WebView2 프로필 정리(재실행 안 함)
  - `Diagnose-BriefingBoard.cmd` — 셀프테스트 · `Stop-BriefingBoard.cmd` — 강제 종료
- 뉴 사이언티스트(New Scientist)는 Core 기본 수집 계획에 포함(space·technology·health, 실측 .NET 200·섹션 10건을 전량 반영).
  curl/node는 406(봇 차단)이라 브라우저 데모 스냅샷 생성기엔 미포함 — "폴백 대체 없이 가능한 것만 추가" 원칙.
- 자세한 설계·진행: `docs/implementation-spec.md` §7 참조. 남은 작업: Windows 최종 스모크(§7.7 — 알림 풍선·트레이 포함) · MSIX 실제 패킹/설치 · (선택) M3 실제 iCloud 계정 검증.
- 브라우저 산출물 유지: `node tools/build.js` → `dist/index.html` (단, `dist/`는 작업공간 스냅샷 제외 폴더이므로 재빌드 필요)
