const mongoose = require("mongoose");

const PunchSchema = new mongoose.Schema(
  {
    employeeId: {
      type: String,
      ref: "Employee",
      required: [true, "Employee ID is required"],
    },
    attendanceId: {
      type: String,
      ref: "Attendance",
      required: [true, "Attendance ID is required"],
    },
    date: {
      type: Date,
      required: [true, "Date is required"],
    },
    time: {
      type: String,
      required: [true, "Time is required"],
    },
    punchType: {
      type: String,
      enum: ["firstEntry", "lastExit", "overtimeStart", "overtimeEnd"],
      required: [true, "Punch type is required"],
    },
    status: {
      type: String,
      enum: ["Pending", "Approved", "Rejected"],
      default: "Pending",
    },
    reason: {
      type: String,
      default: "",
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Employee",
    },
    rejectionReason: {
      type: String,
      default: "",
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model("Punch", PunchSchema);
