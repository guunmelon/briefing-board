@echo off
rem ============================================================
rem  BriefingBoard - quick launcher (prebuilt binary)
rem  Double-click to start. No Node/.NET SDK needed.
rem  Requires: .NET 8 Desktop Runtime (x64) on this PC.
rem ============================================================
set "APP=%~dp0publish\win-x64\BriefingBoard.exe"

if not exist "%APP%" (
  echo [!] %APP% not found.
  echo     Build it first with:  powershell -ExecutionPolicy Bypass -File native\scripts\build-win.ps1 -Run
  echo     (needs .NET 8 SDK + Node.js)
  pause
  exit /b 1
)

echo Starting BriefingBoard ...
start "" "%APP%"
exit /b 0
