const { successResponse, errorRresponse } = require("../utils/response");
const PayRoll = require("../models/payRoll"); 
const moment = require("moment");
const PayrollHourly = require('../models/PayrollHourly');
const PayrollMonthly = require('../models/PayrollMonthly');
const DailyAttendance = require('../models/dailyAttendance'); 
const Employee = require('../models/employee');
const OtherDeduction = require('../models/otherDeduction');
const OtherIncentive = require('../models/otherIncentives');

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
      
      // Get other incentives for this employee within date range that are not processed yet
      const incentiveRecords = await OtherIncentive.find({
        employeeId: employee._id,
        incentiveDate: { $gte: new Date(startDate), $lte: new Date(endDate) },
        processed: false
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
      
      // Calculate total incentives
      let totalIncentives = 0;
      const incentiveDetails = [];
      
      for (const incentive of incentiveRecords) {
        totalIncentives += incentive.amount;
        incentiveDetails.push({
          id: incentive._id,
          type: incentive.incentiveType,
          amount: incentive.amount,
          date: incentive.incentiveDate,
          description: incentive.description
        });
      }
      
      // Adjust net salary with incentives
      const finalNetSalary = netSalary + totalIncentives;
      
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
        otherIncentives: totalIncentives,
        incentiveDetails,
        netSalary: finalNetSalary,
        dailyCalculations,
        status: 'Generated',
      });
      
      // Mark all processed incentives as processed
      if (incentiveRecords.length > 0) {
        await OtherIncentive.updateMany(
          { _id: { $in: incentiveRecords.map(inc => inc._id) } },
          { processed: true }
        );
      }
      
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
    
    await PayrollHourly.deleteOne({ _id: req.params.id });
    
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
      
      // Get other incentives for this employee within date range that are not processed yet
      const incentiveRecords = await OtherIncentive.find({
        employeeId: employee._id,
        incentiveDate: { $gte: new Date(startDate), $lte: new Date(endDate) },
        processed: false,
        status: "Approved"
      });
      
      // Calculate salary based on monthly rules
      const {
        grossSalary,
        absentDays,
        absentDeductions,
        otherDeductions,
        netSalary,
        dailyCalculations
      } = calculateMonthlySalary(employee, attendanceRecords, fineRecords);
      
      // Calculate total incentives
      let totalIncentives = 0;
      const incentiveDetails = [];
      
      for (const incentive of incentiveRecords) {
        totalIncentives += incentive.amount;
        incentiveDetails.push({
          id: incentive._id,
          type: incentive.incentiveType,
          amount: incentive.amount,
          date: incentive.incentiveDate,
          description: incentive.description
        });
      }
      
      // Adjust net salary with incentives
      const finalNetSalary = netSalary + totalIncentives;
      
      // Create payroll record
      const payroll = await PayrollMonthly.create({
        employeeId: employee._id,
        employeeName: employee.name,
        designation: employee.designation,
        startDate,
        endDate,
        grossSalary,
        absentDays,
        absentDeductions,
        otherDeductions,
        otherIncentives: totalIncentives,
        incentiveDetails,
        netSalary: finalNetSalary,
        dailyCalculations,
        status: 'Generated',
      });
      
      // Mark all processed incentives as processed
      if (incentiveRecords.length > 0) {
        await OtherIncentive.updateMany(
          { _id: { $in: incentiveRecords.map(inc => inc._id) } },
          { processed: true }
        );
      }
      
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
    
    await PayrollMonthly.deleteOne({ _id: req.params.id });
    
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
  
  // Calculate per hour and per minute salary according to specifications
  const workingDays = 26; // As specified in requirements
  const shiftHours = 8; // As specified in requirements
  const perHourRate = grossSalary / (workingDays * shiftHours);
  const perMinuteRate = perHourRate / 60;
  
  // Initialize payable hours
  let payableHours = 0;
  
  // Create a detailed breakdown of day-by-day calculations
  const dailyCalculations = [];
  
  // Check if employee is leadership role for different fine structure
  const isLeadership = ['Team Lead', 'Supervisor', 'Project Manager'].includes(employee.designation);
  
  // Process attendance records for payroll calculations
  attendanceRecords.forEach(record => {
    let dailyPayableMinutes = 0;
    let dailyOvertimeMinutes = 0;
    let dailyLateFine = 0;
    let dailyOvertimePay = 0;
    let status = record.status || 'Present';
    
    const dailyCalc = {
      date: record.date,
      status: status,
      checkinStatus: record.checkinStatus || 'On Time',
      checkoutStatus: record.checkoutStatus || 'On Time',
      isOverTime: record.isOverTime || false,
      overTimeStatus: record.overTimeStatus || 'Not Applicable',
      workDuration: record.workDuration || 0,
      lateArrival: record.lateArrival || 0,
      payableHours: 0, // Will be calculated below
      overtimeMinutes: 0,
      dailyPay: 0,
      overtimePay: 0,
      lateFine: 0,
      totalDailyPay: 0,
      notes: ''
    };
    
    // Calculate payable minutes based on overtime status and approval
    if (record.isOverTime) {
      if (record.overTimeStatus === "Approved") {
        // Use workDuration minutes and add to payable hours
        dailyPayableMinutes = record.workDuration || 0;
        dailyOvertimeMinutes = record.overTimeMinutes || 0;
        
        // Calculate overtime pay based on leadership role
        if (isLeadership) {
          if (dailyOvertimeMinutes <= 60) {
            // Standard rate for <= 60 mins
            dailyOvertimePay = dailyOvertimeMinutes * perMinuteRate;
            dailyCalc.notes = `Work: ${dailyPayableMinutes}min | OT: ${dailyOvertimeMinutes}min @ 1x rate (Leadership ≤60min) | Status: Approved`;
          } else {
            // Double rate for > 60 mins
            dailyOvertimePay = dailyOvertimeMinutes * perMinuteRate * 2;
            dailyCalc.notes = `Work: ${dailyPayableMinutes}min | OT: ${dailyOvertimeMinutes}min @ 2x rate (Leadership >60min) | Status: Approved`;
          }
        } else {
          // Standard per-minute rate for non-leadership
          dailyOvertimePay = dailyOvertimeMinutes * perMinuteRate;
          dailyCalc.notes = `Work: ${dailyPayableMinutes}min | OT: ${dailyOvertimeMinutes}min @ 1x rate (Regular employee) | Status: Approved`;
        }
        
      } else if (record.overTimeStatus === "Pending" || record.overTimeStatus === "Rejected") {
        // Complex logic based on checkin/checkout status
        if (record.checkinStatus === "Early" && (record.checkoutStatus === "Early" || record.checkoutStatus === "On Time")) {
          // expectedCheckinTime → lastExit
          const expectedCheckinTime = new Date(record.expectedCheckinTime);
          const lastExit = new Date(record.lastExit);
          if (lastExit > expectedCheckinTime) {
            dailyPayableMinutes = Math.floor((lastExit - expectedCheckinTime) / (1000 * 60));
          }
          dailyCalc.notes = `OT ${record.overTimeStatus} | Early checkin → Last exit | Payable: ${dailyPayableMinutes}min | Checkin: Early, Checkout: ${record.checkoutStatus}`;
          
        } else if (record.checkoutStatus === "Late" && (record.checkinStatus === "Late" || record.checkinStatus === "On Time")) {
          // firstEntry → expectedCheckoutTime
          const firstEntry = new Date(record.firstEntry);
          const expectedCheckoutTime = new Date(record.expectedCheckoutTime);
          if (expectedCheckoutTime > firstEntry) {
            dailyPayableMinutes = Math.floor((expectedCheckoutTime - firstEntry) / (1000 * 60));
          }
          dailyCalc.notes = `OT ${record.overTimeStatus} | First entry → Expected checkout | Payable: ${dailyPayableMinutes}min | Checkin: ${record.checkinStatus}, Checkout: Late`;
          
        } else if (record.checkinStatus === "Early" && record.checkoutStatus === "Late") {
          // expectedCheckinTime → expectedCheckoutTime
          const expectedCheckinTime = new Date(record.expectedCheckinTime);
          const expectedCheckoutTime = new Date(record.expectedCheckoutTime);
          if (expectedCheckoutTime > expectedCheckinTime) {
            dailyPayableMinutes = Math.floor((expectedCheckoutTime - expectedCheckinTime) / (1000 * 60));
          }
          dailyCalc.notes = `OT ${record.overTimeStatus} | Expected shift duration | Payable: ${dailyPayableMinutes}min | Checkin: Early, Checkout: Late`;
        } else {
          // Fallback to work duration
          dailyPayableMinutes = record.workDuration || 0;
          dailyCalc.notes = `OT ${record.overTimeStatus} | Using work duration as fallback | Payable: ${dailyPayableMinutes}min | Checkin: ${record.checkinStatus}, Checkout: ${record.checkoutStatus}`;
        }
      }
    } else {
      // If isOverTime === false: Use workDuration minutes as payable time
      dailyPayableMinutes = record.workDuration || 0;
      dailyCalc.notes = `Regular shift | Work duration: ${dailyPayableMinutes}min | No overtime claimed`;
    }
    
    // Convert minutes to hours for payable hours tracking
    const dailyPayableHours = dailyPayableMinutes / 60;
    payableHours += dailyPayableHours;
    
    // Calculate daily pay based on payable minutes
    const dailyRegularPay = dailyPayableMinutes * perMinuteRate;
    
    // Late arrival fines (only for working days)
    if (record.lateArrival && (status === 'Present' || status === 'Late')) {
      const lateMinutes = record.lateArrival;
      
      if (isLeadership) {
        // Leadership fine structure
        if (lateMinutes > 120) {
          dailyLateFine = 4000;
          dailyCalc.notes += ` | Late: ${lateMinutes}min → Fine: ₹4000 (Leadership >120min)`;
        } else if (lateMinutes > 20) {
          dailyLateFine = 2000;
          dailyCalc.notes += ` | Late: ${lateMinutes}min → Fine: ₹2000 (Leadership >20min)`;
        } else if (lateMinutes > 1) {
          dailyLateFine = 1000;
          dailyCalc.notes += ` | Late: ${lateMinutes}min → Fine: ₹1000 (Leadership >1min)`;
        }
      } else {
        // Non-leadership fine structure
        if (lateMinutes > 120) {
          dailyLateFine = 2000;
          dailyCalc.notes += ` | Late: ${lateMinutes}min → Fine: ₹2000 (Regular >120min)`;
        } else if (lateMinutes > 20) {
          dailyLateFine = 1000;
          dailyCalc.notes += ` | Late: ${lateMinutes}min → Fine: ₹1000 (Regular >20min)`;
        } else if (lateMinutes > 1) {
          dailyLateFine = 500;
          dailyCalc.notes += ` | Late: ${lateMinutes}min → Fine: ₹500 (Regular >1min)`;
        }
      }
      
      lateFines += dailyLateFine;
    } else if (record.lateArrival && record.lateArrival > 0) {
      dailyCalc.notes += ` | Late: ${record.lateArrival}min (No fine - non-working status)`;
    }
    
    // Update daily calculation object
    dailyCalc.payableHours = (dailyPayableMinutes / 60).toFixed(2); // Convert to hours with 2 decimal places
    dailyCalc.overtimeMinutes = dailyOvertimeMinutes;
    dailyCalc.dailyPay = dailyRegularPay;
    dailyCalc.overtimePay = dailyOvertimePay;
    dailyCalc.lateFine = dailyLateFine;
    dailyCalc.totalDailyPay = (dailyPayableMinutes * perMinuteRate) + dailyOvertimePay - dailyLateFine;
    
    // Add calculation summary to notes
    if (dailyPayableMinutes > 0) {
      dailyCalc.notes += ` | Pay: ₹${dailyCalc.dailyPay.toFixed(2)}`;
      if (dailyOvertimePay > 0) {
        dailyCalc.notes += ` + OT: ₹${dailyOvertimePay.toFixed(2)}`;
      }
      if (dailyLateFine > 0) {
        dailyCalc.notes += ` - Fine: ₹${dailyLateFine}`;
      }
      dailyCalc.notes += ` = Total: ₹${dailyCalc.totalDailyPay.toFixed(2)}`;
    } else {
      dailyCalc.notes += ` | No payable time recorded`;
    }
    
    overtimePay += dailyOvertimePay;
    
    dailyCalculations.push(dailyCalc);
  });
  
  // Add other fines/deductions from monthly deductions
  fineRecords.forEach(fine => {
    otherDeductions += fine.amount || 0;
    
    // Add the fine to daily calculations for transparency
    dailyCalculations.push({
      date: fine.date,
      status: 'Fine/Deduction',
      isDayDeducted: false,
      dailyDeduction: 0,
      otherDeduction: fine.amount || 0,
      notes: `Additional monthly deduction: ₹${fine.amount || 0} | Reason: ${fine.reason || 'Other deduction'}`
    });
  });
  
  // Calculate salary components
  const actualGrossSalary = payableHours * perHourRate;
  const netSalary = actualGrossSalary - lateFines - otherDeductions + overtimePay;
  
  return {
    grossSalary: grossSalary, // Monthly base salary for reference
    actualGrossSalary: actualGrossSalary, // Salary based on actual hours worked
    perHourRate: perHourRate,
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
  
  // Calculate per day salary for absence deductions
  const workingDaysInMonth = 26; // As per specifications
  const perDayDeduction = grossSalary / workingDaysInMonth;
  
  // Count absent days and calculate deductions
  let absentDays = 0;
  const dailyCalculations = [];
  
  attendanceRecords.forEach(record => {
    const status = record.status || 'Present';
    let isDayDeducted = false;
    let dailyDeduction = 0;
    
    // If a daily attendance record's status === "Absent", deduct 1 full day's pay
    if (status === 'Absent') {
      absentDays++;
      dailyDeduction = perDayDeduction;
      absentDeductions += perDayDeduction;
      isDayDeducted = true;
    }
    
    dailyCalculations.push({
      date: record.date,
      status: status,
      isDayDeducted: isDayDeducted,
      dailyDeduction: dailyDeduction,
      notes: isDayDeducted ? 'Absent - full day deduction' : 'Present - full pay'
    });
  });
  
  // Add other fines/deductions from monthly deductions
  fineRecords.forEach(fine => {
    otherDeductions += fine.amount || 0;
    
    // Add the fine to daily calculations for transparency
    dailyCalculations.push({
      date: fine.date,
      status: 'Fine/Deduction',
      isDayDeducted: false,
      dailyDeduction: 0,
      otherDeduction: fine.amount || 0,
      notes: `Additional monthly deduction: ₹${fine.amount || 0} | Reason: ${fine.reason || 'Other deduction'}`
    });
  });
  
  // Final salary = monthly salary − absent day deductions − additional fines/deductions
  const netSalary = grossSalary - absentDeductions - otherDeductions;
  
  return {
    grossSalary,
    absentDays,
    absentDeductions,
    otherDeductions,
    netSalary,
    dailyCalculations
  };
}

// Get unprocessed incentives for an employee
exports.getUnprocessedIncentives = async (req, res) => {
  try {
    const { employeeId, startDate, endDate } = req.query;
    
    if (!employeeId) {
      return res.status(400).json({ success: false, message: 'Employee ID is required' });
    }
    
    // Build query
    const query = {
      employeeId,
      processed: false,
    };
    
    // Add date range if provided
    if (startDate || endDate) {
      query.incentiveDate = {};
      if (startDate) query.incentiveDate.$gte = new Date(startDate);
      if (endDate) {
        const endDateObj = new Date(endDate);
        endDateObj.setHours(23, 59, 59, 999);
        query.incentiveDate.$lte = endDateObj;
      }
    }
    
    // Find incentives
    const incentives = await OtherIncentive.find(query);
    
    // Calculate total
    const totalAmount = incentives.reduce((sum, incentive) => sum + incentive.amount, 0);
    
    return res.status(200).json({
      success: true,
      message: 'Unprocessed incentives fetched successfully',
      data: {
        incentives,
        totalAmount,
        count: incentives.length
      }
    });
  } catch (error) {
    console.error('Error fetching unprocessed incentives:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch unprocessed incentives',
      error: error.message
    });
  }
};

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
  
  listAllPayrolls: exports.listAllPayrolls,
  getUnprocessedIncentives: exports.getUnprocessedIncentives
};

