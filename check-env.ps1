# check-env.ps1 — Verify if the environment is ready for Docker and Kubernetes

function Check-Command {
    param($cmd)
    $path = Get-Command $cmd -ErrorAction SilentlyContinue
    if ($path) {
        Write-Host "✅ $cmd is available at $($path.Source)" -ForegroundColor Green
        return $true
    } else {
        Write-Host "❌ $cmd NOT found in PATH" -ForegroundColor Red
        return $false
    }
}

Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Cyan
Write-Host "  TodoApp Environment Check" -ForegroundColor Cyan
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Cyan

$dockerOk = Check-Command "docker"
$kubekOk  = Check-Command "kubectl"

if ($dockerOk) {
    Write-Host "`nTesting Docker Engine..." -ForegroundColor Cyan
    docker version --format '{{.Server.Version}}' 2>$null | Out-Null
    if ($LASTEXITCODE -eq 0) {
        Write-Host "✅ Docker Engine is RUNNING" -ForegroundColor Green
    } else {
        Write-Host "❌ Docker Engine is NOT RUNNING. Please start Docker Desktop." -ForegroundColor Yellow
    }
}

if ($kubekOk) {
    Write-Host "`nTesting Kubernetes Context..." -ForegroundColor Cyan
    kubectl config current-context 2>$null | Out-Host
    if ($LASTEXITCODE -eq 0) {
        Write-Host "✅ Kubernetes is READY" -ForegroundColor Green
    } else {
        Write-Host "❌ Kubernetes is NOT READY. Enable it in Docker Desktop Settings → Kubernetes." -ForegroundColor Yellow
    }
}

Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Cyan
if (-not $dockerOk -or -not $kubekOk) {
    Write-Host "TIP: If you just installed Docker, restart your terminal." -ForegroundColor Gray
}
