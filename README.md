# Snowmass Monitor - Deployment Guide 🏔️

## Overview
Automated monitoring system for One Snowmass resort availability that sends alerts to n8n webhook when new availability is detected.

## What it does:
- ✅ Logs into osrcreservations.com hourly
- ✅ Captures screenshots of next 3 months' availability  
- ✅ Compares with baseline images using visual diff detection
- ✅ Sends webhook alerts to n8n when significant changes detected
- ✅ Smart availability detection (green/orange colors = available)

## Webhook Integration
- **URL**: `https://buildsolutions.app.n8n.cloud/webhook-test/onesnowmass`
- **Method**: POST
- **Payload**: JSON with availability changes, timestamps, and summary stats

## Deployment Options

### Option 1: Local Windows (Recommended for testing)
```bash
# 1. Install dependencies
npm install

# 2. Install Playwright browsers  
npx playwright install chromium

# 3. Start the server
npm start
# Server runs at http://localhost:3000

# 4. Test manually
npm run monitor
```

### Option 2: Cloud Deployment (Railway/Render/Vercel)
1. **Railway** (Recommended - supports Playwright):
   - Connect GitHub repo
   - Add environment variables
   - Deploy automatically

2. **Render**:
   - Connect repo
   - Use Node.js environment
   - Add Playwright buildpack

### Option 3: VPS/Dedicated Server
```bash
# Install Node.js 18+ and dependencies
npm run setup

# Start with PM2 for persistence
npm install -g pm2
pm2 start server.js --name snowmass-monitor
pm2 startup
pm2 save
```

## Hourly Scheduling

### Option A: Windows Task Scheduler (Local)
1. Open Task Scheduler
2. Create Basic Task: "Snowmass Monitor"
3. Trigger: Daily, repeat every 1 hour
4. Action: Start Program
   - Program: `curl`
   - Arguments: `-X POST http://localhost:3000/api/snowmass-monitor -H "Content-Type: application/json" -d "{}"`

### Option B: Cloud Cron (Railway/Render)
```bash
# Add to your deployment
# Use external cron service like cron-job.org
# URL: https://your-app.railway.app/api/snowmass-monitor
# Method: POST
# Interval: Every hour
```

### Option C: Linux Cron (VPS)
```bash
# Edit crontab
crontab -e

# Add hourly monitor (runs at :00 of every hour)
0 * * * * curl -X POST http://localhost:3000/api/snowmass-monitor -H "Content-Type: application/json" -d "{}"
```

## Environment Variables
```env
SNOWMASS_USERNAME=jillyn.johnson@gmail.com
SNOWMASS_PASSWORD=OneSnowmass25
NODE_ENV=production
PORT=3000
```

## Monitoring Endpoints

- **Health Check**: `GET /health`
- **Manual Trigger**: `POST /api/snowmass-monitor`  
- **Test**: `POST /test`

## Expected n8n Webhook Payload
```json
{
  "timestamp": "2025-06-13T10:00:00.000Z",
  "alert": "NEW_AVAILABILITY_DETECTED",
  "summary": {
    "totalMonthsChecked": 3,
    "monthsWithChanges": 1,
    "highestChangePercent": 2.5,
    "totalAvailabilityIncrease": 150
  },
  "changedMonths": [
    {
      "month": "2025-07",
      "name": "July 2025", 
      "changePercentage": "2.5",
      "availabilityScore": "1.2",
      "availabilityIncrease": 150,
      "significantChange": true,
      "likelyNewAvailability": true
    }
  ],
  "message": "🏔️ NEW AVAILABILITY DETECTED! 1 month(s) show significant changes. Check One Snowmass reservations now!"
}
```

## Troubleshooting

### Common Issues:
1. **Login fails**: Check credentials in .env file
2. **No screenshots**: Ensure Playwright browsers installed  
3. **Webhook fails**: Verify n8n endpoint is accessible
4. **High CPU usage**: Playwright browser processes (normal)

### Debug Mode:
```javascript
// Set headless: false in snowmass-monitor.js to see browser
const browser = await chromium.launch({
  headless: false,  // Change to true for production
  args: ['--no-sandbox', '--disable-setuid-sandbox']
});
```

## Next Steps
1. ✅ Code is ready with webhook integration
2. 🔄 Choose deployment option
3. 🔄 Set up hourly scheduling  
4. 🔄 Test n8n webhook reception
5. 🔄 Monitor logs for successful runs

## Quick Start
```bash
git clone <repo>
cd snowmass-monitor
npm run setup
npm start
```

The system is now ready for deployment! 🚀