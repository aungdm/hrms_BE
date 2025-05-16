const express = require("express");
const router = express.Router();
const {
  processLogs,
  getRecords,
  getStatistics,
  getRecord,
  approveOvertime,
  getOvertimeRecords,
  updateRecord,
  updateOvertimeDetails
} = require("../controllers/dailyAttendanceController");

// Routes for daily attendance
router.post("/process", processLogs);
router.get("/get", getRecords);
router.get("/statistics", getStatistics);
router.get("/get/:id", getRecord);
router.put("/update/:id", updateRecord);

// Overtime routes
router.get("/overtime", getOvertimeRecords);
router.patch("/overtime/:id/approve", approveOvertime);
router.patch("/overtime/:id/details", updateOvertimeDetails);

module.exports = router; 