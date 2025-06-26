const express = require("express");
const router = express.Router();
const {
  createLoan,
  updateLoan,
  getLoans,
  getLoan,
  deleteLoan,
  updateLoanStatus,
  deleteMultipleLoans,
  payLoanInstallment
} = require("../controllers/advancedSalaryController");

// Routes for loans
router.post("/", createLoan);
router.put("/:id", updateLoan);
router.get("/", getLoans);
router.get("/:id", getLoan);
router.delete("/:id", deleteLoan);
router.patch("/:id/status", updateLoanStatus);
router.post("/delete-multiple", deleteMultipleLoans);
router.patch("/:id/pay-installment", payLoanInstallment);

module.exports = router; 