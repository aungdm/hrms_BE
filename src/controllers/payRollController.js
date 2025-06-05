const { successResponse, errorRresponse } = require("../utils/response");
const PayRoll = require("../models/payRoll");
const Employee = require("../models/employee");
const DailyAttendance = require("../models/dailyAttendance");
const moment = require("moment");

/**
 * Generate payroll for a specified date range and set of employees
 */
const generatePayroll = async (req, res) => {
  try {
    const { startDate, endDate, employeeIds } = req.body;
    
    if (!startDate || !endDate) {
      return errorRresponse(res, 400, "Start date and end date are required");
    }
    
    // Validate date format
    if (!moment(startDate).isValid() || !moment(endDate).isValid()) {
      return errorRresponse(res, 400, "Invalid date format");
    }
    
    // Parse dates to ensure they're at the start/end of the day
    const startDateObj = moment(startDate).startOf('day').toDate();
    const endDateObj = moment(endDate).endOf('day').toDate();
    
    // Check if the date range is valid
    if (startDateObj > endDateObj) {
      return errorRresponse(res, 400, "Start date cannot be after end date");
    }
    
    // Define the query to get employees
    let employeeQuery = {};
    
    // If specific employees are selected, filter for them
    if (employeeIds && employeeIds.length > 0) {
      employeeQuery = { _id: { $in: employeeIds } };
    }
    
    // Get all employees that match the criteria
    const employees = await Employee.find(employeeQuery).lean();
    
    if (employees.length === 0) {
      return errorRresponse(res, 404, "No employees found with the specified criteria");
    }
    
    const payrolls = [];
    const errors = [];
    
    // Process each employee's payroll
    for (const employee of employees) {
      try {
        // Check if a payroll already exists for this employee and date range
        const existingPayroll = await PayRoll.findOne({
          employeeId: employee._id,
          startDate: startDateObj,
          endDate: endDateObj,
          payrollStatus: { $ne: "Cancelled" } // Only consider non-cancelled payrolls
        });
        
        if (existingPayroll) {
          errors.push({
            employeeId: employee._id,
            name: employee.name,
            error: "Payroll already exists for this period"
          });
          continue;
        }
        
        // Get attendance records for the date range
        const attendanceRecords = await DailyAttendance.find({
          employeeId: employee._id,
          date: { $gte: startDateObj, $lte: endDateObj }
        }).sort({ date: 1 }).lean();
        
        // Determine if employee is hourly or monthly based on payType
        const isHourly = employee.payType === "Hourly";
        
        // Generate payroll based on employee type
        const payroll = isHourly
          ? await generateHourlyPayroll(employee, attendanceRecords, startDateObj, endDateObj)
          : await generateMonthlyPayroll(employee, attendanceRecords, startDateObj, endDateObj);
        
        // Save the payroll
        const newPayroll = new PayRoll(payroll);
        await newPayroll.save();
        
        payrolls.push(newPayroll);
      } catch (err) {
        console.error(`Error generating payroll for employee ${employee._id}:`, err);
        errors.push({
          employeeId: employee._id,
          name: employee.name,
          error: err.message
        });
      }
    }
    
    return successResponse(res, 200, "Payroll generation process completed", {
      success: payrolls.length,
      failed: errors.length,
      errors,
      payrolls
    });
  } catch (error) {
    console.error("Error in generatePayroll:", error);
    return errorRresponse(res, 500, "Error generating payroll", error);
  }
};

/**
 * Generate payroll for hourly employees based on attendance records
 */
const generateHourlyPayroll = async (employee, attendanceRecords, startDate, endDate) => {
  // Define constants
  const WORKING_DAYS_PER_MONTH = 26;
  const SHIFT_HOURS = employee.shiftHours || 8; // Default to 8 if not specified
  
  // Calculate basic rates
  const basicSalary = parseFloat(employee.basicSalary) || 0;
  const perHourRate = basicSalary / (WORKING_DAYS_PER_MONTH * SHIFT_HOURS);
  const perMinuteRate = perHourRate / 60;
  
  // Initialize counters
  let totalWorkingDays = 0;
  let presentDays = 0;
  let absentDays = 0;
  let lateDays = 0;
  let halfDays = 0;
  let totalHoursWorked = 0;
  let totalOvertimeMinutes = 0;
  let approvedOvertimeMinutes = 0;
  let overtimePay = 0;
  let lateArrivalFine = 0;
  let absentDeduction = 0;
  
  // Arrays for details
  const attendanceIds = [];
  const lateArrivalDetails = [];
  const overtimeDetails = [];
  
  // Process each attendance record
  for (const record of attendanceRecords) {
    // If the day is a working day, count it
    if (record.status !== "Weekend" && record.status !== "Holiday" && record.status !== "Day Off") {
      totalWorkingDays++;
      
      switch (record.status) {
        case "Present":
          presentDays++;
          
          // Convert work duration from minutes to hours
          const hoursWorked = record.workDuration / 60;
          totalHoursWorked += hoursWorked;
          
          // Check for late arrival
          if (record.lateArrival > 0) {
            lateDays++;
            
            // Determine late arrival fine based on employee's position
            let fine = 0;
            const isLeadershipRole = ["Team Lead", "Supervisor", "Project Manager"].includes(employee.designation);
            const lateMinutes = record.lateArrival;
            
            if (isLeadershipRole) {
              if (lateMinutes > 120) fine = 4000;
              else if (lateMinutes > 20) fine = 2000;
              else if (lateMinutes > 1) fine = 1000;
            } else {
              if (lateMinutes > 120) fine = 2000;
              else if (lateMinutes > 20) fine = 1000;
              else if (lateMinutes > 1) fine = 500;
            }
            
            if (fine > 0) {
              lateArrivalFine += fine;
              lateArrivalDetails.push({
                date: record.date,
                minutes: lateMinutes,
                fine
              });
            }
          }
          
          // Check for approved overtime
          if (record.isOverTime && record.overTimeStatus === "Approved") {
            const overtimeMinutes = record.overTimeMinutes || 0;
            if (overtimeMinutes > 0) {
              totalOvertimeMinutes += overtimeMinutes;
              approvedOvertimeMinutes += overtimeMinutes;
              
              // Calculate overtime pay based on role
              const isLeadershipRole = ["Team Lead", "Supervisor", "Project Manager"].includes(employee.designation);
              let overtimeRate = perMinuteRate;
              
              if (isLeadershipRole && overtimeMinutes > 60) {
                // For leadership roles, double rate if over 60 minutes
                overtimeRate = perMinuteRate * 2;
              }
              
              const overtimeAmount = overtimeMinutes * overtimeRate;
              overtimePay += overtimeAmount;
              
              overtimeDetails.push({
                date: record.date,
                minutes: overtimeMinutes,
                amount: overtimeAmount
              });
            }
          }
          break;
          
        case "Half Day":
          halfDays++;
          // Count half day as half a present day
          presentDays += 0.5;
          absentDays += 0.5;
          
          // Add half day's work hours
          totalHoursWorked += SHIFT_HOURS / 2;
          break;
          
        case "Absent":
          absentDays++;
          break;
          
        case "Late":
          // Count a late day as present but track it separately
          presentDays++;
          lateDays++;
          
          // Convert work duration from minutes to hours
          const lateHoursWorked = record.workDuration / 60;
          totalHoursWorked += lateHoursWorked;
          
          // Apply late arrival fine
          let lateFine = 0;
          const isLeadershipRole = ["Team Lead", "Supervisor", "Project Manager"].includes(employee.designation);
          const lateMinutes = record.lateArrival;
          
          if (isLeadershipRole) {
            if (lateMinutes > 120) lateFine = 4000;
            else if (lateMinutes > 20) lateFine = 2000;
            else if (lateMinutes > 1) lateFine = 1000;
          } else {
            if (lateMinutes > 120) lateFine = 2000;
            else if (lateMinutes > 20) lateFine = 1000;
            else if (lateMinutes > 1) lateFine = 500;
          }
          
          if (lateFine > 0) {
            lateArrivalFine += lateFine;
            lateArrivalDetails.push({
              date: record.date,
              minutes: lateMinutes,
              fine: lateFine
            });
          }
          break;
      }
    }
    
    // Add the attendance record ID to our tracking array
    attendanceIds.push(record._id);
  }
  
  // Calculate payable hours (actual hours worked)
  const payableHours = totalHoursWorked;
  
  // Get additional items from employee profile (if available)
  const commission = parseFloat(employee.commission) || 0;
  const arrears = parseFloat(employee.arrears) || 0;
  const referralBonus = parseFloat(employee.referralBonus) || 0;
  const closerIncentive = parseFloat(employee.closerIncentive) || 0;
  const otherIncentives = parseFloat(employee.otherIncentives) || 0;
  const advanceAgainstSalary = parseFloat(employee.advanceAgainstSalary) || 0;
  const personalLoan = parseFloat(employee.personalLoan) || 0;
  const fineOrDeduction = parseFloat(employee.fineOrDeduction) || 0;
  const otherDeduction = parseFloat(employee.otherDeduction) || 0;
  const standardSalary = parseFloat(employee.standardSalary) || basicSalary;
  
  // Calculate total additions and deductions
  const totalAdditions = commission + arrears + referralBonus + closerIncentive + otherIncentives + overtimePay;
  const totalDeductions = lateArrivalFine + absentDeduction + advanceAgainstSalary + personalLoan + fineOrDeduction + otherDeduction;
  
  // Calculate net salary
  const netSalary = basicSalary + totalAdditions - totalDeductions;
  
  // Create pay items array
  const payItems = [
    { name: "Basic Salary", value: basicSalary, type: "Addition" },
    { name: "Standard Salary", value: standardSalary, type: "Addition" },
    { name: "Per Hour Rate", value: perHourRate, type: "Addition" },
    { name: "Payable hours", value: payableHours, type: "Addition" },
    { name: "OverTime", value: overtimePay, type: "Addition" },
    { name: "Commission", value: commission, type: "Addition" },
    { name: "Closer Incentive", value: closerIncentive, type: "Addition" },
    { name: "Referral Bonus", value: referralBonus, type: "Addition" },
    { name: "Arrear's", value: arrears, type: "Addition" },
    { name: "Other Incentives", value: otherIncentives, type: "Addition" },
    { name: "Late Arrival", value: lateArrivalFine, type: "Deduction" },
    { name: "Absent Deduction", value: absentDeduction, type: "Deduction" },
    { name: "Missing Deduction", value: 0, type: "Deduction" }, // Placeholder
    { name: "Other Deduction", value: otherDeduction, type: "Deduction" },
    { name: "Advance Against Salary", value: advanceAgainstSalary, type: "Deduction" },
    { name: "Personal Loan", value: personalLoan, type: "Deduction" },
    { name: "Fine/Deduction", value: fineOrDeduction, type: "Deduction" },
  ];
  
  // Return payroll data
  return {
    employeeId: employee._id,
    startDate,
    endDate,
    payDate: new Date(), // Current date as pay date
    totalWorkingDays,
    presentDays,
    absentDays,
    lateDays,
    halfDays,
    payableHours,
    totalHoursWorked,
    totalOvertimeMinutes,
    approvedOvertimeMinutes,
    basicSalary,
    standardSalary,
    perHourRate,
    overtimePay,
    commission,
    arrears,
    referralBonus,
    closerIncentive,
    otherIncentives,
    lateArrivalFine,
    absentDeduction,
    advanceAgainstSalary,
    personalLoan,
    fineOrDeduction,
    otherDeduction,
    payrollType: "Hourly",
    payrollStatus: "Draft",
    payItems,
    totalAdditions,
    totalDeductions,
    netSalary,
    remarks: `Payroll generated for period ${moment(startDate).format('YYYY-MM-DD')} to ${moment(endDate).format('YYYY-MM-DD')}`,
    attendanceRecords: attendanceIds,
    lateArrivalDetails,
    overtimeDetails,
    createdBy: req?.user?._id || "System"
  };
};

/**
 * Generate payroll for monthly salaried employees based on attendance records
 */
const generateMonthlyPayroll = async (employee, attendanceRecords, startDate, endDate) => {
  // Define constants
  const DAYS_PER_MONTH = 30; // For monthly salary calculations
  
  // Calculate basic salary
  const basicSalary = parseFloat(employee.basicSalary) || 0;
  const dailySalary = basicSalary / DAYS_PER_MONTH;
  
  // Initialize counters
  let totalWorkingDays = 0;
  let presentDays = 0;
  let absentDays = 0;
  let halfDays = 0;
  let lateDays = 0;
  let totalHoursWorked = 0;
  let absentDeduction = 0;
  
  // Arrays for details
  const attendanceIds = [];
  
  // Process each attendance record
  for (const record of attendanceRecords) {
    // If the day is a working day, count it
    if (record.status !== "Weekend" && record.status !== "Holiday" && record.status !== "Day Off") {
      totalWorkingDays++;
      
      switch (record.status) {
        case "Present":
          presentDays++;
          // Add work duration in hours
          totalHoursWorked += record.workDuration / 60;
          break;
          
        case "Half Day":
          halfDays++;
          // Count as half present, half absent
          presentDays += 0.5;
          absentDays += 0.5;
          // Calculate deduction for half day
          absentDeduction += dailySalary * 0.5;
          break;
          
        case "Absent":
          absentDays++;
          // Apply full day deduction
          absentDeduction += dailySalary;
          break;
          
        case "Late":
          presentDays++;
          lateDays++;
          // Add work duration in hours
          totalHoursWorked += record.workDuration / 60;
          break;
      }
    }
    
    // Add the attendance record ID to our tracking array
    attendanceIds.push(record._id);
  }
  
  // Get additional items from employee profile (if available)
  const commission = parseFloat(employee.commission) || 0;
  const arrears = parseFloat(employee.arrears) || 0;
  const referralBonus = parseFloat(employee.referralBonus) || 0;
  const closerIncentive = parseFloat(employee.closerIncentive) || 0;
  const otherIncentives = parseFloat(employee.otherIncentives) || 0;
  const advanceAgainstSalary = parseFloat(employee.advanceAgainstSalary) || 0;
  const personalLoan = parseFloat(employee.personalLoan) || 0;
  const fineOrDeduction = parseFloat(employee.fineOrDeduction) || 0;
  const otherDeduction = parseFloat(employee.otherDeduction) || 0;
  const standardSalary = parseFloat(employee.standardSalary) || basicSalary;
  
  // Calculate total additions and deductions
  const totalAdditions = commission + arrears + referralBonus + closerIncentive + otherIncentives;
  const totalDeductions = absentDeduction + advanceAgainstSalary + personalLoan + fineOrDeduction + otherDeduction;
  
  // Calculate net salary
  const netSalary = basicSalary + totalAdditions - totalDeductions;
  
  // Create pay items array
  const payItems = [
    { name: "Basic Salary", value: basicSalary, type: "Addition" },
    { name: "Standard Salary", value: standardSalary, type: "Addition" },
    { name: "Commission", value: commission, type: "Addition" },
    { name: "Closer Incentive", value: closerIncentive, type: "Addition" },
    { name: "Referral Bonus", value: referralBonus, type: "Addition" },
    { name: "Arrear's", value: arrears, type: "Addition" },
    { name: "Other Incentives", value: otherIncentives, type: "Addition" },
    { name: "Absent Deduction", value: absentDeduction, type: "Deduction" },
    { name: "Missing Deduction", value: 0, type: "Deduction" }, // Placeholder
    { name: "Other Deduction", value: otherDeduction, type: "Deduction" },
    { name: "Advance Against Salary", value: advanceAgainstSalary, type: "Deduction" },
    { name: "Personal Loan", value: personalLoan, type: "Deduction" },
    { name: "Fine/Deduction", value: fineOrDeduction, type: "Deduction" },
  ];
  
  // Return payroll data
  return {
    employeeId: employee._id,
    startDate,
    endDate,
    payDate: new Date(), // Current date as pay date
    totalWorkingDays,
    presentDays,
    absentDays,
    lateDays,
    halfDays,
    totalHoursWorked,
    basicSalary,
    standardSalary,
    commission,
    arrears,
    referralBonus,
    closerIncentive,
    otherIncentives,
    absentDeduction,
    advanceAgainstSalary,
    personalLoan,
    fineOrDeduction,
    otherDeduction,
    payrollType: "Monthly",
    payrollStatus: "Draft",
    payItems,
    totalAdditions,
    totalDeductions,
    netSalary,
    remarks: `Payroll generated for period ${moment(startDate).format('YYYY-MM-DD')} to ${moment(endDate).format('YYYY-MM-DD')}`,
    attendanceRecords: attendanceIds,
    createdBy: req?.user?._id || "System"
  };
};

/**
 * Get payroll records with filtering and pagination
 */
const getPayrolls = async (req, res) => {
  try {
    const {
      page = 1,
      perPage = 10,
      startDate,
      endDate,
      employeeId,
      payrollStatus,
      payrollType
    } = req.query;
    
    const query = {};
    
    if (startDate || endDate) {
      query.startDate = {};
      if (startDate) query.startDate.$gte = new Date(startDate);
      if (endDate) query.endDate.$lte = new Date(endDate);
    }
    
    if (employeeId) query.employeeId = employeeId;
    if (payrollStatus) query.payrollStatus = payrollStatus;
    if (payrollType) query.payrollType = payrollType;
    
    const [payrolls, total] = await Promise.all([
      PayRoll.find(query)
        .populate("employeeId", "name employeeId department designation")
        .sort({ createdAt: -1 })
        .skip((page - 1) * perPage)
        .limit(parseInt(perPage)),
      PayRoll.countDocuments(query)
    ]);
    
    return successResponse(res, 200, "Payroll records fetched successfully", {
      data: payrolls,
      meta: {
        total,
        page: parseInt(page),
        perPage: parseInt(perPage),
        totalPages: Math.ceil(total / parseInt(perPage))
      }
    });
  } catch (error) {
    console.error("Error in getPayrolls:", error);
    return errorRresponse(res, 500, "Error fetching payroll records", error);
  }
};

/**
 * Get a single payroll record by ID
 */
const getPayrollById = async (req, res) => {
  try {
    const { id } = req.params;
    
    const payroll = await PayRoll.findById(id)
      .populate("employeeId", "name employeeId department designation")
      .populate("attendanceRecords");
    
    if (!payroll) {
      return errorRresponse(res, 404, "Payroll record not found");
    }
    
    return successResponse(res, 200, "Payroll record fetched successfully", payroll);
  } catch (error) {
    console.error("Error in getPayrollById:", error);
    return errorRresponse(res, 500, "Error fetching payroll record", error);
  }
};

/**
 * Update a payroll record
 */
const updatePayroll = async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = req.body;
    
    // Check if the record exists
    const payroll = await PayRoll.findById(id);
    if (!payroll) {
      return errorRresponse(res, 404, "Payroll record not found");
    }
    
    // Only allow updates to draft payrolls
    if (payroll.payrollStatus !== "Draft" && !req.body.payrollStatus) {
      return errorRresponse(res, 400, "Only draft payrolls can be updated");
    }
    
    // If payItems are being updated, recalculate totals
    if (updateData.payItems) {
      let totalAdditions = 0;
      let totalDeductions = 0;
      
      updateData.payItems.forEach(item => {
        if (item.type === "Addition") {
          totalAdditions += parseFloat(item.value) || 0;
        } else if (item.type === "Deduction") {
          totalDeductions += parseFloat(item.value) || 0;
        }
      });
      
      updateData.totalAdditions = totalAdditions;
      updateData.totalDeductions = totalDeductions;
      updateData.netSalary = (updateData.basicSalary || payroll.basicSalary) + totalAdditions - totalDeductions;
    }
    
    // Update the record
    const updatedPayroll = await PayRoll.findByIdAndUpdate(
      id,
      { $set: updateData },
      { new: true }
    ).populate("employeeId", "name employeeId department designation");
    
    return successResponse(res, 200, "Payroll record updated successfully", updatedPayroll);
  } catch (error) {
    console.error("Error in updatePayroll:", error);
    return errorRresponse(res, 500, "Error updating payroll record", error);
  }
};

/**
 * Delete a payroll record
 */
const deletePayroll = async (req, res) => {
  try {
    const { id } = req.params;
    
    // Check if the record exists
    const payroll = await PayRoll.findById(id);
    if (!payroll) {
      return errorRresponse(res, 404, "Payroll record not found");
    }
    
    // Only allow deletion of draft payrolls
    if (payroll.payrollStatus !== "Draft") {
      return errorRresponse(res, 400, "Only draft payrolls can be deleted");
    }
    
    // Delete the record
    await PayRoll.findByIdAndDelete(id);
    
    return successResponse(res, 200, "Payroll record deleted successfully");
  } catch (error) {
    console.error("Error in deletePayroll:", error);
    return errorRresponse(res, 500, "Error deleting payroll record", error);
  }
};

/**
 * Approve a payroll record
 */
const approvePayroll = async (req, res) => {
  try {
    const { id } = req.params;
    
    // Check if the record exists
    const payroll = await PayRoll.findById(id);
    if (!payroll) {
      return errorRresponse(res, 404, "Payroll record not found");
    }
    
    // Only draft payrolls can be approved
    if (payroll.payrollStatus !== "Draft") {
      return errorRresponse(res, 400, "Only draft payrolls can be approved");
    }
    
    // Update the payroll status
    const updatedPayroll = await PayRoll.findByIdAndUpdate(
      id,
      {
        $set: {
          payrollStatus: "Approved",
          approvedBy: req?.user?._id || "System",
          approvedAt: new Date()
        }
      },
      { new: true }
    ).populate("employeeId", "name employeeId department designation");
    
    return successResponse(res, 200, "Payroll approved successfully", updatedPayroll);
  } catch (error) {
    console.error("Error in approvePayroll:", error);
    return errorRresponse(res, 500, "Error approving payroll", error);
  }
};

/**
 * Mark a payroll as paid
 */
const markPayrollAsPaid = async (req, res) => {
  try {
    const { id } = req.params;
    
    // Check if the record exists
    const payroll = await PayRoll.findById(id);
    if (!payroll) {
      return errorRresponse(res, 404, "Payroll record not found");
    }
    
    // Only approved payrolls can be marked as paid
    if (payroll.payrollStatus !== "Approved") {
      return errorRresponse(res, 400, "Only approved payrolls can be marked as paid");
    }
    
    // Update the payroll status
    const updatedPayroll = await PayRoll.findByIdAndUpdate(
      id,
      {
        $set: {
          payrollStatus: "Paid",
          paidAt: new Date()
        }
      },
      { new: true }
    ).populate("employeeId", "name employeeId department designation");
    
    return successResponse(res, 200, "Payroll marked as paid successfully", updatedPayroll);
  } catch (error) {
    console.error("Error in markPayrollAsPaid:", error);
    return errorRresponse(res, 500, "Error marking payroll as paid", error);
  }
};

/**
 * Get payroll summary/statistics
 */
const getPayrollSummary = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    
    const query = {};
    
    if (startDate || endDate) {
      query.startDate = {};
      if (startDate) query.startDate.$gte = new Date(startDate);
      if (endDate) query.endDate.$lte = new Date(endDate);
    }
    
    // Get summary statistics
    const [totalPayroll, statusCounts, typeCounts] = await Promise.all([
      PayRoll.aggregate([
        { $match: query },
        {
          $group: {
            _id: null,
            totalNetSalary: { $sum: "$netSalary" },
            totalBasicSalary: { $sum: "$basicSalary" },
            totalAdditions: { $sum: "$totalAdditions" },
            totalDeductions: { $sum: "$totalDeductions" },
            count: { $sum: 1 }
          }
        }
      ]),
      PayRoll.aggregate([
        { $match: query },
        {
          $group: {
            _id: "$payrollStatus",
            count: { $sum: 1 }
          }
        }
      ]),
      PayRoll.aggregate([
        { $match: query },
        {
          $group: {
            _id: "$payrollType",
            count: { $sum: 1 },
            totalNetSalary: { $sum: "$netSalary" }
          }
        }
      ])
    ]);
    
    // Format the response
    const summary = {
      total: totalPayroll.length > 0 ? {
        payrollCount: totalPayroll[0].count,
        netSalary: totalPayroll[0].totalNetSalary,
        basicSalary: totalPayroll[0].totalBasicSalary,
        additions: totalPayroll[0].totalAdditions,
        deductions: totalPayroll[0].totalDeductions
      } : {
        payrollCount: 0,
        netSalary: 0,
        basicSalary: 0,
        additions: 0,
        deductions: 0
      },
      statusBreakdown: {},
      typeBreakdown: {}
    };
    
    // Format status counts
    statusCounts.forEach(status => {
      summary.statusBreakdown[status._id] = status.count;
    });
    
    // Format type counts
    typeCounts.forEach(type => {
      summary.typeBreakdown[type._id] = {
        count: type.count,
        totalNetSalary: type.totalNetSalary
      };
    });
    
    return successResponse(res, 200, "Payroll summary fetched successfully", summary);
  } catch (error) {
    console.error("Error in getPayrollSummary:", error);
    return errorRresponse(res, 500, "Error fetching payroll summary", error);
  }
};

/**
 * Generate PDF for a payroll record
 */
const generatePayrollPdf = async (req, res) => {
  try {
    const { id } = req.params;
    
    // Check if the record exists
    const payroll = await PayRoll.findById(id)
      .populate("employeeId", "name employeeId department designation email joiningDate")
      .lean();
    
    if (!payroll) {
      return errorRresponse(res, 404, "Payroll record not found");
    }
    
    // Generate PDF content - this would typically involve using a PDF generation library
    // For now, we'll just return the payroll data
    return successResponse(res, 200, "Payroll PDF data prepared", payroll);
    
    // In a real implementation, you would:
    // 1. Use a library like PDFKit or html-pdf to generate the PDF
    // 2. Stream the PDF to the client or save it to a file
    // 3. Return a download link or the file itself
  } catch (error) {
    console.error("Error in generatePayrollPdf:", error);
    return errorRresponse(res, 500, "Error generating payroll PDF", error);
  }
};

module.exports = {
  generatePayroll,
  getPayrolls,
  getPayrollById,
  updatePayroll,
  deletePayroll,
  approvePayroll,
  markPayrollAsPaid,
  getPayrollSummary,
  generatePayrollPdf
};
