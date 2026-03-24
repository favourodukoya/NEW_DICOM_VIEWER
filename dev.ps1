# dev.ps1 — Start Ukubona Viewer in development mode
# Usage: .\dev.ps1

Set-Location $PSScriptRoot

# 1. Check Orthanc is running
Write-Host "==> Checking Orthanc..." -ForegroundColor Cyan
& "$PSScriptRoot\check-orthanc.ps1" -Port 8042 -MaxWait 10
if ($LASTEXITCODE -ne 0) {
    Write-Host ""
    Write-Host "Tip: Start Orthanc.exe then re-run .\dev.ps1" -ForegroundColor Yellow
    exit 1
}

# 2. Launch Tauri dev (starts rsbuild dev server + Rust backend + desktop window)
Write-Host ""
Write-Host "==> Starting cargo tauri dev..." -ForegroundColor Cyan
cargo tauri dev
