/**
 * Attendance Processor Job
 * This file sets up a cron job to run the attendance processor hourly
 */
const cron = require('node-cron');
const { processHourlyAttendanceLogs } = require('../utils/attendanceProcessor');

/**
 * Function to run the attendance processor
 * Wrapped in try/catch to ensure the cron job continues running even if errors occur
 */
const runAttendanceProcessor = async () => {
  try {
    console.log(`[${new Date().toISOString()}] Starting scheduled attendance processing job`);
    const result = await processHourlyAttendanceLogs();
    console.log(`[${new Date().toISOString()}] Attendance processing job completed successfully`);
    console.log(`Processed ${result.processed} logs, created ${result.created} records, updated ${result.updated} records`);
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Error in attendance processing job:`, error);
  }
};

/**
 * Schedule the job to run every hour at minute 0
 * Cron expression: '0 * * * *' (minute 0 of every hour)
 */
const scheduleAttendanceProcessingJob = () => {
  cron.schedule('*/2 * * * *', runAttendanceProcessor, {
    scheduled: true,
    timezone: process.env.TIMEZONE || 'UTC' // Use environment variable or default to UTC
  });
  
  console.log('Hourly attendance processing job scheduled');
  
  // Optionally run immediately on startup (can be controlled by env variable)
  if (process.env.RUN_ATTENDANCE_PROCESSOR_ON_STARTUP === 'true') {
    console.log('Running attendance processor on startup');
    runAttendanceProcessor();
  }
};

module.exports = {
  scheduleAttendanceProcessingJob
}; 