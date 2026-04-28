# TodoApp Deployment Guide

> Full-stack production-ready application with Node.js, PostgreSQL (Supabase), Redis, JWT Auth, GitHub OAuth, Razorpay payments, and Kubernetes orchestration.

---

## Table of Contents

1. [Quick Start](#quick-start)
2. [Architecture](#architecture)
3. [Deployment Options](#deployment-options)
4. [API Documentation](#api-documentation)
5. [Features](#features)
6. [Configuration](#configuration)
7. [Monitoring & Scaling](#monitoring--scaling)
8. [Troubleshooting](#troubleshooting)

---

## Quick Start

### Local Development (Node.js)

```bash
# Install dependencies
npm run install:backend

# Configure environment
cp backend/.env.example backend/.env
# Edit backend/.env with your Supabase and GitHub OAuth credentials

# Start backend & frontend
npm run dev
```

Access:
- Frontend: http://localhost:8080
- Backend API: http://localhost:3001

### Kubernetes (Production)

```bash
# Prerequisites
kubectl cluster-info  # Verify cluster access
kubectl get nodes     # Should have at least 1 node

# Deploy to K8s
kubectl apply -f k8s/namespace.yaml
kubectl apply -f k8s/backend/configmap.yaml
# Create secrets (see Configuration section)
kubectl apply -f k8s/backend/ k8s/frontend/ k8s/redis/

# Port forward for local access
kubectl port-forward -n todo-app svc/frontend 8080:8080 &
kubectl port-forward -n todo-app svc/backend 3001:3001 &
```

---

## Architecture

```
┌─────────────────────┐
│   Browser/Client    │
└──────────┬──────────┘
           │ HTTP/HTTPS
      ┌────▼────────────────────────┐
      │  Kubernetes Ingress (nginx)   │
      └────┬──────────────────────────┘
           │
    ┌──────┴────────────────────────────────┐
    │                                       │
┌───▼────────────┐                  ┌──────▼─────────┐
│ Frontend (2-6)  │                  │ Backend (2-10)  │
│ Deployment      │                  │ Deployment      │
│ + HPA           │                  │ + HPA           │
│ + LoadBalancer  │                  │ + LoadBalancer  │
└─────────────────┘                  └────┬────────────┘
                                           │
                                   ┌───────┴──────────┐
                                   │                  │
                            ┌──────▼──────┐   ┌──────▼──────┐
                            │  Supabase    │   │    Redis     │
                            │ (PostgreSQL) │   │ (In-Memory)  │
                            └──────────────┘   └──────────────┘
```

### Components

- **Frontend**: Static HTML/CSS/JS served via Nginx
- **Backend**: Express.js REST API (Node.js)
- **Database**: Supabase (Managed PostgreSQL)
- **Cache**: Redis (In-memory data store)
- **Auth**: JWT + GitHub OAuth
- **Payments**: Razorpay integration
- **Orchestration**: Kubernetes with HPA

---

## Deployment Options

### 1. Local Development (Node.js)

Best for: Development and testing

```bash
cd backend && npm run dev    # Terminal 1
npm run dev:frontend          # Terminal 2
```

**Advantages:**
- Fast reload on file changes
- No Docker required
- Easy debugging

### 2. Docker Compose

Best for: Testing containerized apps locally

```bash
docker compose up --build
```

Access: http://localhost:8080 and http://localhost:3001

**Note**: Docker daemon must be running

### 3. Kubernetes (Production)

Best for: Production, scalability, high availability

```bash
kubectl apply -f k8s/
```

Features:
- ✅ Auto-scaling based on CPU/memory
- ✅ Rolling updates (zero downtime)
- ✅ Health checks and auto-restart
- ✅ Service load balancing
- ✅ Secrets/ConfigMap management

---

## API Documentation

### Authentication Endpoints

#### Register
```bash
POST /auth/register
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "min6chars"
}

# Response
{
  "token": "eyJhbGci...",
  "user": { "id": 1, "email": "...", "is_premium": false }
}
```

#### Login
```bash
POST /auth/login
{
  "email": "user@example.com",
  "password": "password123"
}
```

#### GitHub OAuth
```bash
GET /auth/github
# Redirects to GitHub, then back to /auth/github/callback
```

#### Get Current User
```bash
GET /auth/me
Authorization: Bearer {token}

# Response
{
  "id": 1,
  "email": "user@example.com",
  "is_premium": false
}
```

#### Change Password
```bash
POST /auth/change-password
Authorization: Bearer {token}
{
  "currentPassword": "oldpass123",
  "newPassword": "newpass456"
}
```

#### Forgot Password
```bash
POST /auth/forgot-password
{
  "email": "user@example.com"
}
# Sends reset link (check server logs for demo)
```

#### Reset Password
```bash
POST /auth/reset-password
{
  "token": "reset_token_from_email",
  "newPassword": "newpass789"
}
```

### Todo Endpoints

#### List Todos
```bash
GET /todos
Authorization: Bearer {token}

# Response
[
  {
    "id": 1,
    "user_id": 1,
    "task": "Buy milk",
    "completed": false,
    "created_at": "2026-04-23T10:00:00Z",
    "updated_at": null
  }
]
```

#### Create Todo
```bash
POST /todos
Authorization: Bearer {token}
{
  "task": "New task"
}

# Status: 201 Created
# Free plan: max 10 todos
# Premium: unlimited
```

#### Update Todo
```bash
PUT /todos/{id}
Authorization: Bearer {token}
{
  "task": "Updated task",
  "completed": true
}
```

#### Delete Todo
```bash
DELETE /todos/{id}
Authorization: Bearer {token}

# Response
{ "success": true }
```

### Payment Endpoints

#### Create Payment Order
```bash
POST /payment/create-order
Authorization: Bearer {token}

# Response
{
  "order_id": "order_xyz",
  "amount": 9900,
  "currency": "INR",
  "key_id": "rzp_test_..."
}
```

#### Verify & Complete Payment
```bash
POST /payment/verify
Authorization: Bearer {token}
{
  "razorpay_order_id": "order_xyz",
  "razorpay_payment_id": "pay_abc",
  "razorpay_signature": "sig_123"
}

# Updates user.is_premium = true
```

### Health & Status

```bash
GET /health
# Response: { "status": "ok", "timestamp": "..." }
```

---

## Features

### ✅ Implemented

- User Registration & Login (Email/Password)
- GitHub OAuth Integration
- JWT-based Authentication
- Todo CRUD Operations
- Free Plan (10 todos) vs Premium
- Password Reset & Change
- Razorpay Payment Integration
- Redis Caching (30s TTL)
- Kubernetes Deployment
- Horizontal Pod Autoscaling (HPA)
- Health Checks & Readiness Probes
- Rate Limiting (100 req/15min)
- CORS Configuration
- Docker & Docker Compose

### 🚀 Available for Enhancement

- Email notifications (SendGrid/SES integration)
- Advanced todo features (labels, due dates, reminders)
- Role-based access control (RBAC)
- Audit logging
- API key authentication
- WebSocket for real-time updates
- Mobile app (React Native/Flutter)
- Backup & disaster recovery
- Custom domain with TLS

---

## Configuration

### Environment Variables

Create `backend/.env`:

```env
# Supabase
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJhbGc...  # From Supabase dashboard

# JWT
JWT_SECRET=your-super-secret-key-min-32-chars

# Redis
REDIS_HOST=localhost    # or 'redis' in Kubernetes
REDIS_PORT=6379
# REDIS_PASSWORD=optional

# GitHub OAuth
GITHUB_CLIENT_ID=xxxxxxxxx
GITHUB_CLIENT_SECRET=xxxxxxxxx
GITHUB_CALLBACK_URL=http://localhost:3001/auth/github/callback

# Razorpay (Test mode)
RAZORPAY_KEY_ID=rzp_test_xxxxxxxxx
RAZORPAY_KEY_SECRET=xxxxxxxxx

# Application
PORT=3001
FRONTEND_URL=http://localhost:8080
```

### Kubernetes Secrets

Create `k8s/secrets.yaml`:

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: todo-secrets
  namespace: todo-app
type: Opaque
data:
  SUPABASE_URL: <base64-encoded>
  SUPABASE_SERVICE_ROLE_KEY: <base64-encoded>
  JWT_SECRET: <base64-encoded>
  GITHUB_CLIENT_ID: <base64-encoded>
  GITHUB_CLIENT_SECRET: <base64-encoded>
  RAZORPAY_KEY_ID: <base64-encoded>
  RAZORPAY_KEY_SECRET: <base64-encoded>
  # ... other secrets
```

Encode values:
```bash
echo -n "your-value" | base64
```

Apply:
```bash
kubectl apply -f k8s/secrets.yaml
```

### Kubernetes ConfigMap

Configured in: `k8s/backend/configmap.yaml`

```yaml
data:
  PORT: "3001"
  REDIS_HOST: "redis"
  REDIS_PORT: "6379"
  FRONTEND_URL: "http://your-domain"
  GITHUB_CALLBACK_URL: "http://your-domain/auth/github/callback"
```

Update domain:
```bash
kubectl patch configmap backend-config -n todo-app --type merge \
  -p '{"data":{"FRONTEND_URL":"http://your-domain","GITHUB_CALLBACK_URL":"http://your-domain/auth/github/callback"}}'
```

---

## Monitoring & Scaling

### View Horizontal Pod Autoscaling Status

```bash
# Backend HPA
kubectl describe hpa backend-hpa -n todo-app

# Frontend HPA
kubectl describe hpa frontend-hpa -n todo-app

# Watch scaling in real-time
kubectl get hpa -n todo-app --watch
```

### HPA Configuration

Backend:
- Min replicas: 2
- Max replicas: 10
- CPU target: 50%
- Memory target: 60%
- Scale up: +2 pods per 60s
- Scale down: -1 pod per 120s (300s stabilization)

Frontend:
- Min replicas: 2
- Max replicas: 6
- CPU target: 70%

### Metrics Server

Check if metrics are being collected:

```bash
kubectl get deployment metrics-server -n kube-system

# View resource usage
kubectl top nodes
kubectl top pods -n todo-app
```

### Logs

```bash
# Tail backend logs
kubectl logs -n todo-app deployment/backend -f

# View specific pod
kubectl logs -n todo-app pod/backend-xyz -f

# Previous logs (if pod crashed)
kubectl logs -n todo-app pod/backend-xyz --previous
```

---

## Troubleshooting

### Backend not accessible

```bash
# Check pod status
kubectl get pods -n todo-app

# Check logs
kubectl logs -n todo-app deployment/backend

# Port forward
kubectl port-forward -n todo-app svc/backend 3001:3001
```

### Database connection errors

```bash
# Verify Supabase credentials in secrets
kubectl get secret todo-secrets -n todo-app -o jsonpath='{.data.SUPABASE_URL}' | base64 -d

# Check backend environment variables
kubectl set env deployment/backend -n todo-app --list

# Restart backend to reload config
kubectl rollout restart deployment/backend -n todo-app
```

### HPA not scaling

```bash
# Check metrics availability
kubectl describe hpa backend-hpa -n todo-app

# Check metrics-server
kubectl get deployment metrics-server -n kube-system

# View events
kubectl get events -n todo-app --sort-by='.lastTimestamp'
```

### Memory/CPU issues

```bash
# Request 

 of resource
kubectl top pods -n todo-app

# Check resource requests/limits
kubectl describe deployment backend -n todo-app | grep -A 5 Resources

# Adjust if needed
kubectl set resources deployment backend -n todo-app \
  --requests=cpu=100m,memory=128Mi \
  --limits=cpu=500m,memory=512Mi
```

### CORS errors from frontend

```bash
# Verify FRONTEND_URL in config
kubectl get configmap backend-config -n todo-app -o yaml

# Update if needed
kubectl patch configmap backend-config -n todo-app --type merge \
  -p '{"data":{"FRONTEND_URL":"http://your-url"}}'

# Restart backend
kubectl delete pods -n todo-app -l app=backend
```

### Domain configuration for production

1. **Update environment config:**
   ```bash
   kubectl patch configmap backend-config -n todo-app --type merge \
     -p '{"data":{"FRONTEND_URL":"https://yourdomain.com","GITHUB_CALLBACK_URL":"https://yourdomain.com/auth/github/callback"}}'
   ```

2. **Update Ingress:**
   ```bash
   kubectl patch ingress todo-ingress -n todo-app --type merge \
     -p '{"spec":{"rules":[{"host":"yourdomain.com"}]}}'
   ```

3. **Set up TLS (Optional with cert-manager):**
   ```bash
   kubectl apply -f https://github.com/jetstack/cert-manager/releases/download/v1.12.0/cert-manager.yaml
   ```

---

## Performance Tips

1. **Enable Redis caching**: Already configured with 30s TTL
2. **Use LoadBalancer service**: Distributes traffic across pods
3. **Configure HPA properly**: Adjust CPU/memory targets based on actual usage
4. **Monitor resource usage**: Use `kubectl top` regularly
5. **Implement request/response logging**: Check backend logs
6. **Use CDN for static assets**: Cache CSS/JS/images

---

## Support & Maintenance

### Regular Checks

```bash
# Daily
kubectl get pods -n todo-app
kubectl top pods -n todo-app

# Weekly
kubectl describe hpa -n todo-app
kubectl get events -n todo-app

# Monthly
kubectl get pvc -n todo-app  # If using persistent volumes
```

### Backup Strategies

- **Database**: Use Supabase automatic backups
- **Configuration**: Keep k8s manifests in Git
- **Secrets**: Use separate secret management (Sealed Secrets, Vault)

---

**Last Updated**: April 23, 2026
**Version**: 1.0.0
