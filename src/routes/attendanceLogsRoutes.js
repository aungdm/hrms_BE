const express = require("express");
const router = express.Router();
const {
  // createRecord,
  getRecords,
  // getRecord,
  // updateRecord,
  // deleteRecord,
  // searchRecords,
  // updateSalaryRecord,
  forceSyncRecords,
  getMachinesInfo,
  getProcessingErrors,
  resetProcessingError
} = require("../controllers/attendanceLogsController");

// Import the manual sync function from startup sequence
const { manualAttendanceSync } = require('../jobs/startupSequence');

// router.post("/create", createRecord);
// router.put("/update/:id", updateRecord);
router.get("/get", getRecords);
router.get("/logs", getRecords);
// router.get("/search", searchRecords);
// router.delete("/delete/:id", deleteRecord);
// router.get("/get/:id", getRecord);
// router.patch("/update/:id", updateSalaryRecord);
router.post("/sync", forceSyncRecords);
router.get("/machines", getMachinesInfo);

// Routes for handling processing errors
router.get("/processing-errors", getProcessingErrors);
router.post("/reset-errors", resetProcessingError);

// Endpoint specifically for serverless environments to trigger sync manually
router.post("/manual-sync", async (req, res) => {
  try {
    const result = await manualAttendanceSync();
    if (result.success) {
      return res.status(200).json({ 
        success: true, 
        message: result.message 
      });
    } else {
      return res.status(500).json({ 
        success: false, 
        message: result.message,
        error: result.error
      });
    }
  } catch (error) {
    return res.status(500).json({ 
      success: false, 
      message: "Error triggering manual sync",
      error: error.message
    });
  }
});

module.exports = router;
