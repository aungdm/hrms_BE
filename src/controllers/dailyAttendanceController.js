const { successResponse, errorRresponse } = require("../utils/response");
const DailyAttendance = require("../models/dailyAttendance");
// const { processAttendanceLogs } = require("../utils/attendanceProcessor");
const cron = require("node-cron");
const moment = require("moment");

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

      // Check if overtime (if expected check-out time exists)
      if (record.expectedCheckoutTime) {
        updateData.isOverTime =
          updateData.lastExit > record.expectedCheckoutTime;

        // Handle overtime fields if overtime is detected
        if (updateData.isOverTime) {
          // The overtime starts at the end of the scheduled shift
          updateData.overtTimeStart = record.expectedCheckoutTime;
          // The overtime ends at the last exit time
          updateData.overtTimeEnd = updateData.lastExit;
          // Calculate overtime minutes
          updateData.overTimeMinutes = Math.round(
            (updateData.lastExit - record.expectedCheckoutTime) / (1000 * 60)
          );
          // If not already set, set initial status to Pending
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

        if (!updateData.isOverTime) {
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
      // const expectedCheckoutTime = new Date(record.expectedCheckoutTime);
      // const lastExit = new Date(updateData.lastExit);
      // const newLastExit = new Date(lastExit); // Clone before modifying

      // if (expectedCheckoutTime > lastExit) {
      //   console.log("expectedCheckoutTime is greater than lastExit");
      //   newLastExit.setDate(newLastExit.getDate() + 1);
      // }

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




// Update overtime details
const updateOvertimeDetails = async (req, res) => {
  try {
    const { id } = req.params;
    const { overtimeStart, overtimeEnd, approvalStatus } = req.body;

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
        "This record does not have overtime to update"
      );
    }

    const updateData = {
      isManuallyUpdated: true, // Mark as manually updated
    };

    // Update overtime start time if provided
    if (overtimeStart) {
      updateData.overtTimeStart = new Date(overtimeStart);
    }

    // Update overtime end time if provided
    if (overtimeEnd) {
      updateData.overtTimeEnd = new Date(overtimeEnd);
    }

    // Calculate overtime minutes if both start and end times are available
    if (updateData.overtTimeStart && updateData.overtTimeEnd) {
      updateData.overTimeMinutes = Math.round(
        (updateData.overtTimeEnd - updateData.overtTimeStart) / (1000 * 60)
      );
    } else if (updateData.overtTimeStart && record.overtTimeEnd) {
      updateData.overTimeMinutes = Math.round(
        (record.overtTimeEnd - updateData.overtTimeStart) / (1000 * 60)
      );
    } else if (record.overtTimeStart && updateData.overtTimeEnd) {
      updateData.overTimeMinutes = Math.round(
        (updateData.overtTimeEnd - record.overtTimeStart) / (1000 * 60)
      );
    }

    // Update approval status if provided
    if (approvalStatus !== undefined) {
      if (approvalStatus === "Approved") {
        updateData.overTimeStatus = "Approved";
        updateData.approvedOverTime = true;
      } else if (approvalStatus === "Reject") {
        updateData.overTimeStatus = "Reject";
        updateData.approvedOverTime = false;
      } else if (approvalStatus === "Pending") {
        updateData.overTimeStatus = "Pending";
        updateData.approvedOverTime = false;
      }
    }

    // Update remarks to reflect the changes
    let remarks = record.remarks || "";
    remarks += ". Overtime details manually updated";

    if (approvalStatus) {
      remarks += `. Overtime status changed to ${approvalStatus}`;
    }

    updateData.remarks = remarks;

    // Update the record
    const updatedRecord = await DailyAttendance.findByIdAndUpdate(
      id,
      { $set: updateData },
      { new: true }
    ).populate("employeeId", "name user_defined_code department designation");

    return successResponse(
      res,
      200,
      "Overtime details updated successfully",
      updatedRecord
    );
  } catch (error) {
    console.error("Error updating overtime details:", error);
    return errorRresponse(res, 500, "Error updating overtime details", error);
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
};
