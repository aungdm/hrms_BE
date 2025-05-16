const express = require("express");
const router = express.Router();
const {
  createSchedule,
  updateSchedule,
  getSchedules,
  getSchedule,
  deleteSchedule
} = require("../controllers/workScheduleController");

// Routes for work schedules
router.post("/", createSchedule);
router.put("/:id", updateSchedule);
router.get("/", getSchedules);
router.get("/:id", getSchedule);
router.delete("/:id", deleteSchedule);

module.exports = router; 