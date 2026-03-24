# check-orthanc.ps1
# Verifies that Orthanc is reachable before starting cargo tauri dev.
# Usage: .\check-orthanc.ps1 [-Port 8042] [-MaxWait 30]

param(
    [int]$Port = 8042,
    [int]$MaxWait = 30
)

$url = "http://127.0.0.1:$Port/system"
$waited = 0

Write-Host "Checking Orthanc at $url ..." -ForegroundColor Cyan

while ($waited -lt $MaxWait) {
    try {
        $resp = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 2 -ErrorAction Stop
        if ($resp.StatusCode -eq 200) {
            $info = $resp.Content | ConvertFrom-Json -ErrorAction SilentlyContinue
            $version = if ($info.Version) { $info.Version } else { "unknown" }
            Write-Host "Orthanc is running (version $version)" -ForegroundColor Green
            exit 0
        }
    } catch {
        # not ready yet
    }
    $waited++
    Write-Host "  Waiting for Orthanc... ($waited/$MaxWait)" -ForegroundColor Yellow
    Start-Sleep -Seconds 1
}

Write-Host ""
Write-Host "ERROR: Orthanc is not reachable on port $Port after ${MaxWait}s." -ForegroundColor Red
Write-Host "Please start Orthanc before running cargo tauri dev." -ForegroundColor Red
Write-Host "  Download: https://orthanc.uclouvain.be/downloads/windows-msvc/" -ForegroundColor Gray
exit 1
