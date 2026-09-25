@echo off
rem Stop all BriefingBoard processes (including browser-mode server).
taskkill /F /T /IM BriefingBoard.exe >nul 2>&1
echo Stopped.
pause
