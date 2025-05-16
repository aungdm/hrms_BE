/**
 * Attendance Logs Sync Job
 * This file sets up a cron job to sync attendance logs from multiple biometric devices
 */
const cron = require('node-cron');
const { syncAttendanceLogs } = require('../controllers/attendanceLogsController');

/**
 * Schedule the job to run every 5 minutes
 * Cron expression: /5 * * * * (every 5 minutes)
 */
const scheduleAttendanceLogsSync = () => {
  // Run every 5 minutes
  cron.schedule('*/5 * * * *', async () => {
    try {
      console.log(`[${new Date().toISOString()}] Starting scheduled attendance logs sync for all machines`);
      await syncAttendanceLogs();
      console.log(`[${new Date().toISOString()}] Attendance logs sync completed successfully for all machines`);
    } catch (error) {
      console.error(`[${new Date().toISOString()}] Error in attendance logs sync:`, error);
    }
  }, {
    scheduled: true,
    timezone: process.env.TIMEZONE || 'UTC' // Use environment variable or default to UTC
  });
  
  console.log('Attendance logs sync job scheduled to run every 5 minutes for all machines');
};

module.exports = {
  scheduleAttendanceLogsSync
}; 