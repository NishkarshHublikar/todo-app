#!/bin/bash
# TodoApp - Startup Script for Kubernetes
# Usage: ./start-k8s.sh

set -euo pipefail

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  📦 TodoApp - Kubernetes Startup"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check prerequisites
echo -e "${BLUE}🔍 Checking prerequisites...${NC}"

if ! command -v kubectl &> /dev/null; then
    echo -e "${YELLOW}❌ kubectl not found. Please install kubectl.${NC}"
    exit 1
fi
echo -e "${GREEN}✅ kubectl found${NC}"

if ! command -v docker &> /dev/null; then
    echo -e "${YELLOW}⚠️  docker not found (optional for Docker builds)${NC}"
else
    echo -e "${GREEN}✅ docker found${NC}"
fi

# Check cluster connectivity
echo ""
echo -e "${BLUE}🔍 Checking Kubernetes cluster...${NC}"

if ! kubectl cluster-info &> /dev/null; then
    echo -e "${YELLOW}❌ Cannot connect to Kubernetes cluster${NC}"
    echo "   Please ensure Docker Desktop Kubernetes is enabled"
    exit 1
fi

CONTEXT=$(kubectl config current-context)
echo -e "${GREEN}✅ Connected to cluster: $CONTEXT${NC}"

# Check if namespace exists
echo ""
echo -e "${BLUE}🔍 Checking todo-app namespace...${NC}"

if kubectl get namespace todo-app &> /dev/null; then
    echo -e "${GREEN}✅ Namespace 'todo-app' exists${NC}"
else
    echo -e "${YELLOW}📝 Creating namespace 'todo-app'...${NC}"
    kubectl create namespace todo-app
    echo -e "${GREEN}✅ Namespace created${NC}"
fi

# Check if secrets exist
echo ""
echo -e "${BLUE}🔍 Checking secrets...${NC}"

if kubectl get secret todo-secrets -n todo-app &> /dev/null; then
    echo -e "${GREEN}✅ Secrets already configured${NC}"
else
    echo -e "${YELLOW}⚠️  No secrets found!${NC}"
    echo "   Please create k8s/secrets.yaml with your credentials"
    echo "   See DEPLOYMENT_GUIDE.md for details"
    echo ""
    echo "   Quick creation:"
    echo "   kubectl create secret generic todo-secrets -n todo-app \\"
    echo '     --from-literal=SUPABASE_URL="..." \\'
    echo '     --from-literal=SUPABASE_SERVICE_ROLE_KEY="..." \\'
    echo "     ... [other credentials]"
    exit 1
fi

# Check if configmap exists
echo ""
echo -e "${BLUE}🔍 Checking ConfigMap...${NC}"

if kubectl get configmap backend-config -n todo-app &> /dev/null; then
    echo -e "${GREEN}✅ ConfigMap configured${NC}"
else
    echo -e "${YELLOW}📝 Creating ConfigMap...${NC}"
    kubectl apply -f k8s/backend/configmap.yaml
    echo -e "${GREEN}✅ ConfigMap created${NC}"
fi

# Deploy applications
echo ""
echo -e "${BLUE}🚀 Deploying to Kubernetes...${NC}"

echo "   Applying namespace..."
kubectl apply -f k8s/namespace.yaml

echo "   Applying backend..."
kubectl apply -f k8s/backend/deployment.yaml
kubectl apply -f k8s/backend/service.yaml
kubectl apply -f k8s/backend/hpa.yaml

echo "   Applying frontend..."
kubectl apply -f k8s/frontend/deployment.yaml
kubectl apply -f k8s/frontend/service.yaml
kubectl apply -f k8s/frontend/hpa.yaml

echo "   Applying Redis..."
kubectl apply -f k8s/redis/deployment.yaml
kubectl apply -f k8s/redis/service.yaml

echo -e "${GREEN}✅ Applications deployed${NC}"

# Wait for pods to be ready
echo ""
echo -e "${BLUE}⏳ Waiting for pods to be ready...${NC}"

kubectl wait --for=condition=ready pod -l app=backend -n todo-app --timeout=300s 2>/dev/null || echo "⚠️  Backend pods still starting..."
kubectl wait --for=condition=ready pod -l app=frontend -n todo-app --timeout=300s 2>/dev/null || echo "⚠️  Frontend pods still starting..."
kubectl wait --for=condition=ready pod -l app=redis -n todo-app --timeout=300s 2>/dev/null || echo "⚠️  Redis pod still starting..."

echo -e "${GREEN}✅ Pods are ready${NC}"

# Show service information
echo ""
echo -e "${BLUE}📋 Service Information${NC}"

echo ""
kubectl get svc -n todo-app

# Get external IPs
echo ""
echo -e "${BLUE}🌐 Access URLs${NC}"

FRONTEND_IP=$(kubectl get svc frontend -n todo-app -o jsonpath='{.status.loadBalancer.ingress[0].ip}' || echo "pending")
BACKEND_IP=$(kubectl get svc backend -n todo-app -o jsonpath='{.status.loadBalancer.ingress[0].ip}' || echo "pending")

echo ""
echo -e "Frontend: ${GREEN}http://${FRONTEND_IP}:8080${NC}"
echo -e "Backend:  ${GREEN}http://${BACKEND_IP}:3001${NC}"

# Show port-forward instructions
echo ""
echo -e "${BLUE}📌 Port Forwarding (if LoadBalancer not available)${NC}"
echo ""
echo "   # Terminal 1 - Frontend"
echo "   kubectl port-forward -n todo-app svc/frontend 8080:8080"
echo ""
echo "   # Terminal 2 - Backend"
echo "   kubectl port-forward -n todo-app svc/backend 3001:3001"
echo ""
echo "   Then access:"
echo "   - Frontend: http://localhost:8080"
echo "   - Backend:  http://localhost:3001"

# Show monitoring commands
echo ""
echo -e "${BLUE}📊 Monitoring Commands${NC}"
echo ""
echo "   # Watch HPA scaling"
echo "   kubectl get hpa -n todo-app --watch"
echo ""
echo "   # View logs"
echo "   kubectl logs -n todo-app deployment/backend -f"
echo ""
echo "   # Check pod status"
echo "   kubectl get pods -n todo-app"
echo ""
echo "   # View metrics"
echo "   kubectl top pods -n todo-app"

# Final status
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo -e "${GREEN}✅ TodoApp is running on Kubernetes!${NC}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "Next steps:"
echo "  1. Test the API: curl http://localhost:3001/health"
echo "  2. Open frontend: http://localhost:8080"
echo "  3. Register a new account"
echo "  4. Create and manage todos"
echo ""
echo "For detailed information, see:"
echo "  - DEPLOYMENT_GUIDE.md  (Comprehensive guide)"
echo "  - PROJECT_STATUS.md    (Current status)"
echo "  - README.md            (Quick start)"
echo ""
