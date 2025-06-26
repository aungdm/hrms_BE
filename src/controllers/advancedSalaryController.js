const { successResponse, errorRresponse } = require("../utils/response");
const Loan = require("../models/loan");
const Employee = require("../models/employee");
const AdvancedSalary = require("../models/advancedSalary");

// Create a new loan request
const createLoan = async (req, res) => {
  try {
    const {
      employeeId,
      requestedAmount,
      totalInstallments,
      description,
      requiredDate,
      processed
    } = req.body;

    // Validate required fields
    if (!employeeId || !requestedAmount || !totalInstallments || !requiredDate) {
      return errorRresponse(
        res,
        400,
        "Employee ID, requested amount, total installments, and required date are required"
      );
    }

    // Check if employee exists
    const employee = await Employee.findById(employeeId);
    if (!employee) {
      return errorRresponse(res, 404, "Employee not found");
    }

    // Create new loan request
    const loan = new Loan({
      employeeId,
      requestedAmount,
      totalInstallments,
      description: description || "",
      requiredDate: new Date(requiredDate),
      processed: processed || false
    });

    await loan.save();

    return successResponse(
      res,
      201,
      "Loan Request Created Successfully",
      loan
    );
  } catch (error) {
    console.error("Error creating loan request:", error);
    return errorRresponse(res, 500, "Error creating loan request", error);
  }
};

// Update a loan
const updateLoan = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      employeeId,
      requestedAmount,
      approvedAmount,
      totalInstallments,
      description,
      status,
      requiredDate,
      processed
    } = req.body;

    // Find the loan
    const loan = await Loan.findById(id);
    if (!loan) {
      return errorRresponse(res, 404, "Loan not found");
    }

    // Check if employee exists if employeeId is being updated
    if (employeeId && employeeId !== loan.employeeId.toString()) {
      const employee = await Employee.findById(employeeId);
      if (!employee) {
        return errorRresponse(res, 404, "Employee not found");
      }
      loan.employeeId = employeeId;
    }

    // Update fields
    if (requestedAmount !== undefined) loan.requestedAmount = requestedAmount;
    if (description !== undefined) loan.description = description;
    if (totalInstallments !== undefined) loan.totalInstallments = totalInstallments;
    if (requiredDate !== undefined) loan.requiredDate = new Date(requiredDate);
    if (processed !== undefined) loan.processed = processed;
    
    // Handle status change and approval
    if (status && status !== loan.status) {
      loan.status = status;
      
      if (status === "Approved" && approvedAmount) {
        loan.approvedAmount = approvedAmount;
        loan.leftAmount = approvedAmount;
        loan.approvalDate = new Date();
        
        // Generate installments
        const installmentAmount = Math.round((approvedAmount / totalInstallments) * 100) / 100;
        const installments = [];
        
        for (let i = 0; i < totalInstallments; i++) {
          const dueDate = new Date();
          dueDate.setMonth(dueDate.getMonth() + i + 1);
          
          installments.push({
            amount: i === totalInstallments - 1 
              ? approvedAmount - (installmentAmount * (totalInstallments - 1)) // Last installment handles remaining amount
              : installmentAmount,
            dueDate,
            status: "Pending"
          });
        }
        
        loan.installments = installments;
      }
    }

    await loan.save();

    return successResponse(
      res,
      200,
      "Loan Updated Successfully",
      loan
    );
  } catch (error) {
    console.error("Error updating loan:", error);
    return errorRresponse(res, 500, "Error updating loan", error);
  }
};

// Get all loans with filtering and pagination
const getLoans = async (req, res) => {
  try {
    const {
      page = 1,
      perPage = 10,
      status,
      employeeId,
      startDate,
      endDate,
      processed,
      sortOrder = "desc",
      sortField = "createdAt",
      search = "",
    } = req.query;

    const query = {};

    // Apply filters
    if (status) query.status = status;
    if (employeeId) query.employeeId = employeeId;
    if (processed !== undefined) query.processed = processed === "true";
    
    // Date range filter
    if (startDate || endDate) {
      query.requestDate = {};
      if (startDate) query.requestDate.$gte = new Date(startDate);
      if (endDate) {
        const endDateObj = new Date(endDate);
        endDateObj.setHours(23, 59, 59, 999);
        query.requestDate.$lte = endDateObj;
      }
    }

    // Search by description
    if (search) {
      query.$or = [
        { description: { $regex: search, $options: "i" } }
      ];
    }

    const sortOptions = {
      [sortField]: sortOrder.toLowerCase() === "desc" ? -1 : 1,
    };

    const [loans, total] = await Promise.all([
      Loan.find(query)
        .populate('employeeId', 'name user_defined_code department')
        .sort(sortOptions)
        .skip((page - 1) * perPage)
        .limit(perPage),
      Loan.countDocuments(query),
    ]);

    return successResponse(res, 200, "Loans Fetched Successfully", {
      data: loans,
      meta: {
        total,
        page: Number(page),
        perPage: Number(perPage),
        totalPages: Math.ceil(total / perPage),
      },
    });
  } catch (error) {
    console.error("Error fetching loans:", error);
    return errorRresponse(res, 500, "Error fetching loans", error);
  }
};

// Get a single loan
const getLoan = async (req, res) => {
  try {
    const { id } = req.params;

    const loan = await Loan.findById(id)
      .populate('employeeId', 'name user_defined_code department');
    
    if (!loan) {
      return errorRresponse(res, 404, "Loan not found");
    }

    return successResponse(
      res,
      200,
      "Loan Fetched Successfully",
      loan
    );
  } catch (error) {
    console.error("Error fetching loan:", error);
    return errorRresponse(res, 500, "Error fetching loan", error);
  }
};

// Delete a loan
const deleteLoan = async (req, res) => {
  try {
    const { id } = req.params;

    const loan = await Loan.findByIdAndDelete(id);
    if (!loan) {
      return errorRresponse(res, 404, "Loan not found");
    }

    return successResponse(
      res,
      200,
      "Loan Deleted Successfully",
      loan
    );
  } catch (error) {
    console.error("Error deleting loan:", error);
    return errorRresponse(res, 500, "Error deleting loan", error);
  }
};

// Update loan status
const updateLoanStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, approvedAmount } = req.body;

    if (!status || !['Pending', 'Approved', 'Rejected', 'Completed'].includes(status)) {
      return errorRresponse(res, 400, "Valid status is required (Pending, Approved, Rejected, Completed)");
    }

    const loan = await Loan.findById(id);
    if (!loan) {
      return errorRresponse(res, 404, "Loan not found");
    }

    loan.status = status;
    
    if (status === "Approved" && approvedAmount) {
      loan.approvedAmount = approvedAmount;
      loan.leftAmount = approvedAmount;
      loan.approvalDate = new Date();
      
      // Generate installments
      const installmentAmount = Math.round((approvedAmount / loan.totalInstallments) * 100) / 100;
      const installments = [];
      
      for (let i = 0; i < loan.totalInstallments; i++) {
        const dueDate = new Date();
        dueDate.setMonth(dueDate.getMonth() + i + 1);
        
        installments.push({
          amount: i === loan.totalInstallments - 1 
            ? approvedAmount - (installmentAmount * (loan.totalInstallments - 1)) // Last installment handles remaining amount
            : installmentAmount,
          dueDate,
          status: "Pending"
        });
      }
      
      loan.installments = installments;
    }
    
    await loan.save();

    return successResponse(
      res,
      200,
      `Loan ${status.toLowerCase()} successfully`,
      loan
    );
  } catch (error) {
    console.error("Error updating loan status:", error);
    return errorRresponse(res, 500, "Error updating loan status", error);
  }
};

// Delete multiple loans
const deleteMultipleLoans = async (req, res) => {
  try {
    const { ids } = req.body;

    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return errorRresponse(res, 400, "Valid array of loan IDs is required");
    }

    const result = await Loan.deleteMany({ _id: { $in: ids } });

    return successResponse(
      res,
      200,
      `${result.deletedCount} loans deleted successfully`,
      { deletedCount: result.deletedCount }
    );
  } catch (error) {
    console.error("Error deleting multiple loans:", error);
    return errorRresponse(res, 500, "Error deleting multiple loans", error);
  }
};

// Pay loan installment
const payLoanInstallment = async (req, res) => {
  try {
    const { id } = req.params;
    const { installmentId } = req.body;

    if (!installmentId) {
      return errorRresponse(res, 400, "Installment ID is required");
    }

    const loan = await Loan.findById(id);
    if (!loan) {
      return errorRresponse(res, 404, "Loan not found");
    }

    const installment = loan.installments.id(installmentId);
    if (!installment) {
      return errorRresponse(res, 404, "Installment not found");
    }

    if (installment.status === "Paid") {
      return errorRresponse(res, 400, "Installment already paid");
    }

    // Update installment status
    installment.status = "Paid";
    
    // Update loan remaining values
    loan.leftInstallments = loan.leftInstallments - 1;
    loan.leftAmount = loan.leftAmount - installment.amount;
    
    // Check if all installments are paid
    if (loan.leftInstallments === 0) {
      loan.status = "Completed";
    }
    
    await loan.save();

    return successResponse(
      res,
      200,
      "Installment paid successfully",
      loan
    );
  } catch (error) {
    console.error("Error paying loan installment:", error);
    return errorRresponse(res, 500, "Error paying loan installment", error);
  }
};

module.exports = {
  createLoan,
  updateLoan,
  getLoans,
  getLoan,
  deleteLoan,
  updateLoanStatus,
  deleteMultipleLoans,
  payLoanInstallment
};
