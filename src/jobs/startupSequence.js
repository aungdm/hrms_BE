/**
 * Startup Sequence for HRMS Backend
 * 
 * This file manages the startup sequence for attendance-related tasks:
 * 1. Immediately sync attendance logs from biometric devices
 * 2. Wait for 3 minutes
 * 3. Start the attendance processor job scheduler
 * 4. Start the regular attendance logs sync job scheduler
 */

const { syncAttendanceLogs } = require('../controllers/attendanceLogsController');
const { scheduleAttendanceProcessingJob } = require('./attendanceProcessorJob');
const { scheduleAttendanceLogsSync } = require('./attendanceLogsSync');

// Detect serverless environment
const isServerless = process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME;

/**
 * Initializes the startup sequence for attendance processing
 * First syncs attendance logs, then starts the attendance processor job after a delay
 */
const initializeStartupSequence = async () => {
  // Skip full initialization in serverless environments
  if (isServerless) {
    console.log('Running in serverless environment - startup sequence modified');
    return;
  }
  
  try {
    console.log('Starting HRMS startup sequence...');
    
    // Step 1: Immediately sync attendance logs
    console.log('Starting immediate attendance logs sync...');
    // await syncAttendanceLogs();
    console.log('Initial attendance logs sync completed');
    
    // Step 2: Start the regular attendance logs sync job
    console.log('Starting regular attendance logs sync job scheduler...');
    // scheduleAttendanceLogsSync();
    
    // Step 3: Wait for 1 minute before starting the attendance processor
    console.log('Waiting 1 minute before starting attendance processor job...');
    setTimeout(() => {
      console.log('Starting attendance processor job scheduler after 1-minute delay');
      // Step 4: Start the attendance processor job scheduler
      scheduleAttendanceProcessingJob();
    }, 20 * 3000); // 1 minute in milliseconds
    
  } catch (error) {
    console.error('Error during startup sequence:', error);
    // Still schedule the jobs after error in sync
    console.log('Starting regular attendance logs sync job scheduler after error...');
    scheduleAttendanceLogsSync();
    
    setTimeout(() => {
      console.log('Starting attendance processor job scheduler after error and delay');
      scheduleAttendanceProcessingJob();
    }, 60 * 1000);
  }
};

// For serverless environments, provide a way to manually trigger attendance sync
const manualAttendanceSync = async () => {
  try {
    console.log('Starting manual attendance logs sync...');
    await syncAttendanceLogs();
    console.log('Manual attendance logs sync completed');
    return { success: true, message: 'Attendance logs sync completed' };
  } catch (error) {
    console.error('Error during manual attendance sync:', error);
    return { success: false, message: 'Error during attendance sync', error: error.message };
  }
};

module.exports = {
  initializeStartupSequence,
  manualAttendanceSync
}; 