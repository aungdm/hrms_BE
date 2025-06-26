/**
 * Script to process attendance for a specific month
 * 
 * Usage: 
 * node processMonthAttendance.js <month> <year> [employeeId] [forceReprocess]
 * 
 * Example:
 * node processMonthAttendance.js 5 2023          # Process May 2023 for all employees
 * node processMonthAttendance.js 5 2023 123456   # Process May 2023 for employee with ID 123456
 * node processMonthAttendance.js 5 2023 123456 true  # Force reprocess May 2023 for employee with ID 123456
 */

// Load environment variables
require('dotenv').config();

// Connect to MongoDB
const mongoose = require('mongoose');
const moment = require('moment');

// Import necessary modules
const { processAttendanceLogs, verifyMonthAttendance } = require('../utils/attendanceProcessor');
const EmployeeSchedule = require('../models/employeeSchedule');
const DailyAttendance = require('../models/dailyAttendance');
const Employee = require('../models/employee');
const AttendanceLog = require('../models/attendanceLogs');

// Parse command line arguments
const args = process.argv.slice(2);
const month = parseInt(args[0]);
const year = parseInt(args[1]);
const employeeId = args[2] || null;
const forceReprocess = args[3] === 'true';

// Validate arguments
if (!month || !year || month < 1 || month > 12 || year < 2000 || year > 2100) {
  console.error('Invalid month or year. Usage: node processMonthAttendance.js <month> <year> [employeeId] [forceReprocess]');
  process.exit(1);
}

// Connect to MongoDB
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/hrms')
  .then(() => console.log('Connected to MongoDB'))
  .catch(err => {
    console.error('Failed to connect to MongoDB:', err);
    process.exit(1);
  });

async function processMonth() {
  try {
    console.log(`Processing attendance for ${month}/${year}`);
    
    // Create date range for the entire month
    const startDate = moment({ year, month: month - 1, day: 1 }).startOf('day').toDate();
    const endDate = moment({ year, month: month - 1 }).endOf('month').toDate();
    
    console.log(`Date range: ${startDate.toISOString()} to ${endDate.toISOString()}`);
    console.log(`Days in month: ${moment(startDate).daysInMonth()}`);
    
    // Prepare employee filter
    const employeeFilter = employeeId ? [employeeId] : null;
    
    if (employeeId) {
      console.log(`Processing for specific employee: ${employeeId}`);
    } else {
      console.log('Processing for all employees');
    }
    
    // If force reprocess, mark logs as unprocessed and delete existing records
    if (forceReprocess) {
      console.log('Force reprocess enabled - marking logs as unprocessed');
      
      // Get all logs within the date range
      const logsQuery = {
        recordTime: {
          $gte: moment(startDate).startOf('day').subtract(12, 'hours').toDate(),
          $lte: moment(endDate).endOf('day').add(12, 'hours').toDate()
        }
      };
      
      // Add employee filter if specified
      if (employeeFilter) {
        logsQuery.deviceUserId = { $in: employeeFilter };
      }
      
      // Mark logs as unprocessed
      const updateResult = await AttendanceLog.updateMany(
        logsQuery,
        { $set: { isProcessed: false } }
      );
      
      console.log(`Marked ${updateResult.modifiedCount} logs as unprocessed`);
      
      // Delete existing daily attendance records for this period
      const deleteQuery = {
        date: {
          $gte: moment(startDate).startOf('day').toDate(),
          $lte: moment(endDate).endOf('day').toDate()
        }
      };
      
      // Add employee filter if specified
      if (employeeFilter) {
        deleteQuery.employeeId = { $in: employeeFilter };
      }
      
      const deleteResult = await DailyAttendance.deleteMany(deleteQuery);
      console.log(`Deleted ${deleteResult.deletedCount} existing daily attendance records`);
    }
    
    // Process the month's attendance
    console.log('Starting attendance processing...');
    const result = await processAttendanceLogs(startDate, endDate, employeeFilter);
    console.log('Initial processing completed');
    
    // Run a dedicated verification step to ensure all days have records
    console.log('Running verification to ensure all days have attendance records...');
    const verificationResult = await verifyMonthAttendance(startDate, endDate, employeeFilter);
    
    // Combine results
    const combinedResult = {
      ...result,
      created: result.created + verificationResult.recordsCreated,
      absentsCreated: (result.absentsCreated || 0) + verificationResult.absentsCreated,
      missingDaysFixed: verificationResult.recordsCreated
    };
    
    console.log('\n====== PROCESSING SUMMARY ======');
    console.log(`Month: ${month}/${year}`);
    console.log(`Days in month: ${moment(startDate).daysInMonth()}`);
    console.log(`Logs processed: ${result.processed}`);
    console.log(`Records created: ${combinedResult.created}`);
    console.log(`Records updated: ${result.updated}`);
    console.log(`Errors: ${result.errors}`);
    console.log(`Missing days fixed: ${verificationResult.recordsCreated}`);
    console.log(`Verification details: ${verificationResult.absentsCreated} absents, ${verificationResult.dayOffCreated} day offs`);
    console.log('==============================\n');
    
    console.log('Processing completed successfully');
    
    // Close MongoDB connection
    await mongoose.connection.close();
    console.log('MongoDB connection closed');
    
  } catch (error) {
    console.error('Error processing month attendance:', error);
    process.exit(1);
  }
}

// Run the script
processMonth(); 