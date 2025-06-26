const express = require("express");
const router = express.Router();
const {
  createArrears,
  updateArrears,
  getArrearsRecords,
  getArrearsRecord,
  deleteArrearsRecord,
  updateArrearsStatus,
  deleteMultipleArrearsRecords
} = require("../controllers/arrearsController");

// Routes for arrears
router.post("/", createArrears);
router.put("/:id", updateArrears);
router.get("/", getArrearsRecords);
router.get("/:id", getArrearsRecord);
router.delete("/:id", deleteArrearsRecord);
router.patch("/:id/status", updateArrearsStatus);
router.post("/delete-multiple", deleteMultipleArrearsRecords);

module.exports = router; 