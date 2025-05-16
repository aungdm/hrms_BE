# HRMS Backend Deployment Guide for Vercel

This guide explains how to deploy the HRMS backend application to Vercel serverless environment.

## Important Notes About Serverless Deployment

Before deploying, please be aware of these important considerations:

1. **Scheduled Jobs**: In serverless environments, continuous background processes like cron jobs work differently. The attendance sync jobs will not run automatically as they would in a traditional server environment.

2. **Manual Attendance Sync**: We've added a special endpoint `/api/v1/attendanceLogs/manual-sync` that you can call to trigger attendance synchronization manually. You'll need to set up an external service (like Uptime Robot or a dedicated server with cron jobs) to call this endpoint at regular intervals.

3. **File System Access**: Serverless functions cannot write to the local file system persistently. We've adapted the logging to use console logs instead of file-based logs.

## Preparing for Deployment

### 1. Configure Environment Variables in Vercel

You need to set up the following environment variables in your Vercel project settings:

1. `MONGO_URI` - Your MongoDB connection string
2. `JWT_SECRET` - Secret key for JWT token generation
3. `ATTENDANCE_MACHINE_1_IP` - IP address of the first attendance machine
4. `ATTENDANCE_MACHINE_1_PORT` - Port of the first attendance machine
5. `ATTENDANCE_MACHINE_2_IP` - IP address of the second attendance machine
6. `ATTENDANCE_MACHINE_2_PORT` - Port of the second attendance machine
7. `ATTENDANCE_MACHINE_3_IP` - IP address of the third attendance machine
8. `ATTENDANCE_MACHINE_3_PORT` - Port of the third attendance machine
9. `TIMEZONE` - Your timezone (e.g., "Asia/Yangon")

### 2. Deploy to Vercel

You can deploy your backend to Vercel using one of these methods:

#### Option 1: Using Vercel CLI

1. Install Vercel CLI:
   ```
   npm install -g vercel
   ```

2. Log in to Vercel:
   ```
   vercel login
   ```

3. Deploy from your project directory:
   ```
   cd backend-hrms
   vercel
   ```

4. Follow the prompts to configure your project.

#### Option 2: Using Vercel GitHub Integration

1. Push your code to GitHub.
2. Go to [Vercel Dashboard](https://vercel.com/dashboard).
3. Click "New Project."
4. Import your repository.
5. Configure project settings:
   - Framework Preset: Other
   - Root Directory: leave empty (or specify if your backend is in a subdirectory)
   - Build Command: `npm run vercel-build`
   - Output Directory: leave empty
6. Click "Deploy."

## Setting Up Manual Cron Jobs

Since Vercel doesn't support persistent background processes, you'll need to set up external services to call your API endpoints at regular intervals:

### Option 1: Using Uptime Robot

1. Create an account on [Uptime Robot](https://uptimerobot.com/).
2. Set up a new monitor of type "HTTP(s)."
3. Configure it to call your endpoint: `https://your-vercel-app.vercel.app/api/v1/attendanceLogs/manual-sync`
4. Set the monitoring interval (e.g., every 30 minutes).
5. Use POST method and optionally set up an authorization header if you've added protection to the endpoint.

### Option 2: Using GitHub Actions

You can set up a GitHub Action to call your API at regular intervals:

1. Create a new file `.github/workflows/cron.yml` in your repository.
2. Add the following content:

```yaml
name: Trigger Attendance Sync

on:
  schedule:
    - cron: '*/30 * * * *'  # Run every 30 minutes

jobs:
  trigger_sync:
    runs-on: ubuntu-latest
    steps:
      - name: Call API Endpoint
        run: |
          curl -X POST https://your-vercel-app.vercel.app/api/v1/attendanceLogs/manual-sync
```

## Verifying Deployment

After deployment, you can check if your API is running correctly by:

1. Visiting the health check endpoint: `https://your-vercel-app.vercel.app/api/health`
2. Checking the environment in the response (should say "serverless")

## Troubleshooting

If you encounter issues with your Vercel deployment:

1. Check Vercel's function logs in the Vercel dashboard.
2. Ensure all environment variables are set correctly.
3. If you're having connectivity issues with your attendance machines, ensure they're accessible from Vercel's serverless functions (you may need a VPN or secure tunnel).
4. Remember that Vercel has limits on function execution time (10-60 seconds depending on your plan). If attendance sync takes longer, you may need to optimize or consider a different hosting solution.

## Need More Help?

If you need assistance with deployment, contact the development team or refer to [Vercel's documentation](https://vercel.com/docs). 