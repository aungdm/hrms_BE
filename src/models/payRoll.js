const mongoose = require("mongoose");

const PayRollSchema = new mongoose.Schema(
   
);

// Compound index for efficient querying
PayRollSchema.index({ employeeId: 1, startDate: 1, endDate: 1 });

module.exports = mongoose.model("PayRoll", PayRollSchema);

