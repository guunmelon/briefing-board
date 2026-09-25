@echo off
rem ============================================================
rem  BriefingBoard - Cleanup (STOP ONLY - does NOT relaunch)
rem  1) Kills ALL BriefingBoard processes (incl. msedgewebview2 children)
rem  2) Deletes the WebView2 profile folder (app recreates it)
rem  Then YOU choose how to start:
rem     - Run-Browser.cmd      (default browser, NO WebView2 window)
rem     - Start-BriefingBoard.cmd  (WebView2 windowed mode)
rem  NOTE: do this BEFORE installing/reinstalling WebView2 Runtime
rem  so no file locks remain.
rem ============================================================
echo.
echo [1/2] Stopping BriefingBoard processes...
taskkill /F /T /IM BriefingBoard.exe  >nul 2>&1
timeout /t 2 /nobreak >nul

echo [2/2] Deleting WebView2 profile (%LOCALAPPDATA%\BriefingBoard\WebView2)...
rmdir /S /Q "%LOCALAPPDATA%\BriefingBoard\WebView2"  >nul 2>&1

echo.
echo Cleaned. Start it your way:
echo   Run-Browser.cmd      - board in your default browser (no WebView2 window)
echo   Start-BriefingBoard.cmd - WebView2 windowed mode
echo.
pause
