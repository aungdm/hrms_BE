const express = require("express");
const router = express.Router();
const {
  createDeduction,
  updateDeduction,
  getDeductions,
  getDeduction,
  deleteDeduction,
  updateDeductionStatus,
  deleteMultipleDeductions,
  updateProcessedStatus
} = require("../controllers/otherDeductionsController");

// Routes for other deductions
router.post("/", createDeduction);
router.put("/:id", updateDeduction);
router.get("/", getDeductions);
router.get("/:id", getDeduction);
router.delete("/:id", deleteDeduction);
router.patch("/:id/status", updateDeductionStatus);
router.patch("/:id/processed", updateProcessedStatus);
router.post("/delete-multiple", deleteMultipleDeductions);

module.exports = router; 