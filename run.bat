@echo off
setlocal enabledelayedexpansion
rem ============================================================
rem  AI 브리핑 보드 (BriefingBoard) - 원클릭 실행기
rem  - 네이버 웨일(Whale), 크롬, 엣지 등 모든 브라우저 자동 오픈 지원
rem  - 바탕화면 및 어디서나 실행 지원
rem ============================================================

chcp 65001 >nul
title AI 브리핑 보드 (BriefingBoard)

set "CONFIG_DIR=%LOCALAPPDATA%\BriefingBoard"
set "CONFIG_FILE=%CONFIG_DIR%\project_path.txt"
set "FOUND_DIR="

rem 1) 현재 위치 기준 확인
set "BASE_DIR=%~dp0"
if exist "%BASE_DIR%tools\build.js" (
    set "FOUND_DIR=%BASE_DIR%"
    goto :DIR_FOUND
)
if exist "%BASE_DIR%briefing-board\tools\build.js" (
    set "FOUND_DIR=%BASE_DIR%briefing-board"
    goto :DIR_FOUND
)

rem 2) 이전에 저장된 경로 확인
if exist "%CONFIG_FILE%" (
    set /p SAVED_DIR=<"%CONFIG_FILE%"
    if exist "!SAVED_DIR!\tools\build.js" (
        set "FOUND_DIR=!SAVED_DIR!"
        goto :DIR_FOUND
    )
)

rem 3) 윈도우 주요 사용자 폴더 자동 탐색
set "CANDIDATES[0]=%USERPROFILE%\Downloads\briefing-board"
set "CANDIDATES[1]=%USERPROFILE%\Downloads\briefing-board-main"
set "CANDIDATES[2]=%USERPROFILE%\Documents\briefing-board"
set "CANDIDATES[3]=%USERPROFILE%\Desktop\briefing-board"
set "CANDIDATES[4]=%USERPROFILE%\briefing-board"
set "CANDIDATES[5]=%USERPROFILE%\source\repos\briefing-board"
set "CANDIDATES[6]=C:\briefing-board"
set "CANDIDATES[7]=D:\briefing-board"
set "CANDIDATES[8]=E:\briefing-board"

for /L %%i in (0,1,8) do (
    set "CAND=!CANDIDATES[%%i]!"
    if exist "!CAND!\tools\build.js" (
        set "FOUND_DIR=!CAND!"
        goto :DIR_FOUND
    )
)

rem 4) PowerShell 빠른 검색
echo [안내] 프로젝트 위치를 찾는 중...
for /f "usebackq delims=" %%p in (`powershell -NoProfile -Command "Get-ChildItem -Path $env:USERPROFILE -Filter 'build.js' -Recurse -Depth 4 -ErrorAction SilentlyContinue | Where-Object { $_.FullName -like '*tools*build.js' } | Select-Object -First 1 | ForEach-Object { $_.Directory.Parent.FullName }"`) do (
    if exist "%%p\tools\build.js" (
        set "FOUND_DIR=%%p"
        goto :DIR_FOUND
    )
)

rem 5) 사용자 입력 요청
echo.
echo ============================================================
echo   [!] briefing-board 폴더를 찾지 못했습니다.
echo   다운로드받은 폴더를 이 창으로 끌어다 놓아주세요.
echo ============================================================
set /p USER_INPUT="폴더 경로 입력: "
set "USER_INPUT=!USER_INPUT:"=!"

if exist "!USER_INPUT!\tools\build.js" (
    set "FOUND_DIR=!USER_INPUT!"
    goto :DIR_FOUND
)
if exist "!USER_INPUT!\briefing-board\tools\build.js" (
    set "FOUND_DIR=!USER_INPUT!\briefing-board"
    goto :DIR_FOUND
)

echo [오류] 경로를 찾을 수 없습니다: "!USER_INPUT!"
pause
exit /b 1

:DIR_FOUND
if not exist "%CONFIG_DIR%" mkdir "%CONFIG_DIR%" >nul 2>&1
echo %FOUND_DIR%>"%CONFIG_FILE%" 2>nul

cd /d "%FOUND_DIR%"

rem Node.js 설치 확인
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo.
    echo [!] Node.js가 설치되어 있지 않습니다. https://nodejs.org 에서 설치해 주세요.
    pause
    exit /b 1
)

echo ============================================================
echo   AI 브리핑 보드 (BriefingBoard) 실행 중...
echo   위치: %FOUND_DIR%
echo ============================================================
echo.

echo [1/3] 단일 배포 파일 빌드 중 (src -^> dist/index.html)...
node tools/build.js
if %errorlevel% neq 0 (
    echo [!] 빌드 중 오류가 발생했습니다.
    pause
    exit /b 1
)
echo      -^> 빌드 완료!
echo.

echo [2/3] 브라우저(웨일 / 기본 브라우저)를 엽니다...

rem 브라우저 오픈용 헬퍼 실행 (웨일 우선 탐색 -> 쉘 프로토콜 -> 기본 브라우저 순차 시도)
start "" cmd /c "timeout /t 1 /nobreak >nul & (if exist "%LOCALAPPDATA%\Naver\Naver Whale\Application\whale.exe" (start "" "%LOCALAPPDATA%\Naver\Naver Whale\Application\whale.exe" "http://localhost:8420") else if exist "C:\Program Files\Naver\Naver Whale\Application\whale.exe" (start "" "C:\Program Files\Naver\Naver Whale\Application\whale.exe" "http://localhost:8420") else if exist "C:\Program Files (x86)\Naver\Naver Whale\Application\whale.exe" (start "" "C:\Program Files (x86)\Naver\Naver Whale\Application\whale.exe" "http://localhost:8420") else (rundll32 url.dll,FileProtocolHandler http://localhost:8420 || powershell -NoProfile -Command "Start-Process 'http://localhost:8420'"))"

echo      -^> 브라우저 주소: http://localhost:8420
echo.

echo [3/3] 미니 실시간 데이터 서버를 시작합니다 (포트: 8420)...
echo.
echo ============================================================
echo   * 주식, 환율, 비트코인, F1/스포츠, 날씨 실시간 연동 중
echo   * 혹시 브라우저가 안 뜨면 주소창에 직접 입력해 주세요:
echo     http://localhost:8420
echo   * 창을 닫거나 Ctrl+C를 누르면 서버가 종료됩니다.
echo ============================================================
echo.

node tools/live-server.js --dir dist
pause
