const moment = require("moment");
const { successResponse, errorRresponse } = require("../utils/response");
const EmployeeSchedule = require("../models/employeeSchedule");
const Employee = require("../models/employee");
const Scheduling = require("../models/scheduling");
const WorkSchedule = require("../models/workSchedule");

// Generate a monthly schedule for an employee
const generateEmployeeSchedule = async (req, res) => {
  try {
    const { employee_id, month, year } = req.body;

    // Validate required fields
    if (!employee_id || !month || !year) {
      return errorRresponse(
        res,
        400,
        "Employee ID, month, and year are required"
      );
    }

    // Find the employee
    const employee = await Employee.findById(employee_id);
    console.log({ employee }, "generateEmployeeSchedule");
    if (!employee) {
      return errorRresponse(res, 404, "Employee not found");
    }

    // Check if the employee has a time slot assigned
    if (!employee.timeSlot) {
      return errorRresponse(
        res,
        400,
        "Employee does not have a time slot assigned"
      );
    }

    // Find the time slot
    const timeSlot = await WorkSchedule.findById(employee.timeSlot);
    console.log({ timeSlot }, "generateEmployeeSchedule");
    if (!timeSlot) {
      return errorRresponse(res, 404, "Time slot not found");
    }

    // Check if a schedule already exists for this month/year
    const existingSchedule = await EmployeeSchedule.findOne({
      employee_id,
      month,
      year,
    });
    console.log({ existingSchedule }, "generateEmployeeSchedule");

    if (existingSchedule) {
      return errorRresponse(
        res,
        400,
        "Schedule already exists for this employee, month, and year"
      );
    }

    // Generate schedule for the month
    const firstDay = moment(`${year}-${month}-01`);
    const daysInMonth = firstDay.daysInMonth();

    const schedules = [];

    for (let day = 1; day <= daysInMonth; day++) {
      const date = moment(`${year}-${month}-${day}`);
      const dayOfWeek = date.day(); // 0 = Sunday, 1 = Monday, etc.

      // Check if this is a work day for the employee
      const isWorkDay = employee.workDays.includes(dayOfWeek);
      console.log({ isWorkDay }, "generateEmployeeSchedule");
      // Parse shift start and end times
      const [startHour, startMinute] = timeSlot.shiftStart
        .split(":")
        .map(Number);
      const [endHour, endMinute] = timeSlot.shiftEnd.split(":").map(Number);

      // Create start and end datetime objects
      const start = date.clone().hour(startHour).minute(startMinute).second(0);
      const end = date.clone().hour(endHour).minute(endMinute).second(0);

      // If end time is earlier than start time, it spans the next day
      const dayChanged =
        endHour < startHour ||
        (endHour === startHour && endMinute < startMinute);
      if (dayChanged) {
        end.add(1, "day");
      }

      // Calculate duration in minutes
      const durationMinutes = end.diff(start, "minutes");

      // Create schedule entry
      schedules.push({
        date: date.toDate(),
        start: start.toDate(),
        end: end.toDate(),
        day_changed: dayChanged,
        isDayOff: !isWorkDay,
        is_full_overtime_shift: false,
        actual_expected_minutes: durationMinutes,
        notes: isWorkDay ? "Regular work day" : "Day off",
        time_slot_id: timeSlot._id,
      });
    }

    // Create the employee schedule
    const employeeSchedule = new EmployeeSchedule({
      employee_id,
      month,
      year,
      schedules,
    });

    await employeeSchedule.save();

    return successResponse(
      res,
      201,
      "Employee schedule generated successfully",
      employeeSchedule
    );
  } catch (error) {
    console.error("Error generating employee schedule:", error);
    return errorRresponse(
      res,
      500,
      "Error generating employee schedule",
      error
    );
  }
};

// Get employee schedule for a specific month and year
const getEmployeeSchedule = async (req, res) => {
  try {
    const { employee_id, month, year } = req.query;
    console.log({ employee_id, month, year }, "getEmployeeSchedule");

    // Validate required fields
    if (!employee_id || !month || !year) {
      return errorRresponse(
        res,
        400,
        "Employee ID, month, and year are required"
      );
    }

    // Find the schedule
    const schedule = await EmployeeSchedule.findOne({
      employee_id,
      month,
      year,
    }).populate("employee_id", "name");
    // .populate("time_slot_id");

    if (!schedule) {
      return errorRresponse(res, 404, "Schedule not found");
    }

    return successResponse(
      res,
      200,
      "Employee schedule retrieved successfully",
      schedule
    );
  } catch (error) {
    console.error("Error retrieving employee schedule:", error);
    return errorRresponse(
      res,
      500,
      "Error retrieving employee schedule",
      error
    );
  }
};

// Get all employees schedules with pagination
const getAllEmployeeSchedules = async (req, res) => {
  try {
    const { month, year, page = 1, perPage = 10 } = req.query;

    // Validate required fields
    if (!month || !year) {
      return errorRresponse(res, 400, "Month and year are required");
    }

    // Find all schedules for the month and year
    const schedules = await EmployeeSchedule.find({
      month,
      year,
    })
      .populate("employee_id", "name user_defined_code")
      // .populate("time_slot_id")
      .skip((page - 1) * perPage)
      .limit(parseInt(perPage));

    // Count total records for pagination
    const total = await EmployeeSchedule.countDocuments({
      month,
      year,
    });

    return successResponse(
      res,
      200,
      "Employee schedules retrieved successfully",
      {
        data: schedules,
        meta: {
          total,
          page: Number(page),
          perPage: Number(perPage),
          totalPages: Math.ceil(total / perPage),
        },
      }
    );
  } catch (error) {
    console.error("Error retrieving employee schedules:", error);
    return errorRresponse(
      res,
      500,
      "Error retrieving employee schedules",
      error
    );
  }
};

// Update a specific day in an employee's schedule
const updateEmployeeScheduleDay = async (req, res) => {
  try {
    console.log('updateEmployeeScheduleDay function called', req.body); // Log start and request body
    const { schedule_id, date, isDayOff, notes, time_slot_id } = req.body;
 

    // Validate required fields
    if (!schedule_id || !date) {
      console.log('Validation failed: Missing schedule_id or date'); // Log validation failure
      return errorRresponse(res, 400, "Schedule ID and date are required");
    }
    console.log('Validation passed.'); // Log validation success

    // Find the schedule
    const schedule = await EmployeeSchedule.findById(schedule_id);
    if (!schedule) {
      console.log(`Schedule not found for ID: ${schedule_id}`); // Log schedule not found
      return errorRresponse(res, 404, "Schedule not found");
    }
    console.log(`Schedule found for ID: ${schedule_id}`); // Log schedule found

    // Find the specific day in the schedule
    const dayIndex = schedule.schedules.findIndex(
      (s) =>
        moment(s.date).format("YYYY-MM-DD") ===
        moment(date).format("YYYY-MM-DD")
    );
    console.log(`Searching for day ${moment(date).format("YYYY-MM-DD")}. Found at index: ${dayIndex}`); // Log day search result

    if (dayIndex === -1) {
      console.log(`Day not found in schedule for date: ${date}`); // Log day not found
      return errorRresponse(res, 404, "Day not found in schedule");
    }
    console.log(`Day found at index ${dayIndex}. Original day data:`, schedule.schedules[dayIndex]); // Log day found and its data

    // Update the day
    console.log('Checking isDayOff:', isDayOff); // Log isDayOff check
    if (isDayOff !== undefined) {
      schedule.schedules[dayIndex].isDayOff = isDayOff;
      console.log(`Set isDayOff to ${isDayOff}`); // Log setting isDayOff

      // If marking as day off, clear all scheduling-related fields
      if (isDayOff) {
        console.log('Marking day as off. Clearing schedule fields.'); // Log clearing fields for day off
        // Keep only necessary fields for a day off
        const dateObj = moment(date).toDate();

        // Reset all scheduling-related fields
        schedule.schedules[dayIndex].start = null;
        schedule.schedules[dayIndex].end = null;
        schedule.schedules[dayIndex].day_changed = false;
        schedule.schedules[dayIndex].is_full_overtime_shift = false;
        schedule.schedules[dayIndex].actual_expected_minutes = 0;
        schedule.schedules[dayIndex].time_slot_id = null;
        console.log('Schedule fields cleared for day off.'); // Log fields cleared

        // Set a note if none provided
        if (!notes) {
          schedule.schedules[dayIndex].notes = "Day off";
          console.log('No notes provided, setting default note for day off.'); // Log default note
        }

        // Skip further processing since this is a day off
        if (notes) {
          schedule.schedules[dayIndex].notes = notes;
          console.log('Notes provided for day off:', notes); // Log provided notes
        }

        console.log('Saving schedule after marking as day off:', schedule.schedules[dayIndex]); // Log schedule before saving day off
        await schedule.save();
        console.log('Schedule saved after marking as day off.'); // Log save success

        return successResponse(
          res,
          200,
          "Employee schedule day marked as day off",
          schedule
        );
      }
    }
    console.log('isDayOff check complete. isDayOff was:', isDayOff); // Log after isDayOff block

    // If time_slot_id is provided and it's not a day off, fetch the time slot details and use them
    console.log('Checking time_slot_id and isDayOff:', { time_slot_id, isDayOff }); // Log check for time_slot_id and !isDayOff
    if (time_slot_id && (!isDayOff || isDayOff === false)) {
      console.log('time_slot_id provided and not a day off. Processing time slot.'); // Log entering time slot processing block
      try {
        // Find the work schedule with the given time_slot_id
        const workSchedule = await WorkSchedule.findById(time_slot_id);
        console.log({ workSchedule }, "workSchedule"); // Log workSchedule details

        if (workSchedule) {
          console.log('Work schedule found. Parsing times.'); // Log work schedule found
          // Parse the shiftStart and shiftEnd from the work schedule
          const [startHour, startMinute] = workSchedule.shiftStart
            .split(":")
            .map(Number);
          const [endHour, endMinute] = workSchedule.shiftEnd
            .split(":")
            .map(Number);
          console.log(`Parsed times: startHour=${startHour}, startMinute=${startMinute}, endHour=${endHour}, endMinute=${endMinute}`); // Log parsed times

          // Create the date objects for start and end times
          const dateObj = moment(date);
          const startDate = dateObj
            .clone()
            .hour(startHour)
            .minute(startMinute)
            .second(0);
          const endDate = dateObj
            .clone()
            .hour(endHour)
            .minute(endMinute)
            .second(0);
          console.log('Created start and end date objects:', { startDate: startDate.toDate(), endDate: endDate.toDate() }); // Log date objects

          // Check if end time is before start time (spans to next day)
          const dayChanged =
            endHour < startHour ||
            (endHour === startHour && endMinute < startMinute);
          if (dayChanged) {
            endDate.add(1, "day");
            console.log('Day changed detected. Added 1 day to end date.'); // Log day changed
          }
          console.log('dayChanged:', dayChanged); // Log dayChanged status

          // Update the schedule with the calculated times
          schedule.schedules[dayIndex].start = startDate.toDate();
          schedule.schedules[dayIndex].end = endDate.toDate();
          schedule.schedules[dayIndex].day_changed = dayChanged;
          schedule.schedules[dayIndex].time_slot_id = time_slot_id;
          schedule.schedules[dayIndex].actual_expected_minutes =
                endDate.diff(startDate, "minutes");
          schedule.schedules[dayIndex].is_full_overtime_shift = false;
          console.log('Updated schedule fields with time slot data:', schedule.schedules[dayIndex]); // Log updated fields

          // Add a note about the schedule if none is provided
          if (!notes) {
            schedule.schedules[
              dayIndex
            ].notes = `Using schedule: ${workSchedule.name}`;
            console.log('No notes provided, setting default note from work schedule.'); // Log default note from work schedule
          }
        } else {
           console.log(`Work schedule not found for time_slot_id: ${time_slot_id}`); // Log work schedule not found
        }
      } catch (error) {
        console.error("Error processing time slot for schedule update:", error); // Log time slot processing error
        return errorRresponse(
          res,
          500,
          "Error processing time slot for schedule update",
          error
        );
      }
      console.log('Time slot processing complete.'); // Log end of time slot processing block
    }

    // Update notes if provided
    console.log('Checking if notes are provided:', notes); // Log check for notes
    if (notes) {
      schedule.schedules[dayIndex].notes = notes;
      console.log('Notes provided, setting notes:', notes); // Log setting notes
    }

    console.log({ schedule }, "schedule save before"); // Log schedule before saving
    await schedule.save();
    console.log('Schedule saved successfully.'); // Log save success

    return successResponse(
      res,
      200,
      "Employee schedule day updated successfully",
      schedule
    );
  } catch (error) {
    console.error("Error updating employee schedule day:", error); // Log general error
    return errorRresponse(
      res,
      500,
      "Error updating employee schedule day",
      error
    );
  }
};

// Generate schedules for all employees for a specific month and year
const generateAllEmployeeSchedules = async (req, res) => {
  try {
    const { month, year } = req.body;

    // Validate required fields
    if (!month || !year) {
      return errorRresponse(res, 400, "Month and year are required");
    }

    // Find all employees with assigned time slots
    const employees = await Employee.find({
      timeSlot: { $exists: true, $ne: null },
    });
    console.log({ employees }, "generateAllEmployeeSchedules");
    const results = {
      success: [],
      failed: [],
    };

    // Generate schedules for each employee
    for (const employee of employees) {
      try {
        // Check if a schedule already exists
        const existingSchedule = await EmployeeSchedule.findOne({
          employee_id: employee._id,
          month,
          year,
        });
        console.log({ existingSchedule }, "generateAllEmployeeSchedules");
        if (existingSchedule) {
          results.failed.push({
            employee_id: employee._id,
            name: employee.name,
            reason: "Schedule already exists",
          });
          continue;
        }

        // Find the time slot
        const timeSlot = await WorkSchedule.findById(employee.timeSlot);
        console.log({ timeSlot }, "timeSlot");
        if (!timeSlot) {
          results.failed.push({
            employee_id: employee._id,
            name: employee.name,
            reason: "Time slot not found",
          });
          continue;
        }

        // Generate schedule for the month
        const firstDay = moment(`${year}-${month}-01`);
        const daysInMonth = firstDay.daysInMonth();

        const schedules = [];

        for (let day = 1; day <= daysInMonth; day++) {
          const date = moment(`${year}-${month}-${day}`);
          const dayOfWeek = date.day(); // 0 = Sunday, 1 = Monday, etc.

          // Check if this is a work day for the employee
          const isWorkDay = employee.workDays.includes(dayOfWeek);

          // Parse shift start and end times
          const [startHour, startMinute] = timeSlot.shiftStart
            .split(":")
            .map(Number);
          const [endHour, endMinute] = timeSlot.shiftEnd.split(":").map(Number);

          // Create start and end datetime objects
          const start = date
            .clone()
            .hour(startHour)
            .minute(startMinute)
            .second(0);
          const end = date.clone().hour(endHour).minute(endMinute).second(0);

          // If end time is earlier than start time, it spans the next day
          const dayChanged =
            endHour < startHour ||
            (endHour === startHour && endMinute < startMinute);
          if (dayChanged) {
            end.add(1, "day");
          }

          // Calculate duration in minutes
          const durationMinutes = end.diff(start, "minutes");

          // Create schedule entry
          schedules.push({
            date: date.toDate(),
            start: start.toDate(),
            end: end.toDate(),
            day_changed: dayChanged,
            isDayOff: !isWorkDay,
            is_full_overtime_shift: false,
            actual_expected_minutes: durationMinutes,
            notes: isWorkDay ? "Regular work day" : "Day off",
            time_slot_id: timeSlot._id,
          });
        }

        // Create the employee schedule
        const employeeSchedule = new EmployeeSchedule({
          employee_id: employee._id,
          month,
          year,
          schedules,
        });

        console.log({ employeeSchedule }, "employeeSchedule");
        await employeeSchedule.save();

        results.success.push({
          employee_id: employee._id,
          name: employee.name,
        });
      } catch (error) {
        console.error(
          `Error generating schedule for employee ${employee._id}:`,
          error
        );
        results.failed.push({
          employee_id: employee._id,
          name: employee.name,
          reason: error.message,
        });
      }
    }

    return successResponse(res, 200, "Employee schedules generated", {
      total: employees.length,
      success: results.success.length,
      failed: results.failed.length,
      results,
    });
  } catch (error) {
    console.error("Error generating employee schedules:", error);
    return errorRresponse(
      res,
      500,
      "Error generating employee schedules",
      error
    );
  }
};

// Delete an employee schedule
const deleteEmployeeSchedule = async (req, res) => {
  try {
    const { id } = req.params;

    const schedule = await EmployeeSchedule.findByIdAndDelete(id);
    if (!schedule) {
      return errorRresponse(res, 404, "Schedule not found");
    }

    return successResponse(
      res,
      200,
      "Employee schedule deleted successfully",
      schedule
    );
  } catch (error) {
    console.error("Error deleting employee schedule:", error);
    return errorRresponse(res, 500, "Error deleting employee schedule", error);
  }
};

// Generate a schedule automatically when an employee is created or updated
// This function will be called from the employee controller
const generateScheduleForNewEmployee = async (employee) => {
  try {
    // Only proceed if the employee has a time slot
    if (!employee.timeSlot) {
      console.log(
        `Employee ${employee._id} does not have a time slot assigned. Skipping schedule generation.`
      );
      return null;
    }

    // Get the current month and year
    const now = moment();
    const month = now.month() + 1; // moment months are 0-indexed
    const year = now.year();

    // Check if a schedule already exists
    const existingSchedule = await EmployeeSchedule.findOne({
      employee_id: employee._id,
      month,
      year,
    });

    if (existingSchedule) {
      console.log(
        `Schedule already exists for employee ${employee._id} for ${year}-${month}`
      );
      return existingSchedule;
    }

    // Find the time slot
    const timeSlot = await Scheduling.findById(employee.timeSlot);
    if (!timeSlot) {
      console.log(`Time slot not found for employee ${employee._id}`);
      return null;
    }

    // Generate schedule for the month
    const firstDay = moment(`${year}-${month}-01`);
    const daysInMonth = firstDay.daysInMonth();

    const schedules = [];

    for (let day = 1; day <= daysInMonth; day++) {
      const date = moment(`${year}-${month}-${day}`);
      const dayOfWeek = date.day(); // 0 = Sunday, 1 = Monday, etc.

      // Check if this is a work day for the employee
      const isWorkDay = timeSlot.workDays.includes(dayOfWeek);

      // Parse shift start and end times
      const [startHour, startMinute] = timeSlot.shiftStart
        .split(":")
        .map(Number);
      const [endHour, endMinute] = timeSlot.shiftEnd.split(":").map(Number);

      // Create start and end datetime objects
      const start = date.clone().hour(startHour).minute(startMinute).second(0);
      const end = date.clone().hour(endHour).minute(endMinute).second(0);

      // If end time is earlier than start time, it spans the next day
      const dayChanged =
        endHour < startHour ||
        (endHour === startHour && endMinute < startMinute);
      if (dayChanged) {
        end.add(1, "day");
      }

      // Calculate duration in minutes
      const durationMinutes = end.diff(start, "minutes");

      // Create schedule entry
      schedules.push({
        date: date.toDate(),
        start: start.toDate(),
        end: end.toDate(),
        day_changed: dayChanged,
        isDayOff: !isWorkDay,
        is_full_overtime_shift: false,
        actual_expected_minutes: durationMinutes,
        notes: isWorkDay ? "Regular work day" : "Day off",
        time_slot_id: timeSlot._id,
      });
    }

    // Create the employee schedule
    const employeeSchedule = new EmployeeSchedule({
      employee_id: employee._id,
      month,
      year,
      schedules,
    });

    await employeeSchedule.save();
    console.log(
      `Schedule generated for employee ${employee._id} for ${year}-${month}`
    );
    return employeeSchedule;
  } catch (error) {
    console.error(
      `Error generating schedule for employee ${employee._id}:`,
      error
    );
    return null;
  }
};

// Update multiple days across different employee schedules
const updateMultipleEmployeeScheduleDays = async (req, res) => {
  try {
    const { schedules } = req.body;

    // Validate required fields
    if (!schedules || !Array.isArray(schedules) || schedules.length === 0) {
      return errorRresponse(
        res,
        400,
        "Schedules array is required and must not be empty"
      );
    }

    console.log(
      "Received batch update request for schedules:",
      schedules.length
    );

    const results = {
      success: [],
      failed: [],
    };

    // Process each schedule update
    for (const scheduleData of schedules) {
      try {
        const { schedule_id, date, isDayOff, time_slot_id, notes } =
          scheduleData;

        // Skip invalid entries
        if (!schedule_id || !date) {
          results.failed.push({
            schedule_id,
            date,
            reason: "Missing required fields (schedule_id and date)",
          });
          continue;
        }

        // Find the schedule
        const schedule = await EmployeeSchedule.findById(schedule_id);
        if (!schedule) {
          results.failed.push({
            schedule_id,
            date,
            reason: "Schedule not found",
          });
          continue;
        }

        // Find the specific day in the schedule
        const dayIndex = schedule.schedules.findIndex(
          (s) =>
            moment(s.date).format("YYYY-MM-DD") ===
            moment(date).format("YYYY-MM-DD")
        );

        if (dayIndex === -1) {
          results.failed.push({
            schedule_id,
            date,
            reason: "Day not found in schedule",
          });
          continue;
        }

        // Update day off status if provided
        if (isDayOff !== undefined) {
          schedule.schedules[dayIndex].isDayOff = isDayOff;

          // If marking as day off, clear all scheduling-related fields
          if (isDayOff) {
            // Reset all scheduling-related fields
            schedule.schedules[dayIndex].start = null;
            schedule.schedules[dayIndex].end = null;
            schedule.schedules[dayIndex].day_changed = false;
            schedule.schedules[dayIndex].is_full_overtime_shift = false;
            schedule.schedules[dayIndex].actual_expected_minutes = 0;
            schedule.schedules[dayIndex].time_slot_id = null;

            // Set a note if none provided
            if (!notes) {
              schedule.schedules[dayIndex].notes = "Day off";
            }
          }
        }

        // Process time slot if provided and not a day off
        if (time_slot_id && (!isDayOff || isDayOff === false)) {
          try {
            // Find the work schedule with the given time_slot_id
            const workSchedule = await WorkSchedule.findById(time_slot_id);

            if (workSchedule) {
              // Parse the shiftStart and shiftEnd from the work schedule
              const [startHour, startMinute] = workSchedule.shiftStart
                .split(":")
                .map(Number);
              const [endHour, endMinute] = workSchedule.shiftEnd
                .split(":")
                .map(Number);

              // Create the date objects for start and end times
              const dateObj = moment(date);
              const startDate = dateObj
                .clone()
                .hour(startHour)
                .minute(startMinute)
                .second(0);
              const endDate = dateObj
                .clone()
                .hour(endHour)
                .minute(endMinute)
                .second(0);

              // Check if end time is before start time (spans to next day)
              const dayChanged =
                endHour < startHour ||
                (endHour === startHour && endMinute < startMinute);
              if (dayChanged) {
                endDate.add(1, "day");
              }

              // Update the schedule with the calculated times
              schedule.schedules[dayIndex].start = startDate.toDate();
              schedule.schedules[dayIndex].end = endDate.toDate();
              schedule.schedules[dayIndex].day_changed = dayChanged;
              schedule.schedules[dayIndex].time_slot_id = time_slot_id;
              schedule.schedules[dayIndex].actual_expected_minutes =
                endDate.diff(startDate, "minutes");
              schedule.schedules[dayIndex].is_full_overtime_shift = false;

              // Add a note about the schedule if none is provided
              if (!notes) {
                schedule.schedules[
                  dayIndex
                ].notes = `Using schedule: ${workSchedule.name}`;
              }
            }
          } catch (error) {
            console.error(
              `Error processing time slot for schedule ${schedule_id}:`,
              error
            );
            results.failed.push({
              schedule_id,
              date,
              reason: "Error processing time slot",
            });
            continue;
          }
        }

        // Update notes if provided
        if (notes) {
          schedule.schedules[dayIndex].notes = notes;
        }

        // Save the schedule
        await schedule.save();

        // Add to success results
        results.success.push({
          schedule_id,
          date,
          employee_id: schedule.employee_id,
        });
      } catch (error) {
        console.error(`Error updating schedule:`, error);
        results.failed.push({
          schedule_id: scheduleData.schedule_id,
          date: scheduleData.date,
          reason: error.message || "Unknown error",
        });
      }
    }

    return successResponse(res, 200, "Batch update completed", {
      total: schedules.length,
      success: results.success.length,
      failed: results.failed.length,
      results,
    });
  } catch (error) {
    console.error("Error in batch update of employee schedules:", error);
    return errorRresponse(res, 500, "Error updating employee schedules", error);
  }
};
// Add the new controller function here
const revertEmployeeSchedulesToDefault = async (req, res) => {
  try {
    const { employee_ids, month, year } = req.body;

    // Validate required fields
    if (!employee_ids || !Array.isArray(employee_ids) || employee_ids.length === 0 || !month || !year) {
      return errorRresponse(
        res,
        400,
        "Employee IDs (as an array), month, and year are required"
      );
    }

    const results = {
      success: [],
      failed: [],
    };

    for (const employee_id of employee_ids) {
      try {
        // 1. Find and delete the existing schedule
        const deleteResult = await EmployeeSchedule.deleteOne({
          employee_id,
          month,
          year,
        });

        console.log(`Deleted schedule for employee ${employee_id}:`, deleteResult.deletedCount > 0 ? "Yes" : "No");

        // 2. Find the employee and their time slot
        const employee = await Employee.findById(employee_id);

        if (!employee) {
          results.failed.push({
            employee_id,
            reason: "Employee not found",
          });
          continue;
        }

        // Check if the employee has a time slot assigned
        if (!employee.timeSlot) {
          results.failed.push({
            employee_id,
            name: employee.name,
            reason: "Employee does not have a time slot assigned",
          });
          continue;
        }

        // Find the time slot
        const timeSlot = await WorkSchedule.findById(employee.timeSlot);

        if (!timeSlot) {
           results.failed.push({
             employee_id,
             name: employee.name,
             reason: "Time slot not found for employee",
           });
           continue;
        }

        // 3. Generate the default schedule for the month
        const firstDay = moment(`${year}-${month}-01`);
        const daysInMonth = firstDay.daysInMonth();
        const schedules = [];

        for (let day = 1; day <= daysInMonth; day++) {
          const date = moment(`${year}-${month}-${day}`);
          const dayOfWeek = date.day(); // 0 = Sunday, 1 = Monday, etc.

          // Check if this is a work day for the employee
          const isWorkDay = employee.workDays.includes(dayOfWeek);

          // Parse shift start and end times
          const [startHour, startMinute] = timeSlot.shiftStart
            .split(":")
            .map(Number);
          const [endHour, endMinute] = timeSlot.shiftEnd.split(":").map(Number);

          // Create start and end datetime objects
          const start = date.clone().hour(startHour).minute(startMinute).second(0);
          const end = date.clone().hour(endHour).minute(endMinute).second(0);

          // If end time is earlier than start time, it spans the next day
          const dayChanged = endHour < startHour || (endHour === startHour && endMinute < startMinute);
          if (dayChanged) {
            end.add(1, "day");
          }

          // Calculate duration in minutes
          const durationMinutes = end.diff(start, "minutes");

          // Create schedule entry
          schedules.push({
            date: date.toDate(),
            start: start.toDate(),
            end: end.toDate(),
            day_changed: dayChanged,
            isDayOff: !isWorkDay,
            is_full_overtime_shift: false,
            actual_expected_minutes: durationMinutes,
            notes: isWorkDay ? "Regular work day (Default)" : "Day off (Default)",
            time_slot_id: timeSlot._id,
          });
        }

        // 4. Create and save the new default schedule
        const newEmployeeSchedule = new EmployeeSchedule({
          employee_id,
          month,
          year,
          schedules,
        });

        await newEmployeeSchedule.save();

        results.success.push({
          employee_id,
          name: employee.name,
        });

      } catch (error) {
        console.error(`Error reverting schedule for employee ${employee_id}:`, error);
        const employee = await Employee.findById(employee_id);
        results.failed.push({
          employee_id,
          name: employee ? employee.name : "Unknown Employee",
          reason: error.message || "Unknown error",
        });
      }
    }

    return successResponse(res, 200, "Revert schedules operation completed", {
      total: employee_ids.length,
      success: results.success.length,
      failed: results.failed.length,
      results,
    });

  } catch (error) {
    console.error("Error in reverting employee schedules:", error);
    return errorRresponse(
      res,
      500,
      "Error reverting employee schedules",
      error
    );
  }
};

// Process attendance for a specific month
const processMonthAttendance = async (req, res) => {
  try {
    const { month, year, employeeId, forceReprocess = false } = req.body;
    
    if (!month || !year) {
      return errorRresponse(res, 400, "Month and year are required");
    }
    
    // Create date range for the entire month
    const startDate = moment({ year, month: month - 1, day: 1 }).startOf('day').toDate();
    const endDate = moment({ year, month: month - 1 }).endOf('month').toDate();
    
    console.log(`Processing attendance for ${moment(startDate).format('MMMM YYYY')} (${startDate.toISOString()} to ${endDate.toISOString()})`);
    console.log(`Days in month: ${moment(startDate).daysInMonth()}`);
    
    // Prepare employee filter if specified
    const employeeFilter = employeeId ? [employeeId] : null;
    
    // If forceReprocess is true, mark all attendance logs for this period as unprocessed
    if (forceReprocess) {
      console.log('Force reprocess option enabled - marking logs as unprocessed');
      
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
      const AttendanceLog = require('../models/attendanceLogs');
      const updateResult = await AttendanceLog.updateMany(
        logsQuery,
        { $set: { isProcessed: false } }
      );
      
      console.log(`Marked ${updateResult.modifiedCount} logs as unprocessed`);
      
      // Delete existing daily attendance records for this period
      const DailyAttendance = require('../models/dailyAttendance');
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
    
    // Import the attendance processor
    const { processAttendanceLogs, verifyMonthAttendance } = require('../utils/attendanceProcessor');
    
    // Process the month's attendance
    console.log('Step 1: Processing attendance logs');
    const result = await processAttendanceLogs(startDate, endDate, employeeFilter);
    
    // Run a dedicated verification step to ensure all days have records
    console.log('Step 2: Running verification to ensure all days have attendance records');
    const verificationResult = await verifyMonthAttendance(startDate, endDate, employeeFilter);
    
    // Combine results
    const combinedResult = {
      ...result,
      created: result.created + verificationResult.recordsCreated,
      absentsCreated: (result.absentsCreated || 0) + verificationResult.absentsCreated,
      missingDaysFixed: verificationResult.recordsCreated,
      verificationDetails: verificationResult
    };
    
    return successResponse(res, 200, "Monthly attendance processed successfully", {
      month,
      year,
      startDate,
      endDate,
      daysInMonth: moment(startDate).daysInMonth(),
      ...combinedResult
    });
  } catch (error) {
    console.error("Error processing monthly attendance:", error);
    return errorRresponse(res, 500, "Error processing monthly attendance", error);
  }
};

// Export functions
module.exports = {
  generateEmployeeSchedule,
  getEmployeeSchedule,
  getAllEmployeeSchedules,
  updateEmployeeScheduleDay,
  generateAllEmployeeSchedules,
  deleteEmployeeSchedule,
  generateScheduleForNewEmployee,
  updateMultipleEmployeeScheduleDays,
  revertEmployeeSchedulesToDefault,
  processMonthAttendance
};


