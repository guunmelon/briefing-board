# ============================================================
# BriefingBoard — Windows 빌드·실행 스크립트
# 사용:  powershell -ExecutionPolicy Bypass -File build-win.ps1 [-Run] [-SelfContained]
#   기본  : 배포 폴더에 프레임워크 의존(framework-dependent) publish
#   -Run  : 빌드 후 앱 실행
#   -SelfContained : .NET 8 Desktop Runtime 설치 없이 도는 단일 배포(용량 큼 ~100MB)
# 산출:  publish\win-x64\BriefingBoard.exe
# ============================================================
param(
  [switch]$Run,
  [switch]$SelfContained
)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot          # native/
$proj = Join-Path $root 'src\BriefingBoard.Host\BriefingBoard.Host.csproj'
$out  = Join-Path (Split-Path -Parent $root) 'publish\win-x64'   # briefing-board/publish/win-x64

Write-Host "== BriefingBoard Windows 빌드 ==" -ForegroundColor Cyan

# 0) 웹 UI(dist) 재생성 — node 가 있으면 실행 (없으면 기존 dist 사용)
$web = Join-Path (Split-Path -Parent $root) 'dist\index.html'
if (-not (Test-Path $web)) {
  if (Get-Command node -ErrorAction SilentlyContinue) {
    Write-Host "→ dist 없음: node tools/build.js 실행" -ForegroundColor Yellow
    Push-Location (Split-Path -Parent $root)
    node tools/build.js
    Pop-Location
  } else {
    Write-Host "! dist\index.html 없고 node 도 없습니다. 브라우저 빌드 먼저 필요(README)." -ForegroundColor Red
    exit 1
  }
} else {
  Write-Host "→ dist\index.html 사용 (재생성하려면: node tools/build.js)" -ForegroundColor DarkGray
}

# 1) 필요시 .NET 8 SDK 확인
$dotnet = Get-Command dotnet -ErrorAction SilentlyContinue
if (-not $dotnet) {
  Write-Host "! .NET 8 SDK 가 필요합니다 → https://dotnet.microsoft.com/download/dotnet/8.0" -ForegroundColor Red
  exit 1
}

# 2) publish
$rid = 'win-x64'
$args = @('publish', $proj, '-c', 'Release', '-r', $rid, '-o', $out)
if ($SelfContained) { $args += '--self-contained', 'true' }
else               { $args += '--self-contained', 'false' }
Write-Host "→ dotnet $($args -join ' ')" -ForegroundColor DarkGray
& dotnet @args
if ($LASTEXITCODE -ne 0) { Write-Host "빌드 실패" -ForegroundColor Red; exit $LASTEXITCODE }

$exe = Join-Path $out 'BriefingBoard.exe'
Write-Host ""
Write-Host "완료: $exe" -ForegroundColor Green
if (-not $SelfContained) {
  Write-Host "주의: 프레임워크 의존 빌드입니다. Windows 10/11에서 실행 전에" -ForegroundColor Yellow
  Write-Host "      '.NET 8.0 Desktop Runtime' 설치 필요(아니면 -SelfContained 로 재빌드)."
}
if ($Run) { Start-Process $exe }
