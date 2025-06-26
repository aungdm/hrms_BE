const { successResponse, errorRresponse } = require("../utils/response");
const FineDeduction = require("../models/fineDeduction");
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
    const deduction = new FineDeduction({
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
      "Fine Deduction Created Successfully",
      deduction
    );
  } catch (error) {
    console.error("Error creating fine deduction:", error);
    return errorRresponse(res, 500, "Error creating fine deduction", error);
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
    const deduction = await FineDeduction.findById(id);
    if (!deduction) {
      return errorRresponse(res, 404, "Fine deduction not found");
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
      "Fine Deduction Updated Successfully",
      deduction
    );
  } catch (error) {
    console.error("Error updating fine deduction:", error);
    return errorRresponse(res, 500, "Error updating fine deduction", error);
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
      FineDeduction.find(query)
        .sort(sortOptions)
        .skip((page - 1) * perPage)
        .limit(perPage),
      FineDeduction.countDocuments(query),
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

    return successResponse(res, 200, "Fine Deductions Fetched Successfully", {
      data: deductionsWithEmployees,
      meta: {
        total,
        page: Number(page),
        perPage: Number(perPage),
        totalPages: Math.ceil(total / perPage),
      },
    });
  } catch (error) {
    console.error("Error fetching fine deductions:", error);
    return errorRresponse(res, 500, "Error fetching fine deductions", error);
  }
};

// Get a single deduction
const getDeduction = async (req, res) => {
  try {
    const { id } = req.params;

    const deduction = await FineDeduction.findById(id);
    
    if (!deduction) {
      return errorRresponse(res, 404, "Fine deduction not found");
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
      "Fine Deduction Fetched Successfully",
      deductionWithEmployee
    );
  } catch (error) {
    console.error("Error fetching fine deduction:", error);
    return errorRresponse(res, 500, "Error fetching fine deduction", error);
  }
};

// Delete a deduction
const deleteDeduction = async (req, res) => {
  try {
    const { id } = req.params;

    const deduction = await FineDeduction.findByIdAndDelete(id);
    if (!deduction) {
      return errorRresponse(res, 404, "Fine deduction not found");
    }

    return successResponse(
      res,
      200,
      "Fine Deduction Deleted Successfully",
      deduction
    );
  } catch (error) {
    console.error("Error deleting fine deduction:", error);
    return errorRresponse(res, 500, "Error deleting fine deduction", error);
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

    const deduction = await FineDeduction.findById(id);
    if (!deduction) {
      return errorRresponse(res, 404, "Fine deduction not found");
    }

    deduction.status = status;
    await deduction.save();

    return successResponse(
      res,
      200,
      `Fine deduction ${status.toLowerCase()} successfully`,
      deduction
    );
  } catch (error) {
    console.error("Error updating fine deduction status:", error);
    return errorRresponse(res, 500, "Error updating fine deduction status", error);
  }
};

// Delete multiple deductions
const deleteMultipleDeductions = async (req, res) => {
  try {
    const { ids } = req.body;

    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return errorRresponse(res, 400, "Valid array of fine deduction IDs is required");
    }

    const result = await FineDeduction.deleteMany({ _id: { $in: ids } });

    return successResponse(
      res,
      200,
      `${result.deletedCount} fine deductions deleted successfully`,
      { deletedCount: result.deletedCount }
    );
  } catch (error) {
    console.error("Error deleting multiple fine deductions:", error);
    return errorRresponse(res, 500, "Error deleting multiple fine deductions", error);
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
