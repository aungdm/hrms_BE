const mongoose = require("mongoose");
const Employee = require("./employee");

const SalaryRevisionsSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
    },
    effectiveDate: {
      type: Date,
      required: true,
    },
    previousSalary: {
      type: Number,
      required: true,
      trim: true,
    },
    salary: {
      type: Number,
      required: true,
      trim: true,
    },
    employment: {
      type: String,
      ref: "Employee",
      required: true,
    },
    description: {
      type: String,
      required: false,
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model("SalaryRevisions", SalaryRevisionsSchema);
