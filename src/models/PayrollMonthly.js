const mongoose = require('mongoose');

const PayrollMonthlySchema = new mongoose.Schema(
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
    absentDeductions: {
      type: Number,
      default: 0,
    },
    otherDeductions: {
      type: Number,
      default: 0,
    },
    netSalary: {
      type: Number,
      required: [true, 'Net salary is required'],
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
PayrollMonthlySchema.index({ employeeId: 1, startDate: 1, endDate: 1 }, { unique: true });

// Add a method to generate payslip (if needed)
PayrollMonthlySchema.methods.generatePayslip = function() {
  return {
    employeeInfo: {
      id: this.employeeId,
      name: this.employeeName,
      designation: this.designation,
      type: 'Monthly',
    },
    payrollPeriod: {
      startDate: this.startDate,
      endDate: this.endDate,
    },
    salaryDetails: {
      grossSalary: this.grossSalary,
      absentDeductions: this.absentDeductions,
      otherDeductions: this.otherDeductions,
      netSalary: this.netSalary,
    },
    generatedDate: this.createdAt,
  };
};

module.exports = mongoose.model('PayrollMonthly', PayrollMonthlySchema); 