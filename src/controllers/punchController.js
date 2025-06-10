const { successResponse, errorRresponse } = require("../utils/response");
const Punch = require("../models/punch");
const Employee = require("../models/employee");
const DailyAttendance = require("../models/dailyAttendance");
const { updateRecord } = require("./dailyAttendanceController");
const moment = require("moment");
const { calculateOvertimeDetails } = require("../utils/attendanceProcessor");

// Create a new punch request
const createPunch = async (req, res) => {
  console.log(req.body, "createPunch");

  try {
    const { employeeId, date, time, punchType, attendanceId } = req.body;

    if (!employeeId || !date || !time || !punchType || !attendanceId) {
      return errorRresponse(
        res,
        400,
        "Employee ID, date, time, punch type and attendance ID are required"
      );
    }

    // Validate punch type
    const validPunchTypes = [
      "firstEntry",
      "lastExit",
      "overtimeStart",
      "overtimeEnd",
    ];
    if (!validPunchTypes.includes(punchType)) {
      return errorRresponse(
        res,
        400,
        `Invalid punch type. Must be one of: ${validPunchTypes.join(", ")}`
      );
    }

    // Check if employee exists
    const employee = await Employee.findById(employeeId);
    if (!employee) {
      return errorRresponse(res, 404, "Employee not found");
    }

    // Create new punch record
    const newPunch = new Punch({
      employeeId,
      attendanceId,
      date: new Date(date),
      time: new Date(time),
      punchType,
      status: "Pending", // Default status is Pending
    });

    await newPunch.save();

    return successResponse(
      res,
      201,
      "Punch request created successfully",
      newPunch
    );
  } catch (error) {
    console.error("Error creating punch request:", error);
    return errorRresponse(res, 500, "Error creating punch request", error);
  }
};

// Get all punch requests with pagination and filtering
const getPunches = async (req, res) => {
  try {
    const {
      page = 1,
      perPage = 10,
      status,
      employeeId,
      startDate,
      endDate,
      punchType,
    } = req.query;

    const query = {};

    if (status) query.status = status;
    if (employeeId) query.employeeId = employeeId;
    if (punchType) query.punchType = punchType;

    if (startDate || endDate) {
      query.date = {};
      if (startDate) query.date.$gte = new Date(startDate);
      if (endDate) query.date.$lte = new Date(endDate);
    }

    const [punches, total] = await Promise.all([
      Punch.find(query)
        .populate("employeeId", "name employeeId department")
        .sort({ date: -1, time: -1 })
        .skip((page - 1) * perPage)
        .limit(perPage),
      Punch.countDocuments(query),
    ]);

    return successResponse(res, 200, "Punch requests fetched successfully", {
      data: punches,
      meta: {
        total,
        page: Number(page),
        perPage: Number(perPage),
        totalPages: Math.ceil(total / perPage),
      },
    });
  } catch (error) {
    console.error("Error fetching punch requests:", error);
    return errorRresponse(res, 500, "Error fetching punch requests", error);
  }
};

// Get a single punch request by ID
const getPunch = async (req, res) => {
  try {
    const { id } = req.params;

    const punch = await Punch.findById(id).populate(
      "employeeId",
      "name employeeId department"
    );

    if (!punch) {
      return errorRresponse(res, 404, "Punch request not found");
    }

    return successResponse(
      res,
      200,
      "Punch request fetched successfully",
      punch
    );
  } catch (error) {
    console.error("Error fetching punch request:", error);
    return errorRresponse(res, 500, "Error fetching punch request", error);
  }
};

// Update a punch request
const updatePunch = async (req, res) => {
  try {
    const { id } = req.params;
    const { employeeId, date, time, punchType, status } = req.body;

    // Find the current punch record
    const currentPunch = await Punch.findById(id);
    if (!currentPunch) {
      return errorRresponse(res, 404, "Punch request not found");
    }

    const updateData = {};
    if (employeeId) updateData.employeeId = employeeId;
    if (date) updateData.date = new Date(date);
    if (time) updateData.time = new Date(time);
    if (punchType) {
      // Validate punch type
      const validPunchTypes = [
        "firstEntry",
        "lastExit",
        "overtimeStart",
        "overtimeEnd",
      ];
      if (!validPunchTypes.includes(punchType)) {
        return errorRresponse(
          res,
          400,
          `Invalid punch type. Must be one of: ${validPunchTypes.join(", ")}`
        );
      }
      updateData.punchType = punchType;
    }
    if (status) updateData.status = status;

    // Update the record
    const updatedPunch = await Punch.findByIdAndUpdate(
      id,
      { $set: updateData },
      { new: true }
    ).populate("employeeId", "name employeeId department");

    if (!updatedPunch) {
      return errorRresponse(res, 404, "Punch request not found after update");
    }

    return successResponse(
      res,
      200,
      "Punch request updated successfully",
      updatedPunch
    );
  } catch (error) {
    console.error("Error updating punch request:", error);
    return errorRresponse(res, 500, "Error updating punch request", error);
  }
};

// Delete a punch request
const deletePunch = async (req, res) => {
  try {
    const { id } = req.params;

    const deletedPunch = await Punch.findByIdAndDelete(id);

    if (!deletedPunch) {
      return errorRresponse(res, 404, "Punch request not found");
    }

    return successResponse(
      res,
      200,
      "Punch request deleted successfully",
      deletedPunch
    );
  } catch (error) {
    console.error("Error deleting punch request:", error);
    return errorRresponse(res, 500, "Error deleting punch request", error);
  }
};

// Approve or reject a punch request
const updatePunchStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
     console.log({ status }, "status" , req.body);

    if (!status || !["Pending", "Approved", "Rejected"].includes(status)) {
      return errorRresponse(
        res,
        400,
        "Valid status (Pending, Approved, Rejected) is required"
      );
    }

    // Find the current punch record
    const currentPunch = await Punch.findById(id).populate(
      "employeeId",
      "name employeeId department"
    );
    console.log({ currentPunch }, "currentPunch");

    if (!currentPunch) {
      return errorRresponse(res, 404, "Punch request not found");
    }

    // Don't update if status is the same
    if (currentPunch.status === status) {
      return successResponse(
        res,
        200,
        "Punch request status already set",
        currentPunch
      );
    }

    // Update the punch status
    const updatedPunch = await Punch.findByIdAndUpdate(
      id,
      { $set: { status } },
      { new: true }
    ).populate("employeeId", "name employeeId department");

    if (!updatedPunch) {
      return errorRresponse(res, 404, "Punch request not found after update");
    }
    
    let attendanceUpdateMessage = "No attendance record found to update.";
    
    console.log({ status }, "status");
    // If the status is "Approved", update the daily attendance record
    if (status === "Approved") {
      console.log("Approved");
      // Find the daily attendance record for this employee on this day
      const dateForQuery = new Date(currentPunch.date);
      dateForQuery.setHours(0, 0, 0, 0);

      console.log({ dateForQuery }, "dateForQuery");
      //   const updateData = await DailyAttendance.findOne({
      //     employeeId: updatedPunch.employeeId,
      //   date: dateForQuery,
      // });
      const updateData = await DailyAttendance.findById(
        currentPunch.attendanceId
      );
      console.log({ updateData }, "updateData");
      if (updateData) {
        console.log("updateData found");
        // updateData.isManuallyUpdated = true;
        updateData[updatedPunch.punchType] = currentPunch.time;

        console.log({ updateData });

        // Find the record
        const record = await DailyAttendance.findById(currentPunch.attendanceId);
        console.log({ record }, "record");
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
        // updateData.isManuallyUpdated = true;

        // Process firstEntry and lastExit timestamps
        if (
          updateData.firstEntry &&
          typeof updateData.firstEntry === "string"
        ) {
          updateData.firstEntry = new Date(updateData.firstEntry);
          console.log( updateData.firstEntry, "updateData.firstEntry");
        }

        if (updateData.lastExit && typeof updateData.lastExit === "string") {
          updateData.lastExit = new Date(updateData.lastExit);
          console.log( updateData.lastExit, "updateData.lastExit");
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
          console.log("updateData.firstEntry && updateData.lastExit");  
          // Calculate work duration in minutes

          let first = new Date(updateData.firstEntry);
          let last = new Date(updateData.lastExit);
          console.log({ first }, { last }, "first and last");

          // Add 1 day to lastExitTime if it is earlier than firstEntryTime
          if (first > last) {
            last.setDate(last.getDate() + 1);
            console.log({ last }, "last");
          }

          const workDurationMinutes = Math.round((last - first) / (1000 * 60));

          console.log({ workDurationMinutes }, "workDurationMinutes");

          updateData.workDuration = Math.round((last - first) / (1000 * 60));
          console.log({ updateData }, "updateData.workDuration");

          // Check if late arrival (if expected check-in time exists)
          if (record.expectedCheckinTime) {
            updateData.lateArrival =
              updateData.firstEntry > record.expectedCheckinTime
                ? Math.round(
                    (updateData.firstEntry - record.expectedCheckinTime) /
                      (1000 * 60)
                  )
                : 0;
            console.log({ updateData }, "updateData.lateArrival");
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
            console.log({ updateData }, "updateData.earlyDeparture");
          }

          // Check if overtime (if expected check-out time exists)
          if (record.expectedCheckoutTime) {
            // Use the new calculateOvertimeDetails function for overtime calculation
            console.log( updateData.firstEntry, updateData.lastExit, record.expectedCheckinTime, record.expectedCheckoutTime, "updateData.firstEntry and updateData.lastExit");
            const overtimeDetails = calculateOvertimeDetails(
              updateData.firstEntry,
              updateData.lastExit,
              record.expectedCheckinTime,
              record.expectedCheckoutTime
            );
            console.log({ overtimeDetails }, "overtimeDetails");
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
          currentPunch.attendanceId,
          { $set: updateData },
        { new: true }
        ).populate(
          "employeeId",
          "name user_defined_code department designation"
        );

        return successResponse(
          res,
          200,
          "Attendance record updated successfully",
          updatedRecord
        );
        // console.log({ attendanceRecord }, "attendanceRecord");
        // const mockReq = {
        //   params: { id: attendanceRecord._id },
        //   body: attendanceRecord,
        // };

        // const mockRes = {
        //   status: (code) => ({
        //     json: (data) => console.log("Response:", code, data),
        //   }),
        // };

        // await updateRecord(mockReq, mockRes);
      }
      console.log("No attendance record found to update.");
    }
    return successResponse(
      res,
      200,
      "Punch request status updated successfully",
      currentPunch
    );
  } catch (error) {
    console.error("Error updating punch request status:", error);
    return errorRresponse(
      res,
      500,
      "Error updating punch request status",
      error
    );
  }
};

module.exports = {
  createPunch,
  getPunches,
  getPunch,
  updatePunch,
  deletePunch,
  updatePunchStatus,
};
