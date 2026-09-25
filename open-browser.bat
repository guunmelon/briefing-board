@echo off
chcp 65001 >nul
if exist "%LOCALAPPDATA%\Naver\Naver Whale\Application\whale.exe" (
    start "" "%LOCALAPPDATA%\Naver\Naver Whale\Application\whale.exe" "http://localhost:8420"
) else if exist "C:\Program Files\Naver\Naver Whale\Application\whale.exe" (
    start "" "C:\Program Files\Naver\Naver Whale\Application\whale.exe" "http://localhost:8420"
) else if exist "C:\Program Files (x86)\Naver\Naver Whale\Application\whale.exe" (
    start "" "C:\Program Files (x86)\Naver\Naver Whale\Application\whale.exe" "http://localhost:8420"
) else (
    rundll32 url.dll,FileProtocolHandler http://localhost:8420 || powershell -NoProfile -Command "Start-Process 'http://localhost:8420'"
)
