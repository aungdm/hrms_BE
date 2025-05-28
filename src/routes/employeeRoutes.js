const express = require("express");
const router = express.Router();
const {
  createRecord,
  getRecords,
  getRecord,
  updateRecord,
  deleteRecord,
  searchRecords,
  updateSalaryRecord,
} = require("../controllers/employeeController");

router.post("/create", createRecord);
router.patch("/update/:id", updateRecord);
router.get("/get", getRecords);
router.get("/search", searchRecords);
router.delete("/delete/:id", deleteRecord);
router.get("/get/:id", getRecord);
router.patch("/update/:id", updateSalaryRecord);

module.exports = router;
