const express = require("express");
const router = express.Router();
const {
  createScheduling,
  updateScheduling,
  getSchedulings,
  getScheduling,
  deleteScheduling
} = require("../controllers/schedulingController");

// Routes for work schedules
router.post("/", createScheduling);
router.put("/:id", updateScheduling);
router.get("/", getSchedulings);
router.get("/:id", getScheduling);
router.delete("/:id", deleteScheduling);

module.exports = router; 