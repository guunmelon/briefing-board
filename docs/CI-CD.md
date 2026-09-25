# GitHub Actions 자동 빌드(CI/CD) 환경 가이드

본 프로젝트는 서비스 확장 및 크로스 플랫폼 앱 전환에 대비하여 **GitHub Actions 기반의 자동 빌드 및 검증(CI/CD) 파이프라인**이 완전히 구성되어 있습니다.

---

## 1. 파이프라인 구성 요약

GitHub Actions 워크플로 파일: `.github/workflows/ci.yml`

```
┌───────────────────────────────────────────────────────────────┐
│                    GitHub Trigger (Push / PR)                 │
└───────────────────────────────┬───────────────────────────────┘
                                │
        ┌───────────────────────┴───────────────────────┐
        ▼                                               ▼
┌───────────────────────────────┐               ┌───────────────────────────────┐
│  Job 1-A: Ubuntu Linux Runner │               │ Job 1-B: Windows Server Runner│
│  (Node 18.x / 20.x / 22.x)    │               │  (Node 18.x / 20.x / 22.x)    │
│  • npm ci                     │               │  • npm ci                     │
│  • npm run build (Bundle 검증)│               │  • npm run build              │
│  • npm test (205개 전수 테스트)│               │  • npm test (205개 전수 테스트)│
└───────────────┬───────────────┘               └───────────────┬───────────────┘
                │                                               │
                └───────────────────────┬───────────────────────┘
                                        ▼
                        ┌───────────────────────────────┐
                        │ Job 2: Build & Package Bundle │
                        │ • dist/index.html 번들 생성   │
                        │ • Windows 실행 스크립트 패키징│
                        │ • zip 아티팩트 업로드 (30일 보관)│
                        └───────────────┬───────────────┘
                                        ▼ (on: main push)
                        ┌───────────────────────────────┐
                        │ Job 3: GitHub Pages 배포      │
                        │ • 온라인 라이브 대시보드 자동 배포│
                        │   (https://<user>.github.io/) │
                        └───────────────────────────────┘
```

---

## 2. 주요 Job 및 역할

### ① `test` (Multi-OS & Node Matrix 테스트)
* **운영체제(OS)**: `ubuntu-latest`, `windows-latest`
* **Node.js 버전**: `18.x`, `20.x`, `22.x` (LTS 버전 전수 검증)
* **검증 내용**:
  1. `npm ci`: 클린 의존성 설치
  2. `npm run build`: 단일 파일 웹 대시보드(`dist/index.html`) 빌드 및 최소 용량/무결성 검사
  3. `npm test`: 전체 205개 테스트 슈트 실행 (Core 89 + Patch 34 + DOM 20 + Native 62)

### ② `package` (배포용 번들 생성 및 아티팩트 업로드)
* 모든 테스트 통과 후 실행
* `dist/index.html` 단독 웹 대시보드 및 Windows 실행 스크립트(`start.bat`, `create-desktop-shortcut.bat`, `open-browser.bat`, `publish/`)를 `briefing-board-release.zip`으로 묶어 GitHub Actions 아티팩트로 자동 업로드

### ③ `deploy-pages` (GitHub Pages 자동 배포)
* `main` 브랜치에 코드가 push/merge될 때 자동 실행
* `dist/` 정적 대시보드를 GitHub Pages에 배포하여 온라인 브라우저에서 바로 사용 가능

---

## 3. GitHub 리포지토리 연동 방법

내 컴퓨터 또는 작업 환경에서 GitHub 원격 저장소에 push하려면 다음 명령어를 실행합니다:

```bash
# 1. 원격 리포지토리 등록 (본인 GitHub 주소)
git remote add origin https://github.com/<YOUR_GITHUB_USERNAME>/briefing-board.git

# 2. main 브랜치로 최신 코드 푸시
git branch -M main
git push -u origin main
```

푸시 즉시 GitHub 저장소의 **[Actions]** 탭에서 6개 매트릭스(OS 2종 × Node 3종)의 자동 빌드와 테스트가 실시간으로 실행됩니다.

---

## 4. 로컬 CI 사전 검증 명령어

GitHub에 커밋을 올리기 전에 로컬에서 CI와 동일한 빌드 및 테스트를 한 번에 검증할 수 있습니다:

```bash
npm run check
# 또는
npm run ci
```
