# TickerAPP Deployment Files - Status Report

## Files Added/Fixed in TickerAPP Directory

### ✅ Added to Repo (were missing from GitHub)

| File | Purpose |
|------|---------|
| `.github/workflows/publish-images.yml` | GitHub Actions: build/push images to ECR, deploy to EC2 via SSM |
| `buildspec.yml` | CodeBuild: build Docker images and push to ECR |
| `appspec.yml` | CodeDeploy: define deployment hooks and file mappings |
| `deploy/scripts/healthcheck.sh` | CodeDeploy ValidateService hook |
| `deploy/scripts/refresh_images.sh` | CodeDeploy AfterInstall hook - pull latest images |
| `deploy/scripts/start_stack.sh` | CodeDeploy ApplicationStart hook - start compose stack |

### ✅ Fixed

| File | Issue | Fix |
|------|-------|-----|
| `buildspec.yml` | Used `./backend` and `./frontend` as build contexts (wrong paths) | Changed to `-f docker/backend/Dockerfile` and `-f docker/frontend/Dockerfile` with `.` as context |

### ⚠️ Still Needs Attention

1. **ECR_REGISTRY Mismatch**
   - `.env.example` has: `801949252238.dkr.ecr.ap-south-1.amazonaws.com`
   - GitHub Actions workflow uses: `396510133138.dkr.ecr.ap-south-1.amazonaws.com`
   - **Action**: Update `.env.example` to match your actual ECR registry (the one you configured in CodeBuild)

2. **market-feed build in buildspec.yml**
   - The market-feed build section still references `./market-feed` which doesn't exist
   - Since market-feed uses the same backend Dockerfile, this section can be removed or updated

3. **EC2 Instance ID in GitHub Actions**
   - The workflow uses `i-09c3709fc5e7c9e06` - verify this matches your EC2 instance

4. **AWS IAM Roles**
   - GitHub Actions needs: `arn:aws:iam::396510133138:role/tickerapp-github-actions-ecr`
   - Ensure this role exists and has ECR push permissions

## Deployment Architecture Summary

```
GitHub Push / Manual Trigger
         │
         ▼
┌─────────────────────────┐
│  GitHub Actions /       │
│  CodeBuild              │
│  - Build 3 Docker images│
│  - Push to ECR          │
└───────────┬─────────────┘
            │
            ▼
┌─────────────────────────┐
│  ECR (Docker Registry)  │
└───────────┬─────────────┘
            │
            ▼
┌─────────────────────────┐
│  EC2 Instance           │
│  - bootstrap-runtime.sh │
│  - docker compose up    │
│  - nginx reverse proxy  │
│  - Django + React app   │
└─────────────────────────┘
```

## Env Variables Required (CodeBuild / EC2)

```
DJANGO_SECRET_KEY=<random-secret>
DJANGO_ALLOWED_HOSTS=localhost,127.0.0.1,ticker.quantlab.co.in
ECR_REGISTRY=<your-account>.dkr.ecr.ap-south-1.amazonaws.com
IMAGE_TAG=latest
BACKEND_IMAGE_REPOSITORY=tickerapp-backend
FRONTEND_IMAGE_REPOSITORY=tickerapp-frontend
POSTGRES_IMAGE_REPOSITORY=tickerapp-postgres
POSTGRES_DB=tickerapp
POSTGRES_USER=tickerapp
POSTGRES_PASSWORD=<strong-password>
```
