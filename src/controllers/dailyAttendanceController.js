const { successResponse, errorRresponse } = require("../utils/response");
const DailyAttendance = require("../models/dailyAttendance");
// const { processAttendanceLogs } = require("../utils/attendanceProcessor");
const cron = require("node-cron");
const moment = require("moment");
const Employee = require("../models/employee");
const { calculateOvertimeDetails } = require("../utils/attendanceProcessor");
const EmployeeSchedule = require("../models/employeeSchedule");
const AttendanceLog = require("../models/attendanceLogs");
const WorkSchedule = require("../models/workSchedule");

// Schedule to run the processor every day at midnight
// cron.schedule("0 0 * * *", async () => {
//   try {
//     console.log("Running scheduled attendance processing job");
//     // Process yesterday's logs
//     const yesterday = moment().subtract(1, "day").toDate();
//     await processAttendanceLogs(yesterday, yesterday);
//   } catch (error) {
//     console.error("Error in scheduled attendance processing:", error);
//   }
// });

// Process attendance logs manually
const processLogs = async (req, res) => {
  try {
    const { startDate, endDate, employeeIds } = req.body;

    if (!startDate || !endDate) {
      return errorRresponse(res, 400, "Start date and end date are required");
    }

    // Validate date format
    if (
      !moment(startDate, "YYYY-MM-DD", true).isValid() ||
      !moment(endDate, "YYYY-MM-DD", true).isValid()
    ) {
      return errorRresponse(res, 400, "Invalid date format. Use YYYY-MM-DD");
    }

    // Check date range (max 31 days)
    const days = moment(endDate).diff(moment(startDate), "days");
    if (days > 31) {
      return errorRresponse(res, 400, "Date range cannot exceed 31 days");
    }

    // Process in the background
    // processAttendanceLogs(startDate, endDate, employeeIds)
    //   .then((results) => {
    //     console.log(
    //       `Processing completed: ${results.processed} logs processed, ${results.created} records created, ${results.updated} records updated`
    //     );
    //   })
    //   .catch((err) => {
    //     console.error("Error in background processing:", err);
    //   });

    return successResponse(
      res,
      200,
      "Attendance processing started in the background"
    );
  } catch (error) {
    console.error("Error processing attendance logs:", error);
    return errorRresponse(res, 500, "Error processing attendance logs", error);
  }
};

// Get daily attendance records
const getRecords = async (req, res) => {
  try {
    const {
      page = 1,
      perPage = 5,
      startDate,
      endDate,
      employeeId,
      status,
      hasOvertime,
    } = req.query;

    const query = {};

    if (startDate || endDate) {
      query.date = {};
      if (startDate) query.date.$gte = new Date(startDate);
      if (endDate) query.date.$lte = new Date(endDate);
    }

    if (employeeId) query.employeeId = employeeId;
    if (status) query.status = status;

    // Filter by overtime if requested
    if (hasOvertime !== undefined) {
      query.isOverTime = hasOvertime === "true" || hasOvertime === true;
    }

    const [records, total] = await Promise.all([
      DailyAttendance.find(query)
        .populate("employeeId")
        .sort({ date: 1 })
        .skip((page - 1) * perPage)
        .limit(perPage),
      DailyAttendance.countDocuments(query),
    ]);

    // Enhance records with additional calculated fields
    const enhancedRecords = records.map((record) => {
      const recordObj = record.toObject();

      // Calculate work efficiency
      if (recordObj.expectedWorkHours > 0 && recordObj.workDuration > 0) {
        recordObj.workEfficiency = Math.round(
          (recordObj.workDuration / recordObj.expectedWorkHours) * 100
        );
      } else {
        recordObj.workEfficiency = 0;
      }

      // Calculate overtime minutes if applicable
      if (recordObj.isOverTime) {
        recordObj.overtimeMinutes = Math.max(
          0,
          recordObj.workDuration - recordObj.expectedWorkHours
        );
      } else {
        recordObj.overtimeMinutes = 0;
      }

      return recordObj;
    });

    return successResponse(res, 200, "Data Fetched Successfully", {
      data: enhancedRecords,
      meta: {
        total,
        page: Number(page),
        perPage: Number(perPage),
        totalPages: Math.ceil(total / perPage),
      },
    });
  } catch (error) {
    console.error("Error fetching daily attendance records:", error);
    return errorRresponse(
      res,
      500,
      "Error fetching daily attendance records",
      error
    );
  }
};

// Get attendance statistics for a date range
const getStatistics = async (req, res) => {
  try {
    const { startDate, endDate, employeeId } = req.query;

    if (!startDate || !endDate) {
      return errorRresponse(res, 400, "Start date and end date are required");
    }

    const query = {
      date: {
        $gte: new Date(startDate),
        $lte: new Date(endDate),
      },
    };

    if (employeeId) query.employeeId = employeeId;

    // Aggregate statistics
    const statistics = await DailyAttendance.aggregate([
      { $match: query },
      {
        $group: {
          _id: "$status",
          count: { $sum: 1 },
        },
      },
    ]);

    // Time statistics
    const timeStats = await DailyAttendance.aggregate([
      { $match: query },
      {
        $group: {
          _id: null,
          totalLateMinutes: { $sum: "$lateArrival" },
          totalEarlyDepartureMinutes: { $sum: "$earlyDeparture" },
          totalWorkDuration: { $sum: "$workDuration" },
          totalExpectedWorkHours: { $sum: "$expectedWorkHours" },
          recordCount: { $sum: 1 },
        },
      },
    ]);

    // Checkin status statistics
    const checkinStats = await DailyAttendance.aggregate([
      { $match: query },
      {
        $group: {
          _id: "$checkinStatus",
          count: { $sum: 1 },
        },
      },
    ]);

    // Checkout status statistics
    const checkoutStats = await DailyAttendance.aggregate([
      { $match: query },
      {
        $group: {
          _id: "$checkoutStatus",
          count: { $sum: 1 },
        },
      },
    ]);

    // Overtime statistics
    const overtimeStats = await DailyAttendance.aggregate([
      { $match: query },
      {
        $group: {
          _id: "$isOverTime",
          count: { $sum: 1 },
          totalOvertimeRecords: {
            $sum: { $cond: [{ $eq: ["$isOverTime", true] }, 1, 0] },
          },
          totalApprovedOvertimeRecords: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $eq: ["$isOverTime", true] },
                    { $eq: ["$approvedOverTime", true] },
                  ],
                },
                1,
                0,
              ],
            },
          },
          totalPendingOvertimeRecords: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $eq: ["$isOverTime", true] },
                    { $eq: ["$approvedOverTime", false] },
                  ],
                },
                1,
                0,
              ],
            },
          },
        },
      },
    ]);

    // Calculate total overtime minutes
    const overtimeMinutesStats = await DailyAttendance.aggregate([
      {
        $match: {
          ...query,
          isOverTime: true,
        },
      },
      {
        $project: {
          overtimeMinutes: {
            $max: [0, { $subtract: ["$workDuration", "$expectedWorkHours"] }],
          },
          isApproved: "$approvedOverTime",
        },
      },
      {
        $group: {
          _id: "$isApproved",
          totalMinutes: { $sum: "$overtimeMinutes" },
          count: { $sum: 1 },
        },
      },
    ]);

    // Format the response
    const formattedStats = {
      statusCounts: {},
      totalDays: 0,
      timeStats: {
        totalLateMinutes: 0,
        totalEarlyDepartureMinutes: 0,
        totalWorkDuration: 0,
        totalExpectedWorkHours: 0,
        avgWorkDurationPerDay: 0,
        avgExpectedWorkHoursPerDay: 0,
        workEfficiency: 0, // New field - actual work vs expected
      },
      checkinStats: {},
      checkoutStats: {},
      overtimeStats: {
        totalOvertimeRecords: 0,
        totalApprovedOvertimeRecords: 0,
        totalPendingOvertimeRecords: 0,
        totalOvertimeMinutes: 0,
        totalApprovedOvertimeMinutes: 0,
        totalPendingOvertimeMinutes: 0,
      },
    };

    // Add status counts
    statistics.forEach((stat) => {
      formattedStats.statusCounts[stat._id] = stat.count;
      formattedStats.totalDays += stat.count;
    });

    // Add checkin status counts
    checkinStats.forEach((stat) => {
      formattedStats.checkinStats[stat._id] = stat.count;
    });

    // Add checkout status counts
    checkoutStats.forEach((stat) => {
      formattedStats.checkoutStats[stat._id] = stat.count;
    });

    // Add overtime stats
    if (overtimeStats.length > 0) {
      const stats = overtimeStats[0];
      formattedStats.overtimeStats.totalOvertimeRecords =
        stats.totalOvertimeRecords || 0;
      formattedStats.overtimeStats.totalApprovedOvertimeRecords =
        stats.totalApprovedOvertimeRecords || 0;
      formattedStats.overtimeStats.totalPendingOvertimeRecords =
        stats.totalPendingOvertimeRecords || 0;
    }

    // Add overtime minutes stats
    overtimeMinutesStats.forEach((stat) => {
      if (stat._id === true) {
        formattedStats.overtimeStats.totalApprovedOvertimeMinutes =
          stat.totalMinutes || 0;
      } else {
        formattedStats.overtimeStats.totalPendingOvertimeMinutes =
          stat.totalMinutes || 0;
      }
    });

    formattedStats.overtimeStats.totalOvertimeMinutes =
      (formattedStats.overtimeStats.totalApprovedOvertimeMinutes || 0) +
      (formattedStats.overtimeStats.totalPendingOvertimeMinutes || 0);

    // Add time stats if available
    if (timeStats.length > 0) {
      formattedStats.timeStats.totalLateMinutes = timeStats[0].totalLateMinutes;
      formattedStats.timeStats.totalEarlyDepartureMinutes =
        timeStats[0].totalEarlyDepartureMinutes;
      formattedStats.timeStats.totalWorkDuration =
        timeStats[0].totalWorkDuration;
      formattedStats.timeStats.totalExpectedWorkHours =
        timeStats[0].totalExpectedWorkHours;

      if (formattedStats.totalDays > 0) {
        formattedStats.timeStats.avgWorkDurationPerDay = Math.round(
          timeStats[0].totalWorkDuration / formattedStats.totalDays
        );

        formattedStats.timeStats.avgExpectedWorkHoursPerDay = Math.round(
          timeStats[0].totalExpectedWorkHours / formattedStats.totalDays
        );
      }

      // Calculate work efficiency (actual work vs expected)
      if (timeStats[0].totalExpectedWorkHours > 0) {
        formattedStats.timeStats.workEfficiency = Math.round(
          (timeStats[0].totalWorkDuration /
            timeStats[0].totalExpectedWorkHours) *
            100
        );
      }
    }

    return successResponse(
      res,
      200,
      "Statistics Fetched Successfully",
      formattedStats
    );
  } catch (error) {
    console.error("Error fetching attendance statistics:", error);
    return errorRresponse(
      res,
      500,
      "Error fetching attendance statistics",
      error
    );
  }
};

// Get a single attendance record
const getRecord = async (req, res) => {
  try {
    const { id } = req.params;

    const record = await DailyAttendance.findById(id)
      .populate("employeeId", "name user_defined_code department designation")
      .populate("logs");

    if (!record) {
      return errorRresponse(res, 404, "Attendance record not found");
    }

    // Calculate and add work efficiency if possible
    let enhancedRecord = record.toObject();
    if (record.expectedWorkHours > 0 && record.workDuration > 0) {
      enhancedRecord.workEfficiency = Math.round(
        (record.workDuration / record.expectedWorkHours) * 100
      );
    } else {
      enhancedRecord.workEfficiency = 0;
    }

    return successResponse(
      res,
      200,
      "Record Fetched Successfully",
      enhancedRecord
    );
  } catch (error) {
    console.error("Error fetching attendance record:", error);
    return errorRresponse(res, 500, "Error fetching attendance record", error);
  }
};

// Approve or reject overtime
const approveOvertime = async (req, res) => {
  try {
    const { id } = req.params;
    const { approved } = req.body;

    // Validate input
    if (approved === undefined) {
      return errorRresponse(res, 400, "Approved status is required");
    }

    // Find the record
    const record = await DailyAttendance.findById(id);
    if (!record) {
      return errorRresponse(res, 404, "Attendance record not found");
    }

    // Check if overtime exists
    if (!record.isOverTime) {
      return errorRresponse(
        res,
        400,
        "This record does not have overtime to approve"
      );
    }

    // Update the record
    record.approvedOverTime = approved;

    // Update the overtime status
    record.overTimeStatus = approved ? "Approved" : "Reject";

    // If we're rejecting previously approved overtime, update remarks
    if (record.approvedOverTime === true && approved === false) {
      // Add rejection to remarks
      record.remarks = record.remarks + ". Overtime approval has been revoked";
    }
    // If we're approving previously rejected overtime
    else if (record.approvedOverTime === false && approved === true) {
      // Add approval to remarks
      record.remarks = record.remarks + ". Overtime has been approved";
    }

    await record.save();

    // Calculate overtime amount in minutes
    const overtimeMinutes = record.workDuration - record.expectedWorkHours;

    return successResponse(res, 200, "Overtime status updated successfully", {
      recordId: record._id,
      date: record.date,
      employeeId: record.employeeId,
      overtimeMinutes: overtimeMinutes > 0 ? overtimeMinutes : 0,
      approved: record.approvedOverTime,
    });
  } catch (error) {
    console.error("Error updating overtime status:", error);
    return errorRresponse(res, 500, "Error updating overtime status", error);
  }
};

// Get all overtime records
const getOvertimeRecords = async (req, res) => {
  try {
    const {
      page = 1,
      perPage = 10,
      startDate,
      endDate,
      employeeId,
      approvalFilter,
    } = req.query;

    const query = {
      isOverTime: true,
    };

    if (startDate || endDate) {
      query.date = {};
      if (startDate) query.date.$gte = new Date(startDate);
      if (endDate) query.date.$lte = new Date(endDate);
    }

    if (employeeId) query.employeeId = employeeId;

    if (approvalFilter !== "All") {
      query.overTimeStatus = approvalFilter;
    }

    console.log({ query });
    const [records, total] = await Promise.all([
      DailyAttendance.find(query)
        .populate("employeeId")
        .sort({ date: -1 })
        .skip((page - 1) * perPage)
        .limit(perPage),
      DailyAttendance.countDocuments(query),
    ]);

    // Enhance records with additional calculated fields
    const enhancedRecords = records.map((record) => {
      const recordObj = record.toObject();

      // Calculate work efficiency
      if (recordObj.expectedWorkHours > 0 && recordObj.workDuration > 0) {
        recordObj.workEfficiency = Math.round(
          (recordObj.workDuration / recordObj.expectedWorkHours) * 100
        );
      } else {
        recordObj.workEfficiency = 0;
      }

      // Use existing overTimeMinutes field if available, otherwise calculate
      if (recordObj.overTimeMinutes) {
        recordObj.overTimeMinutes = recordObj.overTimeMinutes;
      } else {
        // Fallback to calculated value
        recordObj.overTimeMinutes = Math.max(
          0,
          recordObj.workDuration - recordObj.expectedWorkHours
        );
      }

      // Include formatted overtime status for display
      recordObj.overTimeStatus =
        recordObj.overTimeStatus ||
        (recordObj.overTimeStatus ? "Approved" : "Pending");

      return recordObj;
    });

    return successResponse(res, 200, "Overtime Records Fetched Successfully", {
      data: enhancedRecords,
      meta: {
        total,
        page: Number(page),
        perPage: Number(perPage),
        totalPages: Math.ceil(total / perPage),
      },
    });
  } catch (error) {
    console.error("Error fetching overtime records:", error);
    return errorRresponse(res, 500, "Error fetching overtime records", error);
  }
};

// Update a daily attendance record
const updateRecord = async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = req.body;
    console.log({ updateData });

    // Find the record
    const record = await DailyAttendance.findById(id);
    if (!record) {
      return errorRresponse(res, 404, "Attendance record not found");
    }

    // Validate date format if provided
    if (updateData.date) {
      if (!moment(updateData.date, moment.ISO_8601, true).isValid()) {
        return errorRresponse(res, 400, "Invalid date format");
      }
    }

    // Mark record as manually updated - always set for any manual edit
    updateData.isManuallyUpdated = true;

    // Process firstEntry and lastExit timestamps
    if (updateData.firstEntry && typeof updateData.firstEntry === "string") {
      updateData.firstEntry = new Date(updateData.firstEntry);
    }

    if (updateData.lastExit && typeof updateData.lastExit === "string") {
      updateData.lastExit = new Date(updateData.lastExit);
    }

    // If status is changed to Absent or Day Off, clear entry/exit times and related fields
    if (updateData.status === "Absent" || updateData.status === "Day Off") {
      updateData.firstEntry = null;
      updateData.lastExit = null;
      updateData.workDuration = 0;
      updateData.lateArrival = 0;
      updateData.earlyDeparture = 0;
      updateData.isOverTime = false;

      // Clear overtime fields
      updateData.overtTimeStart = null;
      updateData.overtTimeEnd = null;
      updateData.overTimeMinutes = 0;
      updateData.overTimeStatus = null;

      // Set appropriate status for check-in/check-out
      if (updateData.status === "Absent") {
        updateData.checkinStatus = "Absent";
        updateData.checkoutStatus = "Absent";
      } else if (updateData.status === "Day Off") {
        updateData.checkinStatus = "Day Off";
        updateData.checkoutStatus = "Day Off";
      }
    }
    // If we have both entry and exit times, recalculate work duration and other metrics
    else if (updateData.firstEntry && updateData.lastExit) {
      // Calculate work duration in minutes

      let first = new Date(updateData.firstEntry);
      let last = new Date(updateData.lastExit);

      // Add 1 day to lastExitTime if it is earlier than firstEntryTime
      if (first > last) {
        last.setDate(last.getDate() + 1);
      }

      const workDurationMinutes = Math.round((last - first) / (1000 * 60));

      console.log({ workDurationMinutes }, "workDurationMinutes");

      updateData.workDuration = Math.round((last - first) / (1000 * 60));

      // Check if late arrival (if expected check-in time exists)
      if (record.expectedCheckinTime) {
        updateData.lateArrival =
          updateData.firstEntry > record.expectedCheckinTime
            ? Math.round(
                (updateData.firstEntry - record.expectedCheckinTime) /
                  (1000 * 60)
              )
            : 0;
      }

      // Check if early departure (if expected check-out time exists)
      if (record.expectedCheckoutTime) {
        updateData.earlyDeparture =
          updateData.lastExit < record.expectedCheckoutTime
            ? Math.round(
                (record.expectedCheckoutTime - updateData.lastExit) /
                  (1000 * 60)
              )
            : 0;
      }

      // Use the new calculateOvertimeDetails function for overtime calculation
      if (record.expectedCheckinTime && record.expectedCheckoutTime) {
        const overtimeDetails = calculateOvertimeDetails(
          updateData.firstEntry,
          updateData.lastExit,
          record.expectedCheckinTime,
          record.expectedCheckoutTime
        );

        updateData.isOverTime = overtimeDetails.isOverTime;
        
        if (updateData.isOverTime) {
          // Apply overtime details
          updateData.overtTimeStart = overtimeDetails.overtimeStart;
          updateData.overtTimeEnd = overtimeDetails.overtimeEnd;
          updateData.overTimeMinutes = overtimeDetails.overtimeMinutes;
          
          // Keep existing status if available, otherwise set to Pending
          if (!record.overTimeStatus || record.overTimeStatus === "Reject") {
            updateData.overTimeStatus = "Pending";
          }
        } else {
          // Clear overtime fields if there's no overtime
          updateData.overtTimeStart = null;
          updateData.overtTimeEnd = null;
          updateData.overTimeMinutes = 0;
          updateData.overTimeStatus = null;
        }
      }
    }

    // Update checkin/checkout status based on times
    if (updateData.firstEntry && record.expectedCheckinTime) {
      const minutesDiff = Math.round(
        (updateData.firstEntry - record.expectedCheckinTime) / (1000 * 60)
      );
      console.log({ minutesDiff }, "minutesDiff for checkin");
      if (minutesDiff > 1) {
        updateData.checkinStatus = "Late";
      } else if (minutesDiff < -10) {
        // More than 10 mins early
        updateData.checkinStatus = "Early";
      } else {
        updateData.checkinStatus = "On Time";
      }
    }

    if (updateData.lastExit && record.expectedCheckoutTime) {
      console.log(
        { expectedCheckoutTime: record.expectedCheckoutTime },
        { lastExit: updateData.lastExit },
        "newLastExit"
      );
      const minutesDiff = Math.round(
        (updateData.lastExit - record.expectedCheckoutTime) / (1000 * 60)
      );
      console.log({ minutesDiff }, "minutesDiff for checkout");
      if (minutesDiff < 0) {
        updateData.checkoutStatus = "Early";
      } else if (minutesDiff > 10) {
        // More than 10 mins late
        updateData.checkoutStatus = "Late";
      } else {
        updateData.checkoutStatus = "On Time";
      }
    }

    // Generate updated remarks
    if (
      updateData.firstEntry !== undefined ||
      updateData.lastExit !== undefined ||
      updateData.status !== undefined
    ) {
      const statusForRemarks = updateData.status || record.status;
      const lateArrivalForRemarks =
        updateData.lateArrival !== undefined
          ? updateData.lateArrival
          : record.lateArrival;
      const earlyDepartureForRemarks =
        updateData.earlyDeparture !== undefined
          ? updateData.earlyDeparture
          : record.earlyDeparture;
      const checkinStatusForRemarks =
        updateData.checkinStatus || record.checkinStatus;
      const checkoutStatusForRemarks =
        updateData.checkoutStatus || record.checkoutStatus;
      const workDurationForRemarks =
        updateData.workDuration !== undefined
          ? updateData.workDuration
          : record.workDuration;
      const expectedWorkHoursForRemarks = record.expectedWorkHours;
      const isOverTimeForRemarks =
        updateData.isOverTime !== undefined
          ? updateData.isOverTime
          : record.isOverTime;

      const attendanceProcessor = require("../utils/attendanceProcessor");
      updateData.remarks = attendanceProcessor.generateRemarks(
        statusForRemarks,
        lateArrivalForRemarks,
        earlyDepartureForRemarks,
        checkinStatusForRemarks,
        checkoutStatusForRemarks,
        workDurationForRemarks,
        expectedWorkHoursForRemarks,
        isOverTimeForRemarks
      );

      // Add a note about manual update
      updateData.remarks += ". This record was manually updated.";

      // Add specific note for Day Off
      if (updateData.status === "Day Off") {
        updateData.remarks +=
          " Marked as Day Off (holiday or scheduled leave).";
      }
    }

    console.log({ updateData });
    // Update the record with all the calculated values
    const updatedRecord = await DailyAttendance.findByIdAndUpdate(
      id,
      { $set: updateData },
      { new: true }
    ).populate("employeeId", "name user_defined_code department designation");

    return successResponse(
      res,
      200,
      "Attendance record updated successfully",
      updatedRecord
    );
  } catch (error) {
    console.error("Error updating attendance record:", error);
    return errorRresponse(res, 500, "Error updating attendance record", error);
  }
};
const updateOvertimeDetails = async (req, res) => {
  try {
    console.log('========== START: updateOvertimeDetails ==========');
    const { id } = req.params;
    const { firstEntry, lastExit, approvalStatus, date } = req.body;
    console.log({ id, firstEntry, lastExit, approvalStatus, date }, "Request parameters");
    console.log('Full request body:', req.body);

    // Find the record
    console.log(`Searching for attendance record with ID: ${id}`);
    const record = await DailyAttendance.findById(id);
    if (!record) {
      console.log(`No attendance record found with ID: ${id}`);
      return errorRresponse(res, 404, "Attendance record not found");
    }
    console.log('Found attendance record:', JSON.stringify(record, null, 2));

    // Check if overtime exists
    console.log(`Checking if record has overtime. isOverTime: ${record.isOverTime}`);
    if (!record.isOverTime) {
      console.log('Record does not have overtime to update');
      return errorRresponse(
        res,
        400,
        "This record does not have overtime to update"
      );
    }

    const updateData = {
      // isManuallyUpdated: true, // Mark as manually updated
    };
    console.log('Initialized updateData:', updateData);

    // Extract time in HH:MM format from existing record for debugging and reference
    const formatTimeHHMM = (dateObj) => {
      if (!dateObj) return null;
      const date = new Date(dateObj);
      if (isNaN(date.getTime())) return null;
      return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
    };

    // Extract existing times in HH:MM format
    const recordFirstEntryHHMM = formatTimeHHMM(record.firstEntry);
    const recordLastExitHHMM = formatTimeHHMM(record.lastExit);
    console.log(`Existing record times - firstEntry: ${recordFirstEntryHHMM}, lastExit: ${recordLastExitHHMM}`);

    // Helper function to check if a string is in HH:MM format
    const isTimeFormat = (timeString) => {
      const isValid = typeof timeString === 'string' && /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/.test(timeString);
      console.log(`Checking if "${timeString}" is in time format: ${isValid}`);
      return isValid;
    };

    // Helper function to combine date and time
    const combineDateTime = (dateValue, timeString) => {
      console.log(`Combining date: ${dateValue} with time: ${timeString}`);
      if (!dateValue || !timeString) {
        console.log('Missing date or time value, returning null');
        return null;
      }
      
      const baseDate = new Date(dateValue);
      console.log(`Base date object: ${baseDate}`);
      
      const [hours, minutes] = timeString.split(':').map(Number);
      console.log(`Extracted hours: ${hours}, minutes: ${minutes}`);
      
      // Create new date with the specified time
      const combinedDate = new Date(baseDate);
      combinedDate.setHours(hours, minutes, 0, 0);
      console.log(`Combined date result: ${combinedDate}`);
      
      return combinedDate;
    };

    // Process firstEntry and lastExit
    let entry = null;
    let exit = null;
    let entryHHMM = null;
    let exitHHMM = null;

    console.log('Processing firstEntry value...');
    if (firstEntry) {
      console.log(`firstEntry provided: ${firstEntry}, type: ${typeof firstEntry}`);

      if (isTimeFormat(firstEntry)) {
        // Handle time-only format (HH:MM)
        console.log('firstEntry is in time-only format (HH:MM)');
        entryHHMM = firstEntry; // Store the HH:MM format
        if (!date) {
          console.log('Date is required but missing for time-only format');
          return errorRresponse(res, 400, "Date is required when using time-only format");
        }
        entry = combineDateTime(date, firstEntry);
        console.log(`Converted firstEntry to datetime: ${entry}`);
      } else {
        // Handle full datetime format (backward compatibility)
        console.log('firstEntry appears to be in full datetime format');
        entry = new Date(firstEntry);
        entryHHMM = formatTimeHHMM(entry); // Extract HH:MM from the date
        console.log(`Parsed firstEntry as date object: ${entry}, valid date: ${!isNaN(entry.getTime())}`);
        console.log(`Extracted HH:MM format: ${entryHHMM}`);
      }
    } else {
      entry = record.firstEntry;
      entryHHMM = recordFirstEntryHHMM;
      console.log(`No firstEntry provided, using existing value: ${entry} (${entryHHMM})`);
    }

    console.log('Processing lastExit value...');
    if (lastExit) {
      console.log(`lastExit provided: ${lastExit}, type: ${typeof lastExit}`);
      
      if (isTimeFormat(lastExit)) {
        // Handle time-only format (HH:MM)
        console.log('lastExit is in time-only format (HH:MM)');
        exitHHMM = lastExit; // Store the HH:MM format
        if (!date) {
          console.log('Date is required but missing for time-only format');
          return errorRresponse(res, 400, "Date is required when using time-only format");
        }
        exit = combineDateTime(date, lastExit);
        console.log(`Converted lastExit to datetime: ${exit}`);
      } else {
        // Handle full datetime format (backward compatibility)
        console.log('lastExit appears to be in full datetime format');
        exit = new Date(lastExit);
        exitHHMM = formatTimeHHMM(exit); // Extract HH:MM from the date
        console.log(`Parsed lastExit as date object: ${exit}, valid date: ${!isNaN(exit.getTime())}`);
        console.log(`Extracted HH:MM format: ${exitHHMM}`);
      }
    } else {
      exit = record.lastExit;
      exitHHMM = recordLastExitHHMM;
      console.log(`No lastExit provided, using existing value: ${exit} (${exitHHMM})`);
    }

    // Log the extracted HH:MM values for clarity
    console.log(`Working with time values - firstEntry: ${entryHHMM}, lastExit: ${exitHHMM}`);

    // Handle overnight scenario: if exit time is earlier than entry time, add 1 day to exit
    if (entry && exit) {
      console.log(`Checking overnight scenario - entry: ${entry}, exit: ${exit}`);
      console.log(`Time comparison: exit < entry = ${exit < entry}`);
      
      if (exit < entry) {
        console.log("Detected overnight work: lastExit is earlier than firstEntry, adding 1 day to lastExit");
        const originalExit = new Date(exit);
        exit.setDate(exit.getDate() + 1);
        console.log(`Updated lastExit from ${originalExit} to ${exit}`);
      }
    }

    const shiftStartTime = record.expectedCheckinTime;
    const shiftEndTime = record.expectedCheckoutTime;
    const shiftStartHHMM = formatTimeHHMM(shiftStartTime);
    const shiftEndHHMM = formatTimeHHMM(shiftEndTime);
    console.log(`Shift times - start: ${shiftStartTime} (${shiftStartHHMM}), end: ${shiftEndTime} (${shiftEndHHMM})`);

    // Only recalculate if we have all required data
    if (entry && exit && shiftStartTime && shiftEndTime) {
      console.log('All required data available, calculating overtime details...');
      console.log(`Parameters for calculation:
        - Entry: ${entry} (${entryHHMM})
        - Exit: ${exit} (${exitHHMM})
        - Shift start: ${shiftStartTime} (${shiftStartHHMM})
        - Shift end: ${shiftEndTime} (${shiftEndHHMM})`);
      
      const overtimeDetails = calculateOvertimeDetails(
        entry,
        exit,
        shiftStartTime,
        shiftEndTime
      );
      console.log('Calculated overtime details:', overtimeDetails);
      
      updateData.firstEntry = entry;
      updateData.lastExit = exit;
      updateData.overtTimeStart = overtimeDetails.overtimeStart;
      updateData.overtTimeEnd = overtimeDetails.overtimeEnd;
      updateData.overTimeMinutes = overtimeDetails.overtimeMinutes;
      updateData.earlyOvertimeMinutes = overtimeDetails.earlyOvertimeMinutes;
      updateData.lateOvertimeMinutes = overtimeDetails.lateOvertimeMinutes;
      updateData.isOverTime = overtimeDetails.isOverTime;
      
      console.log('Updated updateData with overtime calculations:', updateData);
    } else {
      console.log('Missing required data for overtime calculation:');
      console.log(`- Entry: ${!!entry} (${entryHHMM})`);
      console.log(`- Exit: ${!!exit} (${exitHHMM})`);
      console.log(`- Shift start: ${!!shiftStartTime} (${shiftStartHHMM})`);
      console.log(`- Shift end: ${!!shiftEndTime} (${shiftEndHHMM})`);
    }

    // Update approval status if provided
    if (approvalStatus !== undefined) {
      console.log(`Processing approval status: ${approvalStatus}`);
      
      if (approvalStatus === "Approved") {
        console.log('Setting status to Approved');
        updateData.overTimeStatus = "Approved";
        updateData.approvedOverTime = true;
      } else if (approvalStatus === "Reject" || approvalStatus === "Rejected") {
        console.log('Setting status to Rejected');
        updateData.overTimeStatus = "Reject";
        updateData.approvedOverTime = false;
      } else if (approvalStatus === "Pending") {
        console.log('Setting status to Pending');
        updateData.overTimeStatus = "Pending";
        updateData.approvedOverTime = false;
      } else {
        console.log(`Unrecognized approval status: ${approvalStatus}`);
      }
    } else {
      console.log('No approval status provided, keeping existing status');
    }

    // Update remarks to reflect the changes
    let remarks = record.remarks || "";
    remarks += ". Overtime details manually updated";
    if (approvalStatus) {
      remarks += `. Overtime status changed to ${approvalStatus}`;
    }
    updateData.remarks = remarks;
    console.log(`Updated remarks: ${remarks}`);

    // Add HH:MM values to the log for clarity
    console.log(`Final time values being used - firstEntry: ${entryHHMM}, lastExit: ${exitHHMM}`);
    console.log('Final updateData object:', JSON.stringify(updateData, null, 2));
    
    // Update the record
    console.log(`Updating record with ID: ${id}`);
    const updatedRecord = await DailyAttendance.findByIdAndUpdate(
      id,
      { $set: updateData },
      { new: true }
    ).populate("employeeId", "name user_defined_code department designation");

    console.log('Update successful. Updated record:', JSON.stringify(updatedRecord, null, 2));
    console.log('========== END: updateOvertimeDetails ==========');

    return successResponse(
      res,
      200,
      "Overtime details updated successfully",
      updatedRecord
    );
  } catch (error) {
    console.error("Error updating overtime details:", error);
    console.log('Stack trace:', error.stack);
    return errorRresponse(res, 500, "Error updating overtime details", error);
  }
};
// Update overtime details
// const updateOvertimeDetails = async (req, res) => {
//   try {
//     console.log('========== START: updateOvertimeDetails ==========');
//     const { id } = req.params;
//     const { firstEntry, lastExit, approvalStatus, date } = req.body;
//     console.log({ id, firstEntry, lastExit, approvalStatus, date }, "Request parameters");
//     console.log('Full request body:', req.body);

//     // Find the record
//     console.log(`Searching for attendance record with ID: ${id}`);
//     const record = await DailyAttendance.findById(id);
//     if (!record) {
//       console.log(`No attendance record found with ID: ${id}`);
//       return errorRresponse(res, 404, "Attendance record not found");
//     }
//     console.log('Found attendance record:', JSON.stringify(record, null, 2));

//     // Check if overtime exists
//     console.log(`Checking if record has overtime. isOverTime: ${record.isOverTime}`);
//     if (!record.isOverTime) {
//       console.log('Record does not have overtime to update');
//       return errorRresponse(
//         res,
//         400,
//         "This record does not have overtime to update"
//       );
//     }

//     const updateData = {
//       // isManuallyUpdated: true, // Mark as manually updated
//     };
//     console.log('Initialized updateData:', updateData);

//     // Helper function to check if a string is in HH:MM format
//     const isTimeFormat = (timeString) => {
//       const isValid = typeof timeString === 'string' && /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/.test(timeString);
//       console.log(`Checking if "${timeString}" is in time format: ${isValid}`);
//       return isValid;
//     };

//     // Helper function to combine date and time
//     const combineDateTime = (dateValue, timeString) => {
//       console.log(`Combining date: ${dateValue} with time: ${timeString}`);
//       if (!dateValue || !timeString) {
//         console.log('Missing date or time value, returning null');
//         return null;
//       }
      
//       const baseDate = new Date(dateValue);
//       console.log(`Base date object: ${baseDate}`);
      
//       const [hours, minutes] = timeString.split(':').map(Number);
//       console.log(`Extracted hours: ${hours}, minutes: ${minutes}`);
      
//       // Create new date with the specified time
//       const combinedDate = new Date(baseDate);
//       combinedDate.setHours(hours, minutes, 0, 0);
//       console.log(`Combined date result: ${combinedDate}`);
      
//       return combinedDate;
//     };

//     // Process firstEntry and lastExit
//     let entry = null;
//     let exit = null;

//     console.log('Processing firstEntry value...');
//     if (firstEntry) {
//       console.log(`firstEntry provided: ${firstEntry}, type: ${typeof firstEntry}`);

//       if (isTimeFormat(firstEntry)) {
//         // Handle time-only format (HH:MM)
//         console.log('firstEntry is in time-only format (HH:MM)');
//         if (!date) {
//           console.log('Date is required but missing for time-only format');
//           return errorRresponse(res, 400, "Date is required when using time-only format");
//         }
//         entry = combineDateTime(date, firstEntry);
//         console.log(`Converted firstEntry to datetime: ${entry}`);
//       } else {
//         // Handle full datetime format (backward compatibility)
//         console.log('firstEntry appears to be in full datetime format');
//         entry = new Date(firstEntry);
//         console.log(`Parsed firstEntry as date object: ${entry}, valid date: ${!isNaN(entry.getTime())}`);
//       }
//     } else {
//       entry = record.firstEntry;
//       console.log(`No firstEntry provided, using existing value: ${entry}`);
//     }

//     console.log('Processing lastExit value...');
//     if (lastExit) {
//       console.log(`lastExit provided: ${lastExit}, type: ${typeof lastExit}`);
      
//       if (isTimeFormat(lastExit)) {
//         // Handle time-only format (HH:MM)
//         console.log('lastExit is in time-only format (HH:MM)');
//         if (!date) {
//           console.log('Date is required but missing for time-only format');
//           return errorRresponse(res, 400, "Date is required when using time-only format");
//         }
//         exit = combineDateTime(date, lastExit);
//         console.log(`Converted lastExit to datetime: ${exit}`);
//       } else {
//         // Handle full datetime format (backward compatibility)
//         console.log('lastExit appears to be in full datetime format');
//         exit = new Date(lastExit);
//         console.log(`Parsed lastExit as date object: ${exit}, valid date: ${!isNaN(exit.getTime())}`);
//       }
//     } else {
//       exit = record.lastExit;
//       console.log(`No lastExit provided, using existing value: ${exit}`);
//     }

//     // Handle overnight scenario: if exit time is earlier than entry time, add 1 day to exit
//     if (entry && exit) {
//       console.log(`Checking overnight scenario - entry: ${entry}, exit: ${exit}`);
//       console.log(`Time comparison: exit < entry = ${exit < entry}`);
      
//       if (exit < entry) {
//         console.log("Detected overnight work: lastExit is earlier than firstEntry, adding 1 day to lastExit");
//         const originalExit = new Date(exit);
//         exit.setDate(exit.getDate() + 1);
//         console.log(`Updated lastExit from ${originalExit} to ${exit}`);
//       }
//     }

//     const shiftStartTime = record.expectedCheckinTime;
//     const shiftEndTime = record.expectedCheckoutTime;
//     console.log(`Shift times - start: ${shiftStartTime}, end: ${shiftEndTime}`);

//     // Only recalculate if we have all required data
//     if (entry && exit && shiftStartTime && shiftEndTime) {
//       console.log('All required data available, calculating overtime details...');
//       console.log(`Parameters for calculation:
//         - Entry: ${entry}
//         - Exit: ${exit}
//         - Shift start: ${shiftStartTime}
//         - Shift end: ${shiftEndTime}`);
      
//       const overtimeDetails = calculateOvertimeDetails(
//         entry,
//         exit,
//         shiftStartTime,
//         shiftEndTime
//       );
//       console.log('Calculated overtime details:', overtimeDetails);
      
//       updateData.firstEntry = entry;
//       updateData.lastExit = exit;
//       updateData.overtTimeStart = overtimeDetails.overtimeStart;
//       updateData.overtTimeEnd = overtimeDetails.overtimeEnd;
//       updateData.overTimeMinutes = overtimeDetails.overtimeMinutes;
//       updateData.earlyOvertimeMinutes = overtimeDetails.earlyOvertimeMinutes;
//       updateData.lateOvertimeMinutes = overtimeDetails.lateOvertimeMinutes;
//       updateData.isOverTime = overtimeDetails.isOverTime;
      
//       console.log('Updated updateData with overtime calculations:', updateData);
//     } else {
//       console.log('Missing required data for overtime calculation:');
//       console.log(`- Entry: ${!!entry}`);
//       console.log(`- Exit: ${!!exit}`);
//       console.log(`- Shift start: ${!!shiftStartTime}`);
//       console.log(`- Shift end: ${!!shiftEndTime}`);
//     }

//     // Update approval status if provided
//     if (approvalStatus !== undefined) {
//       console.log(`Processing approval status: ${approvalStatus}`);
      
//       if (approvalStatus === "Approved") {
//         console.log('Setting status to Approved');
//         updateData.overTimeStatus = "Approved";
//         updateData.approvedOverTime = true;
//       } else if (approvalStatus === "Reject" || approvalStatus === "Rejected") {
//         console.log('Setting status to Rejected');
//         updateData.overTimeStatus = "Reject";
//         updateData.approvedOverTime = false;
//       } else if (approvalStatus === "Pending") {
//         console.log('Setting status to Pending');
//         updateData.overTimeStatus = "Pending";
//         updateData.approvedOverTime = false;
//       } else {
//         console.log(`Unrecognized approval status: ${approvalStatus}`);
//       }
//     } else {
//       console.log('No approval status provided, keeping existing status');
//     }

//     // Update remarks to reflect the changes
//     let remarks = record.remarks || "";
//     remarks += ". Overtime details manually updated";
//     if (approvalStatus) {
//       remarks += `. Overtime status changed to ${approvalStatus}`;
//     }
//     updateData.remarks = remarks;
//     console.log(`Updated remarks: ${remarks}`);

//     console.log('Final updateData object:', JSON.stringify(updateData, null, 2));
    
//     // Update the record
//     console.log(`Updating record with ID: ${id}`);
//     const updatedRecord = await DailyAttendance.findByIdAndUpdate(
//       id,
//       { $set: updateData },
//       { new: true }
//     ).populate("employeeId", "name user_defined_code department designation");

//     console.log('Update successful. Updated record:', JSON.stringify(updatedRecord, null, 2));
//     console.log('========== END: updateOvertimeDetails ==========');

//     return successResponse(
//       res,
//       200,
//       "Overtime details updated successfully",
//       updatedRecord
//     );
//   } catch (error) {
//     console.error("Error updating overtime details:", error);
//     console.log('Stack trace:', error.stack);
//     return errorRresponse(res, 500, "Error updating overtime details", error);
//   }
// };

const updateRelaxationRequest = async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = req.body;
    console.log("Relaxation Request Update Received:", { id, updateData });

    // Find the record
    const record = await DailyAttendance.findById(id);
    if (!record) {
      return errorRresponse(res, 404, "Attendance record not found");
    }

    console.log("Original Attendance Record:", {
      id: record._id,
      date: record.date,
      employeeId: record.employeeId,
      firstEntry: record.firstEntry,
      lastExit: record.lastExit,
      expectedCheckinTime: record.expectedCheckinTime,
      expectedCheckoutTime: record.expectedCheckoutTime,
      relaxationRequest: record.relaxationRequest,
      relaxationRequestStatus: record.relaxationRequestStatus,
      lateArrival: record.lateArrival,
      earlyDeparture: record.earlyDeparture
    });

    // Validate date format if provided
    if (updateData.date) {
      if (!moment(updateData.date, moment.ISO_8601, true).isValid()) {
        return errorRresponse(res, 400, "Invalid date format");
      }
    }

    // Process firstEntry and lastExit timestamps
    if (updateData.firstEntry && typeof updateData.firstEntry === "string") {
      updateData.firstEntry = new Date(updateData.firstEntry);
    }

    if (updateData.lastExit && typeof updateData.lastExit === "string") {
      updateData.lastExit = new Date(updateData.lastExit);
    }

    // --- Relaxation Request Handling ---
    // FLOW:
    // 1. User submits a relaxation request (relaxationRequest=true, relaxationRequestStatus="Pending")
    // 2. Admin approves/rejects the request by setting relaxationRequestStatus="Approved" or "Reject"
    // 3. If approved:
    //    a. Reset firstEntry to match expectedCheckinTime (if late arrival)
    //    b. Reset lastExit to match expectedCheckoutTime (if early departure)
    //    c. Reset lateArrival and earlyDeparture to 0
    //    d. Set checkinStatus and checkoutStatus to "On Time"
    //    e. Recalculate work duration and other metrics
    // 4. If rejected: Keep original values but mark as rejected
    
    if (updateData.relaxationRequestStatus && (updateData.relaxationRequestStatus === 'Approved' || updateData.relaxationRequestStatus === 'Reject')) {
        if (record.relaxationRequest) {
            updateData.relaxationRequest = true; // Keep the flag true if a request was made
        }
        
        // Special handling for APPROVED relaxation requests
        if (updateData.relaxationRequestStatus === 'Approved') {
            console.log("🟢 RELAXATION REQUEST APPROVED - Resetting attendance times to expected values");
            
            // When a relaxation request is approved, we reset the attendance record to match the expected times
            // This essentially gives the employee the benefit of being counted as on-time
            if (record.firstEntry) {
                // Reset firstEntry to match expected check-in time
                updateData.firstEntry = new Date(record.firstEntry);
                console.log("✓ Reset firstEntry to expectedCheckinTime:", updateData.firstEntry);
            }
            
            if (record.lastExit) {
                // Reset lastExit to match expected check-out time
                updateData.lastExit = new Date(record.lastExit);
                console.log("✓ Reset lastExit to expectedCheckoutTime:", updateData.lastExit);
            }
            
            // Reset late arrival and early departure metrics
            updateData.lateArrival = 0;
            updateData.earlyDeparture = 0;
            console.log("✓ Reset lateArrival and earlyDeparture to 0");
            
            // Update check-in and check-out status to "On Time"
            updateData.checkinStatus = "On Time";
            updateData.checkoutStatus = "On Time";
            console.log("✓ Set checkinStatus and checkoutStatus to 'On Time'");
            
            // Add a note to remarks about the relaxation approval
            const baseRemarks = "Relaxation request approved. Employee marked as on-time.";
            updateData.remarks = updateData.remarks ? `${updateData.remarks} ${baseRemarks}` : baseRemarks;
        } else if (updateData.relaxationRequestStatus === 'Reject') {
            console.log("🔴 RELAXATION REQUEST REJECTED - Keeping original attendance values");
        }
    }
    // If relaxationRequestStatus is being set to Pending (e.g., manual edit)
    else if (updateData.relaxationRequestStatus === 'Pending') {
         // Ensure relaxationRequest is true if status is Pending
         updateData.relaxationRequest = true;
    }
    // If relaxationRequestStatus is being cleared or not provided in updateData,
    // recalculate relaxationRequest based on late/early times after other updates.
    // This case is handled later if firstEntry/lastExit are updated.

    // If status is changed to Absent or Day Off, clear entry/exit times and related fields
    if (updateData.status === "Absent" || updateData.status === "Day Off") {
      updateData.firstEntry = null;
      updateData.lastExit = null;
      updateData.workDuration = 0;
      updateData.lateArrival = 0;
      updateData.earlyDeparture = 0;
      updateData.isOverTime = false;

      // Clear overtime fields
      updateData.overtTimeStart = null;
      updateData.overtTimeEnd = null;
      updateData.overTimeMinutes = 0;
      updateData.overTimeStatus = null;

      // Also clear relaxation request fields if marked as Absent/Day Off
      updateData.relaxationRequest = false;
      updateData.relaxationRequestStatus = null;

      // Set appropriate status for check-in/check-out
      if (updateData.status === "Absent") {
        updateData.checkinStatus = "Absent";
        updateData.checkoutStatus = "Absent";
      } else if (updateData.status === "Day Off") {
        updateData.checkinStatus = "Day Off";
        updateData.checkoutStatus = "Day Off";
      }
    }
    // If we have both entry and exit times, recalculate work duration and other metrics
    else if (updateData.firstEntry && updateData.lastExit) {
      // Calculate work duration in minutes

      let first = new Date(updateData.firstEntry);
      let last = new Date(updateData.lastExit);

      // Add 1 day to lastExitTime if it is earlier than firstEntryTime
      if (first > last) {
        last.setDate(last.getDate() + 1);
      }

      const workDurationMinutes = Math.round((last - first) / (1000 * 60));

      console.log({ workDurationMinutes }, "workDurationMinutes");

      updateData.workDuration = Math.round((last - first) / (1000 * 60));

      // Check if late arrival (if expected check-in time exists)
      // Skip this calculation if relaxation request was approved
      if (record.expectedCheckinTime && updateData.relaxationRequestStatus !== 'Approved') {
        updateData.lateArrival =
          updateData.firstEntry > record.expectedCheckinTime
            ? Math.round(
                (updateData.firstEntry - record.expectedCheckinTime) /
                  (1000 * 60)
              )
            : 0;
      }

      // Check if early departure (if expected check-out time exists)
      // Skip this calculation if relaxation request was approved
      if (record.expectedCheckoutTime && updateData.relaxationRequestStatus !== 'Approved') {
        updateData.earlyDeparture =
          updateData.lastExit < record.expectedCheckoutTime
            ? Math.round(
                (record.expectedCheckoutTime - updateData.lastExit) /
                  (1000 * 60)
              )
            : 0;
      }

      // Use the new calculateOvertimeDetails function for overtime calculation
      if (record.expectedCheckinTime && record.expectedCheckoutTime) {
      const overtimeDetails = calculateOvertimeDetails(
          updateData.firstEntry,
          updateData.lastExit,
          record.expectedCheckinTime,
          record.expectedCheckoutTime
        );

        updateData.isOverTime = overtimeDetails.isOverTime;
        
        if (updateData.isOverTime) {
          // Apply overtime details
      updateData.overtTimeStart = overtimeDetails.overtimeStart;
      updateData.overtTimeEnd = overtimeDetails.overtimeEnd;
      updateData.overTimeMinutes = overtimeDetails.overtimeMinutes;
      
          // Keep existing status if available, otherwise set to Pending
          if (!record.overTimeStatus || record.overTimeStatus === "Reject") {
            updateData.overTimeStatus = "Pending";
          }
    } else {
          // Clear overtime fields if there's no overtime
          updateData.overtTimeStart = null;
          updateData.overtTimeEnd = null;
          updateData.overTimeMinutes = 0;
          updateData.overTimeStatus = null;
        }
      }
    }

    // Update checkin/checkout status based on times
    // Skip this calculation if relaxation request was approved (already set to "On Time")
    if (updateData.firstEntry && record.expectedCheckinTime && updateData.relaxationRequestStatus !== 'Approved') {
      const minutesDiff = Math.round(
        (updateData.firstEntry - record.expectedCheckinTime) / (1000 * 60)
      );
      console.log({ minutesDiff }, "minutesDiff for checkin");
      if (minutesDiff > 1) {
        updateData.checkinStatus = "Late";
      } else if (minutesDiff < -10) {
        // More than 10 mins early
        updateData.checkinStatus = "Early";
      } else {
        updateData.checkinStatus = "On Time";
      }
    }

    if (updateData.lastExit && record.expectedCheckoutTime && updateData.relaxationRequestStatus !== 'Approved') {
      console.log(
        { expectedCheckoutTime: record.expectedCheckoutTime },
        { lastExit: updateData.lastExit },
        "newLastExit"
      );
      const minutesDiff = Math.round(
        (updateData.lastExit - record.expectedCheckoutTime) / (1000 * 60)
      );
      console.log({ minutesDiff }, "minutesDiff for checkout");
      if (minutesDiff < 0) {
        updateData.checkoutStatus = "Early";
      } else if (minutesDiff > 10) {
        // More than 10 mins late
        updateData.checkoutStatus = "Late";
    } else {
        updateData.checkoutStatus = "On Time";
      }
    }

    // Generate updated remarks
    if (
      updateData.firstEntry !== undefined ||
      updateData.lastExit !== undefined ||
      updateData.status !== undefined
    ) {
      const statusForRemarks = updateData.status || record.status;
      const lateArrivalForRemarks =
        updateData.lateArrival !== undefined
          ? updateData.lateArrival
          : record.lateArrival;
      const earlyDepartureForRemarks =
        updateData.earlyDeparture !== undefined
          ? updateData.earlyDeparture
          : record.earlyDeparture;
      const checkinStatusForRemarks =
        updateData.checkinStatus || record.checkinStatus;
      const checkoutStatusForRemarks =
        updateData.checkoutStatus || record.checkoutStatus;
      const workDurationForRemarks =
        updateData.workDuration !== undefined
          ? updateData.workDuration
          : record.workDuration;
      const expectedWorkHoursForRemarks = record.expectedWorkHours;
      const isOverTimeForRemarks =
        updateData.isOverTime !== undefined
          ? updateData.isOverTime
          : record.isOverTime;

      const attendanceProcessor = require("../utils/attendanceProcessor");
      updateData.remarks = attendanceProcessor.generateRemarks(
        statusForRemarks,
        lateArrivalForRemarks,
        earlyDepartureForRemarks,
        checkinStatusForRemarks,
        checkoutStatusForRemarks,
        workDurationForRemarks,
        expectedWorkHoursForRemarks,
        isOverTimeForRemarks
      );

      // Add a note about manual update
      updateData.remarks += ". This record was manually updated.";
      
      // Add note about relaxation request if it was approved
      if (updateData.relaxationRequestStatus === 'Approved') {
        updateData.remarks += " Relaxation request was approved, employee marked as on-time.";
      } else if (updateData.relaxationRequestStatus === 'Reject') {
        updateData.remarks += " Relaxation request was rejected.";
      }

      // Add specific note for Day Off
      if (updateData.status === "Day Off") {
        updateData.remarks +=
          " Marked as Day Off (holiday or scheduled leave).";
      }
    }

    console.log("Final updateData before saving:", updateData);
    
    // Update the record with all the calculated values
    const updatedRecord = await DailyAttendance.findByIdAndUpdate(
      id,
      { $set: updateData },
      { new: true }
    ).populate("employeeId", "name user_defined_code department designation");

    console.log("Updated Attendance Record after relaxation request handling:", {
      id: updatedRecord._id,
      date: updatedRecord.date,
      employeeId: updatedRecord.employeeId?.name || updatedRecord.employeeId,
      firstEntry: updatedRecord.firstEntry,
      lastExit: updatedRecord.lastExit,
      relaxationRequestStatus: updatedRecord.relaxationRequestStatus,
      lateArrival: updatedRecord.lateArrival,
      earlyDeparture: updatedRecord.earlyDeparture,
      checkinStatus: updatedRecord.checkinStatus,
      checkoutStatus: updatedRecord.checkoutStatus,
      workDuration: updatedRecord.workDuration
    });

    return successResponse(
      res,
      200,
      "Attendance record updated successfully",
      updatedRecord
    );
  } catch (error) {
    console.error("Error updating attendance record:", error);
    return errorRresponse(res, 500, "Error updating attendance record", error);
  }
};

// Get relaxation request records
const getRelaxationRequests = async (req, res) => {
  try {
    const {
      page = 1,
      perPage = 10,
      startDate,
      endDate,
      employeeId,
      search,
      approvalFilter // This will map to relaxationRequestStatus
    } = req.query;

    const query = { relaxationRequest: true };

    if (startDate || endDate) {
      query.date = {};
      if (startDate) query.date.$gte = new Date(startDate);
      if (endDate) query.date.$lte = new Date(endDate);
    }

    if (employeeId) query.employeeId = employeeId;

    if (approvalFilter && approvalFilter.toLowerCase() !== 'all') {
        // Map frontend filter value to backend enum value
        let backendStatus = approvalFilter;
        if (approvalFilter.toLowerCase() === 'rejected') {
             backendStatus = 'Reject'; // Assuming backend uses 'Reject'
        }
         query.relaxationRequestStatus = backendStatus;
    }

     // Handle search by employee name or ID
    if (search) {
        const employees = await Employee.find({
            $or: [
                { name: { $regex: search, $options: 'i' } },
                { user_defined_code: { $regex: search, $options: 'i' } }
            ]
        }).select('_id');
        const employeeIds = employees.map(emp => emp._id);
        
        if(employeeIds.length > 0) {
             // Add to existing query with an AND condition
             query.employeeId = { $in: employeeIds };
        } else {
             // If no employees found by search, return empty result
             return successResponse(res, 200, "Data Fetched Successfully", {
                  data: [],
                  meta: {
                       total: 0,
                       page: Number(page),
                       perPage: Number(perPage),
                       totalPages: 0,
                  },
             });
        }
    }

    const [records, total] = await Promise.all([
      DailyAttendance.find(query)
        .populate("employeeId", "name user_defined_code department designation") // Populate employee details
        .sort({ date: -1 }) // Sort by date descending
        .skip((page - 1) * perPage)
        .limit(perPage),
      DailyAttendance.countDocuments(query),
    ]);

     // No need to enhance records here as relaxationRequest and relaxationRequestStatus are already fields

    return successResponse(res, 200, "Data Fetched Successfully", {
      data: records,
      meta: {
        total,
        page: Number(page),
        perPage: Number(perPage),
        totalPages: Math.ceil(total / perPage),
      },
    });

  } catch (error) {
    console.error("Error fetching relaxation request records:", error);
    return errorRresponse(
      res,
      500,
      "Error fetching relaxation request records",
      error
    );
  }
};

// Get relaxation request statistics for a date range
const getRelaxationRequestStats = async (req, res) => {
    try {
        const { startDate, endDate, employeeId } = req.query;

        const query = { relaxationRequest: true };

        if (startDate || endDate) {
            query.date = {};
            if (startDate) query.date.$gte = new Date(startDate);
            if (endDate) query.date.$lte = new Date(endDate);
        }

        if (employeeId) query.employeeId = employeeId;

        // Aggregate statistics by relaxationRequestStatus
        const stats = await DailyAttendance.aggregate([
            { $match: query },
            {
                $group: {
                    _id: "$relaxationRequestStatus",
                    count: { $sum: 1 }
                }
            }
        ]);

        // Format the results
        const formattedStats = {
            totalRecords: 0,
            totalPendingRecords: 0,
            totalApprovedRecords: 0,
            totalRejectedRecords: 0,
        };

        stats.forEach(item => {
            formattedStats.totalRecords += item.count;
            if (item._id === 'Pending') {
                formattedStats.totalPendingRecords = item.count;
            } else if (item._id === 'Approved') {
                formattedStats.totalApprovedRecords = item.count;
            } else if (item._id === 'Reject') {
                formattedStats.totalRejectedRecords = item.count;
            }
        });

        return successResponse(res, 200, "Relaxation Request Statistics Fetched Successfully", {
            relaxationRequestStats: formattedStats
        });

    } catch (error) {
        console.error("Error fetching relaxation request statistics:", error);
        return errorRresponse(
            res,
            500,
            "Error fetching relaxation request statistics",
            error
        );
    }
};

// Recalculate a daily attendance record based on updated employee schedule
const recalculateAttendance = async (req, res) => {
  console.log("🔄 RECALCULATE ATTENDANCE - Starting process");
  try {
    const { id } = req.params;
    console.log(`🔍 Processing attendance record ID: ${id}`);

    // Find the attendance record
    const record = await DailyAttendance.findById(id);
    if (!record) {
      console.log(`❌ Attendance record not found for ID: ${id}`);
      return errorRresponse(res, 404, "Attendance record not found");
    }
    console.log(`✅ Found attendance record for employee: ${record.employeeId}`);

    // Get the employee ID and date from the record
    const employeeId = record.employeeId;
    const date = new Date(record.date);
    console.log(`📅 Processing date: ${date.toISOString().split('T')[0]}`);
    
    // Get the employee's logs for that day
    const dayStart = new Date(date);
    dayStart.setHours(0, 0, 0, 0);
    
    const dayEnd = new Date(date);
    dayEnd.setHours(23, 59, 59, 999);
    console.log(`⏰ Time range: ${dayStart.toISOString()} to ${dayEnd.toISOString()}`);

    // Get the employee's schedule for this date
    const monthNum = date.getMonth() + 1; // JavaScript months are 0-indexed
    const yearNum = date.getFullYear();
    console.log(`📆 Looking for employee schedule for month: ${monthNum}, year: ${yearNum}`);
    
    const employeeSchedule = await EmployeeSchedule.findOne({
      employee_id: employeeId,
      month: monthNum,
      year: yearNum
    });

    if (!employeeSchedule) {
      console.log(`❌ No employee schedule found for employee ${employeeId} in ${monthNum}/${yearNum}`);
      return errorRresponse(res, 404, "Employee schedule not found for this date");
    }
    console.log(`✅ Found employee schedule for ${monthNum}/${yearNum}`);

    // Find the specific day's schedule
    const currentDateStr = moment(date).format('YYYY-MM-DD');
    console.log(`🔍 Looking for day schedule for date: ${currentDateStr}`);
    const daySchedule = employeeSchedule.schedules.find(
      s => moment(s.date).format('YYYY-MM-DD') === currentDateStr
    );

    if (!daySchedule) {
      console.log(`❌ No day schedule found for date: ${currentDateStr}`);
      return errorRresponse(res, 404, "Day schedule not found for this date");
    }
    console.log(`✅ Found day schedule for ${currentDateStr}`);
    console.log(`📋 Day schedule details:`, JSON.stringify(daySchedule, null, 2));

    // Determine if it's a work day based on isDayOff flag
    const isWorkDay = !daySchedule.isDayOff;
    console.log(`📊 Is work day: ${isWorkDay}`);

    // If it's not a work day, update the record as a day off
    if (!isWorkDay) {
      console.log(`🏝️ Day marked as non-working day, updating record as Day Off`);
      const updatedRecord = await DailyAttendance.findByIdAndUpdate(
        id,
        {
          status: "Weekend",
          firstEntry: null,
          lastExit: null,
          workDuration: 0,
          lateArrival: 0,
          earlyDeparture: 0,
          expectedWorkHours: 0,
          checkinStatus: "Day Off",
          checkoutStatus: "Day Off",
          expectedCheckinTime: null,
          expectedCheckoutTime: null,
          isOverTime: false,
          overtTimeStart: null,
          overtTimeEnd: null,
          overTimeMinutes: 0,
          overTimeStatus: null,
          remarks: "Day Off (holiday or scheduled leave). Record recalculated due to schedule change.",
          // isManuallyUpdated: true
        },
        { new: true }
      ).populate("employeeId");
      console.log(`✅ Successfully updated record as Day Off`);

      return successResponse(
        res,
        200,
        "Attendance record recalculated successfully as Day Off",
        updatedRecord
      );
    }

    // Use the specific start and end times from the day's schedule
    const shiftStartTime = moment(daySchedule.start).toDate();
    const shiftEndTime = moment(daySchedule.end).toDate();
    console.log(`⏰ Shift start time: ${shiftStartTime.toISOString()}`);
    console.log(`⏰ Shift end time: ${shiftEndTime.toISOString()}`);

    // Calculate the extended window for early check-in
    const earlyWindow = moment(shiftStartTime)
      .subtract(6, "hours")
      .toDate();
    
    // Calculate the extended window for late check-out
    const lateWindow = moment(shiftEndTime)
      .add(6, "hours")
      .toDate();
    console.log(`🔍 Looking for attendance logs between: ${earlyWindow.toISOString()} and ${lateWindow.toISOString()}`);

    // Get all logs that could be relevant for this shift (within extended windows)
    const logs = await AttendanceLog.find({
      deviceUserId: employeeId,
      recordTime: {
        $gte: earlyWindow,
        $lte: lateWindow,
      },
    }).sort({ recordTime: 1 });
    console.log(`📊 Found ${logs.length} attendance logs for this time range`);
    
    if (logs.length > 0) {
      console.log(`📝 First log time: ${logs[0].recordTime.toISOString()}`);
      console.log(`📝 Last log time: ${logs[logs.length - 1].recordTime.toISOString()}`);
    }

    // Calculate expected work hours directly from the day schedule
    const expectedWorkHours = daySchedule.actual_expected_minutes || 
      Math.round((shiftEndTime - shiftStartTime) / (1000 * 60));
    console.log(`⏱️ Expected work hours: ${expectedWorkHours} minutes`);

    // If no logs found, mark as absent
    if (logs.length === 0) {
      console.log(`❌ No attendance logs found, marking as Absent`);
      const updatedRecord = await DailyAttendance.findByIdAndUpdate(
        id,
        {
          status: "Absent",
          firstEntry: null,
          lastExit: null,
          workDuration: 0,
          lateArrival: 0,
          earlyDeparture: 0,
          expectedWorkHours: expectedWorkHours,
          checkinStatus: "Absent",
          checkoutStatus: "Absent",
          expectedCheckinTime: shiftStartTime,
          expectedCheckoutTime: shiftEndTime,
          isOverTime: false,
          overtTimeStart: null,
          overtTimeEnd: null,
          overTimeMinutes: 0,
          overTimeStatus: null,
          remarks: "Absent. Record recalculated due to schedule change.",
          // isManuallyUpdated: true
        },
        { new: true }
      ).populate("employeeId");
      console.log(`✅ Successfully updated record as Absent`);

      return successResponse(
        res,
        200,
        "Attendance record recalculated successfully as Absent",
        updatedRecord
      );
    }

    // Use the first log as the first entry
    const firstEntry = logs[0].recordTime;
    console.log(`🕒 First entry time: ${firstEntry.toISOString()}`);
    
    // Use the last log as the last exit
    const lastExit = logs[logs.length - 1].recordTime;
    console.log(`🕒 Last exit time: ${lastExit.toISOString()}`);

    // Get the work schedule for grace period
    console.log(`🔍 Looking for work schedule ID: ${daySchedule.time_slot_id}`);
    const workSchedule = await WorkSchedule.findById(daySchedule.time_slot_id);
    if (!workSchedule) {
      console.log(`❌ Work schedule not found for ID: ${daySchedule.time_slot_id}`);
      return errorRresponse(res, 404, "Work schedule not found");
    }
    console.log(`✅ Found work schedule with grace period: ${workSchedule.graceTimeInMinutes} minutes`);

    // Calculate work duration in minutes
    let workDuration = Math.round((lastExit - firstEntry) / (1000 * 60));
    console.log(`⏱️ Work duration: ${workDuration} minutes`);

    // Check if late arrival (considering grace period)
    const lateArrival = firstEntry > shiftStartTime
      ? Math.max(0, Math.round((firstEntry - shiftStartTime) / (1000 * 60)) - workSchedule.graceTimeInMinutes)
      : 0;
    console.log(`⏰ Late arrival: ${lateArrival} minutes (after ${workSchedule.graceTimeInMinutes} min grace period)`);

    // Check if early departure
    const earlyDeparture = lastExit < shiftEndTime
      ? Math.round((shiftEndTime - lastExit) / (1000 * 60))
      : 0;
    console.log(`⏰ Early departure: ${earlyDeparture} minutes`);

    // Determine check-in status
    let checkinStatus = "On Time";
    if (lateArrival > 0) {
      checkinStatus = "Late";
    } else if (firstEntry < shiftStartTime) {
      // If checked in more than 10 minutes early
      const earlyMinutes = Math.round((shiftStartTime - firstEntry) / (1000 * 60));
      if (earlyMinutes > 10) {
        checkinStatus = "Early";
      }
    }
    console.log(`📊 Check-in status: ${checkinStatus}`);

    // Determine check-out status
    let checkoutStatus = "On Time";
    if (earlyDeparture > 0) {
      checkoutStatus = "Early";
    } else if (lastExit > shiftEndTime) {
      // If checked out more than 10 minutes after shift end
      const lateMinutes = Math.round((lastExit - shiftEndTime) / (1000 * 60));
      if (lateMinutes > 10) {
        checkoutStatus = "Late";
      }
    }
    console.log(`📊 Check-out status: ${checkoutStatus}`);

    // Determine attendance status
    let status = "Present";
    const workHours = workDuration / 60;
    console.log(`⏱️ Work hours: ${workHours.toFixed(2)} hours`);
    console.log(`📊 Min work hours for half day: ${workSchedule.minWorkHoursForHalfDay}`);
    console.log(`📊 Min work hours for full day: ${workSchedule.minWorkHours}`);

    if (workHours < workSchedule.minWorkHoursForHalfDay) {
      status = "Less than Half Day"; // Less than minimum hours for half day
    } else if (workHours < workSchedule.minWorkHours) {
      status = "Half Day";
    } else if (lateArrival > 0) {
      status = "Late";
    }
    console.log(`📊 Attendance status: ${status}`);

    // Calculate overtime using the utility function
    console.log(`🔄 Calculating overtime details...`);
    const attendanceProcessor = require("../utils/attendanceProcessor");
    const overtimeDetails = attendanceProcessor.calculateOvertimeDetails(
      firstEntry,
      lastExit,
      shiftStartTime,
      shiftEndTime
    );
    console.log(`📊 Overtime calculation results:`, JSON.stringify({
      isOverTime: overtimeDetails.isOverTime,
      overtimeMinutes: overtimeDetails.overtimeMinutes,
      overtimeStart: overtimeDetails.overtimeStart,
      overtimeEnd: overtimeDetails.overtimeEnd
    }, null, 2));

    // Generate remarks
    const remarks = attendanceProcessor.generateRemarks(
      status,
      lateArrival,
      earlyDeparture,
      checkinStatus,
      checkoutStatus,
      workDuration,
      expectedWorkHours,
      overtimeDetails.isOverTime
    ) + ". Record recalculated due to schedule change.";
    console.log(`📝 Generated remarks: ${remarks}`);

    // Determine if relaxation request is needed
    let relaxationRequest = false;
    let relaxationRequestStatus = null;
    if (lateArrival > 1 || earlyDeparture > 0) {
      relaxationRequest = record.relaxationRequest || false;
      relaxationRequestStatus = record.relaxationRequestStatus || null;
      console.log(`🔄 Keeping existing relaxation request: ${relaxationRequest}, status: ${relaxationRequestStatus}`);
    }

    // Prepare update data
    const updateData = {
      status,
      firstEntry,
      lastExit,
      workDuration,
      lateArrival,
      earlyDeparture,
      expectedWorkHours,
      checkinStatus,
      checkoutStatus,
      expectedCheckinTime: shiftStartTime,
      expectedCheckoutTime: shiftEndTime,
      isOverTime: overtimeDetails.isOverTime,
      overtTimeStart: overtimeDetails.overtimeStart,
      overtTimeEnd: overtimeDetails.overtimeEnd,
      overTimeMinutes: overtimeDetails.overtimeMinutes,
      overTimeStatus: overtimeDetails.isOverTime ? "Pending" : null,
      remarks,
      // isManuallyUpdated: true,
      relaxationRequest,
      relaxationRequestStatus
    };
    console.log(`📝 Update data prepared for database update`);

    // Update the record with the recalculated values
    console.log(`🔄 Updating attendance record in database...`);
    const updatedRecord = await DailyAttendance.findByIdAndUpdate(
      id,
      { $set: updateData },
      { new: true }
    ).populate("employeeId");
    console.log(`✅ Successfully updated attendance record`);

    return successResponse(
      res,
      200,
      "Attendance record recalculated successfully",
      updatedRecord
    );

  } catch (error) {
    console.error("❌ ERROR in recalculateAttendance:", error);
    console.error(error.stack);
    return errorRresponse(res, 500, "Error recalculating attendance record", error);
  }
};

module.exports = {
  processLogs,
  getRecords,
  getStatistics,
  getRecord,
  approveOvertime,
  getOvertimeRecords,
  updateRecord,
  updateOvertimeDetails,
  updateRelaxationRequest,
  getRelaxationRequests,
  getRelaxationRequestStats,
  recalculateAttendance
};
