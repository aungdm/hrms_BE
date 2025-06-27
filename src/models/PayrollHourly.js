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
    actualGrossSalary: {
      type: Number,
      default: 0,
      comment: 'Gross salary calculated based on actual hours worked'
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
    otherIncentives: {
      type: Number,
      default: 0,
      comment: 'Additional incentives added to the salary'
    },
    incentiveDetails: {
      type: Array,
      default: [],
      comment: 'Details of incentives added to this payroll'
    },
    arrears: {
      type: Number,
      default: 0,
      comment: 'Arrears amount added to the salary'
    },
    arrearsDetails: {
      type: Array,
      default: [],
      comment: 'Details of arrears added to this payroll'
    },
    fineDeductions: {
      type: Number,
      default: 0,
      comment: 'Fine deductions subtracted from the salary'
    },
    fineDeductionDetails: {
      type: Array,
      default: [],
      comment: 'Details of fine deductions subtracted from this payroll'
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
      actualGrossSalary: this.actualGrossSalary,
      perHourRate: this.perHourRate,
      payableHours: this.payableHours,
      lateFines: this.lateFines,
      otherDeductions: this.otherDeductions,
      overtimePay: this.overtimePay,
      otherIncentives: this.otherIncentives,
      incentiveDetails: this.incentiveDetails || [],
      arrears: this.arrears,
      arrearsDetails: this.arrearsDetails || [],
      fineDeductions: this.fineDeductions,
      fineDeductionDetails: this.fineDeductionDetails || [],
      netSalary: this.netSalary,
    },
    generatedDate: this.createdAt,
  };
};

module.exports = mongoose.model('PayrollHourly', PayrollHourlySchema); 