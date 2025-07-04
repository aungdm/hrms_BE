const mongoose = require("mongoose");

const DailyAttendanceSchema = new mongoose.Schema(
  {
    employeeId: {
      type: String,
      ref: "Employee",
      required: true,
      index: true,
    },
    date: {
      type: Date,
      required: true,
      index: true,
    },
    status: {
      type: String,
      enum: [
        "Present",
        "Absent",
        "Half Day",
        "Late",
        "Leave",
        "Weekend",
        "Holiday",
        "Check In Only",
        "Day Off",
        "Less than Half Day",
      ],
      required: true,
      index: true,
    },
    firstEntry: {
      type: Date,
      default: null,
    },
    lastExit: {
      type: Date,
      default: null,
    },
    workDuration: {
      type: Number, // Duration in minutes
      default: 0,
    },
    lateArrival: {
      type: Number, // Minutes late for arrival
      default: 0,
    },
    earlyDeparture: {
      type: Number, // Minutes early for departure
      default: 0,
    },
    expectedWorkHours: {
      type: Number, // Expected work hours in minutes
      default: 0,
    },
    checkinStatus: {
      type: String,
      default: "On Time",
    },
    checkoutStatus: {
      type: String,
      default: "On Time",
    },
    expectedCheckinTime: {
      type: Date,
      default: null,
    },
    expectedCheckoutTime: {
      type: Date,
      default: null,
    },
    isOverTime: {
      type: Boolean,
      default: false,
    },
    isManuallyUpdated: {
      type: Boolean,
      default: false,
    },
    relaxationRequest: {
      type: Boolean,
      default: false,
    },
    relaxationRequestStatus: {
      type: String,
      enum: ["Approved", "Reject", "Pending"],
      default: "Pending",
    },
    approvedOverTime: {
      type: Boolean,
      default: false,
    },
    overtTimeStart: {
      type: Date,
      default: null,
    },
    overtTimeEnd: {
      type: Date,
      default: null,
    },
    overTimeMinutes: {
      type: Number,
      default: null,
    },
    overTimeStatus: {
      type: String,
      enum: ["Approved", "Reject", "Pending"],
      index: true,
    },
    logs: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "AttendanceLog",
      },
    ],
    remarks: {
      type: String,
      default: "",
    },
  },
  {
    timestamps: true,
  }
);

// Compound index for efficient querying
DailyAttendanceSchema.index({ employeeId: 1, date: 1 }, { unique: true });

module.exports = mongoose.model("DailyAttendance", DailyAttendanceSchema);
