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
  updateOvertimeDetails,
  updateRelaxationRequest,
  getRelaxationRequests,
  getRelaxationRequestStats,
  recalculateAttendance
} = require("../controllers/dailyAttendanceController");

// Routes for daily attendance
router.post("/process", processLogs);
router.get("/get", getRecords);
router.get("/statistics", getStatistics);
router.get("/get/:id", getRecord);
router.put("/update/:id", updateRecord);
router.post("/recalculate/:id", recalculateAttendance);

// Overtime routes
router.get("/overtime", getOvertimeRecords);
router.patch("/overtime/:id/approve", approveOvertime);
router.patch("/overtime/:id/details", updateOvertimeDetails);

// Relaxation request routes
router.patch("/relaxation/:id/request", updateRelaxationRequest);
router.get("/relaxation", getRelaxationRequests);
router.get("/relaxation/statistics", getRelaxationRequestStats);

module.exports = router; 