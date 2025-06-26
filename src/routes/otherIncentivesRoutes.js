const express = require("express");
const router = express.Router();
const {
  createIncentive,
  updateIncentive,
  getIncentives,
  getIncentive,
  deleteIncentive,
  updateIncentiveStatus,
  deleteMultipleIncentives
} = require("../controllers/otherIncentivesController");

// Routes for other incentives
router.post("/", createIncentive);
router.put("/:id", updateIncentive);
router.get("/", getIncentives);
router.get("/:id", getIncentive);
router.delete("/:id", deleteIncentive);
router.patch("/:id/status", updateIncentiveStatus);
router.post("/delete-multiple", deleteMultipleIncentives);

module.exports = router; 