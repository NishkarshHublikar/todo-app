#!/usr/bin/env bash
# deploy.sh — Build images, push to registry, apply all k8s manifests
# Usage: ./deploy.sh <registry> <domain>
# Example: ./deploy.sh docker.io/myusername todo.mysite.com
set -euo pipefail

# ─── Args ─────────────────────────────────────────────────────────────────────
REGISTRY="${1:-}"
DOMAIN="${2:-}"

if [[ -z "$REGISTRY" || -z "$DOMAIN" ]]; then
  echo "Usage: $0 <registry> <domain>"
  echo "  registry  e.g. docker.io/youruser  or  ghcr.io/yourorg"
  echo "  domain    e.g. todo.yourdomain.com  or  192.168.1.10"
  exit 1
fi

TAG="${IMAGE_TAG:-latest}"
BACKEND_IMAGE="$REGISTRY/todo-backend:$TAG"
FRONTEND_IMAGE="$REGISTRY/todo-frontend:$TAG"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  TodoApp Deployment"
echo "  Registry : $REGISTRY"
echo "  Domain   : $DOMAIN"
echo "  Tag      : $TAG"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# ─── Build ────────────────────────────────────────────────────────────────────
echo ""
echo "▶ Building backend..."
docker build -t "$BACKEND_IMAGE" ./backend

echo ""
echo "▶ Building frontend..."
docker build -t "$FRONTEND_IMAGE" ./frontend

# ─── Push ─────────────────────────────────────────────────────────────────────
echo ""
echo "▶ Pushing images..."
docker push "$BACKEND_IMAGE"
docker push "$FRONTEND_IMAGE"

# ─── Patch k8s manifests with actual registry and domain ──────────────────────
echo ""
echo "▶ Patching k8s manifests..."

# Work on temp copies so originals stay as templates
cp -r k8s /tmp/k8s-patched

sed -i "s|YOUR_REGISTRY/todo-backend:latest|$BACKEND_IMAGE|g"  /tmp/k8s-patched/backend/deployment.yaml
sed -i "s|YOUR_REGISTRY/todo-frontend:latest|$FRONTEND_IMAGE|g" /tmp/k8s-patched/frontend/deployment.yaml
sed -i "s|YOUR_DOMAIN|$DOMAIN|g" \
  /tmp/k8s-patched/backend/configmap.yaml \
  /tmp/k8s-patched/frontend/deployment.yaml \
  /tmp/k8s-patched/ingress.yaml

# ─── Check secrets exist ──────────────────────────────────────────────────────
if kubectl get secret todo-secrets -n todo-app &>/dev/null; then
  echo "✅ Secret todo-secrets already exists — skipping"
else
  echo ""
  echo "⚠️  Secret todo-secrets not found in namespace todo-app."
  echo "   Fill in k8s/secrets.yaml and run:"
  echo "   kubectl apply -f k8s/secrets.yaml"
  echo ""
  echo "   Continuing with rest of deployment..."
fi

# ─── Apply ────────────────────────────────────────────────────────────────────
echo ""
echo "▶ Applying manifests..."

kubectl apply -f /tmp/k8s-patched/namespace.yaml

# Infrastructure first (Postgres, Redis)
kubectl apply -f /tmp/k8s-patched/postgres/
kubectl apply -f /tmp/k8s-patched/redis/

echo "⏳ Waiting for Postgres to be ready..."
kubectl rollout status deployment/postgres -n todo-app --timeout=120s

# App services
kubectl apply -f /tmp/k8s-patched/backend/
kubectl apply -f /tmp/k8s-patched/frontend/
kubectl apply -f /tmp/k8s-patched/ingress.yaml

echo ""
echo "⏳ Waiting for backend rollout..."
kubectl rollout status deployment/backend -n todo-app --timeout=120s

echo "⏳ Waiting for frontend rollout..."
kubectl rollout status deployment/frontend -n todo-app --timeout=120s

# ─── Status ───────────────────────────────────────────────────────────────────
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Deployment complete ✅"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
kubectl get pods     -n todo-app
echo ""
kubectl get hpa      -n todo-app
echo ""
kubectl get ingress  -n todo-app
echo ""
echo "  App URL: http://$DOMAIN"

rm -rf /tmp/k8s-patched
