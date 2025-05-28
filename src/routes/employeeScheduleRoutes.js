const express = require("express");
const router = express.Router();
const {
  generateEmployeeSchedule,
  getEmployeeSchedule,
  getAllEmployeeSchedules,
  updateEmployeeScheduleDay,
  updateMultipleEmployeeScheduleDays,
  generateAllEmployeeSchedules,
  deleteEmployeeSchedule,
  revertEmployeeSchedulesToDefault
} = require("../controllers/employeeScheduleController");

// Generate a schedule for a specific employee
router.post("/generate", generateEmployeeSchedule);

// Generate schedules for all employees
router.post("/generate-all", generateAllEmployeeSchedules);

// Get a schedule for a specific employee
router.get("/employee", getEmployeeSchedule);

// Get all employee schedules
router.get("/", getAllEmployeeSchedules);

// Update a specific day in an employee's schedule
router.put("/update-day", updateEmployeeScheduleDay);

// Batch update multiple days across different employee schedules
router.put("/update-multiple", updateMultipleEmployeeScheduleDays);

// Delete an employee schedule
router.delete("/:id", deleteEmployeeSchedule);

// Add route for reverting schedules to default
router.post("/revert", revertEmployeeSchedulesToDefault);

module.exports = router; 