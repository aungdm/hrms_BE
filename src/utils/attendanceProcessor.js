const AttendanceLog = require("../models/attendanceLogs");
const DailyAttendance = require("../models/dailyAttendance");
const Employee = require("../models/employee");
const ProcessTracking = require("../models/processTracking");

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

  // Process status tracking in DB
  PROCESS_TRACKING_COLLECTION: "ProcessTracking",
  ATTENDANCE_PROCESS_ID: "hourlyAttendanceProcessor",
};

/**
 * Process attendance logs and create daily attendance records
 * @param {Date} startDate - Start date for processing
 * @param {Date} endDate - End date for processing
 * @param {Array} employeeIds - Optional array of employee IDs to process
 * @returns {Object} - Processing results
 */
const processAttendanceLogs = async (
  startDate,
  endDate,
  employeeIds = null
) => {
  try {
    console.log(
      `Starting attendance processing from ${startDate.toISOString()} to ${endDate.toISOString()}`
    );
    
    if (employeeIds && employeeIds.length) {
      console.log(`Processing for ${employeeIds.length} specific employees`);
    } else {
      console.log(`Processing for all employees`);
    }

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
    console.log(`Found ${employees.length} employees to process`);

    // Process each day in the date range
    const currentDate = moment(startDate).startOf("day"); // Use original startDate for processing days
    const lastDate = moment(endDate).endOf("day"); // Use original endDate for processing days

    let processed = 0;
    let created = 0;
    let updated = 0;
    let errors = 0;

    // Process each day in the date range
    while (currentDate.isSameOrBefore(lastDate, "day")) {
      console.log(`Processing date: ${currentDate.format('YYYY-MM-DD')}`);
      
      // Process each employee for this day
      for (const employee of employees) {
        try {
          // If employee has no work schedule, skip
          if (!employee.timeSlot) {
            console.warn(`No time slot assigned for employee ${employee._id}`);
            continue;
          }

          // Get the employee's work schedule
          const workSchedule = await WorkSchedule.findOne({
            _id: employee.timeSlot,
          });

          if (!workSchedule) {
            console.warn(`No work schedule found for employee ${employee._id}`);
            continue;
          }

          // Determine day of week (0 = Sunday, 1 = Monday, etc.)
          const dayOfWeek = currentDate.day();
          const isWorkDay = workSchedule.workDays.includes(dayOfWeek);

          // If it's not a work day, create a weekend/holiday record and continue to next employee
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
              0,  // No expected work hours on weekend/holidays
              "Day Off", // No check-in status for weekends
              "Day Off", // No check-out status for weekends
              null, // expectedCheckinTime for non-working days
              null, // expectedCheckoutTime for non-working days
              false // isOverTime for non-working days
            );
            created++;
            continue;
          }

          // Parse shift times for the current day
          const [shiftStartHour, shiftStartMinute] = workSchedule.shiftStart
            .split(":")
            .map(Number);
          const [shiftEndHour, shiftEndMinute] = workSchedule.shiftEnd
            .split(":")
            .map(Number);

          // Create shift start and end timestamps for the current day
          const shiftStartTime = currentDate.clone().set({
            hour: shiftStartHour,
            minute: shiftStartMinute,
            second: 0,
            millisecond: 0,
          });

          const shiftEndTime = currentDate.clone().set({
            hour: shiftEndHour,
            minute: shiftEndMinute,
            second: 0,
            millisecond: 0,
          });
          if (shiftEndTime.isBefore(shiftStartTime)) {
            shiftEndTime.add(1, "day");
          }

          // Calculate the extended window for early check-in (up to 6 hours before shift start)
          const earlyWindow = shiftStartTime
            .clone()
            .subtract(CONFIG.EARLY_CHECK_IN_WINDOW_HOURS, "hours");

          // Calculate the extended window for late check-out (up to 6 hours after shift end)
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
            // Process daily attendance
            const result = await processDailyAttendance(
              employee._id,
              currentDate.toDate(),
              logs,
              workSchedule,
              isWorkDay,
              shiftStartTime.toDate(),
              shiftEndTime.toDate()
            );

            // Update logs as processed
            const logIds = logs.map((log) => log._id);
            await AttendanceLog.updateMany(
              { _id: { $in: logIds } },
              { $set: { isProcessed: true } }
            );

            processed += logs.length;
            if (result.created) created++;
            if (result.updated) updated++;
          } else {
            // No logs found within the extended window - mark as absent
            // Calculate expected work hours for this shift
            const expectedWorkHoursForShift = calculateExpectedWorkHours(
              shiftStartTime.toDate(),
              shiftEndTime.toDate()
            );
            
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
              expectedWorkHoursForShift,  // Include expected work hours
              "Absent",  // Absent check-in status
              "Absent",  // Absent check-out status
              shiftStartTime.toDate(), // Store expected check-in time even for absent
              shiftEndTime.toDate(),   // Store expected check-out time even for absent
              false  // No overtime for absent
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
          errors++;
        }
      }

      // Move to next day
      currentDate.add(1, "day");
    }

    console.log(`Completed processing for date range: ${startDate.toISOString()} to ${endDate.toISOString()}`);
    console.log(`Results: ${processed} logs processed, ${created} records created, ${updated} records updated, ${errors} errors`);

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
 * @param {Object} workSchedule - Employee's work schedule
 * @param {Boolean} isWorkDay - Whether this is a working day
 * @param {Date} shiftStartDate - The exact datetime of shift start
 * @param {Date} shiftEndDate - The exact datetime of shift end
 * @returns {Object} - Processing result
 */
const processDailyAttendance = async (
  employeeId,
  date,
  logs,
  workSchedule,
  isWorkDay,
  shiftStartDate,
  shiftEndDate
) => {
  try {
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

    // Calculate expected work hours in minutes for this shift
    const expectedWorkHours = calculateExpectedWorkHours(shiftStartDate, shiftEndDate);

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

    if (logs.length > 1) {
      // Find the last exit that's closest to shift end or after
      // (should be after shift end or the latest log)
      let lastExitIndex = logs.length - 1;

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

      // Determine check-out status
      checkoutStatus = "On Time";
      if (earlyDeparture > 0) {
        checkoutStatus = "Early";
      } else if (lastExit > shiftEndDate) {
        // If checked out more than 30 minutes after shift end
        const lateMinutes = Math.round((lastExit - shiftEndDate) / (1000 * 60));
        if (lateMinutes > 30) {
          checkoutStatus = "Late";
        }
      }

      // Determine if overtime (if lastExit exceeds expectedCheckoutTime)
      isOverTime = lastExit > shiftEndDate;
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
      status = "Absent"; // Less than minimum hours for half day
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
      if (earlyMinutes > 30) {
        checkinStatus = "Early";
      }
    }

    // Handle overtime related fields
    let overtTimeStart = null;
    let overtTimeEnd = null;
    let overTimeMinutes = 0;
    let overTimeStatus = null;

    // If overtime is detected
    if (lastExit && lastExit > shiftEndDate) {
      isOverTime = true;
      // The overtime starts at the end of the scheduled shift
      overtTimeStart = shiftEndDate;
      // The overtime ends at the last exit time
      overtTimeEnd = lastExit;
      // Calculate overtime minutes
      overTimeMinutes = Math.round((lastExit - shiftEndDate) / (1000 * 60));
      // Set initial status to Pending
      overTimeStatus = "Pending";
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
      overTimeStatus   // New field: overtime approval status
    );
  } catch (error) {
    console.error("Error in processDailyAttendance:", error);
    throw error;
  }
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
  overTimeStatus
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

  if (status === "Absent") {
    remarks.push("Employee was absent");
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

    console.log(`Found ${unprocessedLogs.length} unprocessed logs in the time range`);

    if (unprocessedLogs.length === 0) {
      console.log("No new logs to process in this hour");
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
    
    console.log(`Found ${employeeIds.length} employees with unprocessed logs`);

    // Get unique dates that need to be processed, accounting for cross-day shifts
    // We'll determine this for each employee based on their work schedule
    const dateRangeToProcess = new Set();

    // Get all affected employees
    const employees = await Employee.find({
      _id: { $in: employeeIds },
    }).lean();

    // For each employee, determine which shift dates need processing
    for (const employee of employees) {
      if (!employee.timeSlot) continue;

      // Get employee's work schedule
      const workSchedule = await WorkSchedule.findById(employee.timeSlot);

      if (!workSchedule) continue;

      // Get this employee's logs
      const employeeLogs = unprocessedLogs.filter(
        (log) => log.deviceUserId === employee._id
      );

      // For each log, determine the correct shift date
      for (const log of employeeLogs) {
        const shiftDate = determineShiftDate(log.recordTime, workSchedule);
        dateRangeToProcess.add(shiftDate.format("YYYY-MM-DD"));
      }
    }

    // Process each date that may be affected
    const dateArray = Array.from(dateRangeToProcess).sort();
    console.log(`Dates to process: ${dateArray.join(', ')}`);

    // If no valid dates, just update the last processed time and return
    if (dateArray.length === 0) {
      console.log("No valid dates to process after determining shift dates");
      await updateLastProcessedTime(endTime);
      
      console.log(`\n======================================================================`);
      console.log(`Hourly processing completed at ${new Date().toISOString()} - No valid dates`);
      console.log(`======================================================================\n\n`);
      
      return { processed: 0, created: 0, updated: 0, errors: 0 };
    }

    // Process from the earliest date to the latest
    const startDate = moment(dateArray[0], "YYYY-MM-DD").toDate();
    const endDate = moment(
      dateArray[dateArray.length - 1],
      "YYYY-MM-DD"
    ).toDate();

    console.log(`Processing date range: ${startDate.toISOString()} to ${endDate.toISOString()}`);
    
    // Process the attendance logs for the affected dates and employees
    const result = await processAttendanceLogs(startDate, endDate, employeeIds);

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
 * Determine the correct shift date for a given timestamp based on the work schedule
 * This function handles cross-day scenarios where check-ins/check-outs may fall outside
 * the calendar day of the actual shift
 * @param {Date} timestamp - The timestamp of the attendance log
 * @param {Object} workSchedule - The employee's work schedule
 * @returns {moment} - The moment object representing the correct shift date
 */
const determineShiftDate = (timestamp, workSchedule) => {
  const logTime = moment(timestamp);

  // Parse shift start and end times
  const [shiftStartHour, shiftStartMinute] = workSchedule.shiftStart
    .split(":")
    .map(Number);
  const [shiftEndHour, shiftEndMinute] = workSchedule.shiftEnd
    .split(":")
    .map(Number);

  // Clone the log time and set it to the current day's shift start
  const currentDayShiftStart = logTime.clone().set({
    hour: shiftStartHour,
    minute: shiftStartMinute,
    second: 0,
    millisecond: 0,
  });

  // Clone the log time and set it to the current day's shift end
  const currentDayShiftEnd = logTime.clone().set({
    hour: shiftEndHour,
    minute: shiftEndMinute,
    second: 0,
    millisecond: 0,
  });

  if (currentDayShiftEnd.isBefore(currentDayShiftStart)) {
    currentDayShiftEnd.add(1, "day");
  }

  // Early window for the current day
  const earlyWindow = currentDayShiftStart
    .clone()
    .subtract(CONFIG.EARLY_CHECK_IN_WINDOW_HOURS, "hours");

  // Late window for the current day
  const lateWindow = currentDayShiftEnd
    .clone()
    .add(CONFIG.LATE_CHECK_OUT_WINDOW_HOURS, "hours");

  // If the log falls within the early window to late window of the current day
  if (logTime.isBetween(earlyWindow, lateWindow, null, "[]")) {
    return logTime.clone().startOf("day");
  }

  // Previous day's shift time
  const previousDayShiftEnd = currentDayShiftEnd.clone().subtract(1, "day");
  const previousDayLateWindow = previousDayShiftEnd
    .clone()
    .add(CONFIG.LATE_CHECK_OUT_WINDOW_HOURS, "hours");

  // If the log is within the late window of the previous day's shift
  if (
    logTime.isBetween(previousDayShiftEnd, previousDayLateWindow, null, "[]")
  ) {
    return logTime.clone().subtract(1, "day").startOf("day");
  }

  // Next day's shift time
  const nextDayShiftStart = currentDayShiftStart.clone().add(1, "day");
  const nextDayEarlyWindow = nextDayShiftStart
    .clone()
    .subtract(CONFIG.EARLY_CHECK_IN_WINDOW_HOURS, "hours");

  // If the log is within the early window of the next day's shift
  if (logTime.isBetween(nextDayEarlyWindow, nextDayShiftStart, null, "[]")) {
    return logTime.clone().add(1, "day").startOf("day");
  }

  // Default fallback - use the timestamp's date (though this case should be rare)
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

module.exports = {
  processAttendanceLogs,
  processHourlyAttendanceLogs,
  generateRemarks
};
