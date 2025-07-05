# GCP FREE TIER Optimization Guide 🆓

## Free Tier Resource Limits
- **Cloud Run**: 2M requests, 400K GB-seconds/month
- **Cloud Build**: 120 build-minutes/day  
- **Cloud Storage**: 5GB
- **Cloud Scheduler**: 3 jobs free

## Optimized Deployment for Free Tier

### 1. Resource-Optimized Deployment
```bash
# Deploy with minimal resources
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

### 2. Conservative Scheduling (stay within limits)
```bash
# Run every 2 hours instead of hourly to save resources
gcloud scheduler jobs create http snowmass-monitor \
  --location us-central1 \
  --schedule "0 */2 * * *" \
  --uri "https://snowmass-monitor-[HASH]-uc.a.run.app/api/snowmass-monitor" \
  --http-method POST \
  --headers "Content-Type=application/json" \
  --message-body "{}"
```

## Cost Calculation (Free Tier)

### Monthly Usage Estimate:
- **Requests**: 360/month (every 2 hours)
- **Execution Time**: ~2 minutes per run
- **Memory Usage**: 1GB × 2 min × 360 runs = 720 GB-seconds
- **Result**: Well within 400K GB-seconds limit! ✅

### Storage:
- Baseline images: ~3 images × 50KB = 150KB
- Well within 5GB limit ✅

## Alternative: Even More Conservative

If you want to be extra safe:

### Option 1: Run 3x Daily
```bash
# 8 AM, 2 PM, 8 PM daily
gcloud scheduler jobs create http snowmass-3x-daily \
  --schedule "0 8,14,20 * * *"
```

### Option 2: Business Hours Only
```bash
# Only during peak booking hours (9 AM - 6 PM)
gcloud scheduler jobs create http snowmass-business \
  --schedule "0 9-18 * * *"
```

## Monitoring Free Tier Usage

### Check Usage:
```bash
# View Cloud Run metrics
gcloud run services describe snowmass-monitor --region us-central1

# Check billing
gcloud billing accounts list
```

### Set Billing Alerts:
1. Go to Cloud Console → Billing
2. Set budget alert at $1 (way before any charges)
3. Get email notifications if approaching limits

## Expected Costs: $0.00/month 🎉

With hourly monitoring:
- **Cloud Run**: FREE (1,800 GB-seconds, limit 400,000)
- **Cloud Scheduler**: FREE (1 job, limit is 3)
- **Cloud Storage**: FREE (minimal image storage)
- **Cloud Build**: FREE (one-time deployment)
- **Usage**: 0.45% of free tier allocation

## Tips to Stay in Free Tier:

1. **Monitor rarely used**: Every 2-4 hours vs hourly
2. **Clean old baselines**: Delete old comparison images
3. **Set billing alerts**: Get notified before any charges
4. **Use minimal resources**: 1GB memory vs 2GB

## Quick Start (Free Tier Optimized):
```bash
# 1. Deploy with minimal resources
gcloud run deploy snowmass-monitor \
  --source . \
  --memory 1Gi \
  --timeout 300 \
  --max-instances 1

# 2. Schedule conservatively (every 2 hours)  
gcloud scheduler jobs create http snowmass-monitor \
  --schedule "0 */2 * * *" \
  --uri "https://your-service-url/api/snowmass-monitor"
```

**Result: Full automation for $0/month!** 🆓🏔️