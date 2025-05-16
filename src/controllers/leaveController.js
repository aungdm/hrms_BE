const { successResponse, errorRresponse } = require("../utils/response");
const Leave = require("../models/leave");
const Employee = require("../models/employee");

// Create a new leave record
const createLeave = async (req, res) => {
  console.log(req.body, "createLeave");

  try {
    const { employeeId, date, status = "Pending", createdFromAbsence = false } = req.body;

    if (!employeeId || !date) {
      return errorRresponse(res, 400, "Employee ID and date are required");
    }

    // Check if employee exists
    const employee = await Employee.findById(employeeId);
    if (!employee) {
      return errorRresponse(res, 404, "Employee not found");
    }

    // Check if a leave already exists for this employee on this date
    const existingLeave = await Leave.findOne({
      employeeId,
      date: new Date(date),
    });

    if (existingLeave) {
      return errorRresponse(
        res,
        400,
        "A leave record already exists for this employee on this date"
      );
    }

    // Create new leave record
    const newLeave = new Leave({
      employeeId,
      date: new Date(date),
      status: status || "Pending", // Default status is Pending
      createdFromAbsence
    });

    await newLeave.save();

    return successResponse(res, 201, "Leave created successfully", newLeave);
  } catch (error) {
    console.error("Error creating leave:", error);
    return errorRresponse(res, 500, "Error creating leave", error);
  }
} ;

// Get all leave records with pagination and filtering
const getLeaves = async (req, res) => {
  try {
    const {
      page = 1,
      perPage = 10,
      status,
      employeeId,
      startDate,
      endDate,
    } = req.query;

    const query = {};

    if (status) query.status = status;
    if (employeeId) query.employeeId = employeeId;

    if (startDate || endDate) {
      query.date = {};
      if (startDate) query.date.$gte = new Date(startDate);
      if (endDate) query.date.$lte = new Date(endDate);
    }

    const [leaves, total] = await Promise.all([
      Leave.find(query)
        .populate("employeeId", "name employeeId department")
        .sort({ date: -1 })
        .skip((page - 1) * perPage)
        .limit(perPage),
      Leave.countDocuments(query),
    ]);

    return successResponse(res, 200, "Leaves fetched successfully", {
      data: leaves,
      meta: {
        total,
        page: Number(page),
        perPage: Number(perPage),
        totalPages: Math.ceil(total / perPage),
      },
    });
  } catch (error) {
    console.error("Error fetching leaves:", error);
    return errorRresponse(res, 500, "Error fetching leaves", error);
  }
};

// Get a single leave record by ID
const getLeave = async (req, res) => {
  try {
    const { id } = req.params;

    const leave = await Leave.findById(id).populate(
      "employeeId",
      "name employeeId department"
    );

    if (!leave) {
      return errorRresponse(res, 404, "Leave not found");
    }

    return successResponse(res, 200, "Leave fetched successfully", leave);
  } catch (error) {
    console.error("Error fetching leave:", error);
    return errorRresponse(res, 500, "Error fetching leave", error);
  }
};

// Update a leave record
const updateLeave = async (req, res) => {
  try {
    const { id } = req.params;
    const { employeeId, date, status } = req.body;

    // Validate input
    if (!status) {
      return errorRresponse(res, 400, "Status is required for update");
    }

    // Find the current leave record to check if status has changed
    const currentLeave = await Leave.findById(id);
    if (!currentLeave) {
      return errorRresponse(res, 404, "Leave not found");
    }

    const updateData = {};
    if (employeeId) updateData.employeeId = employeeId;
    if (date) updateData.date = new Date(date);
    if (status) updateData.status = status;

    // Update the record
    const updatedLeave = await Leave.findByIdAndUpdate(
      id,
      { $set: updateData },
      { new: true }
    ).populate("employeeId", "name employeeId department");

    if (!updatedLeave) {
      return errorRresponse(res, 404, "Leave not found");
    }

    // Check if status changed to Approved or Rejected
    if (currentLeave.status !== status) {
      // If status changed, update the corresponding daily attendance record
      const DailyAttendance = require("../models/dailyAttendance");
      
      // Find the daily attendance record for this employee on this day
      const attendanceRecord = await DailyAttendance.findOne({
        employeeId: updatedLeave.employeeId,
        date: new Date(updatedLeave.date.setHours(0, 0, 0, 0)),
      });
      
      if (attendanceRecord) {
        const attendanceUpdateData = {
          isManuallyUpdated: true,
          remarks: `Attendance status updated due to leave ${status}.`,
        };
        
        if (status === "Approved") {
          // Update attendance to "Day Off" when leave is approved
          attendanceUpdateData.status = "Day Off";
          attendanceUpdateData.checkinStatus = "Day Off";
          attendanceUpdateData.checkoutStatus = "Day Off";
          attendanceUpdateData.firstEntry = null;
          attendanceUpdateData.lastExit = null;
          attendanceUpdateData.workDuration = 0;
          attendanceUpdateData.lateArrival = 0;
          attendanceUpdateData.earlyDeparture = 0;
          attendanceUpdateData.isOverTime = false;
          attendanceUpdateData.remarks += " Employee is on approved leave.";
        } else if (status === "Rejected" && attendanceRecord.status === "Day Off") {
          // If leave is rejected, and current status is Day Off, set it back to Absent
          attendanceUpdateData.status = "Absent";
          attendanceUpdateData.checkinStatus = "Absent";
          attendanceUpdateData.checkoutStatus = "Absent";
          attendanceUpdateData.remarks += " Leave request rejected, marked as absent.";
        }
        
        // Update the attendance record
        await DailyAttendance.findByIdAndUpdate(
          attendanceRecord._id,
          { $set: attendanceUpdateData },
          { new: true }
        );
        
        console.log(`Updated attendance record for ${updatedLeave.employeeId} on ${updatedLeave.date.toISOString().split('T')[0]} to ${attendanceUpdateData.status} due to leave ${status}`);
      } else {
        console.log(`No attendance record found for ${updatedLeave.employeeId} on ${updatedLeave.date.toISOString().split('T')[0]}`);
      }
    }

    return successResponse(
      res,
      200,
      "Leave updated successfully",
      updatedLeave
    );
  } catch (error) {
    console.error("Error updating leave:", error);
    return errorRresponse(res, 500, "Error updating leave", error);
  }
};

// Delete a leave record
const deleteLeave = async (req, res) => {
  try {
    const { id } = req.params;

    const deletedLeave = await Leave.findByIdAndDelete(id);

    if (!deletedLeave) {
      return errorRresponse(res, 404, "Leave not found");
    }

    return successResponse(
      res,
      200,
      "Leave deleted successfully",
      deletedLeave
    );
  } catch (error) {
    console.error("Error deleting leave:", error);
    return errorRresponse(res, 500, "Error deleting leave", error);
  }
};

// Update leave status
const updateLeaveStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!status || !["Pending", "Approved", "Rejected"].includes(status)) {
      return errorRresponse(res, 400, "Valid status (Pending, Approved, Rejected) is required");
    }

    // Find the current leave record to check if status has changed
    const currentLeave = await Leave.findById(id).populate("employeeId", "name employeeId department");
    if (!currentLeave) {
      return errorRresponse(res, 404, "Leave not found");
    }

    // Don't update if status is the same
    if (currentLeave.status === status) {
      return successResponse(
        res,
        200,
        "Leave status already set",
        currentLeave
      );
    }

    // Update the leave status
    const updatedLeave = await Leave.findByIdAndUpdate(
      id,
      { $set: { status } },
      { new: true }
    ).populate("employeeId", "name employeeId department");

    if (!updatedLeave) {
      return errorRresponse(res, 404, "Leave not found after update");
    }

    // Update the corresponding daily attendance record
    const DailyAttendance = require("../models/dailyAttendance");
    
    // Find the daily attendance record for this employee on this day
    const dateForQuery = new Date(currentLeave.date);
    dateForQuery.setHours(0, 0, 0, 0);
    
    const attendanceRecord = await DailyAttendance.findOne({
      employeeId: updatedLeave.employeeId,
      date: dateForQuery,
    });
    
    let attendanceUpdateMessage = "No attendance record found to update.";
    
    if (attendanceRecord) {
      const attendanceUpdateData = {
        isManuallyUpdated: true,
        remarks: `Attendance status updated due to leave status change to ${status}.`,
      };
      
      if (status === "Approved") {
        // Update attendance to "Day Off" when leave is approved
        attendanceUpdateData.status = "Day Off";
        attendanceUpdateData.checkinStatus = "Day Off";
        attendanceUpdateData.checkoutStatus = "Day Off";
        attendanceUpdateData.firstEntry = null;
        attendanceUpdateData.lastExit = null;
        attendanceUpdateData.workDuration = 0;
        attendanceUpdateData.lateArrival = 0;
        attendanceUpdateData.earlyDeparture = 0;
        attendanceUpdateData.isOverTime = false;
        attendanceUpdateData.remarks += " Employee is on approved leave.";
      } else if (status === "Rejected") {
        // If leave is rejected, set it back to Absent (we only do this if it was previously Day Off)
        if (attendanceRecord.status === "Day Off") {
          attendanceUpdateData.status = "Absent";
          attendanceUpdateData.checkinStatus = "Absent";
          attendanceUpdateData.checkoutStatus = "Absent";
          attendanceUpdateData.remarks += " Leave request rejected, marked as absent.";
        } else {
          // If not Day Off, keep the current status
          attendanceUpdateData.remarks += " Leave request rejected but no change to attendance status.";
        }
      }
      
      // Update the attendance record
      const updatedAttendance = await DailyAttendance.findByIdAndUpdate(
        attendanceRecord._id,
        { $set: attendanceUpdateData },
        { new: true }
      );
      
      attendanceUpdateMessage = `Attendance record updated to ${updatedAttendance.status}.`;
    }

    return successResponse(
      res,
      200,
      `Leave status updated to ${status}. ${attendanceUpdateMessage}`,
      updatedLeave
    );
  } catch (error) {
    console.error("Error updating leave status:", error);
    return errorRresponse(res, 500, "Error updating leave status", error);
  }
};
 
module.exports = {
  createLeave,
  getLeaves,
  getLeave,
  updateLeave,
  deleteLeave,
  updateLeaveStatus
};
