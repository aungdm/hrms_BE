const express = require("express");
const router = express.Router();
const payRollController = require("../controllers/payRollController");

// Generate payroll for specified date range and employees
router.post("/generate", payRollController.generatePayroll);

// Get payroll records with filtering and pagination
router.get("/", payRollController.getPayrolls);

// Get a single payroll record by ID
router.get("/:id", payRollController.getPayrollById);

// Update a payroll record
router.put("/:id", payRollController.updatePayroll);

// Delete a payroll record (usually only drafts can be deleted)
router.delete("/:id", payRollController.deletePayroll);

// Approve a payroll record
router.patch("/:id/approve", payRollController.approvePayroll);

// Mark a payroll as paid
router.patch("/:id/paid", payRollController.markPayrollAsPaid);

// Get payroll summary/statistics
router.get("/summary", payRollController.getPayrollSummary);

// Generate payroll PDF for a specific payroll
router.get("/:id/pdf", payRollController.generatePayrollPdf);

module.exports = router;

