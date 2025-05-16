const express = require("express");
const router = express.Router();
const {
  createPunch,
  getPunches,
  getPunch,
  updatePunch,
  deletePunch,
  updatePunchStatus
} = require("../controllers/punchController");

// Create a new punch request
router.post("/", createPunch);

// Get all punch requests with pagination and filtering
router.get("/", getPunches);

// Get punch request by ID
router.get("/:id", getPunch);

// Update punch request
router.put("/:id", updatePunch);

// Update punch status (approve/reject)
router.patch("/:id/status", updatePunchStatus);

// Delete punch request
router.delete("/:id", deletePunch);

module.exports = router;
