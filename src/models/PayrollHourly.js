const mongoose = require('mongoose');

const PayrollHourlySchema = new mongoose.Schema(
  {
    employeeId: {
      type: String,
      ref: 'Employee',
      required: [true, 'Employee ID is required'],
    },
    employeeName: {
      type: String,
      required: [true, 'Employee name is required'],
    },
    designation: {
      type: String,
      required: [true, 'Designation is required'],
    },
    startDate: {
      type: Date,
      required: [true, 'Start date is required'],
    },
    endDate: {
      type: Date,
      required: [true, 'End date is required'],
    },
    grossSalary: {
      type: Number,
      required: [true, 'Gross salary is required'],
    },
    perHourRate: {
      type: Number,
      default: 0,
    },
    payableHours: {
      type: Number,
      default: 0,
    },
    lateFines: {
      type: Number,
      default: 0,
    },
    otherDeductions: {
      type: Number,
      default: 0,
    },
    overtimePay: {
      type: Number,
      default: 0,
    },
    netSalary: {
      type: Number,
      required: [true, 'Net salary is required'],
    },
    dailyCalculations: {
      type: Array,
      default: [],
    },
    status: {
      type: String,
      enum: ['Generated', 'Approved', 'Paid', 'Rejected'],
      default: 'Generated',
    },
  },
  {
    timestamps: true,
  }
);

// Ensure no duplicate payrolls for same employee and date range
PayrollHourlySchema.index({ employeeId: 1, startDate: 1, endDate: 1 }, { unique: true });

// Add a method to generate payslip (if needed)
PayrollHourlySchema.methods.generatePayslip = function() {
  return {
    employeeInfo: {
      id: this.employeeId,
      name: this.employeeName,
      designation: this.designation,
      type: 'Hourly',
    },
    payrollPeriod: {
      startDate: this.startDate,
      endDate: this.endDate,
    },
    salaryDetails: {
      grossSalary: this.grossSalary,
      perHourRate: this.perHourRate,
      payableHours: this.payableHours,
      lateFines: this.lateFines,
      otherDeductions: this.otherDeductions,
      overtimePay: this.overtimePay,
      netSalary: this.netSalary,
    },
    generatedDate: this.createdAt,
  };
};

module.exports = mongoose.model('PayrollHourly', PayrollHourlySchema); 