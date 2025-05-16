const express = require("express");
const router = express.Router();
const {
  createRecord,
  getRecords,
  getRecord,
  // updateRecord,
  deleteRecord,
} = require("../controllers/salaryRevisionsController");

router.post("/create", createRecord);
router.get("/get", getRecords);
router.get("/get/:id", getRecord);
// router.put("/update/:id", updateRecord);
router.delete("/delete/:id", deleteRecord);

module.exports = router;
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               