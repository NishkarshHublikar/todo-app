# TodoApp - Startup Script for Kubernetes (Windows PowerShell)
# Usage: .\start-k8s.ps1

param(
    [switch]$NoWait = $false,
    [switch]$PortForward = $false
)

function Write-Step {
    param([string]$Message)
    Write-Host "🔍 $Message" -ForegroundColor Cyan
}

function Write-Success {
    param([string]$Message)
    Write-Host "✅ $Message" -ForegroundColor Green
}

function Write-Warning {
    param([string]$Message)
    Write-Host "⚠️  $Message" -ForegroundColor Yellow
}

function Write-Error {
    param([string]$Message)
    Write-Host "❌ $Message" -ForegroundColor Red
    exit 1
}

Clear-Host

Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Cyan
Write-Host "  📦 TodoApp - Kubernetes Startup (Windows)" -ForegroundColor Cyan
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Cyan
Write-Host ""

# Check prerequisites
Write-Step "Checking prerequisites..."

# Check kubectl
$kubectlCmd = Get-Command kubectl -ErrorAction SilentlyContinue
if (-not $kubectlCmd) {
    Write-Error "kubectl not found. Please install kubectl."
}
Write-Success "kubectl found"

# Check docker (optional)
$dockerCmd = Get-Command docker -ErrorAction SilentlyContinue
if (-not $dockerCmd) {
    Write-Warning "docker not found (optional for Docker builds)"
} else {
    Write-Success "docker found"
}

# Check cluster connectivity
Write-Host ""
Write-Step "Checking Kubernetes cluster..."

$clusterInfo = kubectl cluster-info 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Error "Cannot connect to Kubernetes cluster. Ensure Docker Desktop Kubernetes is enabled."
}

$context = kubectl config current-context
Write-Success "Connected to cluster: $context"

# Check namespace
Write-Host ""
Write-Step "Checking todo-app namespace..."

$nsExists = kubectl get namespace todo-app -ErrorAction SilentlyContinue
if ($nsExists) {
    Write-Success "Namespace 'todo-app' exists"
} else {
    Write-Host "📝 Creating namespace 'todo-app'..." -ForegroundColor Magenta
    kubectl create namespace todo-app
    Write-Success "Namespace created"
}

# Check secrets
Write-Host ""
Write-Step "Checking secrets..."

$secretsExists = kubectl get secret todo-secrets -n todo-app -ErrorAction SilentlyContinue
if ($secretsExists) {
    Write-Success "Secrets already configured"
} else {
    Write-Error @"
No secrets found!
Please create k8s/secrets.yaml with your credentials.
See DEPLOYMENT_GUIDE.md for details.

Quick creation:
  kubectl create secret generic todo-secrets -n todo-app `
    --from-literal=SUPABASE_URL="..." `
    --from-literal=SUPABASE_SERVICE_ROLE_KEY="..." `
    ... [other credentials]
"@
}

# Check ConfigMap
Write-Host ""
Write-Step "Checking ConfigMap..."

$cmExists = kubectl get configmap backend-config -n todo-app -ErrorAction SilentlyContinue
if ($cmExists) {
    Write-Success "ConfigMap configured"
} else {
    Write-Host "📝 Creating ConfigMap..." -ForegroundColor Magenta
    kubectl apply -f k8s/backend/configmap.yaml
    Write-Success "ConfigMap created"
}

# Deploy applications
Write-Host ""
Write-Host "🚀 Deploying to Kubernetes..." -ForegroundColor Green

Write-Host "   Applying namespace..."
kubectl apply -f k8s/namespace.yaml | Out-Null

Write-Host "   Applying backend..."
kubectl apply -f k8s/backend/deployment.yaml | Out-Null
kubectl apply -f k8s/backend/service.yaml | Out-Null
kubectl apply -f k8s/backend/hpa.yaml | Out-Null

Write-Host "   Applying frontend..."
kubectl apply -f k8s/frontend/deployment.yaml | Out-Null
kubectl apply -f k8s/frontend/service.yaml | Out-Null
kubectl apply -f k8s/frontend/hpa.yaml | Out-Null

Write-Host "   Applying Redis..."
kubectl apply -f k8s/redis/deployment.yaml | Out-Null
kubectl apply -f k8s/redis/service.yaml | Out-Null

Write-Success "Applications deployed"

# Wait for pods
if (-not $NoWait) {
    Write-Host ""
    Write-Host "⏳ Waiting for pods to be ready..." -ForegroundColor Yellow
    
    $maxAttempts = 12
    $attempt = 0
    $allReady = $false
    
    while ($attempt -lt $maxAttempts -and -not $allReady) {
        $attempt++
        
        $backendReady = (kubectl get pods -n todo-app -l app=backend --field-selector=status.phase=Running --no-headers 2>/dev/null | Measure-Object).Count -ge 1
        $frontendReady = (kubectl get pods -n todo-app -l app=frontend --field-selector=status.phase=Running --no-headers 2>/dev/null | Measure-Object).Count -ge 1
        $redisReady = (kubectl get pods -n todo-app -l app=redis --field-selector=status.phase=Running --no-headers 2>/dev/null | Measure-Object).Count -ge 1
        
        if ($backendReady -and $frontendReady -and $redisReady) {
            $allReady = $true
            Write-Success "Pods are ready"
        } else {
            Write-Host "   [$attempt/$maxAttempts] Waiting... (Backend: $backendReady, Frontend: $frontendReady, Redis: $redisReady)" -ForegroundColor Gray
            Start-Sleep -Seconds 5
        }
    }
    
    if (-not $allReady) {
        Write-Warning "Pods still starting... This may take a moment."
    }
}

# Show services
Write-Host ""
Write-Host "📋 Service Information" -ForegroundColor Cyan
Write-Host ""

kubectl get svc -n todo-app

# Get external IPs
Write-Host ""
Write-Host "🌐 Access URLs" -ForegroundColor Cyan
Write-Host ""

$services = kubectl get svc -n todo-app -o json | ConvertFrom-Json

$frontendSvc = $services.items | Where-Object { $_.metadata.name -eq "frontend" }
$backendSvc = $services.items | Where-Object { $_.metadata.name -eq "backend" }

$frontendIP = if ($frontendSvc.status.loadBalancer.ingress[0].ip) { $frontendSvc.status.loadBalancer.ingress[0].ip } else { "pending" }
$backendIP = if ($backendSvc.status.loadBalancer.ingress[0].ip) { $backendSvc.status.loadBalancer.ingress[0].ip } else { "pending" }

Write-Host "Frontend: http://${frontendIP}:8080" -ForegroundColor Green
Write-Host "Backend:  http://${backendIP}:3001" -ForegroundColor Green

# Port forwarding
Write-Host ""
Write-Host "📌 Port Forwarding (if LoadBalancer not available)" -ForegroundColor Cyan
Write-Host ""
Write-Host "   # Terminal 1 - Frontend" -ForegroundColor Gray
Write-Host "   kubectl port-forward -n todo-app svc/frontend 8080:8080" -ForegroundColor Yellow
Write-Host ""
Write-Host "   # Terminal 2 - Backend" -ForegroundColor Gray
Write-Host "   kubectl port-forward -n todo-app svc/backend 3001:3001" -ForegroundColor Yellow
Write-Host ""
Write-Host "   Then access:" -ForegroundColor Gray
Write-Host "   - Frontend: http://localhost:8080" -ForegroundColor Yellow
Write-Host "   - Backend:  http://localhost:3001" -ForegroundColor Yellow

if ($PortForward) {
    Write-Host ""
    Write-Host "🔄 Starting port forwarding..." -ForegroundColor Magenta
    
    # Start port forwarding in background
    Start-Process powershell -ArgumentList "-Command", "cd '$PWD'; kubectl port-forward -n todo-app svc/frontend 8080:8080" -NoNewWindow
    Start-Sleep -Seconds 1
    Start-Process powershell -ArgumentList "-Command", "cd '$PWD'; kubectl port-forward -n todo-app svc/backend 3001:3001" -NoNewWindow
    
    Write-Success "Port forwarding started in background"
}

# Monitoring
Write-Host ""
Write-Host "📊 Monitoring Commands" -ForegroundColor Cyan
Write-Host ""
Write-Host "   # Watch HPA scaling" -ForegroundColor Gray
Write-Host "   kubectl get hpa -n todo-app --watch" -ForegroundColor Yellow
Write-Host ""
Write-Host "   # View logs" -ForegroundColor Gray
Write-Host "   kubectl logs -n todo-app deployment/backend -f" -ForegroundColor Yellow
Write-Host ""
Write-Host "   # Check pod status" -ForegroundColor Gray
Write-Host "   kubectl get pods -n todo-app" -ForegroundColor Yellow
Write-Host ""
Write-Host "   # View metrics" -ForegroundColor Gray
Write-Host "   kubectl top pods -n todo-app" -ForegroundColor Yellow

# Final status
Write-Host ""
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Cyan
Write-Host "✅ TodoApp is running on Kubernetes!" -ForegroundColor Green
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Cyan
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Magenta
Write-Host "  1. Test the API: Invoke-WebRequest -Uri http://localhost:3001/health" -ForegroundColor Yellow
Write-Host "  2. Open frontend: http://localhost:8080" -ForegroundColor Yellow
Write-Host "  3. Register a new account" -ForegroundColor Yellow
Write-Host "  4. Create and manage todos" -ForegroundColor Yellow
Write-Host ""
Write-Host "For detailed information, see:" -ForegroundColor Magenta
Write-Host "  - DEPLOYMENT_GUIDE.md  (Comprehensive guide)" -ForegroundColor Yellow
Write-Host "  - PROJECT_STATUS.md    (Current status)" -ForegroundColor Yellow
Write-Host "  - README.md            (Quick start)" -ForegroundColor Yellow
Write-Host ""
