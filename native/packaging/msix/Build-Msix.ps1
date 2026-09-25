# =====================================================================
# BriefingBoard MSIX 패키지 빌드 (Windows 전용 — PowerShell)
#
# 사전 요구:
#   - .NET 8 SDK  (dotnet publish 로 win-x64 산출물 준비)
#   - Windows SDK (makeappx.exe / signtool.exe 포함) — 대부분 Windows 10/11
#     SDK 설치는: winget install Microsoft.WindowsSDK  (또는 Visual Studio Installer)
#
# 사용:
#   .\Build-Msix.ps1                        # 산출물 자동 publish → msix 패킹
#   .\Build-Msix.ps1 -PublishDir C:\out\win-x64   # 기존 publish 폴더 사용
#   .\Build-Msix.ps1 -NewTestCert           # 테스트 코드서명 인증서 생성+설치+서명
#   .\Build-Msix.ps1 -SkipSign              # 서명 없이 패킹만 (설치 불가 테스트용)
#
# 산출:  publish\win-x64\..\..\BriefingBoard.msix (실행 위치 기준 out 폴더)
# 설치(개발):
#   .\Build-Msix.ps1 -NewTestCert           # 최초 1회 — 신뢰 루트에 인증서 등록
#   Add-AppxPackage -Path .\BriefingBoard_0.1.0.0_x64.msix
#   시작 메뉴/앱 실행 별칭 'BriefingBoard' 로 실행
# =====================================================================
param(
    [string]$PublishDir = "",
    [switch]$NewTestCert,
    [switch]$SkipSign,
    [string]$CertSubject = "CN=Localhost, O=BriefingBoard, C=US",
    [string]$CertPfxPass = "BriefingBoard-dev-2026"
)

$ErrorActionPreference = "Stop"
$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..\..")
$outDir   = Join-Path $repoRoot "publish\msix"

function Find-Tool([string]$name) {
    $roots = @(
        "${env:ProgramFiles(x86)}\Windows Kits\10\bin",
        "${env:ProgramFiles}\Windows Kits\10\bin"
    )
    foreach ($root in $roots) {
        if (-not (Test-Path $root)) { continue }
        foreach ($ver in (Get-ChildItem $root -Directory -ErrorAction SilentlyContinue |
                          Sort-Object Name -Descending)) {
            $cand = Join-Path $ver.FullName "x64\$name"
            if (Test-Path $cand) { return $cand }
        }
    }
    $cand2 = Get-Command $name -ErrorAction SilentlyContinue
    if ($cand2) { return $cand2.Source }
    throw "$name 를 찾을 수 없습니다. Windows SDK(10.x)를 설치하세요: winget install Microsoft.WindowsSDK"
}

Write-Host "repoRoot: $repoRoot"

# ---- 1) win-x64 산출물 준비 ----
if (-not $PublishDir) {
    Write-Host "dotnet publish -r win-x64 ..."
    Push-Location (Join-Path $repoRoot "native\src\BriefingBoard.Host")
    try {
        dotnet publish -c Release -r win-x64 --self-contained false -o (Join-Path $outDir "stage") | Out-Null
        if ($LASTEXITCODE -ne 0) { throw "dotnet publish 실패" }
    } finally { Pop-Location }
    $PublishDir = Join-Path $outDir "stage"
}
if (-not (Test-Path (Join-Path $PublishDir "BriefingBoard.exe"))) {
    throw "publish 폴더에 BriefingBoard.exe 가 없습니다: $PublishDir"
}

# ---- 2) msix 스테이징 폴더 구성 ----
$stage = Join-Path $outDir "msix-stage"
$msixAssets = Join-Path $PSScriptRoot "assets"
if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
New-Item -ItemType Directory -Force -Path $stage | Out-Null

Copy-Item (Join-Path $PSScriptRoot "AppxManifest.xml") $stage
Copy-Item $msixAssets (Join-Path $stage "assets") -Recurse

# 앱 산출물 전체(웹 콘텐츠 포함) + Manifest 에서 참조
Copy-Item (Join-Path $PublishDir "*") $stage -Recurse -Force

# ---- 3) makeappx 패킹 ----
$makeappx = Find-Tool "makeappx.exe"
$ver = [regex]::Match([System.IO.Path]::GetFileName((Split-Path (Split-Path $makeappx -Parent) -Parent)), "\d+\.\d+\.\d+").Value
$msixName = "BriefingBoard_0.1.0.0_x64.msix"
$msixPath = Join-Path $outDir $msixName
if (Test-Path $msixPath) { Remove-Item $msixPath -Force }

Write-Host "makeappx pack → $msixPath"
& $makeappx pack /d $stage /p $msixPath /o
if ($LASTEXITCODE -ne 0) { throw "makeappx pack 실패" }

# ---- 4) 서명 ----
if (-not $SkipSign) {
    $signtool = Find-Tool "signtool.exe"
    $cert = $null
    if ($NewTestCert) {
        Write-Host "테스트 코드서명 인증서 생성/설치 ..."
        $cert = New-SelfSignedCertificate -Type CodeSigningCert `
            -Subject $CertSubject -CertStoreLocation Cert:\CurrentUser\My `
            -NotAfter (Get-Date).AddYears(3)
        $pfx = Join-Path $outDir "briefingboard-test.pfx"
        $pwd = ConvertTo-SecureString -String $CertPfxPass -Force -AsPlainText
        Export-PfxCertificate -Cert $cert -FilePath $pfx -Password $pwd | Out-Null
        # 신뢰(루트) 저장소에 등록 → Add-AppxPackage 가 서명을 인정
        Import-PfxCertificate -FilePath $pfx -CertStoreLocation Cert:\CurrentUser\Root -Password $pwd | Out-Null
        Write-Host "  인증서 지문: $($cert.Thumbprint)"
        Write-Host "  ※ 새 컴퓨터에서 설치하려면 이 pfx 를 루트 저장소에 등록하거나 enterprise 인증서로 다시 서명하세요."
    }
    if (-not $cert) {
        $cert = Get-ChildItem Cert:\CurrentUser\My -CodeSigningCert | Select-Object -First 1
        if (-not $cert) { throw "코드서명 인증서가 없습니다. -NewTestCert 를 쓰세요." }
    }
    Write-Host "sign → $($cert.Subject)"
    & $signtool sign /fd SHA256 /a /sha1 $cert.Thumbprint /v $msixPath | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "signtool 서명 실패" }
}

Remove-Item $stage -Recurse -Force -ErrorAction SilentlyContinue
Write-Host ""
Write-Host "완료: $msixPath"
if (-not $SkipSign) {
    Write-Host "설치: Add-AppxPackage -Path `"$msixPath`""
}
Write-Host "실행: 시작 메뉴의 BriefingBoard 또는 터미널에서 BriefingBoard"
