@echo off
rem ============================================================
rem  BriefingBoard - Diagnostic (self-test)
rem  Runs the app WITHOUT WebView2 to check: web file, local
rem  HTTP server, and API. Shows a result dialog, then opens
rem  the result + log files for you to copy.
rem ============================================================
set "APP=%~dp0publish\win-x64\BriefingBoard.exe"
set "DIR=%LOCALAPPDATA%\BriefingBoard"

if not exist "%APP%" (
  echo [!] %APP% not found.
  pause
  exit /b 1
)

echo Running self-test (no window will appear - just a dialog)...
"%APP%" --selftest

echo.
if exist "%DIR%\selftest.txt" (
  start notepad "%DIR%\selftest.txt"
  timeout /t 2 /nobreak >nul
  start notepad "%DIR%\app.log"
) else (
  echo [i] selftest.txt was not created.
  pause
  exit /b 1
)

echo.
echo Please send the content of selftest.txt and the last lines of app.log.
pause
