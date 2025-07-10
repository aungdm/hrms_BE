# HRMS Attendance Processing Documentation

## Table of Contents
1. [Overview](#overview)
2. [System Architecture](#system-architecture)
3. [Configuration Parameters](#configuration-parameters)
4. [Data Models](#data-models)
5. [Processing Workflow](#processing-workflow)
6. [Daily Attendance Processing](#daily-attendance-processing)
7. [Overtime Calculation](#overtime-calculation)
8. [Late Fine and Status Logic](#late-fine-and-status-logic)
9. [Hourly Processing](#hourly-processing)
10. [Error Handling](#error-handling)
11. [API Functions](#api-functions)
12. [Business Rules](#business-rules)
13. [Examples](#examples)

---

## Overview

The HRMS Attendance Processing System automatically converts raw attendance logs from biometric devices into structured daily attendance records. The system handles complex scenarios including:

- **Cross-day shifts** (shifts that span midnight)
- **Month boundary processing** (shifts crossing month boundaries)
- **Overtime calculations** (early arrival and late departure)
- **Multiple check-ins/check-outs** per day
- **Grace periods** and **late fines**
- **Work schedule variations** per employee
- **Hourly automated processing** via cron jobs

---

## System Architecture

### Core Components

1. **AttendanceProcessor** (`attendanceProcessor.js`)
   - Main processing engine
   - Handles batch and real-time processing
   - Manages cross-day and cross-month scenarios

2. **Data Models**
   - `AttendanceLog`: Raw biometric device data
   - `DailyAttendance`: Processed daily records
   - `EmployeeSchedule`: Employee-specific work schedules
   - `WorkSchedule`: Template work shift definitions
   - `ProcessTracking`: System processing state tracking

3. **Processing Types**
   - **Batch Processing**: Full month/date range processing
   - **Hourly Processing**: Automated incremental processing
   - **Manual Processing**: On-demand processing for specific employees/dates

---

## Configuration Parameters

```javascript
const CONFIG = {
  // Window for early check-ins (6 hours before shift)
  EARLY_CHECK_IN_WINDOW_HOURS: 6,
  
  // Window for late check-outs (6 hours after shift)
  LATE_CHECK_OUT_WINDOW_HOURS: 6,
  
  // Default lookback when no last processed time exists
  DEFAULT_LOOKBACK_HOURS: 24,
  
  // Grace time before overtime starts counting
  OVERTIME_GRACE_TIME: 10,
  
  // Minimum minutes required for overtime consideration
  OVERTIME_THRESHOLD_MINUTES: 10,
  
  // Process tracking configuration
  PROCESS_TRACKING_COLLECTION: "ProcessTracking",
  ATTENDANCE_PROCESS_ID: "hourlyAttendanceProcessor"
};
```

### Key Parameters Explained

- **EARLY_CHECK_IN_WINDOW_HOURS (6)**: Employees can check in up to 6 hours before their shift starts
- **LATE_CHECK_OUT_WINDOW_HOURS (6)**: Check-outs up to 6 hours after shift end are considered for that shift
- **OVERTIME_THRESHOLD_MINUTES (10)**: Must work >10 minutes beyond shift to qualify for overtime

---

## Data Models

### AttendanceLog Schema
```javascript
{
  deviceUserId: ObjectId,     // Employee ID from biometric device
  recordTime: Date,           // Timestamp of check-in/check-out
  isProcessed: Boolean,       // Processing status flag
  processingError: String,    // Error message if processing failed
  lastProcessingAttempt: Date,// Last attempt timestamp
  processingAttempts: Number  // Number of processing attempts
}
```

### DailyAttendance Schema
```javascript
{
  employeeId: ObjectId,
  date: Date,                    // Attendance date (midnight normalized)
  status: String,                // Present, Late, Absent, Half Day, etc.
  firstEntry: Date,              // First check-in time
  lastExit: Date,                // Last check-out time
  workDuration: Number,          // Work duration in minutes
  lateArrival: Number,           // Late minutes (after grace period)
  earlyDeparture: Number,        // Early departure minutes
  logs: [ObjectId],              // References to AttendanceLog records
  remarks: String,               // Generated remarks/notes
  expectedWorkHours: Number,     // Expected work duration in minutes
  checkinStatus: String,         // Early, On Time, Late
  checkoutStatus: String,        // Early, On Time, Late, Absent
  expectedCheckinTime: Date,     // Expected shift start time
  expectedCheckoutTime: Date,    // Expected shift end time
  isOverTime: Boolean,           // Overtime flag
  approvedOverTime: Boolean,     // Overtime approval status
  overtTimeStart: Date,          // Overtime start time
  overtTimeEnd: Date,            // Overtime end time
  overTimeMinutes: Number,       // Total overtime minutes
  overTimeStatus: String,        // Pending, Approved, Rejected
  relaxationRequest: Boolean,    // Relaxation request needed
  relaxationRequestStatus: String // Pending, Approved, Rejected
}
```

---

## Processing Workflow

### 1. Main Processing Flow

```
Raw Attendance Logs → Employee Schedule Lookup → Daily Processing → Status Determination → Record Creation/Update
```

### 2. Detailed Processing Steps

#### Step 1: Data Preparation
1. **Date Range Expansion**: Extend processing window by ±6 hours to capture cross-day entries
2. **Employee Filtering**: Process specific employees or all employees
3. **Schedule Validation**: Ensure employee schedules exist for the processing period

#### Step 2: Daily Processing Loop
For each day in the date range:
1. **Schedule Lookup**: Find employee's schedule for that specific day
2. **Work Day Determination**: Check if it's a working day or day off
3. **Log Collection**: Gather all relevant logs within the extended time window
4. **Attendance Processing**: Process logs to create daily attendance record

#### Step 3: Log Processing
1. **Entry/Exit Identification**: Determine first entry and last exit
2. **Duration Calculation**: Calculate work duration, late arrival, early departure
3. **Status Determination**: Assign attendance status based on business rules
4. **Overtime Detection**: Calculate overtime using threshold logic

---

## Daily Attendance Processing

### 1. Work Day vs Non-Work Day

#### Non-Work Days
- **Status**: "Weekend"
- **Work Duration**: 0 minutes
- **Check-in/Check-out Status**: "Day Off"
- **No further processing required**

#### Work Days with No Logs
- **Status**: "Absent"
- **Expected Work Hours**: From employee schedule
- **Check-in/Check-out Status**: "Absent"
- **Late Arrival**: 0 (not applicable)

### 2. Work Days with Logs

#### Single Log (Check-in Only)
```javascript
status = "Check In Only";
firstEntry = logTime;
lastExit = null;
workDuration = 0;
checkoutStatus = "Absent";
```

#### Multiple Logs
```javascript
firstEntry = logs[0].recordTime;
lastExit = logs[logs.length - 1].recordTime;
workDuration = (lastExit - firstEntry) in minutes;
```

### 3. Status Determination Logic

```javascript
if (logs.length === 1) {
  status = "Check In Only";
} else if (workHours < workSchedule.minWorkHoursForHalfDay) {
  status = "Less than Half Day";
} else if (workHours < workSchedule.minWorkHours) {
  status = "Half Day";
} else if (lateArrival > 0) {
  status = "Late";
} else {
  status = "Present";
}
```

### 4. Check-in/Check-out Status Logic

#### Check-in Status
```javascript
if (lateArrival > 0) {
  checkinStatus = "Late";
} else if (firstEntry < shiftStartTime && earlyMinutes > 10) {
  checkinStatus = "Early";
} else {
  checkinStatus = "On Time";
}
```

#### Check-out Status
```javascript
if (earlyDeparture > 0) {
  checkoutStatus = "Early";
} else if (lastExit > shiftEndTime && lateMinutes > 10) {
  checkoutStatus = "Late";
} else {
  checkoutStatus = "On Time";
}
```

---

## Overtime Calculation

### 1. Overtime Detection Logic

The system calculates two types of overtime:

#### Early Overtime (Pre-shift)
```javascript
if (firstEntry < shiftStartTime) {
  const minutesBeforeShift = (shiftStartTime - firstEntry) / (1000 * 60);
  if (minutesBeforeShift > OVERTIME_THRESHOLD_MINUTES) {
    earlyOvertimeMinutes = minutesBeforeShift;
    earlyOvertimeStart = firstEntry;
    earlyOvertimeEnd = shiftStartTime - (OVERTIME_THRESHOLD_MINUTES * 60 * 1000);
  }
}
```

#### Late Overtime (Post-shift)
```javascript
if (lastExit > shiftEndTime) {
  const minutesAfterShift = (lastExit - shiftEndTime) / (1000 * 60);
  if (minutesAfterShift > OVERTIME_THRESHOLD_MINUTES) {
    lateOvertimeMinutes = minutesAfterShift;
    lateOvertimeStart = shiftEndTime + (OVERTIME_THRESHOLD_MINUTES * 60 * 1000);
    lateOvertimeEnd = lastExit;
  }
}
```

### 2. Total Overtime Calculation
```javascript
const totalOvertimeMinutes = earlyOvertimeMinutes + lateOvertimeMinutes;

if (totalOvertimeMinutes > 0) {
  isOverTime = true;
  overTimeMinutes = totalOvertimeMinutes;
  overTimeStatus = "Pending"; // Requires approval
}
```

### 3. Overtime Approval Workflow
1. **Detection**: System automatically detects overtime based on thresholds
2. **Initial Status**: Set to "Pending" for management review
3. **Approval Process**: Managers can approve/reject overtime claims
4. **Payroll Integration**: Approved overtime affects salary calculations

---

## Late Fine and Status Logic

### 1. Late Arrival Calculation
```javascript
const lateArrival = firstEntry > shiftStartTime
  ? Math.max(0, Math.round((firstEntry - shiftStartTime) / (1000 * 60)) - workSchedule.graceTimeInMinutes)
  : 0;
```

### 2. Grace Period Handling
- **Grace Time**: Defined in work schedule (e.g., 15 minutes)
- **Late Fine**: Only applied after grace period expires
- **Example**: 
  - Shift starts: 9:00 AM
  - Grace period: 15 minutes
  - Employee arrives: 9:20 AM
  - Late arrival: 5 minutes (20 - 15 = 5)

### 3. Early Departure Calculation
```javascript
const earlyDeparture = lastExit < shiftEndTime
  ? Math.round((shiftEndTime - lastExit) / (1000 * 60))
  : 0;
```

---

## Hourly Processing

### 1. Automated Processing Overview

The system runs an automated hourly processor that:
- **Incremental Processing**: Only processes new logs since last run
- **Cross-day Handling**: Manages logs that belong to previous/next day shifts
- **Month Boundary Management**: Handles shifts crossing month boundaries
- **Error Recovery**: Tracks and retries failed processing attempts

### 2. Hourly Processing Flow

```
Get Last Processed Time → Find Unprocessed Logs → Determine Affected Dates → Process by Date → Update Last Processed Time
```

#### Step-by-Step Process:

1. **Retrieve Last Processed Time**
   ```javascript
   const lastProcessedTime = await getLastProcessedTime();
   const lookbackTime = lastProcessedTime || 
     moment().subtract(CONFIG.DEFAULT_LOOKBACK_HOURS, "hours").toDate();
   ```

2. **Find Unprocessed Logs**
   ```javascript
   const unprocessedLogs = await AttendanceLog.find({
     recordTime: { $gte: startTime, $lte: endTime },
     isProcessed: false,
   });
   ```

3. **Determine Shift Dates**
   - For each employee's logs, determine which shift date they belong to
   - Handle cross-day scenarios using shift start/end times
   - Account for early check-in and late check-out windows

4. **Process Affected Dates**
   - Process each date that has unprocessed logs
   - Update all processed logs with `isProcessed: true`
   - Track processing errors and retry attempts

### 3. Cross-Day and Cross-Month Handling

#### Cross-Day Scenarios
```javascript
// Example: Night shift 10 PM - 6 AM
// Check-in at 9:45 PM on Day 1 belongs to shift starting Day 1
// Check-out at 6:15 AM on Day 2 belongs to shift starting Day 1
```

#### Month Boundary Processing
- **Previous Month Check**: For logs on 1st day of month, check if they belong to last day of previous month
- **Next Month Check**: For logs on last day of month, check if they belong to first day of next month
- **Schedule Cross-Reference**: Use employee schedules to determine correct shift assignment

### 4. Failed Log Tracking

```javascript
const failedLogs = [];

// Track processing failures
failedLogs.push({
  logId: log._id,
  reason: "No employee schedule found",
  employeeId: employee._id,
  error: error
});

// Update failed logs in database
await updateFailedLogs(failedLogs);
```

---

## Error Handling

### 1. Processing Error Types

#### Schedule-Related Errors
- **No Employee Schedule**: Employee has no schedule for the month/year
- **No Day Schedule**: Specific day not found in employee schedule
- **Invalid Time Slot**: Referenced work schedule doesn't exist

#### Data-Related Errors
- **Invalid Log Data**: Corrupted or invalid attendance log entries
- **Missing Employee**: Log references non-existent employee
- **Date Range Issues**: Invalid date ranges in processing requests

#### System-Related Errors
- **Database Connection**: MongoDB connection issues
- **Memory Limits**: Large dataset processing limitations
- **Timeout Issues**: Long-running processing operations

### 2. Error Recovery Mechanisms

#### Retry Logic
```javascript
// Track processing attempts
await AttendanceLog.updateOne(
  { _id: log._id },
  { 
    $set: { 
      processingError: error.message,
      lastProcessingAttempt: new Date()
    },
    $inc: { processingAttempts: 1 }
  }
);
```

#### Fallback Strategies
1. **Schedule Fallback**: Use default schedule if employee schedule missing
2. **Date Fallback**: Use log date if shift date cannot be determined
3. **Status Fallback**: Mark as "Present" if status cannot be determined

### 3. Monitoring and Alerting

#### Processing Metrics
- **Logs Processed**: Count of successfully processed logs
- **Records Created**: New daily attendance records
- **Records Updated**: Updated existing records
- **Errors Encountered**: Failed processing attempts
- **Processing Duration**: Time taken for processing

#### Alert Conditions
- **High Error Rate**: >10% of logs failing to process
- **Processing Delays**: Processing taking >30 minutes
- **Missing Schedules**: Employees without schedules
- **Data Inconsistencies**: Duplicate or conflicting records

---

## API Functions

### 1. Main Processing Functions

#### processAttendanceLogs()
```javascript
/**
 * Main batch processing function
 * @param {Date} startDate - Start date for processing
 * @param {Date} endDate - End date for processing
 * @param {Array} employeeIds - Optional employee filter
 * @param {Array} failedLogs - Array to collect failed logs
 * @returns {Object} Processing results
 */
```

#### processHourlyAttendanceLogs()
```javascript
/**
 * Automated hourly processing function
 * Processes only new logs since last run
 * @returns {Object} Processing results
 */
```

### 2. Helper Functions

#### processDailyAttendance()
```javascript
/**
 * Process single employee's attendance for one day
 * @param {String} employeeId
 * @param {Date} date
 * @param {Array} logs
 * @param {Object} daySchedule
 * @param {Boolean} isWorkDay
 * @param {Date} shiftStartDate
 * @param {Date} shiftEndDate
 */
```

#### calculateOvertimeDetails()
```javascript
/**
 * Calculate overtime based on entry/exit times
 * @param {Date} firstEntry
 * @param {Date} lastExit
 * @param {Date} shiftStartTime
 * @param {Date} shiftEndTime
 * @returns {Object} Overtime details
 */
```

### 3. Utility Functions

#### determineShiftDate()
```javascript
/**
 * Determine correct shift date for cross-day scenarios
 * @param {Date} timestamp
 * @param {String} employeeId
 * @returns {moment} Shift date
 */
```

#### generateRemarks()
```javascript
/**
 * Generate human-readable remarks for attendance record
 * @param {String} status
 * @param {Number} lateArrival
 * @param {Number} earlyDeparture
 * @param {String} checkinStatus
 * @param {String} checkoutStatus
 * @param {Number} workDuration
 * @param {Number} expectedWorkHours
 * @param {Boolean} isOverTime
 * @returns {String} Generated remarks
 */
```

---

## Business Rules

### 1. Working Day Standards
- **Standard Shift**: 8 hours (480 minutes)
- **Half Day Minimum**: 4 hours (240 minutes) - configurable per work schedule
- **Quarter Day Minimum**: 2 hours (120 minutes) - configurable per work schedule
- **Grace Period**: 15 minutes default - configurable per work schedule

### 2. Overtime Policies
- **Minimum Threshold**: 10 minutes beyond shift end
- **Early Arrival**: Counts as overtime if >10 minutes before shift
- **Late Departure**: Counts as overtime if >10 minutes after shift
- **Approval Required**: All overtime requires management approval
- **Maximum Daily**: No system limit (configurable if needed)

### 3. Attendance Status Rules

#### Present
- Worked full expected hours
- No late arrival or within grace period
- Proper check-in and check-out

#### Late
- Arrived after grace period expires
- Worked full or nearly full hours
- Proper check-out

#### Half Day
- Worked at least half day minimum hours
- Less than full day hours

#### Less than Half Day
- Worked some hours but less than half day minimum
- More than just check-in

#### Check In Only
- Only one log entry (check-in)
- No check-out recorded

#### Absent
- No logs for the day
- Working day with no attendance

#### Weekend
- Non-working day
- Day off in schedule

### 4. Processing Rules

#### Duplicate Prevention
- Only one daily attendance record per employee per day
- Updates existing records if reprocessing
- Preserves manual overrides (e.g., approved overtime)

#### Cross-Day Processing
- 6-hour window before shift start for early check-ins
- 6-hour window after shift end for late check-outs
- Logs assigned to correct shift date based on employee schedule

#### Month Boundary Handling
- Check previous month schedules for logs on 1st day
- Check next month schedules for logs on last day
- Ensure no attendance records are missed

---

## Examples

### Example 1: Regular Day Shift Processing

**Scenario:**
- Employee: John Doe
- Shift: 9:00 AM - 5:00 PM
- Logs: Check-in 8:55 AM, Check-out 5:10 PM
- Date: 2024-01-15 (Monday)

**Processing:**
```javascript
// Input
firstEntry = 2024-01-15 08:55:00
lastExit = 2024-01-15 17:10:00
shiftStart = 2024-01-15 09:00:00
shiftEnd = 2024-01-15 17:00:00

// Calculations
workDuration = 495 minutes (8 hours 15 minutes)
lateArrival = 0 (arrived early)
earlyDeparture = 0 (left after shift end)
isOverTime = true (10 minutes after shift)
overtimeMinutes = 10

// Results
status = "Present"
checkinStatus = "Early"
checkoutStatus = "Late"
remarks = "Arrived early before scheduled time. Stayed later than scheduled end time. Worked 10 minutes overtime"
```

### Example 2: Night Shift Cross-Day Processing

**Scenario:**
- Employee: Jane Smith
- Shift: 10:00 PM - 6:00 AM (crosses midnight)
- Logs: Check-in 9:50 PM (Day 1), Check-out 6:05 AM (Day 2)
- Shift Date: Day 1

**Processing:**
```javascript
// Input (times on different calendar days)
firstEntry = 2024-01-15 21:50:00
lastExit = 2024-01-16 06:05:00
shiftStart = 2024-01-15 22:00:00
shiftEnd = 2024-01-16 06:00:00

// System correctly assigns to Day 1 shift
attendanceDate = 2024-01-15

// Calculations
workDuration = 495 minutes (8 hours 15 minutes)
lateArrival = 0
earlyDeparture = 0
isOverTime = true (15 minutes total: 10 early + 5 late)

// Results
status = "Present"
checkinStatus = "Early"
checkoutStatus = "On Time"
```

### Example 3: Half Day with Late Arrival

**Scenario:**
- Employee: Bob Wilson
- Shift: 9:00 AM - 5:00 PM
- Logs: Check-in 11:30 AM, Check-out 3:30 PM
- Grace Period: 15 minutes

**Processing:**
```javascript
// Input
firstEntry = 2024-01-15 11:30:00
lastExit = 2024-01-15 15:30:00
shiftStart = 2024-01-15 09:00:00
graceTime = 15 minutes

// Calculations
workDuration = 240 minutes (4 hours)
lateArrival = 135 minutes (150 - 15 = 135)
earlyDeparture = 90 minutes

// Results
status = "Half Day" (worked exactly half day hours)
checkinStatus = "Late"
checkoutStatus = "Early"
remarks = "Worked less than full day hours. Late arrival by 135 minutes. Early departure by 90 minutes"
```

### Example 4: Month Boundary Processing

**Scenario:**
- Date: 2024-01-01 (first day of month)
- Log: Check-out at 6:15 AM on Jan 1
- Employee has night shift Dec 31 10:00 PM - Jan 1 6:00 AM

**Processing:**
```javascript
// System logic
1. Check current month (January) schedule - no shift found for 6:15 AM
2. Check previous month (December) schedule
3. Find shift Dec 31 22:00 - Jan 1 06:00
4. Assign log to Dec 31 shift date

// Result
attendanceDate = 2023-12-31
status = "Present" (if paired with check-in from Dec 31)
```

### Example 5: Hourly Processing Scenario

**Scenario:**
- Hourly processor runs at 2:00 PM
- Last processed time: 1:00 PM
- New logs between 1:00 PM - 2:00 PM

**Processing:**
```javascript
// System workflow
1. Get logs from 1:00 PM - 2:00 PM with isProcessed = false
2. Group by employees
3. Determine affected shift dates
4. Process each affected date
5. Mark logs as processed
6. Update last processed time to 2:00 PM

// Cross-day handling
- Log at 1:30 PM might belong to previous day's night shift
- Log at 1:45 PM might belong to current day's day shift
- System uses employee schedules to determine correct assignment
```

---

## Performance Considerations

### 1. Batch Processing Optimization
- **Pagination**: Process large datasets in chunks
- **Indexing**: Proper database indexes on date, employeeId, recordTime
- **Memory Management**: Clear processed data from memory
- **Parallel Processing**: Process multiple employees simultaneously when possible

### 2. Real-time Processing Efficiency
- **Incremental Updates**: Only process new/changed data
- **Smart Scheduling**: Process during low-traffic hours
- **Resource Monitoring**: Track CPU, memory, and database usage
- **Graceful Degradation**: Continue processing even if some records fail

### 3. Database Optimization
- **Compound Indexes**: On frequently queried field combinations
- **TTL Indexes**: Automatic cleanup of old processing logs
- **Connection Pooling**: Efficient database connection management
- **Query Optimization**: Use aggregation pipelines for complex operations

---

## Troubleshooting Guide

### Common Issues and Solutions

#### 1. Logs Not Processing
**Symptoms**: `isProcessed` remains `false`
**Causes**: 
- No employee schedule
- Invalid time slot reference
- Data corruption

**Solutions**:
- Check employee schedule exists for the month/year
- Verify work schedule references are valid
- Review processing error logs

#### 2. Incorrect Shift Date Assignment
**Symptoms**: Attendance records on wrong dates
**Causes**:
- Cross-day shift configuration issues
- Missing schedule data
- Incorrect time zone handling

**Solutions**:
- Verify employee schedules span correct dates
- Check time zone consistency
- Review cross-day shift logic

#### 3. Missing Overtime Detection
**Symptoms**: Overtime not calculated correctly
**Causes**:
- Threshold settings
- Clock drift between devices
- Incorrect shift times

**Solutions**:
- Review overtime threshold configuration
- Synchronize device clocks
- Verify shift start/end times in schedules

#### 4. Performance Issues
**Symptoms**: Processing takes too long
**Causes**:
- Large datasets
- Missing database indexes
- Inefficient queries

**Solutions**:
- Implement batch processing
- Add database indexes
- Optimize query patterns

---

*Last Updated: December 2024*
*Version: 1.0* 