const AttendanceLog = require("../models/attendanceLogs");
const DailyAttendance = require("../models/dailyAttendance");
const Employee = require("../models/employee");
const ProcessTracking = require("../models/processTracking");
const EmployeeSchedule = require("../models/employeeSchedule");

const WorkSchedule = require("../models/workSchedule");
const moment = require("moment");

/**
 * System configuration
 * These could be moved to environment variables
 */
const CONFIG = {
  // Maximum hours before shift start that check-ins can be considered valid
  EARLY_CHECK_IN_WINDOW_HOURS: 6,

  // Maximum hours after shift end that check-outs can be considered valid
  LATE_CHECK_OUT_WINDOW_HOURS: 6,

  // Default lookback period when no LastProcessedTime is found
  DEFAULT_LOOKBACK_HOURS: 24,

  // grace time for overtime which defines that how much minute will be required to start considering the overtime
  OVERTIME_GRACE_TIME: 10,
  
  // New constant for overtime threshold (minutes)
  OVERTIME_THRESHOLD_MINUTES: 10,

  // Process status tracking in DB
  PROCESS_TRACKING_COLLECTION: "ProcessTracking",
  ATTENDANCE_PROCESS_ID: "hourlyAttendanceProcessor",
};

/**
 * Process attendance logs and create daily attendance records
 * @param {Date} startDate - Start date for processing
 * @param {Date} endDate - End date for processing
 * @param {Array} employeeIds - Optional array of employee IDs to process
 * @param {Array} failedLogs - Array to store processing errors
 * @returns {Object} - Processing results
 */
const processAttendanceLogs = async (
  startDate,
  endDate,
  employeeIds = null,
  failedLogs = []
) => {
  try {
    console.log(
      `Starting attendance processing from ${startDate.toISOString()} to ${endDate.toISOString()}`
    );
    
    // if (employeeIds && employeeIds.length) {
    //   console.log(`Processing for ${employeeIds.length} specific employees`);
    // } else {
    //   console.log(`Processing for all employees`);
    // }

    // Prepare date range - expand range by 6 hours to capture cross-day entries
    const start = moment(startDate)
      .startOf("day")
      .subtract(CONFIG.EARLY_CHECK_IN_WINDOW_HOURS, "hours")
      .toDate();
    const end = moment(endDate)
      .endOf("day")
      .add(CONFIG.LATE_CHECK_OUT_WINDOW_HOURS, "hours")
      .toDate();

    // Query to get unprocessed logs within date range
    const query = {
      recordTime: { $gte: start, $lte: end },
      isProcessed: false,
    };

    // Add employee filter if specified
    if (employeeIds && employeeIds.length > 0) {
      query.deviceUserId = { $in: employeeIds };
    }

    // Get all employees (or specific employees)
    const employeeQuery =
      employeeIds && employeeIds.length > 0
        ? { _id: { $in: employeeIds } }
        : {};

    const employees = await Employee.find(employeeQuery).lean();
    // Process each day in the date range
    const currentDate = moment(startDate).startOf("day"); // Use original startDate for processing days
    const lastDate = moment(endDate).endOf("day"); // Use original endDate for processing days

    let processed = 0;
    let created = 0;
    let updated = 0;
    let errors = 0;

    // Process each day in the date range
    while (currentDate.isSameOrBefore(lastDate, "day")) {
      
      // Process each employee for this day
      for (const employee of employees) {
        try {
          // Find the employee's schedule for this day
          const currentDateStr = currentDate.format('YYYY-MM-DD');
          const monthNum = currentDate.month() + 1; // moment is 0-indexed for months
          const yearNum = currentDate.year();
          // Get the employee schedule instead of work schedule
          const employeeSchedule = await EmployeeSchedule.findOne({
            employee_id: employee._id,
            month: monthNum,
            year: yearNum
          });
          if (!employeeSchedule) {
            console.warn(`No employee schedule found for ${employee._id} for ${monthNum}/${yearNum}`);
            
            // Find logs for this employee on this day
            const employeeLogs = await AttendanceLog.find({
              deviceUserId: employee._id,
              recordTime: {
                $gte: moment(currentDate).startOf('day').toDate(),
                $lte: moment(currentDate).endOf('day').toDate()
              },
              isProcessed: false
            });
            
            // Add to failed logs
            for (const log of employeeLogs) {
              failedLogs.push({
                logId: log._id,
                reason: `No employee schedule found for ${monthNum}/${yearNum}`,
                employeeId: employee._id
              });
            }
            
            continue;
          }

          // Find the specific day's schedule
          const daySchedule = employeeSchedule.schedules.find(
            s => moment(s.date).format('YYYY-MM-DD') === currentDateStr
          );

          if (!daySchedule) {
            console.warn(`No day schedule found for ${employee._id} on ${currentDateStr}`);
            
            // Find logs for this employee on this day
            const employeeLogs = await AttendanceLog.find({
              deviceUserId: employee._id,
              recordTime: {
                $gte: moment(currentDate).startOf('day').toDate(),
                $lte: moment(currentDate).endOf('day').toDate()
              },
              isProcessed: false
            });
            
            // Add to failed logs
            for (const log of employeeLogs) {
              failedLogs.push({
                logId: log._id,
                reason: `No day schedule found for date ${currentDateStr}`,
                employeeId: employee._id
              });
            }
            
            continue;
          }

          // Determine if it's a work day based on isDayOff flag
          const isWorkDay = !daySchedule.isDayOff;

          // If it's not a work day, create a weekend/holiday record and continue
          if (!isWorkDay) {
            await createOrUpdateDailyAttendance(
              employee._id,
              currentDate.toDate(),
              "Weekend",
              null,
              null,
              0,
              0,
              0,
              [],
              0,
              "Day Off",
              "Day Off",
              null,
              null,
              false
            );
            created++;
            continue;
          }

          // Use the specific start and end times from the day's schedule
          const shiftStartTime = moment(daySchedule.start);
          const shiftEndTime = moment(daySchedule.end);
          console.log({shiftStartTime}, {shiftEndTime}, "shiftStartTime and shiftEndTime");

          // Calculate the extended window for early check-in
          const earlyWindow = shiftStartTime
            .clone()
            .subtract(CONFIG.EARLY_CHECK_IN_WINDOW_HOURS, "hours");
          // Calculate the extended window for late check-out
          const lateWindow = shiftEndTime
            .clone()
            .add(CONFIG.LATE_CHECK_OUT_WINDOW_HOURS, "hours");

          // Get all logs that could be relevant for this shift (within extended windows)
          const logs = await AttendanceLog.find({
            deviceUserId: employee._id,
            recordTime: {
              $gte: earlyWindow.toDate(),
              $lte: lateWindow.toDate(),
            },
          }).sort({ recordTime: 1 });
          if (logs.length > 0) {
            try {
              // Process daily attendance
              const result = await processDailyAttendance(
                employee._id,
                currentDate.toDate(),
                logs,
                daySchedule,
                isWorkDay,
                shiftStartTime.toDate(),
                shiftEndTime.toDate()
              );

              // Update logs as processed
              const logIds = logs.map((log) => log._id);
              await AttendanceLog.updateMany(
                { _id: { $in: logIds } },
                { $set: { 
                  isProcessed: true,
                  processingError: null,
                  lastProcessingAttempt: new Date()
                }}
              );

              processed += logs.length;
              if (result.created) created++;
              if (result.updated) updated++;
            } catch (processingError) {
              console.error(`Error processing attendance for employee ${employee._id} on ${currentDateStr}:`, processingError);
              
              // Add to failed logs
              for (const log of logs) {
                failedLogs.push({
                  logId: log._id,
                  reason: `Processing error: ${processingError.message}`,
                  employeeId: employee._id,
                  error: processingError
                });
              }
              
              errors++;
            }
          } else {
            // No logs found within the extended window - mark as absent
            // Get expected work hours directly from the day schedule
            const expectedWorkHoursForShift = daySchedule.actual_expected_minutes || 
              calculateExpectedWorkHours(shiftStartTime.toDate(), shiftEndTime.toDate());
            
            await createOrUpdateDailyAttendance(
              employee._id,
              currentDate.toDate(),
              "Absent",
              null,
              null,
              0,
              0,
              0,
              [],
              expectedWorkHoursForShift,
              "Absent",
              "Absent",
              shiftStartTime.toDate(),
              shiftEndTime.toDate(),
              false
            );
            created++;
          }
        } catch (err) {
          console.error(
            `Error processing employee ${employee._id} for ${currentDate.format(
              "YYYY-MM-DD"
            )}:`,
            err
          );
          
          // Find logs for this employee on this day that might be affected
          const employeeLogs = await AttendanceLog.find({
            deviceUserId: employee._id,
            recordTime: {
              $gte: moment(currentDate).startOf('day').toDate(),
              $lte: moment(currentDate).endOf('day').toDate()
            },
            isProcessed: false
          });
          
          // Add to failed logs
          for (const log of employeeLogs) {
            failedLogs.push({
              logId: log._id,
              reason: `General processing error: ${err.message}`,
              employeeId: employee._id,
              error: err
            });
          }
          
          errors++;
        }
      }

      // Move to next day
      currentDate.add(1, "day");
    }


    return {
      processed,
      created,
      updated,
      errors,
    }; 
  } catch (error) {
    console.error("Error in processAttendanceLogs:", error);
    throw error;
  }
};

/**
 * Process daily attendance for a single employee on a specific day
 * @param {String} employeeId - Employee ID
 * @param {Date} date - The date to process
 * @param {Array} logs - Attendance logs
 * @param {Object} daySchedule - Employee's day schedule
 * @param {Boolean} isWorkDay - Whether this is a working day
 * @param {Date} shiftStartDate - The exact datetime of shift start
 * @param {Date} shiftEndDate - The exact datetime of shift end
 * @returns {Object} - Processing result
 */
const processDailyAttendance = async (
  employeeId,
  date,
  logs,
  daySchedule,
  isWorkDay,
  shiftStartDate,
  shiftEndDate
) => {
  // try {
    if (!isWorkDay) {
      // It's a non-working day (weekend or holiday)
      return await createOrUpdateDailyAttendance(
        employeeId,
        date,
        "Weekend",
        null,
        null,
        0,
        0,
        0,
        [],
        0,  // expectedWorkHours for non-working days is 0
        "Day Off", // checkinStatus for non-working days
        "Day Off", // checkoutStatus for non-working days
        null, // expectedCheckinTime for non-working days
        null, // expectedCheckoutTime for non-working days
        false // isOverTime for non-working days
      );
    }

    // Calculate expected work hours directly from the day schedule
    const expectedWorkHours = daySchedule.actual_expected_minutes || 
      calculateExpectedWorkHours(shiftStartDate, shiftEndDate);
    // For work days, process the logs
    if (logs.length === 0) {
      // No logs on a work day = absent
      return await createOrUpdateDailyAttendance(
        employeeId,
        date,
        "Absent",
        null,
        null,
        0,
        0,
        0,
        [],
        expectedWorkHours,
        "Absent", // checkinStatus for absent
        "Absent", // checkoutStatus for absent
        shiftStartDate, // Store expected check-in time even for absent
        shiftEndDate,   // Store expected check-out time even for absent
        false // isOverTime is false for absent
      );
    }

    // Use the first log as the first entry
    const firstEntry = logs[0].recordTime;
    // Only set lastExit if there's more than one log
    // Otherwise, it should remain null for single check-ins
    let lastExit = null;
    let workDuration = 0;
    let earlyDeparture = 0;
    let checkoutStatus = "Absent"; // Default for single log
    let isOverTime = false;
    let overTimeMinutes = 0;
    let overTimeStatus = null;
    let overtTimeStart = null;
    let overtTimeEnd = null;
    let relaxationRequest = false;
    let relaxationRequestStatus = null;

    const workSchedule = await WorkSchedule.findById(daySchedule.time_slot_id);
    if (logs.length > 1) {
      // Find the last exit that's closest to shift end or after
      // (should be after shift end or the latest log)
      let lastExitIndex = logs.length - 1;
      const workSchedule = await WorkSchedule.findById(daySchedule.time_slot_id);
      // If we have multiple logs, try to find the most appropriate exit
      let closestToShiftEnd = Math.abs(
        logs[lastExitIndex].recordTime - shiftEndDate
      );
      // Prioritize logs after shift end
      for (let i = logs.length - 1; i >= 0; i--) {
        const log = logs[i];
        // If log is after shift end, this is a good candidate for exit
        if (log.recordTime >= shiftEndDate) {
          lastExitIndex = i;
          break;
        }

        // Otherwise, find the closest one to shift end
        const difference = Math.abs(log.recordTime - shiftEndDate);
        if (difference < closestToShiftEnd) {
          closestToShiftEnd = difference;
          lastExitIndex = i;
        }
      }

      // Use the last log as the last exit
      lastExit = logs[logs.length - 1].recordTime;

      // Calculate work duration in minutes
      workDuration = Math.round(
        (lastExit.getTime() - firstEntry.getTime()) / (1000 * 60)
      );
      // Calculate early departure
      earlyDeparture =
        lastExit < shiftEndDate
          ? Math.round((shiftEndDate - lastExit) / (1000 * 60))
          : 0;
      console.log({ earlyDeparture}, "earlyDeparture" , {lastExit}, {shiftEndDate});
      // Determine check-out status
      checkoutStatus = "On Time";
      if (earlyDeparture > 0) {
        checkoutStatus = "Early";
      } else if (lastExit > shiftEndDate) {
        // If checked out more than 30 minutes after shift end
        const lateMinutes = Math.round((lastExit - shiftEndDate) / (1000 * 60));
        if (lateMinutes > 10) {
          checkoutStatus = "Late";
        }
      }

      // Use the new calculateOvertimeDetails function to determine overtime
      const overtimeDetails = calculateOvertimeDetails(
        firstEntry,
        lastExit,
        shiftStartDate,
        shiftEndDate
      );

      // Update overtime-related variables with the results from calculateOvertimeDetails
      isOverTime = overtimeDetails.isOverTime;
      overTimeMinutes = overtimeDetails.overtimeMinutes;
      
      if (isOverTime) {
        overtTimeStart = overtimeDetails.overtimeStart;
        overtTimeEnd = overtimeDetails.overtimeEnd;
        overTimeStatus = "Pending"; // Default status for new overtime
      }
    }
    // Check if late (considering grace period)
    const lateArrival =
      firstEntry > shiftStartDate
        ? Math.max(
            0,
            Math.round((firstEntry - shiftStartDate) / (1000 * 60)) -
            workSchedule.graceTimeInMinutes
          )
        : 0;

    // Determine attendance status
    let status = "Present";

    // Convert to hours for comparison
    const workHours = workDuration / 60;

    if (logs.length === 1) {
      // For single log entries, mark as "Check In Only"
      status = "Check In Only";
    } else if (workHours < workSchedule.minWorkHoursForHalfDay) {
      status = "Less than Half Day"; // Less than minimum hours for half day
    } else if (workHours < workSchedule.minWorkHours) {
      status = "Half Day";
    } else if (lateArrival > 0) {
      status = "Late";
    }

    // Determine check-in status
    let checkinStatus = "On Time";
    if (lateArrival > 0) {
      checkinStatus = "Late";
    } else if (firstEntry < shiftStartDate) {
      // If checked in more than 30 minutes early
      const earlyMinutes = Math.round((shiftStartDate - firstEntry) / (1000 * 60));
      if (earlyMinutes > 10) {
        checkinStatus = "Early";
      }
    }

    console.log({ firstEntry}, {lastExit}, {lateArrival}, {earlyDeparture}  , "relaxation request");
    // Determine if relaxation request is needed
    if (firstEntry && lastExit && (lateArrival > 1 || earlyDeparture > 0)) {
      relaxationRequest = true;
      relaxationRequestStatus = "Pending";
    }

    // Create or update the attendance record
    return await createOrUpdateDailyAttendance(
      employeeId,
      date,
      status,
      firstEntry,
      lastExit,
      workDuration,
      lateArrival,
      earlyDeparture,
      logs.map((log) => log._id),
      expectedWorkHours,
      checkinStatus,
      checkoutStatus,
      shiftStartDate,  // Store expected check-in time
      shiftEndDate,    // Store expected check-out time
      isOverTime,      // Store overtime status
      overtTimeStart,  // New field: overtime start time
      overtTimeEnd,    // New field: overtime end time
      overTimeMinutes, // New field: overtime minutes
      overTimeStatus,  // New field: overtime approval status
      relaxationRequest, // New field: relaxation request status
      relaxationRequestStatus // New field: relaxation request approval status
    );
  // } catch (error) {
  //   console.error("Error in processDailyAttendance:", error);
  //   throw error;
  // }
};

/**
 * Calculate expected work hours in minutes for a shift
 * @param {Date} shiftStartDate - The shift start time
 * @param {Date} shiftEndDate - The shift end time
 * @returns {Number} - Expected work duration in minutes
 */
const calculateExpectedWorkHours = (shiftStartDate, shiftEndDate) => {
  if (!shiftStartDate || !shiftEndDate) return 0;
  
  // Calculate the difference in minutes
  return Math.round((shiftEndDate - shiftStartDate) / (1000 * 60));
};

/**
 * Create or update a daily attendance record
 */
const createOrUpdateDailyAttendance = async (
  employeeId,
  date,
  status,
  firstEntry,
  lastExit,
  workDuration,
  lateArrival,
  earlyDeparture,
  logIds,
  expectedWorkHours,
  checkinStatus,
  checkoutStatus,
  expectedCheckinTime,
  expectedCheckoutTime,
  isOverTime,
  overtTimeStart,
  overtTimeEnd,
  overTimeMinutes,
  overTimeStatus,
  relaxationRequest,
  relaxationRequestStatus
) => {
  // Get date with time set to midnight
  const dayDate = new Date(date);
  dayDate.setHours(0, 0, 0, 0);
  
  try {
    // Check if record already exists
    const existingRecord = await DailyAttendance.findOne({
      employeeId,
      date: dayDate,
    });
    // console.log({ existingRecord}, "existingRecord");
    // Get employee details for better logging
    const employee = await Employee.findById(employeeId).select('employeeId name');
    const employeeInfo = employee ? `${employee.name} (${employee.employeeId || employeeId})` : employeeId;
    const formattedDate = dayDate.toISOString().split('T')[0];

    if (existingRecord) {
      // Update existing record
      const updated = await DailyAttendance.findByIdAndUpdate(
        existingRecord._id,
        {
          status,
          firstEntry,
          lastExit,
          workDuration,
          lateArrival,
          earlyDeparture,
          logs: logIds,
          remarks: generateRemarks(status, lateArrival, earlyDeparture, checkinStatus, checkoutStatus, workDuration, expectedWorkHours, isOverTime),
          expectedWorkHours,
          checkinStatus,
          checkoutStatus,
          expectedCheckinTime,
          expectedCheckoutTime,
          isOverTime,
          // Keep existing approvedOverTime unchanged
          approvedOverTime: existingRecord.approvedOverTime,
          overtTimeStart,
          overtTimeEnd,
          overTimeMinutes,
          overTimeStatus,
          relaxationRequest,
          relaxationRequestStatus,
        },
        { new: true }
      );
      
      // Log detailed information about the update
      console.log('╔═════════════════════ ATTENDANCE RECORD UPDATED ═════════════════════╗');
      console.log(`║ Employee: ${employeeInfo.padEnd(60)} ║`);
      console.log(`║ Date: ${formattedDate.padEnd(64)} ║`);
      console.log(`║ Status: ${status.padEnd(63)} ║`);
      console.log(`║ Previous Status: ${existingRecord.status.padEnd(55)} ║`);
      console.log(`║ First Entry: ${firstEntry ? firstEntry.toLocaleTimeString() : 'N/A'.padEnd(58)} ║`);
      console.log(`║ Last Exit: ${lastExit ? lastExit.toLocaleTimeString() : 'N/A'.padEnd(59)} ║`);
      console.log(`║ Work Duration: ${workDuration} minutes`.padEnd(70) + ' ║');
      console.log(`║ Late Arrival: ${lateArrival} minutes`.padEnd(70) + ' ║');
      console.log(`║ Early Departure: ${earlyDeparture} minutes`.padEnd(70) + ' ║');
      console.log(`║ Expected Work Hours: ${expectedWorkHours} minutes`.padEnd(70) + ' ║');
      console.log(`║ Checkin Status: ${checkinStatus.padEnd(63)} ║`);
      console.log(`║ Checkout Status: ${checkoutStatus.padEnd(63)} ║`);
      console.log(`║ Expected Checkin: ${expectedCheckinTime ? expectedCheckinTime.toLocaleTimeString() : 'N/A'.padEnd(58)} ║`);
      console.log(`║ Expected Checkout: ${expectedCheckoutTime ? expectedCheckoutTime.toLocaleTimeString() : 'N/A'.padEnd(58)} ║`);
      console.log(`║ Overtime: ${isOverTime ? 'Yes' : 'No'.padEnd(65)} ║`);
      console.log(`║ Approved Overtime: ${updated.approvedOverTime ? 'Yes' : 'No'.padEnd(59)} ║`);
      console.log(`║ Record ID: ${updated._id}`.padEnd(70) + ' ║');
      console.log('╚════════════════════════════════════════════════════════════════════╝');

      return { updated: true, created: false, record: updated };
    } else {
      // Create new record
      const newRecord = new DailyAttendance({
        employeeId,
        date: dayDate,
        status,
        firstEntry,
        lastExit,
        workDuration,
        lateArrival,
        earlyDeparture,
        logs: logIds,
        remarks: generateRemarks(status, lateArrival, earlyDeparture, checkinStatus, checkoutStatus, workDuration, expectedWorkHours, isOverTime),
        expectedWorkHours,
        checkinStatus,
        checkoutStatus,
        expectedCheckinTime,
        expectedCheckoutTime,
        isOverTime,
        approvedOverTime: false, // Initially false for new records
        overtTimeStart,
        overtTimeEnd,
        overTimeMinutes,
        overTimeStatus,
        relaxationRequest,
        relaxationRequestStatus,
      });
      
      await newRecord.save();
      
      // Log detailed information about the creation
      console.log('╔═════════════════════ ATTENDANCE RECORD CREATED ═════════════════════╗');
      console.log(`║ Employee: ${employeeInfo.padEnd(60)} ║`);
      console.log(`║ Date: ${formattedDate.padEnd(64)} ║`);
      console.log(`║ Status: ${status.padEnd(63)} ║`);
      console.log(`║ First Entry: ${firstEntry ? firstEntry.toLocaleTimeString() : 'N/A'.padEnd(58)} ║`);
      console.log(`║ Last Exit: ${lastExit ? lastExit.toLocaleTimeString() : 'N/A'.padEnd(59)} ║`);
      console.log(`║ Work Duration: ${workDuration} minutes`.padEnd(70) + ' ║');
      console.log(`║ Late Arrival: ${lateArrival} minutes`.padEnd(70) + ' ║');
      console.log(`║ Early Departure: ${earlyDeparture} minutes`.padEnd(70) + ' ║');
      console.log(`║ Expected Work Hours: ${expectedWorkHours} minutes`.padEnd(70) + ' ║');
      console.log(`║ Checkin Status: ${checkinStatus.padEnd(63)} ║`);
      console.log(`║ Checkout Status: ${checkoutStatus.padEnd(63)} ║`);
      console.log(`║ Expected Checkin: ${expectedCheckinTime ? expectedCheckinTime.toLocaleTimeString() : 'N/A'.padEnd(58)} ║`);
      console.log(`║ Expected Checkout: ${expectedCheckoutTime ? expectedCheckoutTime.toLocaleTimeString() : 'N/A'.padEnd(58)} ║`);
      console.log(`║ Overtime: ${isOverTime ? 'Yes' : 'No'.padEnd(65)} ║`);
      console.log(`║ Approved Overtime: No`.padEnd(70) + ' ║');
      console.log(`║ Record ID: ${newRecord._id}`.padEnd(70) + ' ║');
      console.log('╚════════════════════════════════════════════════════════════════════╝');
      
      return { updated: false, created: true, record: newRecord };
    }
  } catch (error) {
    console.error("Error in createOrUpdateDailyAttendance:", error);
    throw error;
  }
};

/**
 * Generate remarks based on attendance status
 */
const generateRemarks = (status, lateArrival, earlyDeparture, checkinStatus, checkoutStatus, workDuration, expectedWorkHours, isOverTime) => {
  let remarks = [];

  if (status === "Less than Half Day") {
    remarks.push("Worked less than half day hours");
  } else if (status === "Half Day") {
    remarks.push("Worked less than full day hours");
  } else if (status === "Weekend") {
    remarks.push("Non-working day");
  }

  // Add remarks for late arrival
  if (lateArrival > 0) { 
    remarks.push(`Late arrival by ${lateArrival} minutes`);
  }

  // Add remarks for early departure
  if (earlyDeparture > 0) {
    remarks.push(`Early departure by ${earlyDeparture} minutes`);
  }

  // Add check-in status remarks if available and relevant
  if (checkinStatus && checkinStatus !== "On Time" && checkinStatus !== "N/A" && checkinStatus !== "Absent") {
    if (checkinStatus === "Early") {
      remarks.push("Arrived early before scheduled time");
    } else if (checkinStatus === "Late") {
      remarks.push("Late check-in detected");
    }
  }

  // Add check-out status remarks if available and relevant
  if (checkoutStatus && checkoutStatus !== "On Time" && checkoutStatus !== "N/A" && checkoutStatus !== "Absent") {
    if (checkoutStatus === "Early") {
      remarks.push("Left before scheduled end time");
    } else if (checkoutStatus === "Late") {
      remarks.push("Stayed later than scheduled end time");
    }
  }

  // Add overtime information if applicable
  if (isOverTime && status !== "Absent" && status !== "Weekend") {
    const overtimeMinutes = workDuration - expectedWorkHours;
    if (overtimeMinutes > 0) {
      remarks.push(`Worked ${overtimeMinutes} minutes overtime`);
    }
  }

  // Add work efficiency information if applicable
  if (status !== "Absent" && status !== "Weekend" && expectedWorkHours > 0 && workDuration > 0) {
    const workEfficiency = Math.round((workDuration / expectedWorkHours) * 100);
    
    if (workEfficiency >= 100) {
      remarks.push(`Worked at ${workEfficiency}% efficiency (exceeded expected hours)`);
    } else if (workEfficiency >= 90) {
      remarks.push(`Worked at ${workEfficiency}% efficiency (good)`);
    } else if (workEfficiency >= 75) {
      remarks.push(`Worked at ${workEfficiency}% efficiency (satisfactory)`);
    } else {
      remarks.push(`Worked at ${workEfficiency}% efficiency (below target)`);
    }
  }

  return remarks.join(". ");
};

/**
 * Process recent attendance logs hourly
 * This function is designed to be called by a cron job every hour
 * It processes only new logs since the last run to avoid duplicate processing
 * @returns {Object} - Processing results
 */
const processHourlyAttendanceLogs = async () => {
  console.log(`\n\n======================================================================`);
  console.log(`Starting hourly attendance processing at ${new Date().toISOString()}`);
  console.log(`======================================================================`);

  try {
    // Get last process time to determine the lookback period
    const lastProcessedTime = await getLastProcessedTime();

    // If no last processed time found, use default lookback period
    const lookbackTime =
      lastProcessedTime ||
      moment().subtract(CONFIG.DEFAULT_LOOKBACK_HOURS, "hours").toDate();

    console.log(`Last processed time: ${lastProcessedTime ? lastProcessedTime.toISOString() : 'Never (using default lookback)'}`);
    console.log(`Looking back from: ${lookbackTime.toISOString()}`);
    console.log(`Current time: ${new Date().toISOString()}`);

    // Calculate time range for this run: from last processed time to now
    const startTime = lookbackTime;
    const endTime = new Date(); // current time

    // Get all unprocessed logs within the time range
    const unprocessedLogs = await AttendanceLog.find({
      recordTime: { $gte: startTime, $lte: endTime },
      isProcessed: false,
    }).sort({ recordTime: 1 });

    // console.log(`Found ${unprocessedLogs.length} unprocessed logs in the time range`);

    if (unprocessedLogs.length === 0) {
      await updateLastProcessedTime(endTime);
      
      console.log(`\n======================================================================`);
      console.log(`Hourly processing completed at ${new Date().toISOString()} - No logs to process`);
      console.log(`======================================================================\n\n`);
      
      return { processed: 0, created: 0, updated: 0, errors: 0 };
    }

    // Get unique employee IDs from the unprocessed logs
    const employeeIds = [
      ...new Set(unprocessedLogs.map((log) => log.deviceUserId)),
    ];
    
    // Track logs that couldn't be processed with their reasons
    const failedLogs = [];

    // Get unique dates that need to be processed, accounting for cross-day shifts
    // We'll determine this for each employee based on their work schedule
    const dateRangeToProcess = new Set();

    // Get all affected employees
    const employees = await Employee.find({
      _id: { $in: employeeIds },
    }).lean();

    // For each employee, determine which shift dates need processing
    for (const employee of employees) {
      if (!employee.timeSlot) {
        // Track logs for employees without time slots
        const employeeLogs = unprocessedLogs.filter(
          (log) => log.deviceUserId === employee._id
        );
        
        for (const log of employeeLogs) {
          failedLogs.push({
            logId: log._id,
            reason: "Employee has no assigned time slot",
            employeeId: employee._id
          });
        }
        continue;
      }

      // Get employee's work schedule
      const workSchedule = await WorkSchedule.findById(employee.timeSlot);

      if (!workSchedule) {
        // Track logs for employees with invalid time slots
        const employeeLogs = unprocessedLogs.filter(
          (log) => log.deviceUserId === employee._id
        );
        
        for (const log of employeeLogs) {
          failedLogs.push({
            logId: log._id,
            reason: `Invalid work schedule ID: ${employee.timeSlot}`,
            employeeId: employee._id
          });
        }
        continue;
      }

      // Get this employee's logs
      const employeeLogs = unprocessedLogs.filter(
        (log) => log.deviceUserId === employee._id
      );

      // For each log, determine the correct shift date
      for (const log of employeeLogs) {
        try {
          const shiftDate = await determineShiftDate(log.recordTime, employee._id);
          dateRangeToProcess.add(shiftDate.format("YYYY-MM-DD"));
        } catch (error) {
          failedLogs.push({
            logId: log._id,
            reason: `Error determining shift date: ${error.message}`,
            employeeId: employee._id,
            error: error
          });
        }
      }
    }

    // Process each date that may be affected
    const dateArray = Array.from(dateRangeToProcess).sort();

    // If no valid dates, just update the last processed time and return
    if (dateArray.length === 0) {
      // Update all failed logs with their processing errors
      await updateFailedLogs(failedLogs);
      
      await updateLastProcessedTime(endTime);
      
      console.log(`\n======================================================================`);
      console.log(`Hourly processing completed at ${new Date().toISOString()} - No valid dates`);
      console.log(`======================================================================\n\n`);
      
      return { processed: 0, created: 0, updated: 0, errors: failedLogs.length };
    }

    // Process from the earliest date to the latest
    const startDate = moment(dateArray[0], "YYYY-MM-DD").toDate();
    const endDate = moment(
      dateArray[dateArray.length - 1],
      "YYYY-MM-DD"
    ).toDate();

    // console.log(`Processing date range: ${startDate.toISOString()} to ${endDate.toISOString()}`);
    
    // Process the attendance logs for the affected dates and employees
    const result = await processAttendanceLogs(startDate, endDate, employeeIds, failedLogs);

    // Update all failed logs with their processing errors
    await updateFailedLogs(failedLogs);

    // Update the last processed time to avoid reprocessing the same logs
    await updateLastProcessedTime(endTime);

    console.log(`\n======================================================================`);
    console.log(`HOURLY PROCESSING SUMMARY - ${new Date().toISOString()}`);
    console.log(`======================================================================`);
    console.log(`📊 Statistics:`);
    console.log(`   - Logs processed: ${result.processed}`);
    console.log(`   - Records created: ${result.created}`);
    console.log(`   - Records updated: ${result.updated}`);
    console.log(`   - Errors encountered: ${result.errors}`);
    console.log(`   - Failed logs: ${failedLogs.length}`);
    console.log(`   - Date range: ${dateArray.join(', ')}`);
    console.log(`   - Employees affected: ${employeeIds.length}`);
    console.log(`   - Processing duration: ${new Date() - new Date(startTime)}ms`);
    console.log(`======================================================================\n\n`);

    return result;
  } catch (error) {
    console.error(`\n❌ ERROR IN ATTENDANCE PROCESSING: ${error.message}`);
    console.error(error.stack);
    console.log(`\n======================================================================`);
    console.log(`Hourly processing FAILED at ${new Date().toISOString()}`);
    console.log(`======================================================================\n\n`);
    throw error;
  }
};

/**
 * Update failed logs with their processing errors
 * @param {Array} failedLogs - Array of failed logs with their reasons
 */
const updateFailedLogs = async (failedLogs) => {
  if (failedLogs.length === 0) return;
  
  console.log(`Updating ${failedLogs.length} failed logs with processing errors`);
  
  const bulkOps = failedLogs.map(log => ({
    updateOne: {
      filter: { _id: log.logId },
      update: { 
        $set: { 
          processingError: log.reason,
          lastProcessingAttempt: new Date()
        },
        $inc: { processingAttempts: 1 }
      }
    }
  }));
  
  try {
    await AttendanceLog.bulkWrite(bulkOps);
    console.log(`Successfully updated ${failedLogs.length} failed logs`);
  } catch (error) {
    console.error(`Error updating failed logs: ${error.message}`);
  }
};

/**
 * Determine the correct shift date for a given timestamp based on the work schedule
 * This function handles cross-day scenarios where check-ins/check-outs may fall outside
 * the calendar day of the actual shift
 * @param {Date} timestamp - The timestamp of the attendance log
 * @param {Object} workSchedule - The employee's work schedule
 * @returns {moment} - The moment object representing the correct shift date
 */
const determineShiftDate = async (timestamp, employeeId) => {
  // console.log({ timestamp , employeeId}, "timestamp and employeeId" );
  const logTime = moment(timestamp);
  const month = logTime.month() + 1;
  const year = logTime.year();
  // console.log({ month, year, logTime }, "month and year and logTime");
  // Get the employee schedule for this month/year
  const employeeSchedule = await EmployeeSchedule.findOne({
    employee_id: employeeId,
    month,
    year
  });
  // console.log({ employeeSchedule}, "employeeSchedule");
  if (!employeeSchedule) {
    // Fall back to calendar day if no schedule exists
    return logTime.clone().startOf("day");
  }
  
  // Check each day in the schedule to find which shift this log belongs to
  for (const daySchedule of employeeSchedule.schedules) {
    // Skip days off
    if (daySchedule.isDayOff) continue;
    
    const shiftStartTime = moment(daySchedule.start);
    const shiftEndTime = moment(daySchedule.end);
    // console.log({ shiftStartTime, shiftEndTime}, "shiftStartTime and shiftEndTime");
    // Early window for this shift
    const earlyWindow = shiftStartTime
      .clone()
      .subtract(CONFIG.EARLY_CHECK_IN_WINDOW_HOURS, "hours");
    // console.log({ earlyWindow}, "earlyWindow");
    // Late window for this shift
    const lateWindow = shiftEndTime
      .clone()
      .add(CONFIG.LATE_CHECK_OUT_WINDOW_HOURS, "hours");
    // console.log({ lateWindow}, "lateWindow");
    // If the log falls within this shift's window
    if (logTime.isBetween(earlyWindow, lateWindow, null, "[]")) {
      // console.log("logTime is between earlyWindow and lateWindow");
      return moment(daySchedule.date).startOf("day");
    }
  }
  // console.log("logTime is not between earlyWindow and lateWindow");
  // console.log(logTime.clone().startOf("day"), "logTime.clone().startOf('day')");
  // Default fallback - use the timestamp's date
  return logTime.clone().startOf("day");
};

/**
 * Get the last time the hourly processor was run
 * @returns {Date} - The last processed time or null if never run
 */
const getLastProcessedTime = async () => {
  try {
    // Assuming we have a collection to track process history
    // const mongoose = require("mongoose");
    // const ProcessTracking = mongoose.model(
    //   CONFIG.PROCESS_TRACKING_COLLECTION,
    //   new mongoose.Schema({
    //     processId: { type: String, required: true, unique: true },
    //     lastRunTime: { type: Date, required: true },
    //     updatedAt: { type: Date, default: Date.now },
    //   })
    // );

    const tracking = await ProcessTracking.findOne({
      processId: CONFIG.ATTENDANCE_PROCESS_ID,
    });

    return tracking ? tracking.lastRunTime : null;
  } catch (error) {
    console.error("Error retrieving last processed time:", error);
    return null; // Return null to use default lookback period
  }
};

/**
 * Update the last time the hourly processor was run
 * @param {Date} timestamp - The timestamp to set as last processed time
 */
const updateLastProcessedTime = async (timestamp) => {
  try {
    const mongoose = require("mongoose");
    const ProcessTracking = mongoose.model(CONFIG.PROCESS_TRACKING_COLLECTION);

    await ProcessTracking.findOneAndUpdate(
      { processId: CONFIG.ATTENDANCE_PROCESS_ID },
      {
        lastRunTime: timestamp,
        updatedAt: new Date(),
      },
      { upsert: true, new: true }
    );
  } catch (error) {
    console.error("Error updating last processed time:", error);
    throw error;
  }
};

/**
 * Calculate overtime details based on entry/exit times and shift schedule
 * This implements the refined overtime calculation logic:
 * - Only count overtime if last exit exceeds shift end by more than threshold minutes
 * - Only count early arrival as overtime if first entry is more than threshold minutes before shift start
 * - Combine both early and late overtime if applicable
 * 
 * @param {Date} firstEntry - Employee's first entry time
 * @param {Date} lastExit - Employee's last exit time
 * @param {Date} shiftStartTime - Expected shift start time
 * @param {Date} shiftEndTime - Expected shift end time
 * @returns {Object} - Object containing overtime details: isOverTime, overtimeMinutes, overtimeStart, overtimeEnd, etc.
 */
const calculateOvertimeDetails = (firstEntry, lastExit, shiftStartTime, shiftEndTime) => {
  console.log({ firstEntry, lastExit, shiftStartTime, shiftEndTime}, "firstEntry, lastExit, shiftStartTime, shiftEndTime");
  // Initialize result object
  const result = {
    isOverTime: false,
    overtimeMinutes: 0,
    earlyOvertimeMinutes: 0,
    lateOvertimeMinutes: 0,
    overtimeStart: null,
    overtimeEnd: null,
    earlyOvertimeStart: null,
    earlyOvertimeEnd: null,
    lateOvertimeStart: null,
    lateOvertimeEnd: null
  };

  // If any of the required times are missing, return default (no overtime)
  if (!firstEntry || !lastExit || !shiftStartTime || !shiftEndTime) {
    return result;
  }

  // Calculate minutes before shift start (early arrival)
  const minutesBeforeShiftStart = firstEntry < shiftStartTime
    ? Math.round((shiftStartTime - firstEntry) / (1000 * 60))
    : 0;

  // Calculate minutes after shift end (late departure)
  const minutesAfterShiftEnd = lastExit > shiftEndTime
    ? Math.round((lastExit - shiftEndTime) / (1000 * 60))
    : 0;

  // Early overtime is only applicable if arrived more than threshold minutes before shift
  let earlyOvertimeMinutes = 0;
  if (minutesBeforeShiftStart > CONFIG.OVERTIME_THRESHOLD_MINUTES) {
    earlyOvertimeMinutes = minutesBeforeShiftStart;
    result.earlyOvertimeStart = firstEntry;
    result.earlyOvertimeEnd = new Date(shiftStartTime.getTime() - (CONFIG.OVERTIME_THRESHOLD_MINUTES * 60 * 1000));
  }

  // Late overtime is only applicable if departed more than threshold minutes after shift
  let lateOvertimeMinutes = 0;
  if (minutesAfterShiftEnd > CONFIG.OVERTIME_THRESHOLD_MINUTES) {
    lateOvertimeMinutes = minutesAfterShiftEnd;
    result.lateOvertimeStart = new Date(shiftEndTime.getTime() + (CONFIG.OVERTIME_THRESHOLD_MINUTES * 60 * 1000));
    result.lateOvertimeEnd = lastExit;
  }
  console.log({ earlyOvertimeMinutes, lateOvertimeMinutes}, "earlyOvertimeMinutes and lateOvertimeMinutes");

  // Total overtime minutes is the sum of early and late overtime
  const totalOvertimeMinutes = earlyOvertimeMinutes + lateOvertimeMinutes;
  console.log({ totalOvertimeMinutes}, "totalOvertimeMinutes");

  // Only set isOverTime true if there's actual overtime
  if (totalOvertimeMinutes > 0) {
    result.isOverTime = true;
    result.overtimeMinutes = totalOvertimeMinutes;
    result.earlyOvertimeMinutes = earlyOvertimeMinutes;
    result.lateOvertimeMinutes = lateOvertimeMinutes;
    
    // Set overall overtime period if applicable
    if (earlyOvertimeMinutes > 0 && lateOvertimeMinutes > 0) {
      // Both early and late overtime
      result.overtimeStart = result.earlyOvertimeStart;
      result.overtimeEnd = result.lateOvertimeEnd;
    } else if (earlyOvertimeMinutes > 0) {
      // Only early overtime
      result.overtimeStart = result.earlyOvertimeStart;
      result.overtimeEnd = result.earlyOvertimeEnd;
    } else if (lateOvertimeMinutes > 0) {
      // Only late overtime
      result.overtimeStart = result.lateOvertimeStart;
      result.overtimeEnd = result.lateOvertimeEnd;
    }
  }

  return result;
};





module.exports = {
  processAttendanceLogs,
  processHourlyAttendanceLogs,
  generateRemarks,
  calculateOvertimeDetails
};














// const AttendanceLog = require("../models/attendanceLogs");
// const DailyAttendance = require("../models/dailyAttendance");
// const Employee = require("../models/employee");
// const ProcessTracking = require("../models/processTracking");
// const EmployeeSchedule = require("../models/employeeSchedule");

// const WorkSchedule = require("../models/workSchedule");
// const moment = require("moment");

// /**
//  * System configuration
//  * These could be moved to environment variables
//  */
// const CONFIG = {
//   // Maximum hours before shift start that check-ins can be considered valid
//   EARLY_CHECK_IN_WINDOW_HOURS: 6,

//   // Maximum hours after shift end that check-outs can be considered valid
//   LATE_CHECK_OUT_WINDOW_HOURS: 6,

//   // Default lookback period when no LastProcessedTime is found
//   DEFAULT_LOOKBACK_HOURS: 24,

//   // grace time for overtime which defines that how much minute will be required to start considering the overtime
//   OVERTIME_GRACE_TIME: 10,
  
//   // New constant for overtime threshold (minutes)
//   OVERTIME_THRESHOLD_MINUTES: 10,

//   // Process status tracking in DB
//   PROCESS_TRACKING_COLLECTION: "ProcessTracking",
//   ATTENDANCE_PROCESS_ID: "hourlyAttendanceProcessor",
// };

// /**
//  * Process attendance logs and create daily attendance records
//  * @param {Date} startDate - Start date for processing
//  * @param {Date} endDate - End date for processing
//  * @param {Array} employeeIds - Optional array of employee IDs to process
//  * @returns {Object} - Processing results
//  */
// const processAttendanceLogs = async (
//   startDate,
//   endDate,
//   employeeIds = null
// ) => {
//   try {
//     console.log(
//       `Starting attendance processing from ${startDate.toISOString()} to ${endDate.toISOString()}`
//     );
    
//     // Check if we're processing a full month
//     const isFullMonth = moment(startDate).date() === 1 && 
//                         moment(endDate).date() === moment(endDate).daysInMonth();
    
//     if (isFullMonth) {
//       console.log(`Processing full month: ${moment(startDate).format('YYYY-MM')}`);
//     }
    
//     // Prepare date range - expand range by 6 hours to capture cross-day entries
//     // For month boundaries, extend the window further to ensure we catch all relevant logs
//     const start = moment(startDate)
//       .startOf("day")
//       .subtract(CONFIG.EARLY_CHECK_IN_WINDOW_HOURS + (isFullMonth ? 24 : 0), "hours")
//       .toDate();
//     const end = moment(endDate)
//       .endOf("day")
//       .add(CONFIG.LATE_CHECK_OUT_WINDOW_HOURS + (isFullMonth ? 24 : 0), "hours")
//       .toDate();
    
//     console.log(`Expanded processing window: ${start.toISOString()} to ${end.toISOString()}`);

//     // Query to get unprocessed logs within date range
//     const query = {
//       recordTime: { $gte: start, $lte: end },
//       isProcessed: false,
//     };

//     // Add employee filter if specified
//     if (employeeIds && employeeIds.length > 0) {
//       query.deviceUserId = { $in: employeeIds };
//     }

//     // Get all employees (or specific employees)
//     const employeeQuery =
//       employeeIds && employeeIds.length > 0
//         ? { _id: { $in: employeeIds } }
//         : {};

//     const employees = await Employee.find(employeeQuery).lean();
//     console.log(`Processing for ${employees.length} employees`);
    
//     // Process each day in the date range
//     const currentDate = moment(startDate).startOf("day"); // Use original startDate for processing days
//     const lastDate = moment(endDate).endOf("day"); // Use original endDate for processing days

//     let processed = 0;
//     let created = 0;
//     let updated = 0;
//     let errors = 0;
//     let absentsCreated = 0;

//     // For full month processing, ensure we have the employee schedules for this month
//     if (isFullMonth) {
//       const monthNum = moment(startDate).month() + 1;
//       const yearNum = moment(startDate).year();
      
//       console.log(`Ensuring employee schedules exist for ${monthNum}/${yearNum}`);
      
//       // Check if schedules exist for all employees for this month
//       for (const employee of employees) {
//         const employeeSchedule = await EmployeeSchedule.findOne({
//           employee_id: employee._id,
//           month: monthNum,
//           year: yearNum
//         });
        
//         if (!employeeSchedule) {
//           console.warn(`No schedule found for employee ${employee._id} for ${monthNum}/${yearNum}. Skipping this employee.`);
//           continue;
//         }
//       }
//     }

//     // Process each day in the date range
//     while (currentDate.isSameOrBefore(lastDate, "day")) {
//       const currentDateStr = currentDate.format('YYYY-MM-DD');
//       console.log(`Processing day: ${currentDateStr}`);
      
//       // Process each employee for this day
//       for (const employee of employees) {
//         try {
//           // Find the employee's schedule for this day
//           const monthNum = currentDate.month() + 1; // moment is 0-indexed for months
//           const yearNum = currentDate.year();
          
//           // Get the employee schedule instead of work schedule
//           const employeeSchedule = await EmployeeSchedule.findOne({
//             employee_id: employee._id,
//             month: monthNum,
//             year: yearNum
//           });
          
//           if (!employeeSchedule) {
//             console.warn(`No employee schedule found for ${employee._id} for ${monthNum}/${yearNum}`);
//             continue;
//           }

//           // Find the specific day's schedule
//           const daySchedule = employeeSchedule.schedules.find(
//             s => moment(s.date).format('YYYY-MM-DD') === currentDateStr
//           );

//           if (!daySchedule) {
//             console.warn(`No day schedule found for ${employee._id} on ${currentDateStr}`);
//             continue;
//           }

//           // Determine if it's a work day based on isDayOff flag
//           const isWorkDay = !daySchedule.isDayOff;

//           // If it's not a work day, create a weekend/holiday record and continue
//           if (!isWorkDay) {
//             await createOrUpdateDailyAttendance(
//               employee._id,
//               currentDate.toDate(),
//               "Weekend",
//               null,
//               null,
//               0,
//               0,
//               0,
//               [],
//               0,
//               "Day Off",
//               "Day Off",
//               null,
//               null,
//               false
//             );
//             created++;
//             continue;
//           }

//           // Use the specific start and end times from the day's schedule
//           const shiftStartTime = moment(daySchedule.start);
//           const shiftEndTime = moment(daySchedule.end);
//           console.log({shiftStartTime}, {shiftEndTime}, "shiftStartTime and shiftEndTime");

//           // Calculate the extended window for early check-in
//           const earlyWindow = shiftStartTime
//             .clone()
//             .subtract(CONFIG.EARLY_CHECK_IN_WINDOW_HOURS, "hours");
//           // Calculate the extended window for late check-out
//           const lateWindow = shiftEndTime
//             .clone()
//             .add(CONFIG.LATE_CHECK_OUT_WINDOW_HOURS, "hours");

//           // Get all logs that could be relevant for this shift (within extended windows)
//           const logs = await AttendanceLog.find({
//             deviceUserId: employee._id,
//             recordTime: {
//               $gte: earlyWindow.toDate(),
//               $lte: lateWindow.toDate(),
//             },
//           }).sort({ recordTime: 1 });
          
//           console.log(`Found ${logs.length} logs for employee ${employee._id} on ${currentDateStr}`);
          
//           if (logs.length > 0) {
//             // Process daily attendance
//             const result = await processDailyAttendance(
//               employee._id,
//               currentDate.toDate(),
//               logs,
//               daySchedule,
//               isWorkDay,
//               shiftStartTime.toDate(),
//               shiftEndTime.toDate()
//             );

//             // Update logs as processed
//             const logIds = logs.map((log) => log._id);
//             await AttendanceLog.updateMany(
//               { _id: { $in: logIds } },
//               { $set: { isProcessed: true } }
//             );

//             processed += logs.length;
//             if (result.created) created++;
//             if (result.updated) updated++;
//           } else {
//             // No logs found within the extended window - mark as absent
//             // Get expected work hours directly from the day schedule
//             const expectedWorkHoursForShift = daySchedule.actual_expected_minutes || 
//               calculateExpectedWorkHours(shiftStartTime.toDate(), shiftEndTime.toDate());
            
//             // Check if an attendance record already exists for this day
//             const existingRecord = await DailyAttendance.findOne({
//               employeeId: employee._id,
//               date: {
//                 $gte: moment(currentDate).startOf('day').toDate(),
//                 $lte: moment(currentDate).endOf('day').toDate()
//               }
//             });
            
//             if (!existingRecord) {
//               console.log(`Creating absent record for employee ${employee._id} on ${currentDateStr}`);
//               await createOrUpdateDailyAttendance(
//                 employee._id,
//                 currentDate.toDate(),
//                 "Absent",
//                 null,
//                 null,
//                 0,
//                 0,
//                 0,
//                 [],
//                 expectedWorkHoursForShift,
//                 "Absent",
//                 "Absent",
//                 shiftStartTime.toDate(),
//                 shiftEndTime.toDate(),
//                 false
//               );
//               created++;
//               absentsCreated++;
//             } else {
//               console.log(`Attendance record already exists for employee ${employee._id} on ${currentDateStr}, status: ${existingRecord.status}`);
//             }
//           }
//         } catch (err) {
//           console.error(
//             `Error processing employee ${employee._id} for ${currentDate.format(
//               "YYYY-MM-DD"
//             )}:`,
//             err
//           );
//           errors++;
//         }
//       }

//       // Move to next day
//       currentDate.add(1, "day");
//     }

//     // For full month processing, verify that every day has an attendance record for each employee
//     if (isFullMonth) {
//       console.log(`Verifying all days in the month have attendance records...`);
//       const monthNum = moment(startDate).month() + 1;
//       const yearNum = moment(startDate).year();
//       const daysInMonth = moment(startDate).daysInMonth();
      
//       for (const employee of employees) {
//         // Get all attendance records for this employee in this month
//         const attendanceRecords = await DailyAttendance.find({
//           employeeId: employee._id,
//           date: {
//             $gte: moment(startDate).startOf('day').toDate(),
//             $lte: moment(endDate).endOf('day').toDate()
//           }
//         }).sort({ date: 1 });
        
//         // Group by date to check for missing days
//         const recordedDates = attendanceRecords.map(record => 
//           moment(record.date).format('YYYY-MM-DD')
//         );
        
//         // Check each day of the month
//         for (let day = 1; day <= daysInMonth; day++) {
//           const dateToCheck = moment({ year: yearNum, month: monthNum - 1, day }).format('YYYY-MM-DD');
          
//           if (!recordedDates.includes(dateToCheck)) {
//             console.log(`Missing attendance record for employee ${employee._id} on ${dateToCheck}`);
            
//             // Try to find the employee's schedule for this day
//             const employeeSchedule = await EmployeeSchedule.findOne({
//               employee_id: employee._id,
//               month: monthNum,
//               year: yearNum
//             });
            
//             if (employeeSchedule) {
//               const daySchedule = employeeSchedule.schedules.find(
//                 s => moment(s.date).format('YYYY-MM-DD') === dateToCheck
//               );
              
//               if (daySchedule) {
//                 // If it's a work day, create an absent record
//                 if (!daySchedule.isDayOff) {
//                   const shiftStartTime = moment(daySchedule.start);
//                   const shiftEndTime = moment(daySchedule.end);
//                   const expectedWorkHours = daySchedule.actual_expected_minutes || 
//                     (shiftEndTime.diff(shiftStartTime, 'minutes'));
                  
//                   // Create absent record
//                   await createOrUpdateDailyAttendance(
//                     employee._id,
//                     moment(dateToCheck).toDate(),
//                     "Absent",
//                     null,
//                     null,
//                     0,
//                     0,
//                     0,
//                     [],
//                     expectedWorkHours,
//                     "Absent",
//                     "Absent",
//                     shiftStartTime.toDate(),
//                     shiftEndTime.toDate(),
//                     false
//                   );
//                   console.log(`Created absent record for ${employee._id} on ${dateToCheck}`);
//                   created++;
//                   absentsCreated++;
//                 } else {
//                   // It's a day off, create a weekend/holiday record
//                   await createOrUpdateDailyAttendance(
//                     employee._id,
//                     moment(dateToCheck).toDate(),
//                     "Weekend",
//                     null,
//                     null,
//                     0,
//                     0,
//                     0,
//                     [],
//                     0,
//                     "Day Off",
//                     "Day Off",
//                     null,
//                     null,
//                     false
//                   );
//                   console.log(`Created day off record for ${employee._id} on ${dateToCheck}`);
//                   created++;
//                 }
//               }
//             }
//           }
//         }
//       }
//     }

//     console.log(`
//     ======= PROCESSING SUMMARY =======
//     Logs processed: ${processed}
//     Records created: ${created} (including ${absentsCreated} absent records)
//     Records updated: ${updated}
//     Errors: ${errors}
//     ================================
//     `);

//     return {
//       processed,
//       created,
//       updated,
//       errors,
//       absentsCreated
//     }; 
//   } catch (error) {
//     console.error("Error in processAttendanceLogs:", error);
//     throw error;
//   }
// };

// /**
//  * Process daily attendance for a single employee on a specific day
//  * @param {String} employeeId - Employee ID
//  * @param {Date} date - The date to process
//  * @param {Array} logs - Attendance logs
//  * @param {Object} daySchedule - Employee's day schedule
//  * @param {Boolean} isWorkDay - Whether this is a working day
//  * @param {Date} shiftStartDate - The exact datetime of shift start
//  * @param {Date} shiftEndDate - The exact datetime of shift end
//  * @returns {Object} - Processing result
//  */
// const processDailyAttendance = async (
//   employeeId,
//   date,
//   logs,
//   daySchedule,
//   isWorkDay,
//   shiftStartDate,
//   shiftEndDate
// ) => {
//   // try {
//     if (!isWorkDay) {
//       // It's a non-working day (weekend or holiday)
//       return await createOrUpdateDailyAttendance(
//         employeeId,
//         date,
//         "Weekend",
//         null,
//         null,
//         0,
//         0,
//         0,
//         [],
//         0,  // expectedWorkHours for non-working days is 0
//         "Day Off", // checkinStatus for non-working days
//         "Day Off", // checkoutStatus for non-working days
//         null, // expectedCheckinTime for non-working days
//         null, // expectedCheckoutTime for non-working days
//         false // isOverTime for non-working days
//       );
//     }

//     // Calculate expected work hours directly from the day schedule
//     const expectedWorkHours = daySchedule.actual_expected_minutes || 
//       calculateExpectedWorkHours(shiftStartDate, shiftEndDate);
//     // For work days, process the logs
//     if (logs.length === 0) {
//       // No logs on a work day = absent
//       return await createOrUpdateDailyAttendance(
//         employeeId,
//         date,
//         "Absent",
//         null,
//         null,
//         0,
//         0,
//         0,
//         [],
//         expectedWorkHours,
//         "Absent", // checkinStatus for absent
//         "Absent", // checkoutStatus for absent
//         shiftStartDate, // Store expected check-in time even for absent
//         shiftEndDate,   // Store expected check-out time even for absent
//         false // isOverTime is false for absent
//       );
//     }

//     // Use the first log as the first entry
//     const firstEntry = logs[0].recordTime;
//     // Only set lastExit if there's more than one log
//     // Otherwise, it should remain null for single check-ins
//     let lastExit = null;
//     let workDuration = 0;
//     let earlyDeparture = 0;
//     let checkoutStatus = "Absent"; // Default for single log
//     let isOverTime = false;
//     let overTimeMinutes = 0;
//     let overTimeStatus = null;
//     let overtTimeStart = null;
//     let overtTimeEnd = null;
//     let relaxationRequest = false;
//     let relaxationRequestStatus = null;

//     const workSchedule = await WorkSchedule.findById(daySchedule.time_slot_id);
//     if (logs.length > 1) {
//       // Find the last exit that's closest to shift end or after
//       // (should be after shift end or the latest log)
//       let lastExitIndex = logs.length - 1;
//       const workSchedule = await WorkSchedule.findById(daySchedule.time_slot_id);
//       // If we have multiple logs, try to find the most appropriate exit
//       let closestToShiftEnd = Math.abs(
//         logs[lastExitIndex].recordTime - shiftEndDate
//       );
//       // Prioritize logs after shift end
//       for (let i = logs.length - 1; i >= 0; i--) {
//         const log = logs[i];
//         // If log is after shift end, this is a good candidate for exit
//         if (log.recordTime >= shiftEndDate) {
//           lastExitIndex = i;
//           break;
//         }

//         // Otherwise, find the closest one to shift end
//         const difference = Math.abs(log.recordTime - shiftEndDate);
//         if (difference < closestToShiftEnd) {
//           closestToShiftEnd = difference;
//           lastExitIndex = i;
//         }
//       }

//       // Use the last log as the last exit
//       lastExit = logs[logs.length - 1].recordTime;

//       // Calculate work duration in minutes
//       workDuration = Math.round(
//         (lastExit.getTime() - firstEntry.getTime()) / (1000 * 60)
//       );
//       // Calculate early departure
//       earlyDeparture =
//         lastExit < shiftEndDate
//           ? Math.round((shiftEndDate - lastExit) / (1000 * 60))
//           : 0;
//       console.log({ earlyDeparture}, "earlyDeparture" , {lastExit}, {shiftEndDate});
//       // Determine check-out status
//       checkoutStatus = "On Time";
//       if (earlyDeparture > 0) {
//         checkoutStatus = "Early";
//       } else if (lastExit > shiftEndDate) {
//         // If checked out more than 30 minutes after shift end
//         const lateMinutes = Math.round((lastExit - shiftEndDate) / (1000 * 60));
//         if (lateMinutes > 10) {
//           checkoutStatus = "Late";
//         }
//       }

//       // Use the new calculateOvertimeDetails function to determine overtime
//       const overtimeDetails = calculateOvertimeDetails(
//         firstEntry,
//         lastExit,
//         shiftStartDate,
//         shiftEndDate
//       );

//       // Update overtime-related variables with the results from calculateOvertimeDetails
//       isOverTime = overtimeDetails.isOverTime;
//       overTimeMinutes = overtimeDetails.overtimeMinutes;
      
//       if (isOverTime) {
//         overtTimeStart = overtimeDetails.overtimeStart;
//         overtTimeEnd = overtimeDetails.overtimeEnd;
//         overTimeStatus = "Pending"; // Default status for new overtime
//       }
//     }
//     // Check if late (considering grace period)
//     const lateArrival =
//       firstEntry > shiftStartDate
//         ? Math.max(
//             0,
//             Math.round((firstEntry - shiftStartDate) / (1000 * 60)) -
//             workSchedule.graceTimeInMinutes
//           )
//         : 0;

//     // Determine attendance status
//     let status = "Present";

//     // Convert to hours for comparison
//     const workHours = workDuration / 60;

//     if (logs.length === 1) {
//       // For single log entries, mark as "Check In Only"
//       status = "Check In Only";
//     } else if (workHours < workSchedule.minWorkHoursForHalfDay) {
//       status = "Less than Half Day"; // Less than minimum hours for half day
//     } else if (workHours < workSchedule.minWorkHours) {
//       status = "Half Day";
//     } else if (lateArrival > 0) {
//       status = "Late";
//     }

//     // Determine check-in status
//     let checkinStatus = "On Time";
//     if (lateArrival > 0) {
//       checkinStatus = "Late";
//     } else if (firstEntry < shiftStartDate) {
//       // If checked in more than 30 minutes early
//       const earlyMinutes = Math.round((shiftStartDate - firstEntry) / (1000 * 60));
//       if (earlyMinutes > 10) {
//         checkinStatus = "Early";
//       }
//     }

//     console.log({ firstEntry}, {lastExit}, {lateArrival}, {earlyDeparture}  , "relaxation request");
//     // Determine if relaxation request is needed
//     if (firstEntry && lastExit && (lateArrival > 1 || earlyDeparture > 0)) {
//       relaxationRequest = true;
//       relaxationRequestStatus = "Pending";
//     }

//     // Create or update the attendance record
//     return await createOrUpdateDailyAttendance(
//       employeeId,
//       date,
//       status,
//       firstEntry,
//       lastExit,
//       workDuration,
//       lateArrival,
//       earlyDeparture,
//       logs.map((log) => log._id),
//       expectedWorkHours,
//       checkinStatus,
//       checkoutStatus,
//       shiftStartDate,  // Store expected check-in time
//       shiftEndDate,    // Store expected check-out time
//       isOverTime,      // Store overtime status
//       overtTimeStart,  // New field: overtime start time
//       overtTimeEnd,    // New field: overtime end time
//       overTimeMinutes, // New field: overtime minutes
//       overTimeStatus,  // New field: overtime approval status
//       relaxationRequest, // New field: relaxation request status
//       relaxationRequestStatus // New field: relaxation request approval status
//     );
//   // } catch (error) {
//   //   console.error("Error in processDailyAttendance:", error);
//   //   throw error;
//   // }
// };

// /**
//  * Calculate expected work hours in minutes for a shift
//  * @param {Date} shiftStartDate - The shift start time
//  * @param {Date} shiftEndDate - The shift end time
//  * @returns {Number} - Expected work duration in minutes
//  */
// const calculateExpectedWorkHours = (shiftStartDate, shiftEndDate) => {
//   if (!shiftStartDate || !shiftEndDate) return 0;
  
//   // Calculate the difference in minutes
//   return Math.round((shiftEndDate - shiftStartDate) / (1000 * 60));
// };

// /**
//  * Create or update a daily attendance record
//  */
// const createOrUpdateDailyAttendance = async (
//   employeeId,
//   date,
//   status,
//   firstEntry,
//   lastExit,
//   workDuration,
//   lateArrival,
//   earlyDeparture,
//   logIds,
//   expectedWorkHours,
//   checkinStatus,
//   checkoutStatus,
//   expectedCheckinTime,
//   expectedCheckoutTime,
//   isOverTime,
//   overtTimeStart,
//   overtTimeEnd,
//   overTimeMinutes,
//   overTimeStatus,
//   relaxationRequest,
//   relaxationRequestStatus
// ) => {
//   // Get date with time set to midnight
//   const dayDate = new Date(date);
//   dayDate.setHours(0, 0, 0, 0);
  
//   try {
//     // Check if record already exists
//     const existingRecord = await DailyAttendance.findOne({
//       employeeId,
//       date: dayDate,
//     });
//     // console.log({ existingRecord}, "existingRecord");
//     // Get employee details for better logging
//     const employee = await Employee.findById(employeeId).select('employeeId name');
//     const employeeInfo = employee ? `${employee.name} (${employee.employeeId || employeeId})` : employeeId;
//     const formattedDate = dayDate.toISOString().split('T')[0];

//     if (existingRecord) {
//       // Update existing record
//       const updated = await DailyAttendance.findByIdAndUpdate(
//         existingRecord._id,
//         {
//           status,
//           firstEntry,
//           lastExit,
//           workDuration,
//           lateArrival,
//           earlyDeparture,
//           logs: logIds,
//           remarks: generateRemarks(status, lateArrival, earlyDeparture, checkinStatus, checkoutStatus, workDuration, expectedWorkHours, isOverTime),
//           expectedWorkHours,
//           checkinStatus,
//           checkoutStatus,
//           expectedCheckinTime,
//           expectedCheckoutTime,
//           isOverTime,
//           // Keep existing approvedOverTime unchanged
//           approvedOverTime: existingRecord.approvedOverTime,
//           overtTimeStart,
//           overtTimeEnd,
//           overTimeMinutes,
//           overTimeStatus,
//           relaxationRequest,
//           relaxationRequestStatus,
//         },
//         { new: true }
//       );
      
//       // Log detailed information about the update
//       console.log('╔═════════════════════ ATTENDANCE RECORD UPDATED ═════════════════════╗');
//       console.log(`║ Employee: ${employeeInfo.padEnd(60)} ║`);
//       console.log(`║ Date: ${formattedDate.padEnd(64)} ║`);
//       console.log(`║ Status: ${status.padEnd(63)} ║`);
//       console.log(`║ Previous Status: ${existingRecord.status.padEnd(55)} ║`);
//       console.log(`║ First Entry: ${firstEntry ? firstEntry.toLocaleTimeString() : 'N/A'.padEnd(58)} ║`);
//       console.log(`║ Last Exit: ${lastExit ? lastExit.toLocaleTimeString() : 'N/A'.padEnd(59)} ║`);
//       console.log(`║ Work Duration: ${workDuration} minutes`.padEnd(70) + ' ║');
//       console.log(`║ Late Arrival: ${lateArrival} minutes`.padEnd(70) + ' ║');
//       console.log(`║ Early Departure: ${earlyDeparture} minutes`.padEnd(70) + ' ║');
//       console.log(`║ Expected Work Hours: ${expectedWorkHours} minutes`.padEnd(70) + ' ║');
//       console.log(`║ Checkin Status: ${checkinStatus.padEnd(63)} ║`);
//       console.log(`║ Checkout Status: ${checkoutStatus.padEnd(63)} ║`);
//       console.log(`║ Expected Checkin: ${expectedCheckinTime ? expectedCheckinTime.toLocaleTimeString() : 'N/A'.padEnd(58)} ║`);
//       console.log(`║ Expected Checkout: ${expectedCheckoutTime ? expectedCheckoutTime.toLocaleTimeString() : 'N/A'.padEnd(58)} ║`);
//       console.log(`║ Overtime: ${isOverTime ? 'Yes' : 'No'.padEnd(65)} ║`);
//       console.log(`║ Approved Overtime: ${updated.approvedOverTime ? 'Yes' : 'No'.padEnd(59)} ║`);
//       console.log(`║ Record ID: ${updated._id}`.padEnd(70) + ' ║');
//       console.log('╚════════════════════════════════════════════════════════════════════╝');

//       return { updated: true, created: false, record: updated };
//     } else {
//       // Create new record
//       const newRecord = new DailyAttendance({
//         employeeId,
//         date: dayDate,
//         status,
//         firstEntry,
//         lastExit,
//         workDuration,
//         lateArrival,
//         earlyDeparture,
//         logs: logIds,
//         remarks: generateRemarks(status, lateArrival, earlyDeparture, checkinStatus, checkoutStatus, workDuration, expectedWorkHours, isOverTime),
//         expectedWorkHours,
//         checkinStatus,
//         checkoutStatus,
//         expectedCheckinTime,
//         expectedCheckoutTime,
//         isOverTime,
//         approvedOverTime: false, // Initially false for new records
//         overtTimeStart,
//         overtTimeEnd,
//         overTimeMinutes,
//         overTimeStatus,
//         relaxationRequest,
//         relaxationRequestStatus,
//       });
      
//       await newRecord.save();
      
//       // Log detailed information about the creation
//       console.log('╔═════════════════════ ATTENDANCE RECORD CREATED ═════════════════════╗');
//       console.log(`║ Employee: ${employeeInfo.padEnd(60)} ║`);
//       console.log(`║ Date: ${formattedDate.padEnd(64)} ║`);
//       console.log(`║ Status: ${status.padEnd(63)} ║`);
//       console.log(`║ First Entry: ${firstEntry ? firstEntry.toLocaleTimeString() : 'N/A'.padEnd(58)} ║`);
//       console.log(`║ Last Exit: ${lastExit ? lastExit.toLocaleTimeString() : 'N/A'.padEnd(59)} ║`);
//       console.log(`║ Work Duration: ${workDuration} minutes`.padEnd(70) + ' ║');
//       console.log(`║ Late Arrival: ${lateArrival} minutes`.padEnd(70) + ' ║');
//       console.log(`║ Early Departure: ${earlyDeparture} minutes`.padEnd(70) + ' ║');
//       console.log(`║ Expected Work Hours: ${expectedWorkHours} minutes`.padEnd(70) + ' ║');
//       console.log(`║ Checkin Status: ${checkinStatus.padEnd(63)} ║`);
//       console.log(`║ Checkout Status: ${checkoutStatus.padEnd(63)} ║`);
//       console.log(`║ Expected Checkin: ${expectedCheckinTime ? expectedCheckinTime.toLocaleTimeString() : 'N/A'.padEnd(58)} ║`);
//       console.log(`║ Expected Checkout: ${expectedCheckoutTime ? expectedCheckoutTime.toLocaleTimeString() : 'N/A'.padEnd(58)} ║`);
//       console.log(`║ Overtime: ${isOverTime ? 'Yes' : 'No'.padEnd(65)} ║`);
//       console.log(`║ Approved Overtime: No`.padEnd(70) + ' ║');
//       console.log(`║ Record ID: ${newRecord._id}`.padEnd(70) + ' ║');
//       console.log('╚════════════════════════════════════════════════════════════════════╝');
      
//       return { updated: false, created: true, record: newRecord };
//     }
//   } catch (error) {
//     console.error("Error in createOrUpdateDailyAttendance:", error);
//     throw error;
//   }
// };

// /**
//  * Generate remarks based on attendance status
//  */
// const generateRemarks = (status, lateArrival, earlyDeparture, checkinStatus, checkoutStatus, workDuration, expectedWorkHours, isOverTime) => {
//   let remarks = [];

//   if (status === "Less than Half Day") {
//     remarks.push("Worked less than half day hours");
//   } else if (status === "Half Day") {
//     remarks.push("Worked less than full day hours");
//   } else if (status === "Weekend") {
//     remarks.push("Non-working day");
//   }

//   // Add remarks for late arrival
//   if (lateArrival > 0) { 
//     remarks.push(`Late arrival by ${lateArrival} minutes`);
//   }

//   // Add remarks for early departure
//   if (earlyDeparture > 0) {
//     remarks.push(`Early departure by ${earlyDeparture} minutes`);
//   }

//   // Add check-in status remarks if available and relevant
//   if (checkinStatus && checkinStatus !== "On Time" && checkinStatus !== "N/A" && checkinStatus !== "Absent") {
//     if (checkinStatus === "Early") {
//       remarks.push("Arrived early before scheduled time");
//     } else if (checkinStatus === "Late") {
//       remarks.push("Late check-in detected");
//     }
//   }

//   // Add check-out status remarks if available and relevant
//   if (checkoutStatus && checkoutStatus !== "On Time" && checkoutStatus !== "N/A" && checkoutStatus !== "Absent") {
//     if (checkoutStatus === "Early") {
//       remarks.push("Left before scheduled end time");
//     } else if (checkoutStatus === "Late") {
//       remarks.push("Stayed later than scheduled end time");
//     }
//   }

//   // Add overtime information if applicable
//   if (isOverTime && status !== "Absent" && status !== "Weekend") {
//     const overtimeMinutes = workDuration - expectedWorkHours;
//     if (overtimeMinutes > 0) {
//       remarks.push(`Worked ${overtimeMinutes} minutes overtime`);
//     }
//   }

//   // Add work efficiency information if applicable
//   if (status !== "Absent" && status !== "Weekend" && expectedWorkHours > 0 && workDuration > 0) {
//     const workEfficiency = Math.round((workDuration / expectedWorkHours) * 100);
    
//     if (workEfficiency >= 100) {
//       remarks.push(`Worked at ${workEfficiency}% efficiency (exceeded expected hours)`);
//     } else if (workEfficiency >= 90) {
//       remarks.push(`Worked at ${workEfficiency}% efficiency (good)`);
//     } else if (workEfficiency >= 75) {
//       remarks.push(`Worked at ${workEfficiency}% efficiency (satisfactory)`);
//     } else {
//       remarks.push(`Worked at ${workEfficiency}% efficiency (below target)`);
//     }
//   }

//   return remarks.join(". ");
// };

// /**
//  * Process recent attendance logs hourly
//  * This function is designed to be called by a cron job every hour
//  * It processes only new logs since the last run to avoid duplicate processing
//  * @returns {Object} - Processing results
//  */
// const processHourlyAttendanceLogs = async () => {
//   console.log(`\n\n======================================================================`);
//   console.log(`Starting hourly attendance processing at ${new Date().toISOString()}`);
//   console.log(`======================================================================`);

//   try {
//     // Get last process time to determine the lookback period
//     const lastProcessedTime = await getLastProcessedTime();

//     // If no last processed time found, use default lookback period
//     const lookbackTime =
//       lastProcessedTime ||
//       moment().subtract(CONFIG.DEFAULT_LOOKBACK_HOURS, "hours").toDate();

//     console.log(`Last processed time: ${lastProcessedTime ? lastProcessedTime.toISOString() : 'Never (using default lookback)'}`);
//     console.log(`Looking back from: ${lookbackTime.toISOString()}`);
//     console.log(`Current time: ${new Date().toISOString()}`);

//     // Calculate time range for this run: from last processed time to now
//     const startTime = lookbackTime;
//     const endTime = new Date(); // current time

//     // Get all unprocessed logs within the time range
//     const unprocessedLogs = await AttendanceLog.find({
//       recordTime: { $gte: startTime, $lte: endTime },
//       isProcessed: false,
//     }).sort({ recordTime: 1 });

//     console.log(`Found ${unprocessedLogs.length} unprocessed logs in the time range`);

//     if (unprocessedLogs.length === 0) {
//       await updateLastProcessedTime(endTime);
      
//       console.log(`\n======================================================================`);
//       console.log(`Hourly processing completed at ${new Date().toISOString()} - No logs to process`);
//       console.log(`======================================================================\n\n`);
      
//       return { processed: 0, created: 0, updated: 0, errors: 0 };
//     }

//     // Get unique employee IDs from the unprocessed logs
//     const employeeIds = [
//       ...new Set(unprocessedLogs.map((log) => log.deviceUserId)),
//     ];
    
//     console.log(`Found logs for ${employeeIds.length} unique employees`);

//     // Get unique dates that need to be processed, accounting for cross-day shifts
//     // We'll determine this for each employee based on their work schedule
//     const dateRangeToProcess = new Set();

//     // Get all affected employees
//     const employees = await Employee.find({
//       _id: { $in: employeeIds },
//     }).lean();

//     // For each employee, determine which shift dates need processing
//     for (const employee of employees) {
//       if (!employee.timeSlot) continue;

//       // Get employee's work schedule
//       const workSchedule = await WorkSchedule.findById(employee.timeSlot);

//       if (!workSchedule) continue;

//       // Get this employee's logs
//       const employeeLogs = unprocessedLogs.filter(
//         (log) => log.deviceUserId === employee._id
//       );

//       console.log(`Processing ${employeeLogs.length} logs for employee ${employee._id}`);

//       // For each log, determine the correct shift date
//       for (const log of employeeLogs) {
//         const shiftDate = await determineShiftDate(log.recordTime, employee._id);
//         const dateStr = shiftDate.format("YYYY-MM-DD");
//         dateRangeToProcess.add(dateStr);
//         console.log(`Log at ${log.recordTime.toISOString()} mapped to shift date: ${dateStr}`);
//       }
//     }

//     // Process each date that may be affected
//     const dateArray = Array.from(dateRangeToProcess).sort();
//     console.log(`Dates to process: ${dateArray.join(', ')}`);

//     // If no valid dates, just update the last processed time and return
//     if (dateArray.length === 0) {
//       await updateLastProcessedTime(endTime);
      
//       console.log(`\n======================================================================`);
//       console.log(`Hourly processing completed at ${new Date().toISOString()} - No valid dates`);
//       console.log(`======================================================================\n\n`);
      
//       return { processed: 0, created: 0, updated: 0, errors: 0 };
//     }

//     // Process from the earliest date to the latest
//     const startDate = moment(dateArray[0], "YYYY-MM-DD").toDate();
//     const endDate = moment(
//       dateArray[dateArray.length - 1],
//       "YYYY-MM-DD"
//     ).toDate();

//     console.log(`Processing date range: ${startDate.toISOString()} to ${endDate.toISOString()}`);
    
//     // Check if we're crossing a month boundary
//     const startMonth = moment(startDate).month();
//     const endMonth = moment(endDate).month();
//     const isMonthBoundary = startMonth !== endMonth;
    
//     if (isMonthBoundary) {
//       console.log(`Month boundary detected: Processing across ${moment(startDate).format('MMMM')} and ${moment(endDate).format('MMMM')}`);
      
//       // Special handling for month boundaries - process each month separately to ensure complete coverage
//       const monthsToProcess = new Set();
//       dateArray.forEach(dateStr => {
//         const dateMoment = moment(dateStr);
//         monthsToProcess.add(`${dateMoment.year()}-${dateMoment.month() + 1}`);
//       });
      
//       console.log(`Will process these months: ${Array.from(monthsToProcess).join(', ')}`);
      
//       let combinedResult = { processed: 0, created: 0, updated: 0, errors: 0 };
      
//       // Process each month
//       for (const monthKey of monthsToProcess) {
//         const [year, month] = monthKey.split('-').map(Number);
//         const monthStartDate = moment({ year, month: month - 1, day: 1 }).toDate();
//         const monthEndDate = moment({ year, month: month - 1 }).endOf('month').toDate();
        
//         console.log(`Processing month: ${year}-${month} (${monthStartDate.toISOString()} to ${monthEndDate.toISOString()})`);
        
//         // Process this month
//         const monthResult = await processAttendanceLogs(monthStartDate, monthEndDate, employeeIds);
        
//         // Combine results
//         combinedResult.processed += monthResult.processed;
//         combinedResult.created += monthResult.created;
//         combinedResult.updated += monthResult.updated;
//         combinedResult.errors += monthResult.errors;
//       }
      
//       // Update the last processed time to avoid reprocessing the same logs
//       await updateLastProcessedTime(endTime);
      
//       console.log(`\n======================================================================`);
//       console.log(`HOURLY PROCESSING SUMMARY - ${new Date().toISOString()}`);
//       console.log(`======================================================================`);
//       console.log(`📊 Statistics (across multiple months):`);
//       console.log(`   - Logs processed: ${combinedResult.processed}`);
//       console.log(`   - Records created: ${combinedResult.created}`);
//       console.log(`   - Records updated: ${combinedResult.updated}`);
//       console.log(`   - Errors encountered: ${combinedResult.errors}`);
//       console.log(`   - Date range: ${dateArray.join(', ')}`);
//       console.log(`   - Employees affected: ${employeeIds.length}`);
//       console.log(`   - Processing duration: ${new Date() - new Date(startTime)}ms`);
//       console.log(`======================================================================\n\n`);
      
//       return combinedResult;
//     } else {
//       // Standard processing for dates within the same month
//       // Process the attendance logs for the affected dates and employees
//       const result = await processAttendanceLogs(startDate, endDate, employeeIds);
  
//       // Update the last processed time to avoid reprocessing the same logs
//       await updateLastProcessedTime(endTime);
  
//       console.log(`\n======================================================================`);
//       console.log(`HOURLY PROCESSING SUMMARY - ${new Date().toISOString()}`);
//       console.log(`======================================================================`);
//       console.log(`📊 Statistics:`);
//       console.log(`   - Logs processed: ${result.processed}`);
//       console.log(`   - Records created: ${result.created}`);
//       console.log(`   - Records updated: ${result.updated}`);
//       console.log(`   - Errors encountered: ${result.errors}`);
//       console.log(`   - Date range: ${dateArray.join(', ')}`);
//       console.log(`   - Employees affected: ${employeeIds.length}`);
//       console.log(`   - Processing duration: ${new Date() - new Date(startTime)}ms`);
//       console.log(`======================================================================\n\n`);
  
//       return result;
//     }
//   } catch (error) {
//     console.error(`\n❌ ERROR IN ATTENDANCE PROCESSING: ${error.message}`);
//     console.error(error.stack);
//     console.log(`\n======================================================================`);
//     console.log(`Hourly processing FAILED at ${new Date().toISOString()}`);
//     console.log(`======================================================================\n\n`);
//     throw error;
//   }
// };

// /**
//  * Determine the correct shift date for a given timestamp based on the work schedule
//  * This function handles cross-day scenarios where check-ins/check-outs may fall outside
//  * the calendar day of the actual shift
//  * @param {Date} timestamp - The timestamp of the attendance log
//  * @param {Object} workSchedule - The employee's work schedule
//  * @returns {moment} - The moment object representing the correct shift date
//  */
// const determineShiftDate = async (timestamp, employeeId) => {
//   // console.log({ timestamp , employeeId}, "timestamp and employeeId" );
//   const logTime = moment(timestamp);
//   const month = logTime.month() + 1;
//   const year = logTime.year();
  
//   console.log(`Determining shift date for log time: ${logTime.format('YYYY-MM-DD HH:mm:ss')}, month: ${month}, year: ${year}`);
  
//   // First try with the current month's schedule
//   const employeeSchedule = await EmployeeSchedule.findOne({
//     employee_id: employeeId,
//     month,
//     year
//   });
  
//   if (employeeSchedule) {
//     // Check each day in the schedule to find which shift this log belongs to
//     for (const daySchedule of employeeSchedule.schedules) {
//       // Skip days off
//       if (daySchedule.isDayOff) continue;
      
//       const shiftStartTime = moment(daySchedule.start);
//       const shiftEndTime = moment(daySchedule.end);
      
//       // Early window for this shift
//       const earlyWindow = shiftStartTime
//         .clone()
//         .subtract(CONFIG.EARLY_CHECK_IN_WINDOW_HOURS, "hours");
      
//       // Late window for this shift
//       const lateWindow = shiftEndTime
//         .clone()
//         .add(CONFIG.LATE_CHECK_OUT_WINDOW_HOURS, "hours");
      
//       // If the log falls within this shift's window
//       if (logTime.isBetween(earlyWindow, lateWindow, null, "[]")) {
//         console.log(`Log matches shift on ${moment(daySchedule.date).format('YYYY-MM-DD')}`);
//         return moment(daySchedule.date).startOf("day");
//       }
//     }
//   }
  
//   // If no match found in current month, check adjacent months for edge cases
//   // This handles logs that belong to shifts crossing month boundaries
  
//   // Check previous month for logs at the beginning of the month
//   // Always check previous month for logs on the 1st day or within the early check-in window
//   if (logTime.date() <= CONFIG.EARLY_CHECK_IN_WINDOW_HOURS || logTime.date() === 1) {
//     const prevMonth = month === 1 ? 12 : month - 1;
//     const prevYear = month === 1 ? year - 1 : year;
    
//     console.log(`Checking previous month ${prevMonth}/${prevYear} for log near month boundary`);
    
//     const prevMonthSchedule = await EmployeeSchedule.findOne({
//       employee_id: employeeId,
//       month: prevMonth,
//       year: prevYear
//     });
    
//     if (prevMonthSchedule) {
//       // Check only the last few days of the previous month
//       const daysInPrevMonth = moment(`${prevYear}-${prevMonth}-01`).daysInMonth();
//       const lastDaysSchedules = prevMonthSchedule.schedules.filter(s => 
//         moment(s.date).date() >= daysInPrevMonth - 2  // Check last 2 days of previous month
//       );
      
//       for (const daySchedule of lastDaysSchedules) {
//         if (daySchedule.isDayOff) continue;
        
//         const shiftEndTime = moment(daySchedule.end);
//         const lateWindow = shiftEndTime
//           .clone()
//           .add(CONFIG.LATE_CHECK_OUT_WINDOW_HOURS, "hours");
        
//         // If log is within the late window of a shift from the previous month
//         if (logTime.isBetween(shiftEndTime, lateWindow, null, "[]")) {
//           console.log(`Log matches shift from previous month on ${moment(daySchedule.date).format('YYYY-MM-DD')}`);
//           return moment(daySchedule.date).startOf("day");
//         }
//       }
//     }
//   }
  
//   // Check next month for logs at the end of the month
//   // Always check next month for logs on the last day or within the late check-out window
//   const isLastDayOfMonth = logTime.date() === moment(logTime).daysInMonth();
//   if (logTime.date() >= moment(logTime).daysInMonth() - 1 || isLastDayOfMonth) {
//     const nextMonth = month === 12 ? 1 : month + 1;
//     const nextYear = month === 12 ? year + 1 : year;
    
//     console.log(`Checking next month ${nextMonth}/${nextYear} for log near month boundary`);
    
//     const nextMonthSchedule = await EmployeeSchedule.findOne({
//       employee_id: employeeId,
//       month: nextMonth,
//       year: nextYear
//     });
    
//     if (nextMonthSchedule) {
//       // Check only the first few days of the next month
//       const firstDaysSchedules = nextMonthSchedule.schedules.filter(s => 
//         moment(s.date).date() <= 2
//       );
      
//       for (const daySchedule of firstDaysSchedules) {
//         if (daySchedule.isDayOff) continue;
        
//         const shiftStartTime = moment(daySchedule.start);
//         const earlyWindow = shiftStartTime
//           .clone()
//           .subtract(CONFIG.EARLY_CHECK_IN_WINDOW_HOURS, "hours");
        
//         // If log is within the early window of a shift from the next month
//         if (logTime.isBetween(earlyWindow, shiftStartTime, null, "[]")) {
//           console.log(`Log matches shift from next month on ${moment(daySchedule.date).format('YYYY-MM-DD')}`);
//           return moment(daySchedule.date).startOf("day");
//         }
//       }
//     }
//   }
  
//   // If we're on the first or last day of the month and no match was found in adjacent months,
//   // make sure we use the current day's date (don't skip these days)
//   if (logTime.date() === 1 || logTime.date() === moment(logTime).daysInMonth()) {
//     console.log(`Using current date for log on month boundary: ${logTime.format('YYYY-MM-DD')}`);
//     return logTime.clone().startOf("day");
//   }
  
//   // Default fallback - use the timestamp's date
//   console.log(`No matching shift found, using log date: ${logTime.format('YYYY-MM-DD')}`);
//   return logTime.clone().startOf("day");
// };

// /**
//  * Get the last time the hourly processor was run
//  * @returns {Date} - The last processed time or null if never run
//  */
// const getLastProcessedTime = async () => {
//   try {
//     // Assuming we have a collection to track process history
//     // const mongoose = require("mongoose");
//     // const ProcessTracking = mongoose.model(
//     //   CONFIG.PROCESS_TRACKING_COLLECTION,
//     //   new mongoose.Schema({
//     //     processId: { type: String, required: true, unique: true },
//     //     lastRunTime: { type: Date, required: true },
//     //     updatedAt: { type: Date, default: Date.now },
//     //   })
//     // );

//     const tracking = await ProcessTracking.findOne({
//       processId: CONFIG.ATTENDANCE_PROCESS_ID,
//     });

//     return tracking ? tracking.lastRunTime : null;
//   } catch (error) {
//     console.error("Error retrieving last processed time:", error);
//     return null; // Return null to use default lookback period
//   }
// };

// /**
//  * Update the last time the hourly processor was run
//  * @param {Date} timestamp - The timestamp to set as last processed time
//  */
// const updateLastProcessedTime = async (timestamp) => {
//   try {
//     const mongoose = require("mongoose");
//     const ProcessTracking = mongoose.model(CONFIG.PROCESS_TRACKING_COLLECTION);

//     await ProcessTracking.findOneAndUpdate(
//       { processId: CONFIG.ATTENDANCE_PROCESS_ID },
//       {
//         lastRunTime: timestamp,
//         updatedAt: new Date(),
//       },
//       { upsert: true, new: true }
//     );
//   } catch (error) {
//     console.error("Error updating last processed time:", error);
//     throw error;
//   }
// };

// /**
//  * Calculate overtime details based on entry/exit times and shift schedule
//  * This implements the refined overtime calculation logic:
//  * - Only count overtime if last exit exceeds shift end by more than threshold minutes
//  * - Only count early arrival as overtime if first entry is more than threshold minutes before shift start
//  * - Combine both early and late overtime if applicable
//  * 
//  * @param {Date} firstEntry - Employee's first entry time
//  * @param {Date} lastExit - Employee's last exit time
//  * @param {Date} shiftStartTime - Expected shift start time
//  * @param {Date} shiftEndTime - Expected shift end time
//  * @returns {Object} - Object containing overtime details: isOverTime, overtimeMinutes, overtimeStart, overtimeEnd, etc.
//  */
// const calculateOvertimeDetails = (firstEntry, lastExit, shiftStartTime, shiftEndTime) => {
//   console.log({ firstEntry, lastExit, shiftStartTime, shiftEndTime}, "firstEntry, lastExit, shiftStartTime, shiftEndTime");
//   // Initialize result object
//   const result = {
//     isOverTime: false,
//     overtimeMinutes: 0,
//     earlyOvertimeMinutes: 0,
//     lateOvertimeMinutes: 0,
//     overtimeStart: null,
//     overtimeEnd: null,
//     earlyOvertimeStart: null,
//     earlyOvertimeEnd: null,
//     lateOvertimeStart: null,
//     lateOvertimeEnd: null
//   };

//   // If any of the required times are missing, return default (no overtime)
//   if (!firstEntry || !lastExit || !shiftStartTime || !shiftEndTime) {
//     return result;
//   }

//   // Calculate minutes before shift start (early arrival)
//   const minutesBeforeShiftStart = firstEntry < shiftStartTime
//     ? Math.round((shiftStartTime - firstEntry) / (1000 * 60))
//     : 0;

//   // Calculate minutes after shift end (late departure)
//   const minutesAfterShiftEnd = lastExit > shiftEndTime
//     ? Math.round((lastExit - shiftEndTime) / (1000 * 60))
//     : 0;

//   // Early overtime is only applicable if arrived more than threshold minutes before shift
//   let earlyOvertimeMinutes = 0;
//   if (minutesBeforeShiftStart > CONFIG.OVERTIME_THRESHOLD_MINUTES) {
//     earlyOvertimeMinutes = minutesBeforeShiftStart;
//     result.earlyOvertimeStart = firstEntry;
//     result.earlyOvertimeEnd = new Date(shiftStartTime.getTime() - (CONFIG.OVERTIME_THRESHOLD_MINUTES * 60 * 1000));
//   }

//   // Late overtime is only applicable if departed more than threshold minutes after shift
//   let lateOvertimeMinutes = 0;
//   if (minutesAfterShiftEnd > CONFIG.OVERTIME_THRESHOLD_MINUTES) {
//     lateOvertimeMinutes = minutesAfterShiftEnd;
//     result.lateOvertimeStart = new Date(shiftEndTime.getTime() + (CONFIG.OVERTIME_THRESHOLD_MINUTES * 60 * 1000));
//     result.lateOvertimeEnd = lastExit;
//   }
//   console.log({ earlyOvertimeMinutes, lateOvertimeMinutes}, "earlyOvertimeMinutes and lateOvertimeMinutes");

//   // Total overtime minutes is the sum of early and late overtime
//   const totalOvertimeMinutes = earlyOvertimeMinutes + lateOvertimeMinutes;
//   console.log({ totalOvertimeMinutes}, "totalOvertimeMinutes");

//   // Only set isOverTime true if there's actual overtime
//   if (totalOvertimeMinutes > 0) {
//     result.isOverTime = true;
//     result.overtimeMinutes = totalOvertimeMinutes;
//     result.earlyOvertimeMinutes = earlyOvertimeMinutes;
//     result.lateOvertimeMinutes = lateOvertimeMinutes;
    
//     // Set overall overtime period if applicable
//     if (earlyOvertimeMinutes > 0 && lateOvertimeMinutes > 0) {
//       // Both early and late overtime
//       result.overtimeStart = result.earlyOvertimeStart;
//       result.overtimeEnd = result.lateOvertimeEnd;
//     } else if (earlyOvertimeMinutes > 0) {
//       // Only early overtime
//       result.overtimeStart = result.earlyOvertimeStart;
//       result.overtimeEnd = result.earlyOvertimeEnd;
//     } else if (lateOvertimeMinutes > 0) {
//       // Only late overtime
//       result.overtimeStart = result.lateOvertimeStart;
//       result.overtimeEnd = result.lateOvertimeEnd;
//     }
//   }

//   return result;
// };

// /**
//  * Verify and create missing attendance records for a specific month
//  * @param {Date} startDate - First day of the month
//  * @param {Date} endDate - Last day of the month
//  * @param {Array} employeeIds - Optional array of employee IDs to process
//  * @returns {Object} - Processing results (created records count)
//  */
// const verifyMonthAttendance = async (startDate, endDate, employeeIds = null) => {
//   try {
//     console.log(`Verifying attendance records for period: ${moment(startDate).format('YYYY-MM-DD')} to ${moment(endDate).format('YYYY-MM-DD')}`);
    
//     // Get all employees that should be processed
//     const employeeQuery = employeeIds && employeeIds.length > 0
//       ? { _id: { $in: employeeIds } }
//       : {};
    
//     const employees = await Employee.find(employeeQuery).lean();
//     console.log(`Verifying attendance for ${employees.length} employees`);
    
//     const monthNum = moment(startDate).month() + 1;
//     const yearNum = moment(startDate).year();
//     const daysInMonth = moment(startDate).daysInMonth();
    
//     let recordsCreated = 0;
//     let absentsCreated = 0;
//     let dayOffCreated = 0;
    
//     // Process each employee
//     for (const employee of employees) {
//       console.log(`Verifying attendance records for employee ${employee._id}`);
      
//       // Get all attendance records for this employee in this period
//       const attendanceRecords = await DailyAttendance.find({
//         employeeId: employee._id,
//         date: {
//           $gte: moment(startDate).startOf('day').toDate(),
//           $lte: moment(endDate).endOf('day').toDate()
//         }
//       }).sort({ date: 1 });
      
//       // Group by date to check for missing days
//       const recordedDates = attendanceRecords.map(record => 
//         moment(record.date).format('YYYY-MM-DD')
//       );
      
//       console.log(`Found ${attendanceRecords.length} existing records for dates: ${recordedDates.join(', ')}`);
      
//       // Get employee schedule for this month
//       const employeeSchedule = await EmployeeSchedule.findOne({
//         employee_id: employee._id,
//         month: monthNum,
//         year: yearNum
//       });
      
//       if (!employeeSchedule) {
//         console.warn(`No schedule found for employee ${employee._id} for ${monthNum}/${yearNum}. Skipping verification.`);
//         continue;
//       }
      
//       // Check each day of the month, with special attention to first and last days
//       for (let day = 1; day <= daysInMonth; day++) {
//         const dateToCheck = moment({ year: yearNum, month: monthNum - 1, day }).format('YYYY-MM-DD');
//         const isFirstDay = day === 1;
//         const isLastDay = day === daysInMonth;
        
//         // Special logging for first and last days
//         if (isFirstDay || isLastDay) {
//           console.log(`Specifically checking ${isFirstDay ? 'FIRST' : 'LAST'} day of month: ${dateToCheck}`);
//         }
        
//         if (!recordedDates.includes(dateToCheck)) {
//           console.log(`Missing attendance record for employee ${employee._id} on ${dateToCheck}`);
          
//           // Find the specific day's schedule
//           const daySchedule = employeeSchedule.schedules.find(
//             s => moment(s.date).format('YYYY-MM-DD') === dateToCheck
//           );
          
//           if (daySchedule) {
//             // If it's a work day, create an absent record
//             if (!daySchedule.isDayOff) {
//               const shiftStartTime = moment(daySchedule.start);
//               const shiftEndTime = moment(daySchedule.end);
//               const expectedWorkHours = daySchedule.actual_expected_minutes || 
//                 (shiftEndTime.diff(shiftStartTime, 'minutes'));
              
//               // Create absent record
//               const newRecord = new DailyAttendance({
//                 employeeId: employee._id,
//                 date: moment(dateToCheck).toDate(),
//                 status: "Absent",
//                 firstEntry: null,
//                 lastExit: null,
//                 workDuration: 0,
//                 lateArrival: 0,
//                 earlyDeparture: 0,
//                 logs: [],
//                 remarks: `Absent (created during verification${isFirstDay ? ' - first day of month' : isLastDay ? ' - last day of month' : ''})`,
//                 expectedWorkHours,
//                 checkinStatus: "Absent",
//                 checkoutStatus: "Absent",
//                 expectedCheckinTime: shiftStartTime.toDate(),
//                 expectedCheckoutTime: shiftEndTime.toDate(),
//                 isOverTime: false,
//                 approvedOverTime: false
//               });
              
//               await newRecord.save();
//               console.log(`Created absent record for ${employee._id} on ${dateToCheck}`);
//               recordsCreated++;
//               absentsCreated++;
//             } else {
//               // It's a day off, create a weekend/holiday record
//               const newRecord = new DailyAttendance({
//                 employeeId: employee._id,
//                 date: moment(dateToCheck).toDate(),
//                 status: "Weekend",
//                 firstEntry: null,
//                 lastExit: null,
//                 workDuration: 0,
//                 lateArrival: 0,
//                 earlyDeparture: 0,
//                 logs: [],
//                 remarks: `Non-working day (created during verification${isFirstDay ? ' - first day of month' : isLastDay ? ' - last day of month' : ''})`,
//                 expectedWorkHours: 0,
//                 checkinStatus: "Day Off",
//                 checkoutStatus: "Day Off",
//                 expectedCheckinTime: null,
//                 expectedCheckoutTime: null,
//                 isOverTime: false,
//                 approvedOverTime: false
//               });
              
//               await newRecord.save();
//               console.log(`Created day off record for ${employee._id} on ${dateToCheck}`);
//               recordsCreated++;
//               dayOffCreated++;
//             }
//           } else {
//             console.warn(`No day schedule found for ${dateToCheck}`);
//           }
//         }
//       }
//     }
    
//     console.log(`Verification complete. Created ${recordsCreated} records (${absentsCreated} absents, ${dayOffCreated} day offs)`);
    
//     return {
//       recordsCreated,
//       absentsCreated,
//       dayOffCreated
//     };
//   } catch (error) {
//     console.error("Error in verifyMonthAttendance:", error);
//     throw error;
//   }
// };

// module.exports = {
//   processAttendanceLogs,
//   processHourlyAttendanceLogs,
//   generateRemarks,
//   calculateOvertimeDetails,
//   verifyMonthAttendance
// };


