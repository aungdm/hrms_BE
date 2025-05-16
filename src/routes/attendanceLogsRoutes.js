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
  getMachinesInfo
} = require("../controllers/attendanceLogsController");

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

module.exports = router;
