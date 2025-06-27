const express = require("express");
const router = express.Router();
const {
  createAdvancedSalary,
  updateAdvancedSalary,
  getAdvancedSalaries,
  getAdvancedSalary,
  deleteAdvancedSalary,
  updateAdvancedSalaryStatus,
  deleteMultipleAdvancedSalaries
} = require("../controllers/advancedSalaryController");

// Routes for advanced salaries
router.post("/", createAdvancedSalary);
router.put("/:id", updateAdvancedSalary);
router.get("/", getAdvancedSalaries);
router.get("/:id", getAdvancedSalary);
router.delete("/:id", deleteAdvancedSalary);
router.patch("/:id/status", updateAdvancedSalaryStatus);
router.post("/delete-multiple", deleteMultipleAdvancedSalaries);

module.exports = router; 