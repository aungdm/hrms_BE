const express = require("express");
const router = express.Router();

// Import controllers
const payrollController = require("../controllers/payRollController");

// Root level route to get all payrolls (both hourly and monthly)
router.get("/", payrollController.listAllPayrolls);

// Get unprocessed incentives for an employee
router.get("/unprocessed-incentives", payrollController.getUnprocessedIncentives);

// Hourly Employee Payroll Routes
// Generate payroll for hourly employees within date range
router.post("/hourly/generate", payrollController.generateHourlyPayroll);
// Get list of hourly payrolls with filtering options
router.get("/hourly", payrollController.listHourlyPayrolls);
// Get specific hourly payroll details
router.get("/hourly/:id", payrollController.getHourlyPayrollById);
// Update hourly payroll
router.put("/hourly/:id", payrollController.updateHourlyPayroll);
// Delete hourly payroll
router.delete("/hourly/:id", payrollController.deleteHourlyPayroll);
// Get payslip for specific hourly employee payroll
router.get("/hourly/:id/payslip", payrollController.getHourlyPayslip);

// Monthly Employee Payroll Routes
// Generate payroll for monthly employees within date range
router.post("/monthly/generate", payrollController.generateMonthlyPayroll);
// Get list of monthly payrolls with filtering options
router.get("/monthly", payrollController.listMonthlyPayrolls);
// Get specific monthly payroll details
router.get("/monthly/:id", payrollController.getMonthlyPayrollById);
// Update monthly payroll
router.put("/monthly/:id", payrollController.updateMonthlyPayroll);
// Delete monthly payroll
router.delete("/monthly/:id", payrollController.deleteMonthlyPayroll);
// Get payslip for specific monthly employee payroll
router.get("/monthly/:id/payslip", payrollController.getMonthlyPayslip);

module.exports = router;

