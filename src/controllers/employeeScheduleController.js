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
      return errorRresponse(res, 400, "Employee ID, month, and year are required");
    }
    
    // Find the employee
    const employee = await Employee.findById(employee_id);
    console.log({employee}, "generateEmployeeSchedule")
    if (!employee) {
      return errorRresponse(res, 404, "Employee not found");
    }
    
    // Check if the employee has a time slot assigned
    if (!employee.timeSlot) {
      return errorRresponse(res, 400, "Employee does not have a time slot assigned");
    }
    
    // Find the time slot
    const timeSlot = await WorkSchedule.findById(employee.timeSlot);
    console.log({timeSlot}, "generateEmployeeSchedule")
    if (!timeSlot) {
      return errorRresponse(res, 404, "Time slot not found");
    }
    
    // Check if a schedule already exists for this month/year
    const existingSchedule = await EmployeeSchedule.findOne({
      employee_id,
      month,
      year
    });
    console.log({existingSchedule}, "generateEmployeeSchedule")
    
    if (existingSchedule) {
      return errorRresponse(res, 400, "Schedule already exists for this employee, month, and year");
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
      console.log({isWorkDay}, "generateEmployeeSchedule")
      // Parse shift start and end times
      const [startHour, startMinute] = timeSlot.shiftStart.split(':').map(Number);
      const [endHour, endMinute] = timeSlot.shiftEnd.split(':').map(Number);
      
      // Create start and end datetime objects
      const start = date.clone().hour(startHour).minute(startMinute).second(0);
      const end = date.clone().hour(endHour).minute(endMinute).second(0);
      
      // If end time is earlier than start time, it spans the next day
      const dayChanged = endHour < startHour || (endHour === startHour && endMinute < startMinute);
      if (dayChanged) {
        end.add(1, 'day');
      }
      
      // Calculate duration in minutes
      const durationMinutes = end.diff(start, 'minutes');
      
      // Create schedule entry
      schedules.push({
        date: date.toDate(),
        start: start.toDate(),
        end: end.toDate(),
        day_changed: dayChanged,
        isDayOff: !isWorkDay,
        is_full_overtime_shift: false,
        actual_expected_minutes: durationMinutes,
        notes: isWorkDay ? "Regular work day" : "Day off"
      });
    }
    
    // Create the employee schedule
    const employeeSchedule = new EmployeeSchedule({
      employee_id,
      time_slot_id: timeSlot._id,
      month,
      year,
      schedules
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
    return errorRresponse(res, 500, "Error generating employee schedule", error);
  }
};

// Get employee schedule for a specific month and year
const getEmployeeSchedule = async (req, res) => {
  try {
    const { employee_id, month, year } = req.query;
    console.log({employee_id, month, year}, "getEmployeeSchedule")
    
    // Validate required fields
    if (!employee_id || !month || !year) {
      return errorRresponse(res, 400, "Employee ID, month, and year are required");
    }
    
    // Find the schedule
    const schedule = await EmployeeSchedule.findOne({
      employee_id,
      month,
      year
    }).populate('employee_id', 'name').populate('time_slot_id');
    
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
    return errorRresponse(res, 500, "Error retrieving employee schedule", error);
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
      year
    })
      .populate('employee_id', 'name')
      .populate('time_slot_id')
      .skip((page - 1) * perPage)
      .limit(parseInt(perPage));
    
    // Count total records for pagination
    const total = await EmployeeSchedule.countDocuments({
      month,
      year
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
          totalPages: Math.ceil(total / perPage)
        }
      }
    );
  } catch (error) {
    console.error("Error retrieving employee schedules:", error);
    return errorRresponse(res, 500, "Error retrieving employee schedules", error);
  }
};

// Update a specific day in an employee's schedule
const updateEmployeeScheduleDay = async (req, res) => {
  try {
    const { schedule_id, date, isDayOff, start, end, notes } = req.body;
    
    // Validate required fields
    if (!schedule_id || !date) {
      return errorRresponse(res, 400, "Schedule ID and date are required");
    }
    
    // Find the schedule
    const schedule = await EmployeeSchedule.findById(schedule_id);
    if (!schedule) {
      return errorRresponse(res, 404, "Schedule not found");
    }
    
    // Find the specific day in the schedule
    const dayIndex = schedule.schedules.findIndex(
      s => moment(s.date).format('YYYY-MM-DD') === moment(date).format('YYYY-MM-DD')
    );
    
    if (dayIndex === -1) {
      return errorRresponse(res, 404, "Day not found in schedule");
    }
    
    // Update the day
    if (isDayOff !== undefined) {
      schedule.schedules[dayIndex].isDayOff = isDayOff;
    }
    
    if (start && end) {
      const startDate = moment(start);
      const endDate = moment(end);
      
      // Check if end is before start, indicating day change
      const dayChanged = endDate.isBefore(startDate);
      if (dayChanged) {
        endDate.add(1, 'day');
      }
      
      schedule.schedules[dayIndex].start = startDate.toDate();
      schedule.schedules[dayIndex].end = endDate.toDate();
      schedule.schedules[dayIndex].day_changed = dayChanged;
      schedule.schedules[dayIndex].actual_expected_minutes = endDate.diff(startDate, 'minutes');
    }
    
    if (notes) {
      schedule.schedules[dayIndex].notes = notes;
    }
    
    await schedule.save();
    
    return successResponse(
      res,
      200,
      "Employee schedule day updated successfully",
      schedule
    );
  } catch (error) {
    console.error("Error updating employee schedule day:", error);
    return errorRresponse(res, 500, "Error updating employee schedule day", error);
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
    const employees = await Employee.find({ timeSlot: { $exists: true, $ne: null } });
    console.log({employees}, "generateAllEmployeeSchedules")
    const results = {
      success: [],
      failed: []
    };
    
    // Generate schedules for each employee
    for (const employee of employees) {
      try {
        // Check if a schedule already exists
        const existingSchedule = await EmployeeSchedule.findOne({
          employee_id: employee._id,
          month,
          year
        });
        console.log({existingSchedule}, "generateAllEmployeeSchedules")
        if (existingSchedule) {
          results.failed.push({
            employee_id: employee._id,
            name: employee.name,
            reason: "Schedule already exists"
          });
          continue;
        }
        
        // Find the time slot
        const timeSlot = await WorkSchedule.findById(employee.timeSlot);
        if (!timeSlot) {
          results.failed.push({
            employee_id: employee._id,
            name: employee.name,
            reason: "Time slot not found"
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
          const [startHour, startMinute] = timeSlot.shiftStart.split(':').map(Number);
          const [endHour, endMinute] = timeSlot.shiftEnd.split(':').map(Number);
          
          // Create start and end datetime objects
          const start = date.clone().hour(startHour).minute(startMinute).second(0);
          const end = date.clone().hour(endHour).minute(endMinute).second(0);
          
          // If end time is earlier than start time, it spans the next day
          const dayChanged = endHour < startHour || (endHour === startHour && endMinute < startMinute);
          if (dayChanged) {
            end.add(1, 'day');
          }
          
          // Calculate duration in minutes
          const durationMinutes = end.diff(start, 'minutes');
          
          // Create schedule entry
          schedules.push({
            date: date.toDate(),
            start: start.toDate(),
            end: end.toDate(),
            day_changed: dayChanged,
            isDayOff: !isWorkDay,
            is_full_overtime_shift: false,
            actual_expected_minutes: durationMinutes,
            notes: isWorkDay ? "Regular work day" : "Day off"
          });
        }
        
        // Create the employee schedule
        const employeeSchedule = new EmployeeSchedule({
          employee_id: employee._id,
          time_slot_id: timeSlot._id,
          month,
          year,
          schedules
        });
        
        await employeeSchedule.save();
        
        results.success.push({
          employee_id: employee._id,
          name: employee.name
        });
      } catch (error) {
        console.error(`Error generating schedule for employee ${employee._id}:`, error);
        results.failed.push({
          employee_id: employee._id,
          name: employee.name,
          reason: error.message
        });
      }
    }
    
    return successResponse(
      res,
      200,
      "Employee schedules generated",
      {
        total: employees.length,
        success: results.success.length,
        failed: results.failed.length,
        results
      }
    );
  } catch (error) {
    console.error("Error generating employee schedules:", error);
    return errorRresponse(res, 500, "Error generating employee schedules", error);
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
      console.log(`Employee ${employee._id} does not have a time slot assigned. Skipping schedule generation.`);
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
      year
    });
    
    if (existingSchedule) {
      console.log(`Schedule already exists for employee ${employee._id} for ${year}-${month}`);
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
      const [startHour, startMinute] = timeSlot.shiftStart.split(':').map(Number);
      const [endHour, endMinute] = timeSlot.shiftEnd.split(':').map(Number);
      
      // Create start and end datetime objects
      const start = date.clone().hour(startHour).minute(startMinute).second(0);
      const end = date.clone().hour(endHour).minute(endMinute).second(0);
      
      // If end time is earlier than start time, it spans the next day
      const dayChanged = endHour < startHour || (endHour === startHour && endMinute < startMinute);
      if (dayChanged) {
        end.add(1, 'day');
      }
      
      // Calculate duration in minutes
      const durationMinutes = end.diff(start, 'minutes');
      
      // Create schedule entry
      schedules.push({
        date: date.toDate(),
        start: start.toDate(),
        end: end.toDate(),
        day_changed: dayChanged,
        isDayOff: !isWorkDay,
        is_full_overtime_shift: false,
        actual_expected_minutes: durationMinutes,
        notes: isWorkDay ? "Regular work day" : "Day off"
      });
    }
    
    // Create the employee schedule
    const employeeSchedule = new EmployeeSchedule({
      employee_id: employee._id,
      time_slot_id: timeSlot._id,
      month,
      year,
      schedules
    });
    
    await employeeSchedule.save();
    console.log(`Schedule generated for employee ${employee._id} for ${year}-${month}`);
    return employeeSchedule;
  } catch (error) {
    console.error(`Error generating schedule for employee ${employee._id}:`, error);
    return null;
  }
};

module.exports = {
  generateEmployeeSchedule,
  getEmployeeSchedule,
  getAllEmployeeSchedules,
  updateEmployeeScheduleDay,
  generateAllEmployeeSchedules,
  deleteEmployeeSchedule,
  generateScheduleForNewEmployee
}; 