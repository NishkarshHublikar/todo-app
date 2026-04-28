# TodoApp — Production-Ready Full Stack

> Node/Express · PostgreSQL · Redis · JWT + GitHub OAuth · Razorpay Premium · Docker · Kubernetes + HPA

---

## Architecture

```
                    ┌─────────────┐
                    │   Ingress   │  (nginx-ingress)
                    └──────┬──────┘
               /           │           /api/*
        ┌──────▼──────┐    │    ┌──────▼──────┐
        │  Frontend   │    │    │   Backend   │
        │  (Nginx)    │    │    │  (Express)  │
        │  HPA 2-6    │    │    │  HPA 2-10   │
        └─────────────┘    │    └──────┬──────┘
                                  ┌────┴────┐
                             ┌────▼───┐ ┌───▼────┐
                             │Postgres│ │ Redis  │
                             └────────┘ └────────┘
```

---

## Quick Start (Local with Docker Compose)

```bash
# 1. Clone and configure
cp backend/.env.example backend/.env
# Edit backend/.env — fill in GitHub OAuth and Razorpay keys

# 2. Build and run
docker compose up --build

# Frontend: http://localhost:8080
# Backend:  http://localhost:3001
```

---

## GitHub + AWS Readiness Checklist

- Keep secrets out of git: use `backend/.env` locally and AWS Secrets Manager / Kubernetes secrets in AWS.
- Before first push, rotate any credentials that were previously shared in local/dev files.
- Confirm images are registry-qualified in manifests (`YOUR_REGISTRY/todo-backend:latest`, `YOUR_REGISTRY/todo-frontend:latest`).
- Ensure CI passes in GitHub Actions (`.github/workflows/ci.yml`) before deploy.
- Use HTTPS domain in production and update callback URLs:
  - GitHub OAuth callback: `https://YOUR_DOMAIN/auth/github/callback`
  - Frontend URL env: `https://YOUR_DOMAIN`
- For EKS, replace template secret values at deploy time (never commit real values).

---

## Kubernetes Deployment

### Prerequisites
- A running Kubernetes cluster (k3s, kubeadm, minikube, etc.)
- `kubectl` configured
- Docker registry access (Docker Hub, GHCR, etc.)
- nginx ingress controller installed
- metrics-server installed (required for HPA)

### 1. Install metrics-server (for HPA)
```bash
kubectl apply -f https://github.com/kubernetes-sigs/metrics-server/releases/latest/download/components.yaml
```

### 2. Build and push images
```bash
# Set your registry
export REGISTRY=docker.io/YOUR_DOCKERHUB_USERNAME

docker build -t $REGISTRY/todo-backend:latest ./backend
docker build -t $REGISTRY/todo-frontend:latest ./frontend

docker push $REGISTRY/todo-backend:latest
docker push $REGISTRY/todo-frontend:latest
```

### 3. Update image references
```bash
# Replace YOUR_REGISTRY in k8s manifests
sed -i "s|YOUR_REGISTRY|$REGISTRY|g" k8s/backend/deployment.yaml k8s/frontend/deployment.yaml
```

### 4. Update your domain
```bash
export DOMAIN=yourdomain.com   # or your LoadBalancer IP
sed -i "s|YOUR_DOMAIN|$DOMAIN|g" k8s/backend/configmap.yaml k8s/frontend/deployment.yaml k8s/ingress.yaml
```

### 5. Prepare secrets
```bash
# Encode your actual values:
echo -n "your_jwt_secret" | base64
echo -n "your_pg_password" | base64
# ... etc, then fill in k8s/secrets.yaml
```

### 6. Apply all manifests
```bash
kubectl apply -f k8s/namespace.yaml
kubectl apply -f k8s/secrets.yaml
kubectl apply -f k8s/postgres/
kubectl apply -f k8s/redis/
kubectl apply -f k8s/backend/
kubectl apply -f k8s/frontend/
kubectl apply -f k8s/ingress.yaml
```

### 7. Verify
```bash
kubectl get pods -n todo-app
kubectl get hpa -n todo-app
kubectl get ingress -n todo-app
```

### 8. GitHub OAuth setup
1. Go to https://github.com/settings/developers → New OAuth App
2. Homepage URL: `http://YOUR_DOMAIN`
3. Callback URL: `http://YOUR_DOMAIN/api/auth/github/callback`
4. Copy Client ID and Secret into `k8s/secrets.yaml`

### 9. Razorpay setup
1. Sign up at https://dashboard.razorpay.com (use Test Mode)
2. Settings → API Keys → Generate Key
3. Copy Key ID and Secret into `k8s/secrets.yaml`

---

## Feature Summary

| Feature | Implementation |
|---|---|
| Auth | JWT (7-day tokens) + bcrypt passwords |
| OAuth | GitHub via passport-github2 |
| Database | PostgreSQL 16 with indexed tables |
| Caching | Redis 7 — todo list cached 30s per user |
| Premium | Razorpay payment → `is_premium` flag in DB + fresh JWT |
| Free tier limit | 10 todos max; upgrade prompt on breach |
| Containerization | Docker multi-stage, non-root user |
| Orchestration | Kubernetes with namespace isolation |
| Autoscaling | HPA on CPU+Memory: backend 2–10, frontend 2–6 |
| Zero-downtime | RollingUpdate strategy, readiness probes |
| Resilience | topologySpreadConstraints across nodes |

---

## API Reference

### Auth
| Method | Path | Body | Description |
|---|---|---|---|
| POST | `/auth/register` | `{email, password}` | Register |
| POST | `/auth/login` | `{email, password}` | Login → JWT |
| GET | `/auth/github` | — | OAuth redirect |
| GET | `/auth/github/callback` | — | OAuth callback |
| GET | `/auth/me` | — | Get current user |

### Todos (require `Authorization: Bearer <token>`)
| Method | Path | Body | Description |
|---|---|---|---|
| GET | `/todos` | — | List todos (cached) |
| POST | `/todos` | `{task}` | Create todo |
| PUT | `/todos/:id` | `{task?, completed?}` | Update todo |
| DELETE | `/todos/:id` | — | Delete todo |

### Payment
| Method | Path | Description |
|---|---|---|
| POST | `/payment/create-order` | Create Razorpay order |
| POST | `/payment/verify` | Verify payment, activate premium |

---

## Supabase Setup (one-time)

1. Create a free project at https://supabase.com
2. Go to **SQL Editor** and run this once:

```sql
CREATE TABLE IF NOT EXISTS users (
  id           BIGSERIAL PRIMARY KEY,
  email        TEXT UNIQUE,
  password     TEXT,
  provider     TEXT DEFAULT 'local',
  github_id    TEXT UNIQUE,
  is_premium   BOOLEAN DEFAULT FALSE,
  mfa_enabled  BOOLEAN DEFAULT FALSE,
  mfa_code     TEXT,
  mfa_expires  TIMESTAMPTZ,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS todos (
  id          BIGSERIAL PRIMARY KEY,
  user_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  task        TEXT NOT NULL,
  completed   BOOLEAN DEFAULT FALSE,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_todos_user_id    ON todos(user_id);
CREATE INDEX IF NOT EXISTS idx_todos_created_at ON todos(created_at DESC);

CREATE TABLE IF NOT EXISTS payments (
  id                  BIGSERIAL PRIMARY KEY,
  user_id             BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  razorpay_order_id   TEXT UNIQUE NOT NULL,
  razorpay_payment_id TEXT,
  amount              INTEGER NOT NULL,
  currency            TEXT DEFAULT 'INR',
  status              TEXT DEFAULT 'created',
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payments_user_id ON payments(user_id);
```

3. Go to **Settings → API** and copy:
   - **Project URL** → `SUPABASE_URL`
   - **service_role** key (not anon) → `SUPABASE_SERVICE_ROLE_KEY`

4. Paste both into `backend/.env` (copy from `.env.example`)

## Razorpay Test Setup

1. Sign up at https://dashboard.razorpay.com
2. Stay in **Test Mode** (toggle in top-left)
3. Go to **Settings → API Keys → Generate Test Key**
4. Copy **Key ID** → `RAZORPAY_KEY_ID` and **Key Secret** → `RAZORPAY_KEY_SECRET`
5. Use test card `4111 1111 1111 1111` / any future date / any CVV to simulate payment
