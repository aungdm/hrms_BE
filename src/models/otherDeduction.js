const mongoose = require("mongoose");

const OtherDeductionSchema = new mongoose.Schema({
  id: Number,
  date: Date,
  processed: Boolean,
  amount: Number,
  description: String,
  created_at: Date,
  updated_at: Date,
  employee_id: { type: String, ref: "Employee", default: null },
  item_text: { type: String, default: null },
  item_date: { type: Date, default: null },
});

module.exports = mongoose.model("OtherDeduction", OtherDeductionSchema);
