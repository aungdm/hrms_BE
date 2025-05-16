const express = require("express");
const router = express.Router();
const {
  createLeave,
  getLeaves,
  getLeave,
  updateLeave,
  deleteLeave,
  updateLeaveStatus
} = require("../controllers/leaveController");

// Create a new leave
router.post("/", createLeave);

// Get all leaves with pagination and filtering
router.get("/", getLeaves);

// Get leave by ID
router.get("/:id", getLeave);

// Update leave
router.put("/:id", updateLeave);

// Update leave status
router.patch("/:id/status", updateLeaveStatus);

// Delete leave
router.delete("/:id", deleteLeave);

module.exports = router;
