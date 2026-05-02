# AWS Deployment Guide (EC2, Load Balancing, Auto Scaling, Docker, Kubernetes)

This guide is for deploying this `todo-app` project on AWS in production.

It covers:
- **Option A (recommended first):** EC2 + Docker Compose + ALB + Auto Scaling Group
- **Option B (Kubernetes):** EKS + ALB Ingress + HPA + node autoscaling

---

## 0) Architecture Choices

### Option A: EC2 + Docker Compose
- App runs as containers on EC2 instances (`frontend`, `backend`, `redis`).
- Public traffic goes to **Application Load Balancer (ALB)**.
- ALB forwards requests to EC2 instances in an **Auto Scaling Group (ASG)**.
- Best for simpler operations and lower complexity.

### Option B: EKS + Kubernetes
- App runs as Kubernetes Deployments/Services in EKS.
- Public traffic enters via **AWS Load Balancer Controller** (ALB Ingress).
- Pod scaling via **HPA** (already present in `k8s/backend/hpa.yaml` and `k8s/frontend/hpa.yaml`).
- Node scaling via **Cluster Autoscaler** or **Karpenter**.
- Best for long-term scale and cloud-native operations.

---

## 1) Prerequisites (for both options)

- AWS account with IAM permissions for EC2, VPC, ELB, Auto Scaling, ECR, EKS, IAM roles.
- AWS CLI configured:
  - `aws configure`
- Docker installed locally.
- Domain name managed in Route 53 (or other DNS provider) for production HTTPS.
- This repo cloned and configured.

Important security note:
- Do **not** commit real secrets in git.
- Use **AWS Secrets Manager** or **SSM Parameter Store** for production secrets.
- Rotate any credentials if they were previously exposed.

---

## 2) Prepare Application for AWS

### 2.1 Build container images

From project root:

```bash
docker build -t todo-backend:latest ./backend
docker build -t todo-frontend:latest ./frontend
```

### 2.2 Push images to Amazon ECR

Set variables:

```bash
AWS_REGION=ap-south-1
AWS_ACCOUNT_ID=<your-account-id>
```

Create repos (one-time):

```bash
aws ecr create-repository --repository-name todo-backend --region $AWS_REGION
aws ecr create-repository --repository-name todo-frontend --region $AWS_REGION
```

Login + tag + push:

```bash
aws ecr get-login-password --region $AWS_REGION | docker login --username AWS --password-stdin $AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com

docker tag todo-backend:latest  $AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/todo-backend:latest
docker tag todo-frontend:latest $AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/todo-frontend:latest

docker push $AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/todo-backend:latest
docker push $AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/todo-frontend:latest
```

---

## 3) Option A - EC2 + Docker Compose + ALB + ASG

## 3.1 Networking

Create/Use a VPC with:
- 2 public subnets (for ALB)
- 2 private subnets (recommended for EC2 app nodes)
- NAT Gateway (if instances are private and need outbound internet)

Security groups:
- `alb-sg`
  - Inbound: 80, 443 from `0.0.0.0/0`
  - Outbound: all
- `app-sg`
  - Inbound: app port from `alb-sg` only
    - If frontend is entrypoint: 8080 from `alb-sg`
    - If backend exposed directly: 3001 from `alb-sg` (usually not required)
  - Inbound: 22 only from your office IP (or use SSM Session Manager)
  - Outbound: all

---

## 3.2 Production Compose on EC2

Create `docker-compose.prod.yml` in repo root (example):

```yaml
version: "3.9"
services:
  redis:
    image: redis:7-alpine
    restart: unless-stopped
    command: redis-server --save 60 1 --loglevel warning

  backend:
    image: <account>.dkr.ecr.<region>.amazonaws.com/todo-backend:latest
    restart: unless-stopped
    depends_on:
      - redis
    env_file:
      - /opt/todo-app/backend.env
    environment:
      PORT: 3001
      REDIS_HOST: redis
      REDIS_PORT: 6379
      FRONTEND_URL: https://todo.example.com
      GITHUB_CALLBACK_URL: https://todo.example.com/api/auth/github/callback
    ports:
      - "3001:3001"

  frontend:
    image: <account>.dkr.ecr.<region>.amazonaws.com/todo-frontend:latest
    restart: unless-stopped
    depends_on:
      - backend
    environment:
      API_URL: /api
      RAZORPAY_KEY_ID: ${RAZORPAY_KEY_ID}
    ports:
      - "8080:8080"
```

For production, store backend secrets in `/opt/todo-app/backend.env` (created at boot from SSM/Secrets Manager).

---

## 3.3 Create EC2 Launch Template

Use Amazon Linux 2023, instance type `t3.medium` (or higher), IAM role with:
- `AmazonSSMManagedInstanceCore`
- `AmazonEC2ContainerRegistryReadOnly`
- Read access for SSM/Secrets Manager keys used by app

User data (bootstrap) example:

```bash
#!/bin/bash
set -euxo pipefail

dnf update -y
dnf install -y docker git jq
systemctl enable docker
systemctl start docker
usermod -aG docker ec2-user

mkdir -p /opt/todo-app
chown ec2-user:ec2-user /opt/todo-app

# Install docker compose plugin
mkdir -p /usr/local/lib/docker/cli-plugins
curl -SL https://github.com/docker/compose/releases/download/v2.29.7/docker-compose-linux-x86_64 -o /usr/local/lib/docker/cli-plugins/docker-compose
chmod +x /usr/local/lib/docker/cli-plugins/docker-compose

AWS_REGION=ap-south-1
AWS_ACCOUNT_ID=<account-id>
APP_DIR=/opt/todo-app

aws ecr get-login-password --region $AWS_REGION | docker login --username AWS --password-stdin $AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com

# Pull compose and env from S3/Git/SSM. Example shown with S3:
aws s3 cp s3://<bucket>/todo/docker-compose.prod.yml $APP_DIR/docker-compose.yml
aws s3 cp s3://<bucket>/todo/backend.env $APP_DIR/backend.env

cd $APP_DIR
docker compose pull
docker compose up -d
```

---

## 3.4 Configure ALB

1. Create Target Group:
   - Target type: `instance`
   - Protocol/port: HTTP `8080`
   - Health check path: `/`
2. Create ALB in public subnets with `alb-sg`.
3. Create listener rules:
   - HTTP 80 -> redirect to HTTPS 443
   - HTTPS 443 -> target group
4. Attach ACM certificate for domain.
5. Add Route 53 record (`A`/Alias) -> ALB DNS.

Why this works for this app:
- Frontend Nginx handles `/api/*` proxy flow in container setup.
- ALB only needs to route to frontend service port (8080) on each instance.

---

## 3.5 Create Auto Scaling Group

1. Create ASG from the launch template.
2. Attach to private subnets across 2+ AZs.
3. Attach ALB target group.
4. Set capacity:
   - Min: 2
   - Desired: 2
   - Max: 6
5. Enable health checks:
   - ELB + EC2
6. Scaling policies:
   - Target tracking CPU utilization around `50%`
   - Optional: request-based scaling using ALB request count per target

Recommended extras:
- Instance warmup: 180-300s
- Rolling instance refresh on template update

---

## 3.6 Secrets and environment in EC2 pattern

Minimum backend env keys:
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `JWT_SECRET`
- `GITHUB_CLIENT_ID`
- `GITHUB_CLIENT_SECRET`
- `GITHUB_CALLBACK_URL` (set to your HTTPS domain)
- `RAZORPAY_KEY_ID`
- `RAZORPAY_KEY_SECRET`
- `SMTP_USER`
- `SMTP_PASS`
- `FRONTEND_URL` (set to your HTTPS domain)
- `PORT=3001`
- `REDIS_HOST=redis`
- `REDIS_PORT=6379`

Use either:
- SSM Parameter Store (`SecureString`) + bootstrap script export, or
- AWS Secrets Manager + bootstrap fetch.

---

## 3.7 Validate EC2 deployment

On one instance:

```bash
docker ps
docker compose logs -f backend
curl -s http://localhost:3001/health
```

Externally:
- Open `https://your-domain`
- Test login/register/todos/payment flow
- Check ALB target health is `healthy`

---

## 4) Option B - EKS + Kubernetes + ALB + Autoscaling

Use this option if you want Kubernetes-native scaling and operations.

## 4.1 Create EKS cluster

With `eksctl` (example):

```bash
eksctl create cluster \
  --name todo-eks \
  --region ap-south-1 \
  --version 1.30 \
  --nodegroup-name app-ng \
  --node-type t3.medium \
  --nodes 2 \
  --nodes-min 2 \
  --nodes-max 6 \
  --managed
```

---

## 4.2 Install required controllers/components

1. Metrics Server (required for HPA):
```bash
kubectl apply -f https://github.com/kubernetes-sigs/metrics-server/releases/latest/download/components.yaml
```

2. AWS Load Balancer Controller:
- Create IAM OIDC provider for cluster.
- Create IAM policy/role for controller.
- Install with Helm in `kube-system`.

3. ExternalDNS (optional but recommended) for auto Route53 records.

4. Node autoscaler:
- Choose **one**:
  - Cluster Autoscaler, or
  - Karpenter (recommended for new setups)

---

## 4.3 Prepare Kubernetes manifests for AWS

This repo already includes:
- `k8s/backend/deployment.yaml`
- `k8s/frontend/deployment.yaml`
- `k8s/backend/hpa.yaml`
- `k8s/frontend/hpa.yaml`
- `k8s/ingress.yaml`

Update image references in deployment files:
- Replace `YOUR_REGISTRY/todo-backend:latest`
- Replace `YOUR_REGISTRY/todo-frontend:latest`
with your ECR image URIs.

Create secrets safely (preferred from local env file):

```bash
kubectl create namespace todo-app --dry-run=client -o yaml | kubectl apply -f -
kubectl -n todo-app create secret generic todo-secrets \
  --from-env-file=backend/.env \
  --dry-run=client -o yaml | kubectl apply -f -
```

Do not store real secret values directly in `k8s/secrets.yaml` in production.

---

## 4.4 AWS ALB Ingress for EKS

Your existing `k8s/ingress.yaml` uses nginx style.

For EKS ALB, create an AWS Ingress (example annotations):

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: todo-alb-ingress
  namespace: todo-app
  annotations:
    kubernetes.io/ingress.class: alb
    alb.ingress.kubernetes.io/scheme: internet-facing
    alb.ingress.kubernetes.io/target-type: ip
    alb.ingress.kubernetes.io/listen-ports: '[{"HTTP":80},{"HTTPS":443}]'
    alb.ingress.kubernetes.io/ssl-redirect: "443"
    alb.ingress.kubernetes.io/certificate-arn: arn:aws:acm:...
spec:
  rules:
    - host: todo.example.com
      http:
        paths:
          - path: /api/*
            pathType: ImplementationSpecific
            backend:
              service:
                name: backend
                port:
                  number: 3001
          - path: /*
            pathType: ImplementationSpecific
            backend:
              service:
                name: frontend
                port:
                  number: 8080
```

---

## 4.5 Deploy to EKS

```bash
kubectl apply -f k8s/namespace.yaml
kubectl apply -f k8s/redis/
kubectl apply -f k8s/backend/configmap.yaml
kubectl apply -f k8s/backend/deployment.yaml
kubectl apply -f k8s/backend/service.yaml
kubectl apply -f k8s/backend/hpa.yaml
kubectl apply -f k8s/frontend/deployment.yaml
kubectl apply -f k8s/frontend/service.yaml
kubectl apply -f k8s/frontend/hpa.yaml

# Apply your ALB ingress manifest (AWS-specific)
kubectl apply -f k8s/ingress-aws-alb.yaml
```

Verify:

```bash
kubectl get pods -n todo-app
kubectl get svc -n todo-app
kubectl get hpa -n todo-app
kubectl get ingress -n todo-app
```

---

## 4.6 Autoscaling behavior in EKS

Current app scaling config:
- Backend HPA: min 2, max 10, CPU+Memory metrics
- Frontend HPA: min 1, max 6, CPU metric

How scaling layers work:
- **HPA** scales pods based on load.
- **Node autoscaler** (Karpenter/Cluster Autoscaler) adds/removes EC2 nodes if pods cannot be scheduled.

Without node autoscaling, HPA may request pods that remain Pending.

---

## 5) CI/CD (recommended)

Use GitHub Actions pipeline:
- Build backend/frontend images
- Push to ECR
- Deploy:
  - Option A: SSM command or rolling instance refresh in ASG
  - Option B: `kubectl set image` or Helm upgrade on EKS

Minimum deployment strategy:
- `main` branch triggers deploy
- Staging and production environments with separate secrets

---

## 6) Operations, Monitoring, and Cost Controls

- Logs:
  - EC2: CloudWatch Agent for Docker logs
  - EKS: Fluent Bit -> CloudWatch Logs
- Metrics/alerts:
  - ALB 5XX > threshold
  - EC2 CPU high
  - Pod restart spikes
  - HPA at max replicas sustained
- Backups:
  - Supabase backup policy (external to AWS infra)
  - If using RDS in future, enable automated backups + PITR
- Cost:
  - Start with `t3.medium`
  - Use autoscaling limits
  - Use Savings Plans for steady-state workloads

---

## 7) Production Hardening Checklist

- [ ] Rotate all leaked/dev credentials before production
- [ ] Move secrets to AWS Secrets Manager/SSM
- [ ] Enforce HTTPS with ACM certificates
- [ ] Restrict security groups (least privilege)
- [ ] Enable WAF on ALB (optional, recommended)
- [ ] Configure CORS and callback URLs for production domain
- [ ] Add health checks and synthetic uptime probes
- [ ] Enable CloudWatch alarms + notifications
- [ ] Test blue/green or rolling deployments

---

## 8) Quick Decision Guide

- Pick **EC2 + Compose** when:
  - Team is small
  - You want easiest path now
  - Workload is moderate

- Pick **EKS** when:
  - You need pod-level autoscaling and advanced orchestration
  - You already operate Kubernetes
  - You expect growth or multiple services soon

---

## 9) Immediate Next Steps for This Repo

1. Choose deployment pattern (EC2 or EKS).
2. Push images to ECR.
3. Set production secrets in Secrets Manager/SSM.
4. Update domain/callback URLs (`FRONTEND_URL`, `GITHUB_CALLBACK_URL`).
5. Deploy and verify `/health`, auth, todos, payment flows.

