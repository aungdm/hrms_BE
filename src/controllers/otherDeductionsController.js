const { successResponse, errorRresponse } = require("../utils/response");
const OtherDeduction = require("../models/otherDeduction");
const Employee = require("../models/employee");

// Create a new deduction
const createDeduction = async (req, res) => {
  try {
    const {
      employeeId,
      deductionType,
      amount,
      deductionDate,
      description,
      status
    } = req.body;

    // Validate required fields
    if (!employeeId || !deductionType || !amount || !deductionDate) {
      return errorRresponse(
        res,
        400,
        "Employee ID, deduction type, amount, and deduction date are required"
      );
    }

    // Check if employee exists
    const employee = await Employee.findById(employeeId);
    if (!employee) {
      return errorRresponse(res, 404, "Employee not found");
    }

    // Create new deduction
    const deduction = new OtherDeduction({
      employeeId,
      deductionType,
      amount,
      deductionDate,
      description: description || "",
      status: status || "Pending"
    });

    await deduction.save();

    return successResponse(
      res,
      201,
      "Deduction Created Successfully",
      deduction
    );
  } catch (error) {
    console.error("Error creating deduction:", error);
    return errorRresponse(res, 500, "Error creating deduction", error);
  }
};

// Update a deduction
const updateDeduction = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      employeeId,
      deductionType,
      amount,
      deductionDate,
      description,
      status
    } = req.body;

    // Find the deduction
    const deduction = await OtherDeduction.findById(id);
    if (!deduction) {
      return errorRresponse(res, 404, "Deduction not found");
    }

    // Check if employee exists if employeeId is being updated
    if (employeeId && employeeId !== deduction.employeeId) {
      const employee = await Employee.findById(employeeId);
      if (!employee) {
        return errorRresponse(res, 404, "Employee not found");
      }
    }

    // Update fields
    if (employeeId) deduction.employeeId = employeeId;
    if (deductionType) deduction.deductionType = deductionType;
    if (amount !== undefined) deduction.amount = amount;
    if (deductionDate) deduction.deductionDate = deductionDate;
    if (description !== undefined) deduction.description = description;
    if (status) deduction.status = status;

    await deduction.save();

    return successResponse(
      res,
      200,
      "Deduction Updated Successfully",
      deduction
    );
  } catch (error) {
    console.error("Error updating deduction:", error);
    return errorRresponse(res, 500, "Error updating deduction", error);
  }
};

// Get all deductions with filtering and pagination
const getDeductions = async (req, res) => {
  try {
    const {
      page = 1,
      perPage = 10,
      status,
      employeeId,
      startDate,
      endDate,
      sortOrder = "Desc",
      sortField = "deductionDate",
      search = "",
    } = req.query;

    const query = {};

    // Apply filters
    if (status) query.status = status;
    if (employeeId) query.employeeId = employeeId;
    
    // Date range filter
    if (startDate || endDate) {
      query.deductionDate = {};
      if (startDate) query.deductionDate.$gte = new Date(startDate);
      if (endDate) query.deductionDate.$lte = new Date(endDate);
    }

    // Search by description or deduction type
    if (search) {
      query.$or = [
        { description: { $regex: search, $options: "i" } },
        { deductionType: { $regex: search, $options: "i" } }
      ];
    }

    const sortOptions = {
      [sortField]: sortOrder.toLowerCase() === "desc" ? -1 : 1,
    };

    const [deductions, total] = await Promise.all([
      OtherDeduction.find(query)
        .sort(sortOptions)
        .skip((page - 1) * perPage)
        .limit(perPage),
      OtherDeduction.countDocuments(query),
    ]);

    // Manually populate employee data
    const deductionsWithEmployees = await Promise.all(
      deductions.map(async (deduction) => {
        const employee = await Employee.findById(deduction.employeeId).select('name user_defined_code department');
        return {
          ...deduction.toObject(),
          employeeId: employee || null
        };
      })
    );

    return successResponse(res, 200, "Deductions Fetched Successfully", {
      data: deductionsWithEmployees,
      meta: {
        total,
        page: Number(page),
        perPage: Number(perPage),
        totalPages: Math.ceil(total / perPage),
      },
    });
  } catch (error) {
    console.error("Error fetching deductions:", error);
    return errorRresponse(res, 500, "Error fetching deductions", error);
  }
};

// Get a single deduction
const getDeduction = async (req, res) => {
  try {
    const { id } = req.params;

    const deduction = await OtherDeduction.findById(id);
    
    if (!deduction) {
      return errorRresponse(res, 404, "Deduction not found");
    }

    // Manually populate employee data
    const employee = await Employee.findById(deduction.employeeId).select('name user_defined_code department');
    const deductionWithEmployee = {
      ...deduction.toObject(),
      employeeId: employee || null
    };

    return successResponse(
      res,
      200,
      "Deduction Fetched Successfully",
      deductionWithEmployee
    );
  } catch (error) {
    console.error("Error fetching deduction:", error);
    return errorRresponse(res, 500, "Error fetching deduction", error);
  }
};

// Delete a deduction
const deleteDeduction = async (req, res) => {
  try {
    const { id } = req.params;

    const deduction = await OtherDeduction.findByIdAndDelete(id);
    if (!deduction) {
      return errorRresponse(res, 404, "Deduction not found");
    }

    return successResponse(
      res,
      200,
      "Deduction Deleted Successfully",
      deduction
    );
  } catch (error) {
    console.error("Error deleting deduction:", error);
    return errorRresponse(res, 500, "Error deleting deduction", error);
  }
};

// Update deduction status
const updateDeductionStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!status || !['Pending', 'Approved', 'Rejected'].includes(status)) {
      return errorRresponse(res, 400, "Valid status is required (Pending, Approved, Rejected)");
    }

    const deduction = await OtherDeduction.findById(id);
    if (!deduction) {
      return errorRresponse(res, 404, "Deduction not found");
    }

    deduction.status = status;
    await deduction.save();

    return successResponse(
      res,
      200,
      `Deduction ${status.toLowerCase()} successfully`,
      deduction
    );
  } catch (error) {
    console.error("Error updating deduction status:", error);
    return errorRresponse(res, 500, "Error updating deduction status", error);
  }
};

// Delete multiple deductions
const deleteMultipleDeductions = async (req, res) => {
  try {
    const { ids } = req.body;

    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return errorRresponse(res, 400, "Valid array of deduction IDs is required");
    }

    const result = await OtherDeduction.deleteMany({ _id: { $in: ids } });

    return successResponse(
      res,
      200,
      `${result.deletedCount} deductions deleted successfully`,
      { deletedCount: result.deletedCount }
    );
  } catch (error) {
    console.error("Error deleting multiple deductions:", error);
    return errorRresponse(res, 500, "Error deleting multiple deductions", error);
  }
};

module.exports = {
  createDeduction,
  updateDeduction,
  getDeductions,
  getDeduction,
  deleteDeduction,
  updateDeductionStatus,
  deleteMultipleDeductions
};
