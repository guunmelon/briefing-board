# BriefingBoard — 다운로드 후 실행 매뉴얼 (Windows)

> 목적: 워크스페이스를 내려받은 뒤 **딱 무엇을 실행하면 되는지** 안내.
> 이 매뉴얼의 최종 목표 = 트레이 풍선 알림 2종("새 브리핑 도착" / "다가오는 일정")을 화면에서 확인.

---

## 0) 다운로드 내용물에서 중요한 사실 3가지

| 항목 | 다운로드에 포함? | 의미 |
|---|---|---|
| `publish\win-x64\` (exe+dll+`web\`) | ✅ **포함** | **바로 실행 가능한 완성본**. 이 폴더만 있어도 앱이 돈다 |
| `src\`, `native\`, `docs\`, `tools\`, `package.json` | ✅ 포함 | 소스·문서 (수정/재빌드할 때만 필요) |
| `node_modules\`, `dist\`, `.cache\` | ❌ 제외 | 재빌드 시 `npm install`·`node tools/build.js` 로 새로 생성 |

즉, **실행만 원하면 별도 도구 설치 없이 1)번 경로만** 하면 됩니다.

---

## 1) ★ 바로 실행 — 방법 2가지 (아무거나)

### 1-0. 이 PC에서 "창(WebView2)이 흰 화면/로딩"으로 고생했을 때의 결론
`web\index.html`을 **브라우저로 더블클릭하면 정상** = 웹 콘텐츠·앱 데이터·로컬 서버는 멀쩡합니다.
문제는 **이 PC의 WebView2(앱 내장 렌더러)가 화면을 못 그리는 것** → 아래 **방법 A(브라우저 모드)**를 쓰면
WebView2를 아예 안 쓰므로 **지금 당장 정상 사용 가능**합니다. (방법 B는 WebView2 고침/내장 후 시도)

### 방법 A — 브라우저 모드 (★ 이 PC에서 지금 사용할 것. WebView2 불필요)
```
Run-Browser.cmd        더블클릭        (워크스페이스 최상위)
```
- 기본 브라우저(지금 정상 동작하는 그 브라우저)에 보드가 열림
- 안내창이 뜨면 **OK** — 브라우저 탭은 이 앱이 종료될 때까지 유지
- **종료**: 트레이 아이콘 우클릭 → `종료` (또는 `Stop-BriefingBoard.cmd`)
- 알림(풍선) 테스트도 트레이에서 가능. iCloud 일정 등 전 기능 동일.

### 방법 B — 창(WebView2) 모드 (기본값, 환경이 고쳐지면)
```
Start-BriefingBoard.cmd    더블클릭     (또는 publish\win-x64\BriefingBoard.exe 직접)
```
- 흰 화면이 또 나오면 이 PC의 WebView2 문제 → **6-5 Fixed Version(자체 내장)** 또는 방법 A 사용.

### 1-1. 사전 요구 1개 (.NET 런타임)
- **.NET 8 Desktop Runtime (x64)** 필요: 없으면 실행 시 *"install .NET Desktop Runtime"* 대화상자
  → <https://dotnet.microsoft.com/download/dotnet/8.0> 의 **.NET Desktop Runtime 8 → x64** 설치
- WebView2: 방법 A에는 **불필요**. 방법 B에서만 필요(Windows 10/11은 대부분 기본 내장).

### 1-3. 처음 실행 시 (Windows가 물어볼 수 있는 것)
- **SmartScreen** "Windows에서 PC를 보호했습니다" → `추가 정보` → `실행` (서명 없는 테스트 빌드라서)
- **알림 허용** 팝업 → `허용` (안 뜨면 아래 4-2 참고)

---

## 2) 정상 실행 확인 (창이 떠야 함)

1. **보드 창**이 열리고 뉴스 카드·오늘 위젯·브리핑이 표시됨
2. 우측 하단 **시스템 트레이**(시계 옆)에 앱 아이콘 존재
   - 트레이가 접혀 있으면 **∧(숨김 아이콘 표시)** 를 눌러 확인
3. 보드 우상단 토글 스위치(항상 위)가 **켜진** 상태
4. 창 **닫기(X)** → 창만 사라지고 트레이에 남음(= 앱이 계속 실행 중)

> 안 뜨고 바로 종료/오류면: **[6) 문제 해결]** 참고.

---

## 3) ★ 알림 풍선 확인 (이번 목표)

실제 새 뉴스나 iCloud 일정이 **없어도** 확인할 수 있게 테스트 메뉴를 넣어뒀습니다.

1. **트레이 아이콘을 우클릭** → 메뉴에서 **`알림 테스트 (풍선)`** 클릭
2. 기대 동작 (약 7초간 자동 재생):
   - 풍선 ① `새 브리핑 도착 — 새 소식 2건이 들어왔어요. (테스트)`  (약 5초 표시)
   - 풍선 ② (2.5초 뒤) `다가오는 일정 — 15분 뒤 '주간 회의'가 시작돼요. (테스트)`
   - 그 후 **안내창**이 하나 뜸: *"알림 테스트 풍선 2종을 띄우는 코드는 정상 실행됐습니다…"* ← 이 창이 뜨면 **코드는 정상**이고, 풍선만 안 보였다면 Windows 알림 설정 문제
3. **풍선을 클릭**하면 숨겨져 있던 보드 창이 열림

**통과 기준**: 안내창이 뜨고(코드 정상), 두 풍선이 순서대로 보이며, 클릭 시 보드 열림.
풍선만 안 보이면 → 4-3 Windows 알림 설정(알림 허용·배너 표시) / 집중 지원(방해 금지) 끔.

트레이 메뉴 전체 (기능 확인 겸):
| 메뉴 | 동작 |
|---|---|
| 보드 열기 / 숨기기 | 창 표시·숨김 토글 |
| 뉴스 새로고침 | 뉴스 강제 수집 후 UI 새로고침 |
| **알림 테스트 (풍선)** | 위 풍선 2종 표시 (수동 확인용) |
| 항상 위 | 체크 토글 (우상단 스위치와 동기화) |
| 종료 | 앱 완전 종료 |

---

## 4) (선택) 실제 라이브 알림 확인

### 4-1. 실제 "새 브리핑" 알림
- 첫 실행 후 첫 뉴스 수집은 **기준점**으로만 저장 → 알림 없음(의도된 동작)
- 이후 15분 주기 폴링이 **새 헤드라인을 발견하면** 풍선 `새 브리핑 도착 — 새 소식 N건`
- 빠른 확인: 트레이 우클릭 → `뉴스 새로고침`을 간격을 두고 몇 차례 (그 사이 뉴스가 바뀌어야 발동)
- → 당장 풍선 확인이 목표면 **3) 테스트 메뉴**가 정답

### 4-2. 실제 "다가오는 일정" 알림 (iCloud 계정 필요)
1. 보드 우상단 **⚙ 설정** → **네이티브 위젯 연동**
2. Apple ID(이메일) + **앱 특수 암호** 입력 → `연결 저장`
   - 앱 특수 암호: appleid.apple.com → 로그인 및 보안 → **앱별 암호** 생성
3. `일정 표시` **켜기** → 오늘 위젯에 실제 iCloud 일정이 보이면 성공
4. iCloud에 **지금부터 ~10분 이내 시작**하는 일정 추가 → 앱이 시작 전 풍선 표시(같은 일정 1회)

### 4-3. 알림이 아예 안 보일 때 (Windows 설정)
```
Windows 설정 → 시스템 → 알림 → "알림 받기" 켬
  → 목록에서 BriefingBoard → 알림 허용 켬 / 배너 표시 켬
```
(참고: 일부 Windows 버전은 앱이 첫 알림을 보낼 때 허용 여부를 한 번 물어봄)

---

## 5) (개발자용) 소스에서 다시 빌드·실행

소스를 고쳤거나 실행본을 새로 만들고 싶을 때만 필요합니다.

### 사전 요구
| 도구 | 설치처 |
|---|---|
| **Node.js 18+** | https://nodejs.org (LTS) — dist 생성/테스트용 |
| **.NET 8 SDK** | https://dotnet.microsoft.com/download/dotnet/8.0 — 빌드용 |

### 빌드·실행 (더블클릭 1회)
```
native\scripts\build-run.cmd        ← 또는
native\scripts\build-win.ps1 -Run   ← PowerShell
# 옵션: .NET 설치 없이 돌아가게 하려면  build-win.ps1 -Run -SelfContained
```

### 수동 순서
```powershell
cd <워크스페이스 루트>
npm install                          # node_modules 생성 (1회, 소스 포함 안 됨)
node tools/build.js                  # dist\index.html 생성
powershell -ExecutionPolicy Bypass -File native\scripts\build-win.ps1 -Run
# 산출: publish\win-x64\BriefingBoard.exe  (자동 실행됨)
```

### 자동 검증 (선택)
```powershell
npm test                             # JS 105개
cd native\checks\ServerCheck ; dotnet run -c Release     # 서버/API 20개
cd native\checks\CoreCheck   ; dotnet run -c Release --offline   # Core 13개
```

---

## 6) 문제 해결

| 증상 | 원인/해결 |
|---|---|
| 실행 즉시 *".NET Desktop Runtime 필요"* 대화상자 | 1-1 설치 링크에서 **Desktop Runtime 8 (x64)** 설치 |
| SmartScreen 차단 | `추가 정보 → 실행` (서명 없는 개발 빌드) |
| **창이 흰 화면(white-out)** | 아래 **「6-1. 흰 화면 응급 조치」** 참고 |
| *"WebView2 초기화 실패"* | WebView2 Evergreen 런타임 설치 (1-1) |
| 알림 풍선이 안 보임 | **최신 빌드**에서는 테스트 시 안내창이 뜸 → 안내 내용대로 Windows 알림 설정 확인. 그래도 안 보이면 아래 **「6-2. 로그 보내기」** |
| 풍선은 뜨는데 앱이 안 열림 | 풍선 클릭 동작은 트레이 메뉴 `보드 열기/숨기기`로도 확인 가능 |
| 첫 폴링에 "새 브리핑"이 안 뜸 | 정상 — 첫 로드는 기준점 저장. 이후 새 뉴스가 생겨야 발동 |
| 데이터/캐시 위치 | `%LOCALAPPDATA%\BriefingBoard\` (host.json·news-cache.json·notify-state.json·**app.log**) — 지우면 초기화 |

### 6-1. 흰 화면(white-out) 응급 조치 — 순서대로

흰 화면은 대부분 **① 이전 실행 프로세스가 남아 WebView2가 잠긴 경우**, **② WebView2 프로필 캐시가 깨진 경우**입니다.
(코드 쪽도 이제 **자동 복구**(로드 실패 3회 재시도·빈 화면 감지 reload)가 들어가 있지만, 아래 1~2를 먼저 해두면 깨끗합니다.)

1. **모든 프로세스 종료**
   ```
   작업 관리자(Ctrl+Shift+Esc) → 프로세스 탭에서
   BriefingBoard / BriefingBoard.exe  우클릭 → 작업 끝내기
   msedgewebview2.exe  가 있으면 이것도 끝내기
   ```
   (트레이가 남아 있으면 트레이 우클릭 → 종료로 먼저)
2. **WebView2 캐시 삭제** (앱이 다시 만들므로 안전)
   ```
   Win+R → %LOCALAPPDATA%\BriefingBoard  입력 → Enter
   BriefingBoard 폴더에서 WebView2 폴더를 삭제
   ```
   ※ host.json(설정)·news-cache.json은 남겨도 됩니다. 확실히 하려면 폴더째 지워도 무방(설정 초기화).
3. **exe 다시 실행** — `publish\win-x64\BriefingBoard.exe` (web\index.html 과 같은 폴더 확인)
4. 여전히 흰 화면이면 → **「6-2. 로그 보내기」**로 원인을 알려주세요.

### 6-2. 로그 보내기 (무엇이든 안 될 때 가장 빠른 길)

새 빌드부터 실행 과정·알림·오류가 로그에 남습니다. 파일을 열어 내용을 붙여넣어 주세요.
```
Win+R → %LOCALAPPDATA%\BriefingBoard\app.log   → Enter (메모장으로 열림)
```
- 로그에 `BOOT 시작/완료`, `SERVER 시작 — 포트 N`, `NAV ok=True`, `BALLOON 표시 요청 완료`가 보이면 정상 동작.
- `NAV ok=False`, `BLANK 본문 0자`, `예외:` 가 보이면 그 줄이 원인입니다. 그 줄을 그대로 회신에 포함해 주세요.

---

## 6-3. "레지스트리를 건드린 거 아니냐" — 사실 확인

**알림 테스트 버튼·보드 실행은 어떤 시스템 값도 수정하지 않습니다.** 이 앱이 컴퓨터에서 쓰는 곳은 전부 여기뿐입니다:

| 이 앱이 하는 일 | 위치 | 언제 |
|---|---|---|
| 설정·캐시·로그 | `%LOCALAPPDATA%\BriefingBoard\` 폴더 (JSON 4~5개) | 항상 (앱 전용 폴더) |
| Windows 자격증명 저장 | Windows 자격 증명 관리자 | 설정에서 **연결 저장**을 눌렀을 때만 |
| 레지스트리 `HKCU\...\Run` | **로그인 시 자동 시작을 켰을 때만** | 설정 토글 ON (기본: 꺼짐, 절대 자동 X) |

코드 검색 결과 레지스트리 접근은 `AutoStart.cs`(Run 키) **한 곳뿐**이고, 알림 테스트/실행 경로에서는 호출되지 않습니다.

**직접 확인하는 명령** (Win+R → `cmd` → Enter):
```
reg query HKCU\Software\Microsoft\Windows\CurrentVersion\Run
```
→ "BriefingBoard" 항목이 **없으면** 자동 시작은 한 번도 등록된 적이 없습니다.
→ 창/시작 메뉴에 이 앱이 남긴 것이 걱정되면 아래로 전부 되돌릴 수 있습니다(앱 자체 데이터뿐):
```
rmdir /S /Q %LOCALAPPDATA%\BriefingBoard
```
이 폴더는 앱이 다시 만들며, **이것 외에는 지우거나 바꾼 것이 없습니다.**

## 6-4. 이 PC의 원인을 정확히 가르는 진단 (권장)

**A) 셀프테스트 — WebView2 없이 서버·웹 파일·API만 검사**
```
Diagnose-BriefingBoard.cmd   더블클릭
```
- 결과 창 + `%LOCALAPPDATA%\BriefingBoard\selftest.txt` 가 열립니다.
- `[OK] web/index.html 존재 · [OK] GET / 264,xxx바이트 · [OK] GET /api/health` 가 모두 보이면
  → **로컬 서버·웹 파일은 정상**. 흰 화면 원인은 이 PC의 **WebView2** 쪽입니다.

**B) 지금 당장 쓰는 법** — 방법 A 브라우저 모드(`Run-Browser.cmd`): WebView2 없이 정상 사용.

**C) 창(WebView2) 모드를 다시 살리려면 순서대로**
1. `Clean-BriefingBoard.cmd` 실행(이제 **앱을 자동 실행하지 않음** — 프로세스 종료 + WebView2 프로필 삭제만)
   → 이후 설치기가 파일 잠금으로 멈추는 문제 해소
2. WebView2 런타임을 관리자로 재설치: https://developer.microsoft.com/microsoft-edge/webview2/
   → **Evergreen Standalone Installer (x64)** 를 우클릭 → 관리자 권한으로 실행
3. 설치 후 `Start-BriefingBoard.cmd` 로 창 모드 재시도
4. 그래도 흰 화면이면 → **6-5 Fixed Version(자체 내장 WebView2)** 로 시스템 런타임 의존 제거

**D) 앱(웹) 자체가 문제인지 확인** — `publish\win-x64\web\index.html` 을 **더블클릭**
- 보드 데모가 뜨면 웹 파일은 정상 → 위 B/C(WebView2)로. 이마저 안 뜨면 웹 파일 손상 → 다시 받기.

## 6-5. WebView2 Fixed Version 자체 내장 (시스템 WebView2 신뢰 안 함 — 가장 확실)

앱이 시스템 WebView2 대신 **exe 옆 WebView2Runtime 폴더**의 런타임을 쓰도록 되어 있습니다.
폴더만 만들어 넣으면 창(WebView2) 모드가 시스템 상태와 무관하게 동작합니다(이번 빌드부터 자동 감지).

1. https://developer.microsoft.com/microsoft-edge/webview2/ → 다운로드 섹션에서 **Fixed Version** 탭
   → 원하는 버전 + **x64** → `.cab` 파일 다운로드 (~200MB)
2. 관리자 cmd에서 압축 해제:
   ```
   expand "다운로드한\Microsoft.WebView2.FixedVersionRuntime.<버전>.x64.cab" -F:* publish\win-x64\WebView2Runtime
   ```
   (폴더명은 반드시 `WebView2Runtime` — 그 안에 msedgewebview2.exe 가 있어야 함)
3. `Clean-BriefingBoard.cmd` → `Start-BriefingBoard.cmd`
   로그의 `WEB 로드 시작` 줄에 `앱 내장(Fixed: ...)` 로 나오면 성공.

> 번외 사실: 작업관리자에서 `msedgewebview2.exe`가 여러 개(보통 4~8개)인 것은 정상(크로미움 멀티프로세스)입니다.
> `BriefingBoard.exe` 본체가 없는데도 msedgewebview2가 남는다면 그것들은 다른 프로그램의 것이라 건드릴 필요가 없습니다.

## 7) 결과 보고 (회신 양식)

1. 실행 경로: 더블클릭(Start-BriefingBoard.cmd / exe) 중 무엇으로?
2. **알림 테스트 풍선**: ① 새 브리핑 ② 다가오는 일정 — 둘 다 표시 / 일부만 / 안 됨
3. 풍선 클릭 → 보드 열림: 예 / 아니오
4. 오류 메시지가 있었다면 그대로 붙여넣기 (스크린샷 환영)
