# TodoApp - AWS Deployment Guide

> Deploy TodoApp to AWS with auto-scaling, high availability, and production-grade infrastructure

---

## Overview

Your TodoApp is currently running on local Kubernetes (docker-desktop). This guide shows how to deploy it to **AWS** with:
- ✅ Managed Kubernetes (EKS)
- ✅ Auto-scaling (both pod & node level)
- ✅ Load balancing
- ✅ Managed PostgreSQL (RDS)
- ✅ Managed Redis (ElastiCache)
- ✅ SSL/TLS certificates (ACM)
- ✅ Domain management (Route 53)
- ✅ Container registry (ECR)

---

## Architecture: AWS Deployment

```
                    ┌─────────────────────┐
                    │   Internet Gateway  │
                    └──────────┬──────────┘
                               │
                    ┌──────────▼──────────┐
                    │ Application Load    │
                    │ Balancer (ALB)      │
                    │ + SSL/TLS (ACM)     │
                    └──────────┬──────────┘
                               │
    ┌──────────────────────────┼──────────────────────────┐
    │         Amazon EKS Cluster                          │
    │  ┌────────────────────────────────────────────┐   │
    │  │     Kubernetes Control Plane (Managed)     │   │
    │  └────────────────────────────────────────────┘   │
    │                                                    │
    │  ┌─────────────────────────────────────────────┐  │
    │  │           Node Group (Auto Scaling)         │  │
    │  │  ┌────────────┐  ┌────────────┐            │  │
    │  │  │ Backend    │  │ Backend    │  ...       │  │
    │  │  │ Pod (2-10) │  │ Pod (2-10) │            │  │
    │  │  └────────────┘  └────────────┘            │  │
    │  │                                             │  │
    │  │  ┌────────────┐  ┌────────────┐            │  │
    │  │  │ Frontend   │  │ Frontend   │  ...       │  │
    │  │  │ Pod (2-6)  │  │ Pod (2-6)  │            │  │
    │  │  └────────────┘  └────────────┘            │  │
    │  │                                             │  │
    │  │  ┌────────────┐                            │  │
    │  │  │ Redis      │                            │  │
    │  │  │ Pod        │                            │  │
    │  │  └────────────┘                            │  │
    │  └─────────────────────────────────────────────┘  │
    └──────────────────────────────────────────────────┘
           │                            │
           ▼                            ▼
    ┌─────────────────┐         ┌──────────────────┐
    │  RDS Aurora     │         │ ElastiCache      │
    │  PostgreSQL     │         │ Redis Cluster    │
    │  (Multi-AZ)     │         │ (Multi-AZ)       │
    └─────────────────┘         └──────────────────┘
           │
           ▼
    ┌──────────────────┐
    │  Route 53 DNS    │
    │  (yourdomain)    │
    └──────────────────┘
```

---

## AWS Services Required

### Compute
| Service | Purpose | Tier |
|---------|---------|------|
| **EKS** | Kubernetes cluster management | Managed + EC2 nodes |
| **EC2** | Worker nodes for EKS | t3.medium (2-10 nodes) |
| **Auto Scaling Groups** | Node auto-scaling | Min: 2, Max: 10 |

### Database
| Service | Purpose | Tier |
|---------|---------|------|
| **RDS Aurora** | PostgreSQL database | db.t3.small + Multi-AZ |
| **ElastiCache** | Redis caching | cache.t3.micro (2 nodes) |

### Networking
| Service | Purpose | Tier |
|---------|---------|------|
| **VPC** | Virtual private network | 1 VPC, 3 subnets |
| **ALB** | Load balancer | tier-1 (application tier) |
| **Route 53** | Domain/DNS | Hosted zone + records |
| **ACM** | SSL/TLS certificates | Free (auto-renewal) |
| **NAT Gateway** | Outbound internet | 1 per AZ |

### Container Registry
| Service | Purpose | Tier |
|---------|---------|------|
| **ECR** | Container image storage | Private repos |

### Monitoring
| Service | Purpose | Tier |
|---------|---------|------|
| **CloudWatch** | Logs & metrics | Pay-per-use |
| **CloudFormation** | Infrastructure as Code | Free |

---

## Estimated Monthly Cost (Small/Medium)

```
EKS Cluster Fee:           $73.00
EC2 Nodes (average 3):     $45.00  (t3.medium)
RDS Aurora:                $70.00  (db.t3.small)
ElastiCache Redis:         $20.00  (cache.t3.micro)
Data Transfer:             $15.00  (approx)
ALB:                       $20.00
Route 53:                  $5.00
Other (storage, etc):      $10.00
                          ─────────
TOTAL:                    ~$258/month

For HA + larger nodes, add $100-200/month
```

---

## Step-by-Step Deployment

### Phase 1: AWS Setup (30 min)

#### Step 1.1: Create AWS Account
1. Go to https://aws.amazon.com
2. Create free account or sign in
3. Enable billing alerts:
   - Go to Billing Dashboard
   - Set budgets & alerts

#### Step 1.2: Configure AWS CLI
```bash
# Install AWS CLI
# Windows: https://awscli.amazonaws.com/AWSCLIV2.msi
# Mac: brew install awscli
# Linux: sudo snap install aws-cli --classic

# Configure credentials
aws configure
# Enter:
# AWS Access Key ID: [from IAM]
# AWS Secret Access Key: [from IAM]
# Default region: us-east-1
# Default output format: json

# Verify
aws sts get-caller-identity
```

#### Step 1.3: Create IAM User (for access)
1. AWS Console → IAM → Users → Add User
2. Username: `todo-app-deployer`
3. Permissions: `AmazonEKSFullAccess`, `IAMFullAccess`
4. Download credentials CSV
5. Configure in AWS CLI (see Step 1.2)

### Phase 2: Create Container Images (20 min)

#### Step 2.1: Create ECR Repositories
```bash
# Create backend repo
aws ecr create-repository \
  --repository-name todo-app-backend \
  --region us-east-1

# Create frontend repo
aws ecr create-repository \
  --repository-name todo-app-frontend \
  --region us-east-1

# Get login token
aws ecr get-login-password --region us-east-1 | \
  docker login --username AWS --password-stdin \
  ACCOUNT_ID.dkr.ecr.us-east-1.amazonaws.com
```

#### Step 2.2: Build & Push Images
```bash
# Build backend
docker build -t todo-app-backend:latest ./backend
docker tag todo-app-backend:latest \
  ACCOUNT_ID.dkr.ecr.us-east-1.amazonaws.com/todo-app-backend:latest
docker push \
  ACCOUNT_ID.dkr.ecr.us-east-1.amazonaws.com/todo-app-backend:latest

# Build frontend
docker build -t todo-app-frontend:latest ./frontend
docker tag todo-app-frontend:latest \
  ACCOUNT_ID.dkr.ecr.us-east-1.amazonaws.com/todo-app-frontend:latest
docker push \
  ACCOUNT_ID.dkr.ecr.us-east-1.amazonaws.com/todo-app-frontend:latest
```

### Phase 3: Create Network & Databases (45 min)

#### Step 3.1: Create VPC
```bash
# Option A: Use AWS Console
# VPC → Create VPC → VPC + Subnets
# - CIDR: 10.0.0.0/16
# - Public subnets: 10.0.1.0/24, 10.0.2.0/24, 10.0.3.0/24
# - Private subnets: 10.0.11.0/24, 10.0.12.0/24, 10.0.13.0/24
# - Enable DNS hostnames

# Option B: Use CloudFormation (infrastructure-as-code)
aws cloudformation create-stack \
  --stack-name todo-app-vpc \
  --template-body file://aws-vpc-template.yaml
```

#### Step 3.2: Create RDS Aurora PostgreSQL
```bash
# AWS Console → RDS → Create database

# Configuration:
# - Engine: Amazon Aurora (PostgreSQL compatible)
# - Version: PostgreSQL 14.6
# - DB instance class: db.t3.small
# - Multi-AZ: Yes (High availability)
# - DB name: todoapp
# - Master username: postgres
# - Master password: [STRONG PASSWORD]
# - Backup retention: 7 days
# - Encryption: Enabled

# After creation:
# - Note the endpoint URL (used in K8s secrets)
```

#### Step 3.3: Create ElastiCache Redis
```bash
# AWS Console → ElastiCache → Create

# Configuration:
# - Engine: Redis (latest stable)
# - Node type: cache.t3.micro
# - Number of replicas: 1 (Multi-AZ)
# - Automatic failover: Yes
# - Parameter group: default.redis7
# - Subnet group: (select VPC subnets)
# - Security group: Allow EKS nodes

# After creation:
# - Note the endpoint URL and port 6379
```

### Phase 4: Deploy EKS Cluster (40 min)

#### Step 4.1: Create EKS Cluster
```bash
# Using AWS CLI
aws eks create-cluster \
  --name todo-app-cluster \
  --version 1.28 \
  --role-arn arn:aws:iam::ACCOUNT_ID:role/eks-service-role \
  --resources-vpc-config \
    subnetIds=subnet-xxx,subnet-yyy,subnet-zzz \
  --logging '{"clusterLogging":[{"enabled":true,"types":["api","audit","authenticator","controllerManager","scheduler"]}]}' \
  --region us-east-1

# This takes ~10-15 minutes

# Verify cluster is active
aws eks describe-cluster --name todo-app-cluster --region us-east-1

# Update kubeconfig
aws eks update-kubeconfig \
  --name todo-app-cluster \
  --region us-east-1

# Verify connection
kubectl cluster-info
kubectl get nodes  # Will be empty until nodes added
```

#### Step 4.2: Create Node Group
```bash
aws eks create-nodegroup \
  --cluster-name todo-app-cluster \
  --nodegroup-name todo-app-nodes \
  --scaling-config minSize=2,maxSize=10,desiredSize=3 \
  --subnets subnet-xxx subnet-yyy subnet-zzz \
  --node-role arn:aws:iam::ACCOUNT_ID:role/eks-node-role \
  --disk-size 30 \
  --instance-types t3.medium \
  --region us-east-1

# This takes ~5-10 minutes

# Verify nodes
kubectl get nodes
# Should show 3 nodes in Ready state
```

#### Step 4.3: Install AWS Load Balancer Controller
```bash
# Create IAM policy
curl -o iam_policy.json \
  https://raw.githubusercontent.com/kubernetes-sigs/aws-load-balancer-controller/v2.6.0/docs/install/iam_policy.json

aws iam create-policy \
  --policy-name AWSLoadBalancerControllerIAMPolicy \
  --policy-document file://iam_policy.json

# Create Service Account
kubectl apply -f \
  https://raw.githubusercontent.com/aws/eks-charts/master/stable/aws-load-balancer-controller/crds/crds.yaml

# Install controller via Helm
helm repo add eks https://aws.github.io/eks-charts
helm install aws-load-balancer-controller eks/aws-load-balancer-controller \
  -n kube-system \
  --set clusterName=todo-app-cluster \
  --set serviceAccount.create=true \
  --set serviceAccount.name=aws-load-balancer-controller
```

### Phase 5: Deploy Application (30 min)

#### Step 5.1: Create Namespace & Secrets
```bash
# Create namespace
kubectl create namespace todo-app

# Create Secrets
kubectl create secret generic todo-secrets -n todo-app \
  --from-literal=SUPABASE_URL=https://xxx.supabase.co \
  --from-literal=SUPABASE_SERVICE_ROLE_KEY=eyJhbGc... \
  --from-literal=JWT_SECRET=your-super-secret-key \
  --from-literal=GITHUB_CLIENT_ID=xxx \
  --from-literal=GITHUB_CLIENT_SECRET=xxx \
  --from-literal=RAZORPAY_KEY_ID=rzp_test_xxx \
  --from-literal=RAZORPAY_KEY_SECRET=xxx
```

#### Step 5.2: Update Kubernetes Manifests
```bash
# Update image references in k8s manifests
# Replace: todo-app-backend:latest
# With: ACCOUNT_ID.dkr.ecr.us-east-1.amazonaws.com/todo-app-backend:latest

# Update ConfigMap with AWS URLs
kubectl apply -f k8s/backend/configmap.yaml \
  --namespace todo-app

# Create ConfigMap for AWS-specific config
cat <<EOF | kubectl apply -f -
apiVersion: v1
kind: ConfigMap
metadata:
  name: backend-config
  namespace: todo-app
data:
  PORT: "3001"
  REDIS_HOST: "redis-xxxxx.ng.0001.use1.cache.amazonaws.com"  # ElastiCache endpoint
  REDIS_PORT: "6379"
  FRONTEND_URL: "https://yourdomain.com"
  GITHUB_CALLBACK_URL: "https://yourdomain.com/auth/github/callback"
EOF
```

#### Step 5.3: Deploy Applications
```bash
# Deploy backend
kubectl apply -f k8s/backend/deployment.yaml -n todo-app
kubectl apply -f k8s/backend/service.yaml -n todo-app
kubectl apply -f k8s/backend/hpa.yaml -n todo-app

# Deploy frontend
kubectl apply -f k8s/frontend/deployment.yaml -n todo-app
kubectl apply -f k8s/frontend/service.yaml -n todo-app
kubectl apply -f k8s/frontend/hpa.yaml -n todo-app

# Deploy Redis (optional, use ElastiCache instead)
# Skip k8s/redis if using managed ElastiCache

# Verify deployments
kubectl get deployments -n todo-app
kubectl get pods -n todo-app
```

### Phase 6: Configure Load Balancer & Domain (30 min)

#### Step 6.1: Create Ingress with ALB
```bash
cat <<EOF | kubectl apply -f -
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: todo-app-ingress
  namespace: todo-app
  annotations:
    kubernetes.io/ingress.class: alb
    alb.ingress.kubernetes.io/scheme: internet-facing
    alb.ingress.kubernetes.io/target-type: ip
    alb.ingress.kubernetes.io/certificate-arn: arn:aws:acm:us-east-1:ACCOUNT_ID:certificate/xxx
    alb.ingress.kubernetes.io/listen-ports: '[{"HTTP": 80}, {"HTTPS": 443}]'
    alb.ingress.kubernetes.io/ssl-redirect: '443'
spec:
  rules:
    - host: yourdomain.com
      http:
        paths:
          - path: /auth
            pathType: Prefix
            backend:
              service:
                name: backend
                port:
                  number: 3001
          - path: /todos
            pathType: Prefix
            backend:
              service:
                name: backend
                port:
                  number: 3001
          - path: /payment
            pathType: Prefix
            backend:
              service:
                name: backend
                port:
                  number: 3001
          - path: /health
            pathType: Exact
            backend:
              service:
                name: backend
                port:
                  number: 3001
          - path: /
            pathType: Prefix
            backend:
              service:
                name: frontend
                port:
                  number: 8080
EOF

# Get ALB endpoint
kubectl get ingress todo-app-ingress -n todo-app
```

#### Step 6.2: Request SSL Certificate (ACM)
```bash
# AWS Certificate Manager → Request certificate
# - Domain: yourdomain.com
# - Alternative names: www.yourdomain.com
# - Validation: DNS
# - Add CNAME records to Route 53
# - Wait for validation (usually <5 minutes)

# Get certificate ARN
aws acm list-certificates --region us-east-1
# Update ingress annotation with certificate ARN
```

#### Step 6.3: Configure Route 53
```bash
# Register domain (if not already done)
# Route 53 → Hosted zones → yourdomain.com

# Create A record
# - Name: yourdomain.com
# - Type: A
# - Alias: Yes
# - Alias target: ALB endpoint from Step 6.1
# - Routing policy: Simple
# - Evaluate health: No

# Create CNAME for www
# - Name: www.yourdomain.com
# - Type: CNAME
# - Value: yourdomain.com
```

---

## Auto-Scaling Configuration

### 1. Pod-Level Auto-Scaling (HPA)

Already configured in k8s manifests:

```yaml
# Backend HPA
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: backend-hpa
  namespace: todo-app
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: backend
  minReplicas: 2
  maxReplicas: 10
  metrics:
  - type: Resource
    resource:
      name: cpu
      target:
        type: Utilization
        averageUtilization: 50
  - type: Resource
    resource:
      name: memory
      target:
        type: Utilization
        averageUtilization: 60
  behavior:
    scaleUp:
      stabilizationWindowSeconds: 30
      policies:
      - type: Pods
        value: 2
        periodSeconds: 60
    scaleDown:
      stabilizationWindowSeconds: 300
      policies:
      - type: Pods
        value: 1
        periodSeconds: 120
```

### 2. Node-Level Auto-Scaling (ASG)

Already configured in nodegroup creation:

```bash
# Scaling config:
minSize=2      # Minimum nodes
maxSize=10     # Maximum nodes
desiredSize=3  # Starting nodes

# Auto scales based on:
- Pod resource requests/limits
- Available capacity
- Pod disruption budgets
```

### 3. View Scaling Events

```bash
# Watch HPA in real-time
kubectl get hpa -n todo-app --watch

# View scaling history
kubectl describe hpa backend-hpa -n todo-app

# View nodes
kubectl get nodes
kubectl top nodes

# View pod resource usage
kubectl top pods -n todo-app

# View node autoscaling events
aws autoscaling describe-scaling-activities \
  --auto-scaling-group-name todo-app-nodes-asg \
  --region us-east-1
```

---

## Post-Deployment Tasks

### 1. Verify Everything Works
```bash
# Test health endpoint
curl https://yourdomain.com/health

# Test registration
curl -X POST https://yourdomain.com/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"password123"}'

# Open frontend
# https://yourdomain.com
```

### 2. Configure Monitoring
```bash
# CloudWatch Logs
# All pod logs are automatically sent to CloudWatch

# View logs
aws logs tail /aws/eks/todo-app-cluster/cluster --follow

# Create alarms
aws cloudwatch put-metric-alarm \
  --alarm-name todo-app-cpu-high \
  --alarm-description "Alert when CPU > 80%" \
  --metric-name CPUUtilization \
  --namespace AWS/ECS \
  --statistic Average \
  --period 300 \
  --threshold 80 \
  --comparison-operator GreaterThanThreshold \
  --evaluation-periods 2
```

### 3. Set Up Backups
```bash
# RDS Automated Backups (already enabled)
# - Retention: 7 days
# - Backup window: 03:00-04:00 UTC

# ElastiCache Snapshots
aws elasticache create-snapshot \
  --replication-group-id todo-app-redis \
  --snapshot-name todo-app-redis-backup-$(date +%Y%m%d)
```

### 4. Configure Auto-Snapshots
```bash
# RDS
aws rds modify-db-cluster \
  --db-cluster-identifier todo-app-db \
  --backup-retention-period 30 \
  --preferred-backup-window "03:00-04:00"

# ElastiCache
aws elasticache modify-replication-group \
  --replication-group-id todo-app-redis \
  --automatic-failover-enabled \
  --apply-immediately
```

---

## Cost Optimization

### 1. Use Spot Instances
```bash
# For non-critical workloads, use spot pricing (80% cheaper)
aws eks create-nodegroup \
  --cluster-name todo-app-cluster \
  --nodegroup-name spot-nodes \
  --capacity-type spot \
  --instance-types t3.medium t3a.medium t3.large \
  --scaling-config minSize=1,maxSize=5,desiredSize=2
```

### 2. Enable Kubernetes Resource Quotas
```bash
# Prevent runaway costs from resource requests
kubectl apply -f - <<EOF
apiVersion: v1
kind: ResourceQuota
metadata:
  name: compute-quota
  namespace: todo-app
spec:
  hard:
    requests.cpu: "20"           # Max 20 cores
    requests.memory: "50Gi"      # Max 50GB
    limits.cpu: "50"
    limits.memory: "100Gi"
    persistentvolumeclaims: "5"
EOF
```

### 3. Right-Size Database
```bash
# Start with smaller instance, monitor, then upgrade
# db.t3.micro → db.t3.small → db.t3.medium (based on load)

# Check database metrics
aws cloudwatch get-metric-statistics \
  --namespace AWS/RDS \
  --metric-name CPUUtilization \
  --dimensions Name=DBInstanceIdentifier,Value=todo-app-db \
  --statistics Average \
  --start-time 2026-04-17T00:00:00Z \
  --end-time 2026-04-24T00:00:00Z \
  --period 86400
```

---

## Troubleshooting

### Pods not scaling
```bash
# Check HPA status
kubectl describe hpa backend-hpa -n todo-app

# Check metrics availability
kubectl get --raw /apis/metrics.k8s.io/v1beta1/nodes | jq

# Ensure resource requests are set
kubectl get pods -n todo-app -o json | jq '.items[].spec.containers[].resources'
```

### Nodes not scaling
```bash
# Check ASG config
aws autoscaling describe-auto-scaling-groups \
  --auto-scaling-group-names todo-app-nodes-asg

# Check scaling activities
aws autoscaling describe-scaling-activities \
  --auto-scaling-group-name todo-app-nodes-asg \
  --max-records 10

# Check cluster autoscaler logs
kubectl logs -n kube-system -l app=cluster-autoscaler
```

### High costs
```bash
# Analyze costs
aws ce get-cost-and-usage \
  --time-period Start=2026-04-01,End=2026-04-24 \
  --granularity MONTHLY \
  --metrics "BlendedCost" \
  --group-by Type=DIMENSION,Key=SERVICE

# Right-size instances
# Reduce replicas during off-peak
# Use reserved instances for baseline capacity
```

---

## Migration from Local K8s

```bash
# 1. Build and push Docker images to ECR
docker build -t todo-app-backend:latest ./backend
docker push ACCOUNT_ID.dkr.ecr.us-east-1.amazonaws.com/todo-app-backend:latest

# 2. Export current state
kubectl get all -n todo-app -o yaml > local-state-backup.yaml

# 3. Update k8s manifests with AWS resources
# - Change image registries to ECR
# - Update database endpoints to RDS
# - Update Redis endpoints to ElastiCache
# - Update domain in ConfigMap

# 4. Deploy to AWS EKS
kubectl apply -f k8s/ -n todo-app

# 5. Verify
kubectl get all -n todo-app
kubectl logs -f deployment/backend -n todo-app
```

---

## Useful Commands

```bash
# Cluster operations
aws eks describe-cluster --name todo-app-cluster
kubectl cluster-info
kubectl get nodes
kubectl get all -n todo-app

# Scaling
kubectl scale deployment backend -n todo-app --replicas=5
kubectl autoscale deployment backend -n todo-app --min=2 --max=10

# Monitoring
kubectl top nodes
kubectl top pods -n todo-app
kubectl logs -f deployment/backend -n todo-app
kubectl describe hpa backend-hpa -n todo-app

# Updates
kubectl set image deployment/backend backend=ECR_IMAGE:NEW_TAG -n todo-app
kubectl rollout status deployment/backend -n todo-app
kubectl rollout undo deployment/backend -n todo-app

# Cleanup
aws eks delete-nodegroup --cluster-name todo-app-cluster --nodegroup-name todo-app-nodes
aws eks delete-cluster --name todo-app-cluster
```

---

## Timeline Estimate

| Phase | Task | Duration |
|-------|------|----------|
| 1 | AWS Setup | 30 min |
| 2 | Container Images | 20 min |
| 3 | Network & Databases | 45 min |
| 4 | EKS Cluster | 40 min |
| 5 | Deploy Application | 30 min |
| 6 | Load Balancer & Domain | 30 min |
| | **Total** | **~3.5 hours** |

---

## Estimated Monthly Cost Breakdown

| Service | Instance/Config | Quantity | Monthly Cost |
|---------|-----------------|----------|--------------|
| EKS | Cluster fee | 1 | $73.00 |
| EC2 | t3.medium | 3 avg | $45.00 |
| RDS | db.t3.small | 1 | $70.00 |
| ElastiCache | cache.t3.micro | 2 | $20.00 |
| ALB | - | 1 | $20.00 |
| Data Transfer | - | - | $15.00 |
| Route 53 | Hosted zone | 1 | $5.00 |
| Storage & Other | - | - | $10.00 |
| | | **TOTAL** | **~$258/month** |

**Notes:**
- Prices are approximate (US-East-1)
- Can add 20-30% for redundancy/HA
- Reserved instances can reduce compute costs by 30%
- First year free tier covers some services

---

## Next Steps

1. **Create AWS Account** → Set up billing & IAM
2. **Follow Phase 1-2** → Setup CLI and build images
3. **Follow Phase 3-4** → Create infrastructure
4. **Follow Phase 5-6** → Deploy application
5. **Test & Monitor** → Verify everything works
6. **Optimize** → Right-size resources based on metrics

---

**For Help:**
- AWS Support: https://console.aws.amazon.com/support/
- EKS Documentation: https://docs.aws.amazon.com/eks/
- Cost Calculator: https://calculator.aws/

Good luck deploying to AWS! 🚀
