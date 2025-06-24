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

    // Check if attendance record exists
    const attendanceRecord = await DailyAttendance.findById(attendanceId);
    if (!attendanceRecord) {
      return errorRresponse(res, 404, "Attendance record not found");
    }

    // Check if a punch request already exists for this attendance and punch type
    const existingPunch = await Punch.findOne({
      attendanceId,
      punchType,
      status: { $in: ["Pending", "Approved"] } // Don't allow duplicate unless previous was rejected
    });

    if (existingPunch) {
      return errorRresponse(
        res,
        400,
        `A punch request for ${punchType} already exists for this attendance record with status: ${existingPunch.status}`
      );
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
      attendanceId,
    } = req.query;

    const query = {};

    if (status) query.status = status;
    if (employeeId) query.employeeId = employeeId;
    if (punchType) query.punchType = punchType;
    if (attendanceId) query.attendanceId = attendanceId;

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
    const { status, firstEntry, lastExit, date } = req.body;
    console.log({ status, firstEntry, lastExit, date }, "status", req.body);

    if (!status || !["Pending", "Approved", "Rejected"].includes(status)) {
      return errorRresponse(
        res,
        400,
        "Valid status (Pending, Approved, Rejected) is required"
      );
    }

    // Helper function to check if a string is in HH:MM format
    const isTimeFormat = (timeString) => {
      return typeof timeString === 'string' && /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/.test(timeString);
    };

    // Helper function to extract time from datetime or return time as-is
    const extractTime = (timeValue) => {
      if (!timeValue) return null;
      
      if (isTimeFormat(timeValue)) {
        // Already in HH:MM format
        return timeValue;
      } else {
        // Extract time from full datetime
        const date = new Date(timeValue);
        console.log({ date }, " extractTime date");
        const hours = date.getHours().toString().padStart(2, '0');
        const minutes = date.getMinutes().toString().padStart(2, '0');
        console.log({ hours, minutes }, "hours and minutes");
        return `${hours}:${minutes}`;
      }
    };

    // Helper function to combine date and time
    const combineDateTime = (dateValue, timeString) => {
      if (!dateValue || !timeString) return null;
      
      const baseDate = new Date(dateValue);
      const [hours, minutes] = timeString.split(':').map(Number);
      
      // Create new date with the specified time
      const combinedDate = new Date(baseDate);
      combinedDate.setHours(hours, minutes, 0, 0);
      
      return combinedDate;
    };

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
      const updateData = await DailyAttendance.findById(
        currentPunch.attendanceId
      );
      console.log({ updateData }, "updateData");
      
      if (updateData) {
        console.log("updateData found");
        
        // Extract times from both firstEntry and lastExit if provided
        const firstEntryTime = firstEntry ? extractTime(firstEntry) : null;
        const lastExitTime = lastExit ? extractTime(lastExit) : null;
        console.log({ firstEntryTime, lastExitTime }, "firstEntry and lastExit");

        console.log({ firstEntryTime, lastExitTime }, "extracted times");
        
        // Use the provided date or fallback to the attendance record's date
        const baseDate = date || updateData.date;
        
        // Process punch times - combine extracted times with the base date
        let processedFirstEntry = null;
        let processedLastExit = null;
        
        if (firstEntryTime) {
          processedFirstEntry = combineDateTime(baseDate, firstEntryTime);
          console.log({ processedFirstEntry }, "processedFirstEntry");
        }
        
        if (lastExitTime) {
          processedLastExit = combineDateTime(baseDate, lastExitTime);
          console.log({ processedLastExit }, "processedLastExit");
        }
        
        // Update the attendance record with processed times
        if (processedFirstEntry) {
          updateData.firstEntry = processedFirstEntry;
        } else if (updatedPunch.punchType === 'firstEntry') {
          // Use the original punch time if no new time provided
          updateData.firstEntry = currentPunch.time;
        }
        
        if (processedLastExit) {
          updateData.lastExit = processedLastExit;
        } else if (updatedPunch.punchType === 'lastExit') {
          // Use the original punch time if no new time provided
          updateData.lastExit = currentPunch.time;
        }
        
        // If only the punch type time wasn't provided, use the original punch time
        if (!processedFirstEntry && !processedLastExit) {
          updateData[updatedPunch.punchType] = currentPunch.time;
        }

        console.log({ updateData }, "updateData after setting punch times");

        // Find the record
        const record = await DailyAttendance.findById(currentPunch.attendanceId);
        console.log({ record }, "record");
        if (!record) {
          return errorRresponse(res, 404, "Attendance record not found");
        }

        // Mark record as manually updated
        updateData.isManuallyUpdated = true;

        // Process firstEntry and lastExit timestamps
        if (
          updateData.firstEntry &&
          typeof updateData.firstEntry === "string"
        ) {
          updateData.firstEntry = new Date(updateData.firstEntry);
          console.log(updateData.firstEntry, "updateData.firstEntry");
        }

        if (updateData.lastExit && typeof updateData.lastExit === "string") {
          updateData.lastExit = new Date(updateData.lastExit);
          console.log(updateData.lastExit, "updateData.lastExit");
        }

        // Handle overnight scenario: if exit time is earlier than entry time, add 1 day to exit
        if (updateData.firstEntry && updateData.lastExit) {
          let first = new Date(updateData.firstEntry);
          let last = new Date(updateData.lastExit);
          console.log({ first }, { last }, "first and last");
          
          if (first > last) {
            console.log("Detected overnight work: lastExit is earlier than firstEntry, adding 1 day to lastExit");
            last.setDate(last.getDate() + 1);
            updateData.lastExit = last;
          }
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

          const workDurationMinutes = Math.round((last - first) / (1000 * 60));
          console.log({ workDurationMinutes }, "workDurationMinutes");

          updateData.workDuration = workDurationMinutes;
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
            console.log(updateData.firstEntry, updateData.lastExit, record.expectedCheckinTime, record.expectedCheckoutTime, "updateData.firstEntry and updateData.lastExit");
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
          console.log(
            { expectedCheckoutTime: record.expectedCheckoutTime },
            { lastExit: updateData.lastExit },
            "checkout comparison"
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

          // Add a note about punch request approval
          updateData.remarks += ". Updated via approved punch request.";

          // Add specific note for Day Off
          if (updateData.status === "Day Off") {
            updateData.remarks +=
              " Marked as Day Off (holiday or scheduled leave).";
          }
        }

        console.log({ updateData }, "final updateData");
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
          "Punch request approved and attendance record updated successfully",
          {
            punchRequest: updatedPunch,
            attendanceRecord: updatedRecord
          }
        );
      }
      console.log("No attendance record found to update.");
    }
    
    return successResponse(
      res,
      200,
      "Punch request status updated successfully",
      updatedPunch
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
