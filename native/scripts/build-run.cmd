@echo off
rem BriefingBoard — 빌드 후 실행 (더블클릭)
rem 셀프컨테인드로 만들려면 아래 한 줄을 build-win.ps1 -Run -SelfContained 로
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0build-win.ps1" -Run
pause
