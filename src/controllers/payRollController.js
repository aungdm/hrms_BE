const { successResponse, errorRresponse } = require("../utils/response");
const PayRoll = require("../models/payRoll"); 
const moment = require("moment");
const PayrollHourly = require('../models/PayrollHourly');
const PayrollMonthly = require('../models/PayrollMonthly');
const DailyAttendance = require('../models/dailyAttendance'); 
const Employee = require('../models/employee');
const OtherDeduction = require('../models/otherDeduction');
const OtherIncentive = require('../models/otherIncentives');
const Arrears = require('../models/arrears');
const FineDeduction = require('../models/fineDeduction');
const AdvancedSalary = require('../models/advancedSalary');

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
      
      // Get other incentives for this employee within date range that are not processed yet
      const incentiveRecords = await OtherIncentive.find({
        employeeId: employee._id,
        incentiveDate: { $gte: new Date(startDate), $lte: new Date(endDate) },
        processed: false,
        // status: "Approved"
      });
      console.log({incentiveRecords} , "hourly incentiveRecords")
      
      // Get arrears for this employee within date range that are not processed yet
      const arrearsRecords = await Arrears.find({
        employeeId: employee._id,
        deductionDate: { $gte: new Date(startDate), $lte: new Date(endDate) },
        processed: false,
        // status: "Approved"
      });
      console.log({arrearsRecords} , "hourly arrearsRecords")
      
      // Get fine deductions for this employee within date range that are not processed yet
      const fineDeductionRecords = await FineDeduction.find({
        employeeId: employee._id,
        deductionDate: { $gte: new Date(startDate), $lte: new Date(endDate) },
        processed: false,
        // status: "Approved"
      });
      console.log({fineDeductionRecords} , "hourly fineDeductionRecords")

      const otherDeductionRecords = await OtherDeduction.find({
        employeeId: employee._id,
        deductionDate: { $gte: new Date(startDate), $lte: new Date(endDate) },
        processed: false,
        // status: "Approved"
      });
      console.log({otherDeductionRecords} , "hourly otherDeductionRecords")
      
      // Get advanced salary for this employee that are approved and not processed yet
      console.log({startDate, endDate} , "hourly startDate, endDate")
      const advancedSalaryRecords = await AdvancedSalary.find({
        employeeId: employee._id,
        requiredDate: { $gte: new Date(startDate), $lte: new Date(endDate) },
        status: "Approved",
        processed: false
      });
      console.log({advancedSalaryRecords}, "hourly advancedSalaryRecords");
      
      // Calculate salary based on hourly rules
      const {
        grossSalary,
        actualGrossSalary,
        perHourRate,
        payableHours,
        lateFines,
        absentDays,
        absentDeductions,
        overtimePay,
        netSalary,
        dailyCalculations
      } = calculateHourlySalary(employee, attendanceRecords);
      
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
      
      // Calculate total arrears
      let totalArrears = 0;
      const arrearsDetails = [];
      
      for (const arrears of arrearsRecords) {
        totalArrears += arrears.amount;
        arrearsDetails.push({
          id: arrears._id,
          type: arrears.deductionType,
          amount: arrears.amount,
          date: arrears.deductionDate,
          description: arrears.description
        });
      }
      
      // Calculate total fine deductions
      let totalFineDeductions = 0;
      const fineDeductionDetails = [];
      
      for (const fineDeduction of fineDeductionRecords) {
        totalFineDeductions += fineDeduction.amount;
        fineDeductionDetails.push({
          id: fineDeduction._id,
          type: fineDeduction.deductionType,
          amount: fineDeduction.amount,
          date: fineDeduction.deductionDate,
          description: fineDeduction.description
        });
      }

      let totalOtherDeductions = 0;
      const otherDeductionDetails = [];
      
      for (const otherDeduction of otherDeductionRecords) {
        totalOtherDeductions += otherDeduction.amount;
        otherDeductionDetails.push({
          id: otherDeduction._id,
          type: otherDeduction.deductionType,
          amount: otherDeduction.amount,
          date: otherDeduction.deductionDate,
          description: otherDeduction.description
        });
      }
      console.log({totalOtherDeductions}, "hourly totalOtherDeductions")
      
      // Calculate total advanced salary deductions
      let totalAdvancedSalary = 0;
      const advancedSalaryDetails = [];
      
      for (const advancedSalary of advancedSalaryRecords) {
        totalAdvancedSalary += advancedSalary.approvedAmount;
        advancedSalaryDetails.push({
          id: advancedSalary._id,
          amount: advancedSalary.approvedAmount,
          date: advancedSalary.approvalDate,
          requestDate: advancedSalary.requestDate,
          description: advancedSalary.description || "Advanced Salary"
        });
      }
      console.log({advancedSalaryRecords}, {totalAdvancedSalary}, "hourly advancedSalaryRecords");
      
      // Adjust net salary with incentives, arrears, fine deductions, other deductions, and advanced salary
      const finalNetSalary = netSalary + totalIncentives + totalArrears - totalFineDeductions - totalOtherDeductions - totalAdvancedSalary;
      console.log({finalNetSalary} , "hourly finalNetSalary")

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
        otherDeductions: totalOtherDeductions,
        otherDeductionDetails,
        absentDays,
        absentDeductions,
        overtimePay,
        otherIncentives: totalIncentives,
        incentiveDetails,
        arrears: totalArrears,
        arrearsDetails,
        fineDeductions: totalFineDeductions,
        fineDeductionDetails,
        advancedSalary: totalAdvancedSalary,
        advancedSalaryDetails,
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
      
      // Mark all processed arrears as processed
      if (arrearsRecords.length > 0) {
        await Arrears.updateMany(
          { _id: { $in: arrearsRecords.map(arr => arr._id) } },
          { processed: true }
        );
      }
      
      // Mark all processed fine deductions as processed
      if (fineDeductionRecords.length > 0) {
          await FineDeduction.updateMany(
            { _id: { $in: fineDeductionRecords.map(fine => fine._id) } },
            { processed: true }
          );
        }

        if (otherDeductionRecords.length > 0) {
          await OtherDeduction.updateMany(
            { _id: { $in: otherDeductionRecords.map(other => other._id) } },
            { processed: true }
          );
        }
      
      // Mark all processed advanced salaries as processed
      if (advancedSalaryRecords.length > 0) {
        await AdvancedSalary.updateMany(
          { _id: { $in: advancedSalaryRecords.map(adv => adv._id) } },
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
    
    // Add payroll type for frontend identification
    const payrollData = payroll.toObject();
    payrollData.payrollType = 'Hourly';
    
    // Ensure incentive details are included
    if (!payrollData.otherIncentives) payrollData.otherIncentives = 0;
    if (!payrollData.incentiveDetails) payrollData.incentiveDetails = [];
    
    // Ensure arrears details are included
    if (!payrollData.arrears) payrollData.arrears = 0;
    if (!payrollData.arrearsDetails) payrollData.arrearsDetails = [];
    
    // Ensure fine deduction details are included
    if (!payrollData.fineDeductions) payrollData.fineDeductions = 0;
    if (!payrollData.fineDeductionDetails) payrollData.fineDeductionDetails = [];
    
    // Ensure other deduction details are included
    if (!payrollData.otherDeductionDetails) payrollData.otherDeductionDetails = [];
    
    // Ensure absent days and deductions are included
    if (!payrollData.absentDays) payrollData.absentDays = 0;
    if (!payrollData.absentDeductions) payrollData.absentDeductions = 0;
    
    return res.status(200).json({
      success: true,
      data: payrollData
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
    const { grossSalary, lateFines, otherDeductions, overtimePay, missingDeduction, netSalary, status } = req.body;
    
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
    if (missingDeduction !== undefined) payroll.missingDeduction = missingDeduction;
    if (netSalary !== undefined) payroll.netSalary = netSalary;
    if (status) payroll.status = status;
    
    // Recalculate net salary if components changed but net not provided
    if ((grossSalary !== undefined || lateFines !== undefined || otherDeductions !== undefined || 
         overtimePay !== undefined || missingDeduction !== undefined) && netSalary === undefined) {
      payroll.netSalary = payroll.grossSalary - payroll.lateFines - payroll.otherDeductions + 
                          payroll.overtimePay - (payroll.missingDeduction || 0) +
                          (payroll.otherIncentives || 0) + (payroll.arrears || 0) - 
                          (payroll.fineDeductions || 0) - (payroll.advancedSalary || 0) - 
                          (payroll.absentDeductions || 0);
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
        otherDeductionDetails: payroll.otherDeductionDetails || [],
        absentDays: payroll.absentDays || 0,
        absentDeductions: payroll.absentDeductions || 0,
        overtimePay: payroll.overtimePay,
        otherIncentives: payroll.otherIncentives || 0,
        incentiveDetails: payroll.incentiveDetails || [],
        arrears: payroll.arrears || 0,
        arrearsDetails: payroll.arrearsDetails || [],
        fineDeductions: payroll.fineDeductions || 0,
        fineDeductionDetails: payroll.fineDeductionDetails || [],
        advancedSalary: payroll.advancedSalary || 0,
        advancedSalaryDetails: payroll.advancedSalaryDetails || [],
        missingDeduction: payroll.missingDeduction || 0,
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
      
      // Get other incentives for this employee within date range that are not processed yet
      const incentiveRecords = await OtherIncentive.find({
        employeeId: employee._id,
        incentiveDate: { $gte: new Date(startDate), $lte: new Date(endDate) },
        processed: false,
      });
      console.log({incentiveRecords})
       
      // Get arrears for this employee within date range that are not processed yet
      const arrearsRecords = await Arrears.find({
        employeeId: employee._id,
        deductionDate: { $gte: new Date(startDate), $lte: new Date(endDate) },
        processed: false,
      });
      console.log({arrearsRecords})
      
      // Get fine deductions for this employee within date range that are not processed yet
      const fineDeductionRecords = await FineDeduction.find({
        employeeId: employee._id,
        deductionDate: { $gte: new Date(startDate), $lte: new Date(endDate) },
        processed: false,
      });
      console.log({fineDeductionRecords}, "monthly fineDeductionRecords")
      
      // Get other deductions for this employee within date range that are not processed yet
      const otherDeductionRecords = await OtherDeduction.find({
        employeeId: employee._id,
        deductionDate: { $gte: new Date(startDate), $lte: new Date(endDate) },
        processed: false,
      });
      console.log({otherDeductionRecords}, "monthly otherDeductionRecords")
      
      // Get advanced salary for this employee that are approved and not processed yet
      const advancedSalaryRecords = await AdvancedSalary.find({
        employeeId: employee._id,
        requiredDate: { $gte: new Date(startDate), $lte: new Date(endDate) },
        status: "Approved",
        processed: false
      });
      console.log({advancedSalaryRecords}, "monthly advancedSalaryRecords");
      
      // Calculate salary based on monthly rules
      const {
        grossSalary,
        absentDays,
        absentDeductions,
        netSalary,
        dailyCalculations
      } = calculateMonthlySalary(employee, attendanceRecords);
      
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
      
      // Calculate total arrears
      let totalArrears = 0;
      const arrearsDetails = [];
      
      for (const arrears of arrearsRecords) {
        totalArrears += arrears.amount;
        arrearsDetails.push({
          id: arrears._id,
          type: arrears.deductionType,
          amount: arrears.amount,
          date: arrears.deductionDate,
          description: arrears.description
        });
      }
      
      // Calculate total fine deductions
      let totalFineDeductions = 0;
      const fineDeductionDetails = [];
      
      for (const fineDeduction of fineDeductionRecords) {
        totalFineDeductions += fineDeduction.amount;
        fineDeductionDetails.push({
          id: fineDeduction._id,
          type: fineDeduction.deductionType,
          amount: fineDeduction.amount,
          date: fineDeduction.deductionDate,
          description: fineDeduction.description
        });
      }
      
      // Calculate total other deductions
      let totalOtherDeductions = 0;
      const otherDeductionDetails = [];
      
      for (const otherDeduction of otherDeductionRecords) {
        totalOtherDeductions += otherDeduction.amount;
        otherDeductionDetails.push({
          id: otherDeduction._id,
          type: otherDeduction.deductionType,
          amount: otherDeduction.amount,
          date: otherDeduction.deductionDate,
          description: otherDeduction.description
        });
      }
      
      // Calculate total advanced salary deductions
      let totalAdvancedSalary = 0;
      const advancedSalaryDetails = [];
      
      for (const advancedSalary of advancedSalaryRecords) {
        totalAdvancedSalary += advancedSalary.approvedAmount;
        advancedSalaryDetails.push({
          id: advancedSalary._id,
          amount: advancedSalary.approvedAmount,
          date: advancedSalary.approvalDate,
          requestDate: advancedSalary.requestDate,
          description: advancedSalary.description || "Advanced Salary"
        });
      }
      console.log({advancedSalaryRecords}, {totalAdvancedSalary}, "monthly advancedSalaryRecords");
      
      // Adjust net salary with incentives, arrears, fine deductions, other deductions, and advanced salary
      const finalNetSalary = netSalary + totalIncentives + totalArrears - totalFineDeductions - totalOtherDeductions - totalAdvancedSalary;
      
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
        otherDeductions: totalOtherDeductions,
        otherDeductionDetails,
        otherIncentives: totalIncentives,
        incentiveDetails,
        arrears: totalArrears,
        arrearsDetails,
        fineDeductions: totalFineDeductions,
        fineDeductionDetails,
        advancedSalary: totalAdvancedSalary,
        advancedSalaryDetails,
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
      
      // Mark all processed arrears as processed
      if (arrearsRecords.length > 0) {
        await Arrears.updateMany(
          { _id: { $in: arrearsRecords.map(arr => arr._id) } },
          { processed: true }
        );
      }
      
      // Mark all processed fine deductions as processed
      if (fineDeductionRecords.length > 0) {
        await FineDeduction.updateMany(
          { _id: { $in: fineDeductionRecords.map(fine => fine._id) } },
          { processed: true }
        );
      }
      
      // Mark all processed other deductions as processed
      if (otherDeductionRecords.length > 0) {
        await OtherDeduction.updateMany(
          { _id: { $in: otherDeductionRecords.map(other => other._id) } },
          { processed: true }
        );
      }
      
      // Mark all processed advanced salaries as processed
      if (advancedSalaryRecords.length > 0) {
        await AdvancedSalary.updateMany(
          { _id: { $in: advancedSalaryRecords.map(adv => adv._id) } },
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
    
    // Add payroll type for frontend identification
    const payrollData = payroll.toObject();
    payrollData.payrollType = 'Monthly';
    
    // Ensure incentive details are included
    if (!payrollData.otherIncentives) payrollData.otherIncentives = 0;
    if (!payrollData.incentiveDetails) payrollData.incentiveDetails = [];
    
    // Ensure arrears details are included
    if (!payrollData.arrears) payrollData.arrears = 0;
    if (!payrollData.arrearsDetails) payrollData.arrearsDetails = [];
    
    // Ensure fine deduction details are included
    if (!payrollData.fineDeductions) payrollData.fineDeductions = 0;
    if (!payrollData.fineDeductionDetails) payrollData.fineDeductionDetails = [];
    
    // Ensure other deduction details are included
    if (!payrollData.otherDeductionDetails) payrollData.otherDeductionDetails = [];
    
    return res.status(200).json({
      success: true,
      data: payrollData
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
    const { grossSalary, absentDeductions, otherDeductions, missingDeduction, netSalary, status } = req.body;
    
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
    if (missingDeduction !== undefined) payroll.missingDeduction = missingDeduction;
    if (netSalary !== undefined) payroll.netSalary = netSalary;
    if (status) payroll.status = status;
    
    // Recalculate net salary if components changed but net not provided
    if ((grossSalary !== undefined || absentDeductions !== undefined || otherDeductions !== undefined ||
         missingDeduction !== undefined) && netSalary === undefined) {
      payroll.netSalary = payroll.grossSalary - payroll.absentDeductions - payroll.otherDeductions - 
                          (payroll.missingDeduction || 0) + (payroll.otherIncentives || 0) + 
                          (payroll.arrears || 0) - (payroll.fineDeductions || 0) - 
                          (payroll.advancedSalary || 0);
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
        otherDeductionDetails: payroll.otherDeductionDetails || [],
        otherIncentives: payroll.otherIncentives || 0,
        incentiveDetails: payroll.incentiveDetails || [],
        arrears: payroll.arrears || 0,
        arrearsDetails: payroll.arrearsDetails || [],
        fineDeductions: payroll.fineDeductions || 0,
        fineDeductionDetails: payroll.fineDeductionDetails || [],
        advancedSalary: payroll.advancedSalary || 0,
        advancedSalaryDetails: payroll.advancedSalaryDetails || [],
        missingDeduction: payroll.missingDeduction || 0,
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
function calculateHourlySalary(employee, attendanceRecords) {
  // Use after_probation_gross_salary as the base salary
  let grossSalary = parseFloat(employee.after_probation_gross_salary) || 0;
  let lateFines = 0;
  let overtimePay = 0;
  let absentDeductions = 0;
  
  // Calculate per hour and per minute salary according to specifications
  const workingDays = 26; // As specified in requirements
  const shiftHours = 8; // As specified in requirements
  const perHourRate = grossSalary / (workingDays * shiftHours);
  const perMinuteRate = perHourRate / 60;
  const perDayRate = grossSalary / workingDays;
  
  // Initialize payable hours and track absent days
  let payableHours = 0;
  let absentDays = 0;
  
  // Create a detailed breakdown of day-by-day calculations
  const dailyCalculations = [];
  
  // Check if employee is leadership role for different fine structure
  const isLeadership = ['Team Lead', 'Supervisor', 'Project Manager'].includes(employee.designation);
  
  // Count late arrivals to exempt the first three
  let lateArrivalCount = 0;
  
  // First pass: Count the number of late arrivals
  attendanceRecords.forEach(record => {
    if (record.lateArrival && record.lateArrival > 0 && 
        (record.status === 'Present' || record.status === 'Late')) {
      lateArrivalCount++;
    }
  });
  
  // Create a set of dates covered by attendance records to track missing days
  const datesWithRecords = new Set(attendanceRecords.map(record => 
    new Date(record.date).toISOString().split('T')[0]
  ));
  
  // Process attendance records for payroll calculations
  attendanceRecords.forEach(record => {
    let dailyPayableMinutes = 0;
    let dailyOvertimeMinutes = 0;
    let dailyLateFine = 0;
    let dailyOvertimePay = 0;
    let dailyAbsentDeduction = 0;
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
      absentDeduction: 0,
      totalDailyPay: 0,
      notes: ''
    };
    
    // Check for absent status and apply deduction
    if (status === 'Absent') {
      absentDays++;
      dailyAbsentDeduction = 10000; // Fixed deduction for hourly employees
      absentDeductions += dailyAbsentDeduction;
      dailyCalc.absentDeduction = dailyAbsentDeduction;
      dailyCalc.notes = `Absent - Deduction: ₹${dailyAbsentDeduction}`;
      
      // Add to daily calculations and skip the rest of the processing
      dailyCalculations.push(dailyCalc);
      return;
    }
    
    // Calculate payable minutes based on overtime status and approval
    if (record.isOverTime) {
      if (record.overTimeStatus === "Approved") {
        // Use workDuration minutes minus overtime minutes for payable hours
        dailyOvertimeMinutes = record.overTimeMinutes || 0;
        dailyPayableMinutes = (record.workDuration || 0) - dailyOvertimeMinutes;
        
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
    if (record.lateArrival) {
      const lateMinutes = record.lateArrival;
      
      // Get the position of this late arrival in the overall count
      const currentLatePosition = attendanceRecords
        .filter(r => r.date <= record.date && r.lateArrival > 0 )
        .length;
      
      // Only apply fine if this is the 4th or later late arrival
      if (currentLatePosition > 3) {
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
      } else {
        // First three late arrivals are not fined
        dailyCalc.notes += ` | Late: ${lateMinutes}min (No fine - within first 3 late arrivals)`;
      }
    } else if (record.lateArrival && record.lateArrival > 0) {
      dailyCalc.notes += ` | Late: ${record.lateArrival}min (No fine - non-working status)`;
    }
    
    // Update daily calculation object
    dailyCalc.payableHours = (dailyPayableMinutes / 60).toFixed(2); // Convert to hours with 2 decimal places
    dailyCalc.overtimeMinutes = dailyOvertimeMinutes;
    dailyCalc.dailyPay = dailyRegularPay;
    dailyCalc.overtimePay = dailyOvertimePay;
    dailyCalc.lateFine = dailyLateFine;
    dailyCalc.absentDeduction = dailyAbsentDeduction;
    dailyCalc.totalDailyPay = (dailyPayableMinutes * perMinuteRate) + dailyOvertimePay - dailyLateFine - dailyAbsentDeduction;
    
    // Add calculation summary to notes
    if (dailyPayableMinutes > 0) {
      dailyCalc.notes += ` | Pay: ₹${dailyCalc.dailyPay.toFixed(2)}`;
      if (dailyOvertimePay > 0) {
        dailyCalc.notes += ` + OT: ₹${dailyOvertimePay.toFixed(2)}`;
      }
      if (dailyLateFine > 0) {
        dailyCalc.notes += ` - Fine: ₹${dailyLateFine}`;
      }
      if (dailyAbsentDeduction > 0) {
        dailyCalc.notes += ` - Absent: ₹${dailyAbsentDeduction}`;
      }
      dailyCalc.notes += ` = Total: ₹${dailyCalc.totalDailyPay.toFixed(2)}`;
    } else {
      dailyCalc.notes += ` | No payable time recorded`;
    }
    
    overtimePay += dailyOvertimePay;
    
    dailyCalculations.push(dailyCalc);
  });
  
  // Check for missing workdays (expected 26 days)
  // Get the date range from the attendance records
  if (attendanceRecords.length > 0) {
    const dates = attendanceRecords.map(record => new Date(record.date));
    const minDate = new Date(Math.min(...dates));
    const maxDate = new Date(Math.max(...dates));
    
    // Calculate the number of workdays in the period
    const startMonth = minDate.getMonth();
    const startYear = minDate.getFullYear();
    const endMonth = maxDate.getMonth();
    const endYear = maxDate.getFullYear();
    
    // If we have a full month of data, check for missing workdays
    if ((startMonth === endMonth && startYear === endYear) || 
        (attendanceRecords.length >= workingDays)) {
      // Calculate missing workdays (assuming 26 workdays per month)
      const missingWorkdays = workingDays - attendanceRecords.length;
      
      if (missingWorkdays > 0) {
        // Add deduction for each missing workday
        const missingDayDeduction = 10000; // Fixed deduction per missing day
        const totalMissingDeduction = missingWorkdays * missingDayDeduction;
        
        absentDays += missingWorkdays;
        absentDeductions += totalMissingDeduction;
        
        // Add a summary entry for missing workdays
        dailyCalculations.push({
          date: maxDate,
          status: 'Missing Workdays',
          absentDeduction: totalMissingDeduction,
          notes: `${missingWorkdays} missing workday(s) - Deduction: ₹${totalMissingDeduction} (₹${missingDayDeduction} per day)`
        });
      }
    }
  }
  
  // Calculate salary components
  const actualGrossSalary = payableHours * perHourRate;
  const netSalary = actualGrossSalary - lateFines - absentDeductions;
  
  return {
    grossSalary: grossSalary, // Monthly base salary for reference
    actualGrossSalary: actualGrossSalary, // Salary based on actual hours worked
    perHourRate: perHourRate,
    payableHours,
    lateFines,
    absentDays,
    absentDeductions,
    overtimePay,
    netSalary,
    dailyCalculations
  };
}

// Helper function to calculate monthly salary
function calculateMonthlySalary(employee, attendanceRecords) {
  // Use after_probation_gross_salary as the base salary
  let grossSalary = parseFloat(employee.after_probation_gross_salary) || 0;
  let absentDeductions = 0;
  
  // Calculate per day salary for absence deductions
  const workingDaysInMonth = 30; // As per specifications
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
  
  // Final salary = monthly salary − absent day deductions
  const netSalary = grossSalary - absentDeductions;
  
  return {
    grossSalary,
    absentDays,
    absentDeductions,
    netSalary,
    dailyCalculations
  };
}

// Get unprocessed incentives for an employee
exports.getUnprocessedIncentives = async (req, res) => {
  try {
    const { employeeId, startDate, endDate } = req.query;
    console.log({employeeId, startDate, endDate} , "getUnprocessedIncentives")
    
    if (!employeeId) {
      return res.status(400).json({ success: false, message: 'Employee ID is required' });
    }
    
    // Build query
    const query = {
      employeeId,
      processed: false
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
    console.log({incentives})

    
    // Calculate total for approved incentives only
    const approvedIncentives = incentives.filter(inc => inc.status === 'Approved');
    const totalAmount = approvedIncentives.reduce((sum, incentive) => sum + incentive.amount, 0);
    
    return res.status(200).json({
      success: true,
      message: 'Unprocessed incentives fetched successfully',
      data: {
        incentives,
        approvedIncentives,
        totalAmount,
        count: incentives.length,
        approvedCount: approvedIncentives.length
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

// Get unprocessed arrears for an employee
exports.getUnprocessedArrears = async (req, res) => {
  try {
    const { employeeId, startDate, endDate } = req.query;
    console.log({employeeId, startDate, endDate} , "getUnprocessedArrears")
    if (!employeeId) {
      return res.status(400).json({ success: false, message: 'Employee ID is required' });
    }
    
    // Build query
    const query = {
      employeeId,
      processed: false
    };
    
    // Add date range if provided
    if (startDate || endDate) {
      query.deductionDate = {};
      if (startDate) query.deductionDate.$gte = new Date(startDate);
      if (endDate) {
        const endDateObj = new Date(endDate);
        endDateObj.setHours(23, 59, 59, 999);
        query.deductionDate.$lte = endDateObj;
      }
    }
    
    // Find arrears
    const arrears = await Arrears.find(query);
    console.log({arrears})
    
    // Calculate total for approved arrears only
    const approvedArrears = arrears.filter(arr => arr.status === 'Approved');
    const totalAmount = approvedArrears.reduce((sum, arrears) => sum + arrears.amount, 0);
    
    return res.status(200).json({
      success: true,
      message: 'Unprocessed arrears fetched successfully',
      data: {
        arrears,
        approvedArrears,
        totalAmount,
        count: arrears.length,
        approvedCount: approvedArrears.length
      }
    });
  } catch (error) {
    console.error('Error fetching unprocessed arrears:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch unprocessed arrears',
      error: error.message
    });
  }
};

// Get unprocessed fine deductions for an employee
exports.getUnprocessedFineDeductions = async (req, res) => {
  try {
    const { employeeId, startDate, endDate } = req.query;
    console.log({employeeId, startDate, endDate}, "getUnprocessedFineDeductions")
    
    if (!employeeId) {
      return res.status(400).json({ success: false, message: 'Employee ID is required' });
    }
    
    // Build query
    const query = {
      employeeId,
      processed: false
    };
    
    // Add date range if provided
    if (startDate || endDate) {
      query.deductionDate = {};
      if (startDate) query.deductionDate.$gte = new Date(startDate);
      if (endDate) {
        const endDateObj = new Date(endDate);
        endDateObj.setHours(23, 59, 59, 999);
        query.deductionDate.$lte = endDateObj;
      }
    }
    
    // Find fine deductions
    const fineDeductions = await FineDeduction.find(query);
    console.log({fineDeductions})
    
    // Calculate total for approved fine deductions only
    const approvedFineDeductions = fineDeductions.filter(fine => fine.status === 'Approved');
    const totalAmount = approvedFineDeductions.reduce((sum, fine) => sum + fine.amount, 0);
    
    return res.status(200).json({
      success: true,
      message: 'Unprocessed fine deductions fetched successfully',
      data: {
        fineDeductions,
        approvedFineDeductions,
        totalAmount,
        count: fineDeductions.length,
        approvedCount: approvedFineDeductions.length
      }
    });
  } catch (error) {
    console.error('Error fetching unprocessed fine deductions:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch unprocessed fine deductions',
      error: error.message
    });
  }
};

// Get unprocessed advanced salaries for an employee
exports.getUnprocessedAdvancedSalaries = async (req, res) => {
  try {
    const { employeeId, startDate, endDate } = req.query;
    console.log({employeeId, startDate, endDate}, "getUnprocessedAdvancedSalaries")
    
    if (!employeeId) {
      return res.status(400).json({ success: false, message: 'Employee ID is required' });
    }
    
    // Build query
    const query = {
      employeeId,
      processed: false,
      status: "Approved"
    };
    
    // Add date range if provided
    if (startDate || endDate) {
      query.approvalDate = {};
      if (startDate) query.approvalDate.$gte = new Date(startDate);
      if (endDate) {
        const endDateObj = new Date(endDate);
        endDateObj.setHours(23, 59, 59, 999);
        query.approvalDate.$lte = endDateObj;
      }
    }
    
    // Find advanced salaries
    const advancedSalaries = await AdvancedSalary.find(query);
    console.log({advancedSalaries})
    
    // Calculate total for approved advanced salaries
    const approvedAdvancedSalaries = advancedSalaries.filter(adv => adv.status === 'Approved');
    const totalAmount = approvedAdvancedSalaries.reduce((sum, adv) => sum + adv.approvedAmount, 0);
    
    return res.status(200).json({
      success: true,
      message: 'Unprocessed advanced salaries fetched successfully',
      data: {
        advancedSalaries,
        approvedAdvancedSalaries,
        totalAmount,
        count: advancedSalaries.length,
        approvedCount: approvedAdvancedSalaries.length
      }
    });
  } catch (error) {
    console.error('Error fetching unprocessed advanced salaries:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch unprocessed advanced salaries',
      error: error.message
    });
  }
};

// Get unprocessed other deductions for an employee
exports.getUnprocessedOtherDeductions = async (req, res) => {
  try {
    const { employeeId, startDate, endDate } = req.query;
    console.log({employeeId, startDate, endDate}, "getUnprocessedOtherDeductions")
    
    if (!employeeId) {
      return res.status(400).json({ success: false, message: 'Employee ID is required' });
    }
    
    // Build query
    const query = {
      employeeId,
      processed: false
    };
    
    // Add date range if provided
    if (startDate || endDate) {
      query.deductionDate = {};
      if (startDate) query.deductionDate.$gte = new Date(startDate);
      if (endDate) {
        const endDateObj = new Date(endDate);
        endDateObj.setHours(23, 59, 59, 999);
        query.deductionDate.$lte = endDateObj;
      }
    }
    
    // Find other deductions
    const otherDeductions = await OtherDeduction.find(query);
    console.log({otherDeductions})
    
    // Calculate total for approved other deductions
    const approvedOtherDeductions = otherDeductions.filter(deduction => deduction.status === 'Approved');
    const totalAmount = approvedOtherDeductions.reduce((sum, deduction) => sum + deduction.amount, 0);
    
    return res.status(200).json({
      success: true,
      message: 'Unprocessed other deductions fetched successfully',
      data: {
        otherDeductions,
        approvedOtherDeductions,
        totalAmount,
        count: otherDeductions.length,
        approvedCount: approvedOtherDeductions.length
      }
    });
  } catch (error) {
    console.error('Error fetching unprocessed other deductions:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch unprocessed other deductions',
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
  getUnprocessedIncentives: exports.getUnprocessedIncentives,
  getUnprocessedArrears: exports.getUnprocessedArrears,
  getUnprocessedFineDeductions: exports.getUnprocessedFineDeductions,
  getUnprocessedAdvancedSalaries: exports.getUnprocessedAdvancedSalaries,
  getUnprocessedOtherDeductions: exports.getUnprocessedOtherDeductions
};

