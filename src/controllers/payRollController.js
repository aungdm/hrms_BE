const { successResponse, errorRresponse } = require("../utils/response");
const PayRoll = require("../models/payRoll"); 
const moment = require("moment");
const PayrollHourly = require('../models/PayrollHourly');
const PayrollMonthly = require('../models/PayrollMonthly');
const DailyAttendance = require('../models/dailyAttendance'); 
const Employee = require('../models/employee');
const OtherDeduction = require('../models/otherDeduction');

// ---------- Hourly Employee Payroll Controllers ----------

// Generate payroll for hourly employees
exports.generateHourlyPayroll = async (req, res) => {
  try {
    const { startDate, endDate, employeeIds } = req.body;
    
    if (!startDate || !endDate) {
      return res.status(400).json({ success: false, message: 'Start and end dates are required' });
    }
    
    // Query to find employees - either specific ones or all hourly employees
    const employeeQuery = { payroll_type: 'Hourly' };
    if (employeeIds && employeeIds.length > 0) {
      employeeQuery._id = { $in: employeeIds };
    }
    
    const employees = await Employee.find(employeeQuery);
    
    if (!employees.length) {
      return res.status(404).json({ success: false, message: 'No eligible hourly employees found' });
    }
    
    const payrolls = [];
    
    // Process payroll for each employee
    for (const employee of employees) {
      // Check if payroll already exists for this employee and date range
      const existingPayroll = await PayrollHourly.findOne({
        employeeId: employee._id,
        startDate,
        endDate
      });
      
      if (existingPayroll) {
        continue; // Skip if payroll already exists
      }
      
      // Get attendance records for this employee within date range
      const attendanceRecords = await DailyAttendance.find({
        employeeId: employee._id,
        date: { $gte: new Date(startDate), $lte: new Date(endDate) }
      });
      
      // Get fine records for this employee within date range
      const fineRecords = await OtherDeduction.find({
        employee_id: employee._id,
        date: { $gte: new Date(startDate), $lte: new Date(endDate) }
      });
      
      // Calculate salary based on hourly rules
      const {
        grossSalary,
        actualGrossSalary,
        perHourRate,
        payableHours,
        lateFines,
        otherDeductions,
        overtimePay,
        netSalary,
        dailyCalculations
      } = calculateHourlySalary(employee, attendanceRecords, fineRecords);
      
      // Create payroll record
      const payroll = await PayrollHourly.create({
        employeeId: employee._id,
        employeeName: employee.name,
        designation: employee.designation,
        startDate,
        endDate,
        grossSalary,
        actualGrossSalary,
        perHourRate,
        payableHours,
        lateFines,
        otherDeductions,
        overtimePay,
        netSalary,
        dailyCalculations,
        status: 'Generated',
      });
      
      payrolls.push(payroll);
    }
    
    return res.status(201).json({
      success: true,
      message: `Generated ${payrolls.length} hourly payrolls successfully`,
      data: payrolls
    });
  } catch (error) {
    console.error('Error generating hourly payroll:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to generate hourly payroll',
      error: error.message
    });
  }
};

// Get list of hourly payrolls with filtering
exports.listHourlyPayrolls = async (req, res) => {
  try {
    const { employeeId, startDate, endDate, page = 1, limit = 10 } = req.query;
    
    // Build filter object
    const filter = {};
    if (employeeId) filter.employeeId = employeeId;
    if (startDate) filter.startDate = { $gte: new Date(startDate) };
    if (endDate) filter.endDate = { $lte: new Date(endDate) };
    
    // Pagination
    const skip = (page - 1) * limit;
    
    const payrolls = await PayrollHourly.find(filter)
      .skip(skip)
      .limit(parseInt(limit))
      .sort({ createdAt: -1 });
    
    const total = await PayrollHourly.countDocuments(filter);
    
    return res.status(200).json({
      success: true,
      count: payrolls.length,
      total,
      totalPages: Math.ceil(total / limit),
      currentPage: parseInt(page),
      data: payrolls
    });
  } catch (error) {
    console.error('Error listing hourly payrolls:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to list hourly payrolls',
      error: error.message
    });
  }
};

// Get specific hourly payroll by ID
exports.getHourlyPayrollById = async (req, res) => {
  try {
    const payroll = await PayrollHourly.findById(req.params.id);
    
    if (!payroll) {
      return res.status(404).json({
        success: false,
        message: 'Hourly payroll not found'
      });
    }
    
    return res.status(200).json({
      success: true,
      data: payroll
    });
  } catch (error) {
    console.error('Error getting hourly payroll:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to get hourly payroll',
      error: error.message
    });
  }
};

// Update hourly payroll
exports.updateHourlyPayroll = async (req, res) => {
  try {
    const { grossSalary, lateFines, otherDeductions, overtimePay, netSalary, status } = req.body;
    
    const payroll = await PayrollHourly.findById(req.params.id);
    
    if (!payroll) {
      return res.status(404).json({
        success: false,
        message: 'Hourly payroll not found'
      });
    }
    
    // Update fields if provided
    if (grossSalary !== undefined) payroll.grossSalary = grossSalary;
    if (lateFines !== undefined) payroll.lateFines = lateFines;
    if (otherDeductions !== undefined) payroll.otherDeductions = otherDeductions;
    if (overtimePay !== undefined) payroll.overtimePay = overtimePay;
    if (netSalary !== undefined) payroll.netSalary = netSalary;
    if (status) payroll.status = status;
    
    // Recalculate net salary if components changed but net not provided
    if ((grossSalary !== undefined || lateFines !== undefined || otherDeductions !== undefined || overtimePay !== undefined) 
        && netSalary === undefined) {
      payroll.netSalary = payroll.grossSalary - payroll.lateFines - payroll.otherDeductions + payroll.overtimePay;
    }
    
    await payroll.save();
    
    return res.status(200).json({
      success: true,
      message: 'Hourly payroll updated successfully',
      data: payroll
    });
  } catch (error) {
    console.error('Error updating hourly payroll:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to update hourly payroll',
      error: error.message
    });
  }
};

// Delete hourly payroll
exports.deleteHourlyPayroll = async (req, res) => {
  try {
    const payroll = await PayrollHourly.findById(req.params.id);
    
    if (!payroll) {
      return res.status(404).json({
        success: false,
        message: 'Hourly payroll not found'
      });
    }
    
    await payroll.remove();
    
    return res.status(200).json({
      success: true,
      message: 'Hourly payroll deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting hourly payroll:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to delete hourly payroll',
      error: error.message
    });
  }
};

// Get payslip for hourly employee
exports.getHourlyPayslip = async (req, res) => {
  try {
    const payroll = await PayrollHourly.findById(req.params.id);
    
    if (!payroll) {
      return res.status(404).json({
        success: false,
        message: 'Hourly payroll not found'
      });
    }
    
    const employee = await Employee.findById(payroll.employeeId);
    
    if (!employee) {
      return res.status(404).json({
        success: false,
        message: 'Employee not found'
      });
    }
    
    // Build payslip object with all necessary details
    const payslip = {
      employeeInfo: {
        id: employee._id,
        name: employee.name,
        designation: employee.designation,
        type: 'Hourly',
      },
      payrollPeriod: {
        startDate: payroll.startDate,
        endDate: payroll.endDate
      },
      salaryDetails: {
        grossSalary: payroll.grossSalary,
        actualGrossSalary: payroll.actualGrossSalary,
        perHourRate: payroll.perHourRate,
        payableHours: payroll.payableHours,
        lateFines: payroll.lateFines,
        otherDeductions: payroll.otherDeductions,
        overtimePay: payroll.overtimePay,
        netSalary: payroll.netSalary
      },
      dailyCalculations: payroll.dailyCalculations || [],
      generatedDate: payroll.createdAt,
    };
    
    return res.status(200).json({
      success: true,
      data: payslip
    });
  } catch (error) {
    console.error('Error generating hourly payslip:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to generate hourly payslip',
      error: error.message
    });
  }
};

// ---------- Monthly Employee Payroll Controllers ----------

// Generate payroll for monthly employees
exports.generateMonthlyPayroll = async (req, res) => {
  try {
    const { startDate, endDate, employeeIds } = req.body;
    
    if (!startDate || !endDate) {
      return res.status(400).json({ success: false, message: 'Start and end dates are required' });
    }
    
    // Query to find employees - either specific ones or all monthly employees
    const employeeQuery = { payroll_type: 'Monthly' };
    if (employeeIds && employeeIds.length > 0) {
      employeeQuery._id = { $in: employeeIds };
    }
    
    const employees = await Employee.find(employeeQuery);
    
    if (!employees.length) {
      return res.status(404).json({ success: false, message: 'No eligible monthly employees found' });
    }
    
    const payrolls = [];
    
    // Process payroll for each employee
    for (const employee of employees) {
      // Check if payroll already exists for this employee and date range
      const existingPayroll = await PayrollMonthly.findOne({
        employeeId: employee._id,
        startDate,
        endDate
      });
      
      if (existingPayroll) {
        continue; // Skip if payroll already exists
      }
      
      // Get attendance records for this employee within date range
      const attendanceRecords = await DailyAttendance.find({
        employeeId: employee._id,
        date: { $gte: new Date(startDate), $lte: new Date(endDate) }
      });
      
      // Get fine records for this employee within date range
      const fineRecords = await OtherDeduction.find({
        employee_id: employee._id,
        date: { $gte: new Date(startDate), $lte: new Date(endDate) }
      });
      
      // Calculate salary based on monthly rules
      const {
        grossSalary,
        absentDeductions,
        otherDeductions,
        netSalary
      } = calculateMonthlySalary(employee, attendanceRecords, fineRecords);
      
      // Create payroll record
      const payroll = await PayrollMonthly.create({
        employeeId: employee._id,
        employeeName: employee.name,
        designation: employee.designation,
        startDate,
        endDate,
        grossSalary,
        absentDeductions,
        otherDeductions,
        netSalary,
        status: 'Generated',
      });
      
      payrolls.push(payroll);
    }
    
    return res.status(201).json({
      success: true,
      message: `Generated ${payrolls.length} monthly payrolls successfully`,
      data: payrolls
    });
  } catch (error) {
    console.error('Error generating monthly payroll:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to generate monthly payroll',
      error: error.message
    });
  }
};

// List monthly payrolls with filtering
exports.listMonthlyPayrolls = async (req, res) => {
  try {
    const { employeeId, startDate, endDate, page = 1, limit = 10 } = req.query;
    
    // Build filter object
    const filter = {};
    if (employeeId) filter.employeeId = employeeId;
    if (startDate) filter.startDate = { $gte: new Date(startDate) };
    if (endDate) filter.endDate = { $lte: new Date(endDate) };
    
    // Pagination
    const skip = (page - 1) * limit;
    
    const payrolls = await PayrollMonthly.find(filter)
      .skip(skip)
      .limit(parseInt(limit))
      .sort({ createdAt: -1 });
    
    const total = await PayrollMonthly.countDocuments(filter);
    
    return res.status(200).json({
      success: true,
      count: payrolls.length,
      total,
      totalPages: Math.ceil(total / limit),
      currentPage: parseInt(page),
      data: payrolls
    });
  } catch (error) {
    console.error('Error listing monthly payrolls:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to list monthly payrolls',
      error: error.message
    });
  }
};

// Get specific monthly payroll by ID
exports.getMonthlyPayrollById = async (req, res) => {
  try {
    const payroll = await PayrollMonthly.findById(req.params.id);
    
    if (!payroll) {
      return res.status(404).json({
        success: false,
        message: 'Monthly payroll not found'
      });
    }
    
    return res.status(200).json({
      success: true,
      data: payroll
    });
  } catch (error) {
    console.error('Error getting monthly payroll:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to get monthly payroll',
      error: error.message
    });
  }
};

// Update monthly payroll
exports.updateMonthlyPayroll = async (req, res) => {
  try {
    const { grossSalary, absentDeductions, otherDeductions, netSalary, status } = req.body;
    
    const payroll = await PayrollMonthly.findById(req.params.id);
    
    if (!payroll) {
      return res.status(404).json({
        success: false,
        message: 'Monthly payroll not found'
      });
    }
    
    // Update fields if provided
    if (grossSalary !== undefined) payroll.grossSalary = grossSalary;
    if (absentDeductions !== undefined) payroll.absentDeductions = absentDeductions;
    if (otherDeductions !== undefined) payroll.otherDeductions = otherDeductions;
    if (netSalary !== undefined) payroll.netSalary = netSalary;
    if (status) payroll.status = status;
    
    // Recalculate net salary if components changed but net not provided
    if ((grossSalary !== undefined || absentDeductions !== undefined || otherDeductions !== undefined) 
        && netSalary === undefined) {
      payroll.netSalary = payroll.grossSalary - payroll.absentDeductions - payroll.otherDeductions;
    }
    
    await payroll.save();
    
    return res.status(200).json({
      success: true,
      message: 'Monthly payroll updated successfully',
      data: payroll
    });
  } catch (error) {
    console.error('Error updating monthly payroll:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to update monthly payroll',
      error: error.message
    });
  }
};

// Delete monthly payroll
exports.deleteMonthlyPayroll = async (req, res) => {
  try {
    const payroll = await PayrollMonthly.findById(req.params.id);
    
    if (!payroll) {
      return res.status(404).json({
        success: false,
        message: 'Monthly payroll not found'
      });
    }
    
    await payroll.remove();
    
    return res.status(200).json({
      success: true,
      message: 'Monthly payroll deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting monthly payroll:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to delete monthly payroll',
      error: error.message
    });
  }
};

// Get payslip for monthly employee
exports.getMonthlyPayslip = async (req, res) => {
  try {
    const payroll = await PayrollMonthly.findById(req.params.id);
    
    if (!payroll) {
      return res.status(404).json({
        success: false,
        message: 'Monthly payroll not found'
      });
    }
    
    const employee = await Employee.findById(payroll.employeeId);
    
    if (!employee) {
      return res.status(404).json({
        success: false,
        message: 'Employee not found'
      });
    }
    
    // Build payslip object with all necessary details
    const payslip = {
      employeeInfo: {
        id: employee._id,
        name: employee.name,
        designation: employee.designation,
        type: 'Monthly',
      },
      payrollPeriod: {
        startDate: payroll.startDate,
        endDate: payroll.endDate
      },
      salaryDetails: {
        grossSalary: payroll.grossSalary,
        absentDeductions: payroll.absentDeductions,
        otherDeductions: payroll.otherDeductions,
        netSalary: payroll.netSalary
      },
      generatedDate: payroll.createdAt,
    };
    
    return res.status(200).json({
      success: true,
      data: payslip
    });
  } catch (error) {
    console.error('Error generating monthly payslip:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to generate monthly payslip',
      error: error.message
    });
  }
};

// ---------- Helper Functions ----------

// Helper function to calculate hourly salary
function calculateHourlySalary(employee, attendanceRecords, fineRecords) {
  // Use after_probation_gross_salary as the base salary
  let grossSalary = parseFloat(employee.after_probation_gross_salary) || 0;
  let lateFines = 0;
  let otherDeductions = 0;
  let overtimePay = 0;
  
  // Calculate per hour and per minute salary
  const workingDays = 26;
  const shiftHours = 8; // Assuming 8-hour shift, adjust as needed
  const perHourSalary = grossSalary / (workingDays * shiftHours);
  const perMinuteSalary = perHourSalary / 60;
  
  // Calculate payable hours based on ACTUAL working days only
  let payableHours = 0;
  
  // Track late arrivals to implement the "first three late days without fine" rule
  let lateArrivalDays = 0;
  
  // Create a detailed breakdown of day-by-day calculations
  const dailyCalculations = [];
  
  // Process attendance records for late arrival fines and overtime
  attendanceRecords.forEach(record => {
    // Determine actual working hours based on status
    let actualHours = 0;
    let dailyPay = 0;
    let status = record.status || 'Present';
    
    // Only count hours for work days (Present, Check Only, Late arrival with actual work)
    if (status === 'Present' || status === 'Check Only') {
      actualHours = shiftHours;
      dailyPay = perHourSalary * shiftHours;
      payableHours += shiftHours;
    } else if (status === 'Absent') {
      actualHours = 0;
      dailyPay = 0;
      // Don't add to payableHours for absent days
    } else if (status === 'Weekend') {
      // Weekends are typically non-working days unless overtime is approved
      actualHours = 0;
      dailyPay = 0;
      // Don't add to payableHours for weekends
    } else {
      // For any other status, treat as present (fallback)
      actualHours = shiftHours;
      dailyPay = perHourSalary * shiftHours;
      payableHours += shiftHours;
    }
    
    const dailyCalc = {
      date: record.date,
      status: status,
      regularHours: actualHours,
      overtimeMinutes: record.overTimeMinutes || 0,
      overtimeStatus: record.overTimeStatus || 'Not Applicable',
      lateArrival: record.lateArrival || 0,
      dailyPay: dailyPay,
      overtimePay: 0,
      lateFine: 0,
      totalDailyPay: dailyPay,
      notes: ''
    };
    
    // Late arrival fines (only for working days)
    if (record.lateArrival && (status === 'Present' || status === 'Check Only')) {
      const lateMinutes = record.lateArrival; // This is in minutes
      lateArrivalDays++;
      
      // Apply late fines according to rules, but skip the first three late days
      if (lateArrivalDays > 3) {
        let finesToAdd = 0;
        if (lateMinutes > 120) {
          // > 120 minutes
          finesToAdd = employee.designation === 'Regular' ? 2000 : 4000;
          dailyCalc.notes = 'Late fine applied (>120 minutes) - after 3 free late days';
        } else if (lateMinutes > 20) {
          // > 20 minutes
          finesToAdd = employee.designation === 'Regular' ? 1000 : 2000;
          dailyCalc.notes = 'Late fine applied (>20 minutes) - after 3 free late days';
        } else if (lateMinutes > 1) {
          // > 1 minute
          finesToAdd = employee.designation === 'Regular' ? 500 : 1000;
          dailyCalc.notes = 'Late fine applied (>1 minute) - after 3 free late days';
        }
        
        lateFines += finesToAdd;
        dailyCalc.lateFine = finesToAdd;
        dailyCalc.totalDailyPay -= finesToAdd;
      } else {
        dailyCalc.notes = `Late arrival (${lateMinutes} minutes) - no fine (within first 3 late days)`;
      }
    }
    
    // Overtime calculations (can happen on any day, including weekends)
    if (record.overTimeMinutes && record.overTimeStatus === 'Approved') {
      const overtimeMinutes = record.overTimeMinutes; // This field exists in the model
      let dailyOvertimePay = 0;
      
      if (overtimeMinutes > 60 && ['Team Lead', 'Supervisor', 'Project Manager'].includes(employee.designation)) {
        // Leadership overtime > 60 mins: 2x rate
        dailyOvertimePay = overtimeMinutes * perMinuteSalary * 2;
        dailyCalc.notes += ' Overtime at 2x rate (leadership role)';
      } else {
        // Standard rate for all other cases
        dailyOvertimePay = overtimeMinutes * perMinuteSalary;
        dailyCalc.notes += ' Overtime at standard rate';
      }
      
      overtimePay += dailyOvertimePay;
      dailyCalc.overtimePay = dailyOvertimePay;
      dailyCalc.totalDailyPay += dailyOvertimePay;
    }
    
    // Add status-specific notes
    if (status === 'Absent') {
      dailyCalc.notes = 'Absent - no pay for this day';
    } else if (status === 'Weekend') {
      dailyCalc.notes = 'Weekend - non-working day';
    }
    
    dailyCalculations.push(dailyCalc);
  });
  
  // Add other fines/deductions
  fineRecords.forEach(fine => {
    otherDeductions += fine.amount || 0;
    
    // Add the fine to the daily calculations
    dailyCalculations.push({
      date: fine.date,
      status: 'Fine/Deduction',
      regularHours: 0,
      overtimeMinutes: 0,
      overtimeStatus: 'Not Applicable',
      lateArrival: 0,
      dailyPay: 0,
      overtimePay: 0,
      lateFine: 0,
      otherDeduction: fine.amount || 0,
      totalDailyPay: -(fine.amount || 0),
      notes: fine.reason || 'Other deduction'
    });
  });
  
  // Calculate net salary based on actual hours worked
  const actualGrossSalary = payableHours * perHourSalary;
  const netSalary = actualGrossSalary - lateFines - otherDeductions + overtimePay;
  
  return {
    grossSalary: grossSalary, // Keep original for reference
    actualGrossSalary: actualGrossSalary, // Salary based on actual hours worked
    perHourRate: perHourSalary,
    payableHours,
    lateFines,
    otherDeductions,
    overtimePay,
    netSalary,
    dailyCalculations
  };
}

// Helper function to calculate monthly salary
function calculateMonthlySalary(employee, attendanceRecords, fineRecords) {
  // Use after_probation_gross_salary as the base salary
  let grossSalary = parseFloat(employee.after_probation_gross_salary) || 0;
  let absentDeductions = 0;
  let otherDeductions = 0;
  
  // Calculate per day deduction for absences
  const perDayDeduction = grossSalary / 30;
  
  // Count absent days
  const absentDays = attendanceRecords.filter(record => record.status === 'Absent').length;
  
  // Calculate total absent deductions
  absentDeductions = absentDays * perDayDeduction;
  
  // Add other fines/deductions
  fineRecords.forEach(fine => {
    otherDeductions += fine.amount || 0;
  });
  
  // Calculate net salary
  const netSalary = grossSalary - absentDeductions - otherDeductions;
  
  return {
    grossSalary,
    absentDeductions,
    otherDeductions,
    netSalary
  };
}

// Combined function to list all payrolls (both hourly and monthly)
exports.listAllPayrolls = async (req, res) => {
  try {
    // Extract pagination and filter parameters
    const page = parseInt(req.query.page) || 1;
    const perPage = parseInt(req.query.perPage) || 10;
    const skip = (page - 1) * perPage;
    const search = req.query.search || '';
    const startDate = req.query.startDate ? new Date(req.query.startDate) : null;
    const endDate = req.query.endDate ? new Date(req.query.endDate) : null;
    const employeeId = req.query.employeeId;
    const status = req.query.status;
    const sortField = req.query.sortField || 'createdAt';
    const sortOrder = req.query.sortOrder === 'Asc' ? 1 : -1;

    // Build filter object
    const filter = {};
    
    // Add search query if provided
    if (search) {
      filter.$or = [
        { employeeName: { $regex: search, $options: 'i' } }
      ];
    }
    
    // Add date range if provided
    if (startDate && endDate) {
      filter.startDate = { $gte: startDate };
      filter.endDate = { $lte: endDate };
    } else if (startDate) {
      filter.startDate = { $gte: startDate };
    } else if (endDate) {
      filter.endDate = { $lte: endDate };
    }
    
    // Add employee filter if provided
    if (employeeId) {
      filter.employeeId = employeeId;
    }
    
    // Add status filter if provided
    if (status) {
      filter.status = status;
    }

    // Get both hourly and monthly payrolls
    const hourlyQuery = PayrollHourly.find(filter);
    const monthlyQuery = PayrollMonthly.find(filter);
    
    // Apply sorting
    const sort = {};
    sort[sortField] = sortOrder;
    hourlyQuery.sort(sort);
    monthlyQuery.sort(sort);

    // Count total documents for pagination
    const [hourlyCount, monthlyCount] = await Promise.all([
      PayrollHourly.countDocuments(filter),
      PayrollMonthly.countDocuments(filter)
    ]);
    
    const totalCount = hourlyCount + monthlyCount;
    
    // Apply pagination for each model
    // We need to be smart about this - if we're on page 2 and page 1 had all hourly payrolls,
    // we need to skip all hourly payrolls and just get monthly ones
    let hourlyPayrolls = [];
    let monthlyPayrolls = [];
    
    // Simple approach - get all and then manually paginate
    // For production, this should be optimized
    const allHourlyPayrolls = await hourlyQuery.lean().exec();
    const allMonthlyPayrolls = await monthlyQuery.lean().exec();
    
    // Add type identifier to each record
    allHourlyPayrolls.forEach(p => p.payrollType = 'Hourly');
    allMonthlyPayrolls.forEach(p => p.payrollType = 'Monthly');
    
    // Combine and sort
    const allPayrolls = [...allHourlyPayrolls, ...allMonthlyPayrolls].sort((a, b) => {
      if (a[sortField] < b[sortField]) return sortOrder === 1 ? -1 : 1;
      if (a[sortField] > b[sortField]) return sortOrder === 1 ? 1 : -1;
      return 0;
    });
    
    // Apply pagination manually
    const paginatedPayrolls = allPayrolls.slice(skip, skip + perPage);

    return res.status(200).json({
      success: true,
      data: paginatedPayrolls,
      total: totalCount,
      page,
      perPage,
      totalPages: Math.ceil(totalCount / perPage)
    });
    
  } catch (error) {
    console.error('Error fetching payrolls:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch payrolls',
      error: error.message
    });
  }
};

module.exports = {
  generateHourlyPayroll: exports.generateHourlyPayroll,
  listHourlyPayrolls: exports.listHourlyPayrolls,
  getHourlyPayrollById: exports.getHourlyPayrollById,
  updateHourlyPayroll: exports.updateHourlyPayroll,
  deleteHourlyPayroll: exports.deleteHourlyPayroll,
  getHourlyPayslip: exports.getHourlyPayslip,
  
  generateMonthlyPayroll: exports.generateMonthlyPayroll,
  listMonthlyPayrolls: exports.listMonthlyPayrolls,
  getMonthlyPayrollById: exports.getMonthlyPayrollById,
  updateMonthlyPayroll: exports.updateMonthlyPayroll,
  deleteMonthlyPayroll: exports.deleteMonthlyPayroll,
  getMonthlyPayslip: exports.getMonthlyPayslip,
  
  listAllPayrolls: exports.listAllPayrolls
};

