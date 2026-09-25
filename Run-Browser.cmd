@echo off
rem ============================================================
rem  BriefingBoard - Browser mode (NO WebView2 window)
rem  Starts the local server and opens the board in your DEFAULT
rem  browser (the one that already shows web/index.html fine).
rem  Tray icon (종료) ends the server.
rem ============================================================
set "APP=%~dp0publish\win-x64\BriefingBoard.exe"
if not exist "%APP%" (
  echo [!] %APP% not found.
  pause
  exit /b 1
)
start "" "%APP%" --browser
exit /b 0
