const mongoose = require("mongoose");

const PayRollSchema = new mongoose.Schema(
  {
    employeeId: {
      type: String,
      ref: "Employee",
      required: true,
      index: true,
    },
    startDate: {
      type: Date,
      required: true,
    },
    endDate: {
      type: Date,
      required: true,
    },
    payDate: {
      type: Date,
      required: true,
    },
    totalWorkingDays: {
      type: Number,
      default: 0,
    },
    presentDays: {
      type: Number,
      default: 0,
    },
    absentDays: {
      type: Number,
      default: 0,
    },
    lateDays: {
      type: Number,
      default: 0,
    },
    halfDays: {
      type: Number,
      default: 0,
    },
    payableHours: {
      type: Number,
      default: 0,
    },
    totalHoursWorked: {
      type: Number,
      default: 0,
    },
    totalOvertimeMinutes: {
      type: Number,
      default: 0,
    },
    approvedOvertimeMinutes: {
      type: Number,
      default: 0,
    },
    basicSalary: {
      type: Number,
      default: 0,
    },
    standardSalary: {
      type: Number,
      default: 0,
    },
    perHourRate: {
      type: Number,
      default: 0,
    },
    overtimePay: {
      type: Number,
      default: 0,
    },
    // Additions
    commission: {
      type: Number,
      default: 0,
    },
    arrears: {
      type: Number,
      default: 0,
    },
    referralBonus: {
      type: Number,
      default: 0,
    },
    closerIncentive: {
      type: Number,
      default: 0,
    },
    otherIncentives: {
      type: Number,
      default: 0,
    },
    // Deductions
    lateArrivalFine: {
      type: Number,
      default: 0,
    },
    absentDeduction: {
      type: Number,
      default: 0,
    },
    advanceAgainstSalary: {
      type: Number,
      default: 0,
    },
    personalLoan: {
      type: Number,
      default: 0,
    },
    fineOrDeduction: {
      type: Number,
      default: 0,
    },
    otherDeduction: {
      type: Number,
      default: 0,
    },
    missingDeduction: {
      type: Number,
      default: 0,
    },
    // Additional information
    payrollType: {
      type: String,
      enum: ["Hourly", "Monthly"],
      required: true,
    },
    payrollStatus: {
      type: String,
      enum: ["Draft", "Approved", "Paid", "Cancelled"],
      default: "Draft",
    },
    payItems: [{
      name: {
        type: String,
        required: true,
      },
      value: {
        type: Number,
        required: true,
      },
      type: {
        type: String,
        enum: ["Addition", "Deduction"],
        required: true,
      }
    }],
    totalAdditions: {
      type: Number,
      default: 0,
    },
    totalDeductions: {
      type: Number,
      default: 0,
    },
    netSalary: {
      type: Number,
      default: 0,
    },
    remarks: {
      type: String,
      default: "",
    },
    // Track the attendance records that were used for this payroll
    attendanceRecords: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: "DailyAttendance",
    }],
    // Keep track of the late arrivals that resulted in fines
    lateArrivalDetails: [{
      date: Date,
      minutes: Number,
      fine: Number
    }],
    // Track overtime records that were used
    overtimeDetails: [{
      date: Date,
      minutes: Number,
      amount: Number
    }],
    // Record who created and approved this payroll
    createdBy: {
      type: String,
      ref: "User",
    },
    approvedBy: {
      type: String,
      ref: "User",
    },
    approvedAt: {
      type: Date,
    },
    paidAt: {
      type: Date,
    }
  },
  {
    timestamps: true,
  }
);

// Compound index for efficient querying
PayRollSchema.index({ employeeId: 1, startDate: 1, endDate: 1 });

module.exports = mongoose.model("PayRoll", PayRollSchema);
