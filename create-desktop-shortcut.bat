@echo off
rem ============================================================
rem  바탕화면에 'AI 브리핑 보드' 바로가기(.lnk) 생성 스크립트
rem ============================================================
chcp 65001 >nul
set "TARGET_DIR=%~dp0"
set "TARGET_BAT=%TARGET_DIR%start.bat"

powershell -NoProfile -Command "$WshShell = New-Object -ComObject WScript.Shell; $Shortcut = $WshShell.CreateShortcut([Environment]::GetFolderPath('Desktop') + '\AI 브리핑 보드.lnk'); $Shortcut.TargetPath = '%TARGET_BAT%'; $Shortcut.WorkingDirectory = '%TARGET_DIR%'; $Shortcut.Description = 'AI 브리핑 보드 실행'; $Shortcut.Save();"

echo.
echo ============================================================
echo   [완료] 바탕화면에 'AI 브리핑 보드' 바로가기가 생성되었습니다!
echo   이제 바탕화면의 바로가기를 더블클릭하시면 바로 실행됩니다.
echo ============================================================
echo.
timeout /t 3
