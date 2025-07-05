# GCP Cloud Run Deployment Guide 🌩️

## Prerequisites
1. Install Google Cloud CLI: https://cloud.google.com/sdk/docs/install
2. Create GCP project or use existing one
3. Enable required APIs

## Quick Setup

### 1. Initialize GCP
```bash
# Login to GCP
gcloud auth login

# Set project (replace with your project ID)
gcloud config set project YOUR_PROJECT_ID

# Enable required services
gcloud services enable run.googleapis.com
gcloud services enable cloudbuild.googleapis.com
gcloud services enable cloudscheduler.googleapis.com
```

### 2. Deploy to Cloud Run
```bash
cd snowmass-monitor

# Build and deploy optimized for FREE TIER
gcloud run deploy snowmass-monitor \
  --source . \
  --platform managed \
  --region us-central1 \
  --allow-unauthenticated \
  --memory 1Gi \
  --cpu 1 \
  --timeout 300 \
  --max-instances 1 \
  --concurrency 1 \
  --set-env-vars SNOWMASS_USERNAME=jillyn.johnson@gmail.com,SNOWMASS_PASSWORD=OneSnowmass25,NODE_ENV=production
```

### 2. Hourly Scheduling (WITHIN FREE TIER!)
```bash
# Create Cloud Scheduler job for hourly monitoring
gcloud scheduler jobs create http snowmass-hourly \
  --location us-central1 \
  --schedule "0 * * * *" \
  --uri "https://snowmass-monitor-[HASH]-uc.a.run.app/api/snowmass-monitor" \
  --http-method POST \
  --headers "Content-Type=application/json" \
  --message-body "{}"
```

## Free Tier Usage (Hourly):
- **Monthly runs**: 720 (24 × 30 days)
- **Compute usage**: 1,800 GB-seconds 
- **Free tier limit**: 400,000 GB-seconds
- **Usage**: 0.45% of free tier ✅
- **Cost**: $0.00/month 🎉

## Alternative: Manual Deployment Steps

### Step 1: Build Container
```bash
# Build the container image
gcloud builds submit --tag gcr.io/YOUR_PROJECT_ID/snowmass-monitor
```

### Step 2: Deploy to Cloud Run
```bash
# Deploy the container
gcloud run deploy snowmass-monitor \
  --image gcr.io/YOUR_PROJECT_ID/snowmass-monitor \
  --platform managed \
  --region us-central1 \
  --allow-unauthenticated \
  --memory 2Gi \
  --cpu 1 \
  --timeout 900
```

### Step 3: Set Environment Variables
```bash
# Set credentials (replace with your values)
gcloud run services update snowmass-monitor \
  --region us-central1 \
  --set-env-vars SNOWMASS_USERNAME=your-email@gmail.com \
  --set-env-vars SNOWMASS_PASSWORD=your-password \
  --set-env-vars NODE_ENV=production
```

## Storage Setup (for baseline images)

### Option 1: Cloud Storage (Recommended)
```bash
# Create bucket for baseline storage
gsutil mb gs://snowmass-monitor-baselines

# Update code to use Cloud Storage instead of local filesystem
```

### Option 2: Use container's tmp directory (simpler, but not persistent across deployments)
The current setup stores baselines in `/app/tmp/baselines` which works but gets reset on new deployments.

## Cost Estimation
- **Cloud Run**: ~$5-15/month (depending on usage)
- **Cloud Scheduler**: ~$0.10/month  
- **Cloud Storage**: ~$1/month for images
- **Total**: ~$6-16/month

## Monitoring & Logs
```bash
# View logs
gcloud logs read "resource.type=cloud_run_revision AND resource.labels.service_name=snowmass-monitor" --limit 50

# View service details
gcloud run services describe snowmass-monitor --region us-central1
```

## Testing Deployment
Once deployed, you can test:
```bash
# Get your Cloud Run URL
gcloud run services describe snowmass-monitor --region us-central1 --format 'value(status.url)'

# Test the health endpoint
curl https://your-service-url/health

# Trigger manual monitoring
curl -X POST https://your-service-url/api/snowmass-monitor -H "Content-Type: application/json" -d "{}"
```

## Benefits of Cloud Run:
✅ **Auto-scaling**: Only runs when needed  
✅ **Cost-effective**: Pay per request  
✅ **Fully managed**: No server maintenance  
✅ **Supports Playwright**: Full browser automation  
✅ **Built-in monitoring**: Logs and metrics included  
✅ **Easy scheduling**: Integrates with Cloud Scheduler  

The system will automatically send webhooks to your n8n endpoint when availability changes are detected! 🏔️