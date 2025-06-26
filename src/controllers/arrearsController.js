const { successResponse, errorRresponse } = require("../utils/response");
const Arrears = require("../models/arrears");
const Employee = require("../models/employee");

// Create a new arrears record
const createArrears = async (req, res) => {
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

    // Create new arrears record
    const arrears = new Arrears({
      employeeId,
      deductionType,
      amount,
      deductionDate,
      description: description || "",
      status: status || "Pending"
    });

    await arrears.save();

    return successResponse(
      res,
      201,
      "Arrears Record Created Successfully",
      arrears
    );
  } catch (error) {
    console.error("Error creating arrears record:", error);
    return errorRresponse(res, 500, "Error creating arrears record", error);
  }
};

// Update an arrears record
const updateArrears = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      employeeId,
      deductionType,
      amount,
      deductionDate,
      description,
      status,
      processed
    } = req.body;

    // Find the arrears record
    const arrears = await Arrears.findById(id);
    if (!arrears) {
      return errorRresponse(res, 404, "Arrears record not found");
    }

    // Check if employee exists if employeeId is being updated
    if (employeeId && employeeId !== arrears.employeeId) {
      const employee = await Employee.findById(employeeId);
      if (!employee) {
        return errorRresponse(res, 404, "Employee not found");
      }
    }

    // Update fields
    if (employeeId) arrears.employeeId = employeeId;
    if (deductionType) arrears.deductionType = deductionType;
    if (amount !== undefined) arrears.amount = amount;
    if (deductionDate) arrears.deductionDate = deductionDate;
    if (description !== undefined) arrears.description = description;
    if (status) arrears.status = status;
    if (processed !== undefined) arrears.processed = processed;

    await arrears.save();

    return successResponse(
      res,
      200,
      "Arrears Record Updated Successfully",
      arrears
    );
  } catch (error) {
    console.error("Error updating arrears record:", error);
    return errorRresponse(res, 500, "Error updating arrears record", error);
  }
};

// Get all arrears records with filtering and pagination
const getArrearsRecords = async (req, res) => {
  try {
    const {
      page = 1,
      perPage = 10,
      status,
      employeeId,
      startDate,
      endDate,
      processed,
      sortOrder = "Desc",
      sortField = "deductionDate",
      search = "",
    } = req.query;

    const query = {};

    // Apply filters
    if (status) query.status = status;
    if (employeeId) query.employeeId = employeeId;
    if (processed !== undefined) query.processed = processed === "true";
    
    // Date range filter
    if (startDate || endDate) {
      query.deductionDate = {};
      if (startDate) query.deductionDate.$gte = new Date(startDate);
      if (endDate) {
        const endDateObj = new Date(endDate);
        endDateObj.setHours(23, 59, 59, 999);
        query.deductionDate.$lte = endDateObj;
      }
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

    const [arrearsRecords, total] = await Promise.all([
      Arrears.find(query)
        .sort(sortOptions)
        .skip((page - 1) * perPage)
        .limit(perPage),
      Arrears.countDocuments(query),
    ]);

    // Manually populate employee data
    const arrearsWithEmployees = await Promise.all(
      arrearsRecords.map(async (record) => {
        const employee = await Employee.findById(record.employeeId).select('name user_defined_code department');
        return {
          ...record.toObject(),
          employeeId: employee || null
        };
      })
    );

    return successResponse(res, 200, "Arrears Records Fetched Successfully", {
      data: arrearsWithEmployees,
      meta: {
        total,
        page: Number(page),
        perPage: Number(perPage),
        totalPages: Math.ceil(total / perPage),
      },
    });
  } catch (error) {
    console.error("Error fetching arrears records:", error);
    return errorRresponse(res, 500, "Error fetching arrears records", error);
  }
};

// Get a single arrears record
const getArrearsRecord = async (req, res) => {
  try {
    const { id } = req.params;

    const arrears = await Arrears.findById(id);
    
    if (!arrears) {
      return errorRresponse(res, 404, "Arrears record not found");
    }

    // Manually populate employee data
    const employee = await Employee.findById(arrears.employeeId).select('name user_defined_code department');
    const arrearsWithEmployee = {
      ...arrears.toObject(),
      employeeId: employee || null
    };

    return successResponse(
      res,
      200,
      "Arrears Record Fetched Successfully",
      arrearsWithEmployee
    );
  } catch (error) {
    console.error("Error fetching arrears record:", error);
    return errorRresponse(res, 500, "Error fetching arrears record", error);
  }
};

// Delete an arrears record
const deleteArrearsRecord = async (req, res) => {
  try {
    const { id } = req.params;

    const arrears = await Arrears.findByIdAndDelete(id);
    if (!arrears) {
      return errorRresponse(res, 404, "Arrears record not found");
    }

    return successResponse(
      res,
      200,
      "Arrears Record Deleted Successfully",
      arrears
    );
  } catch (error) {
    console.error("Error deleting arrears record:", error);
    return errorRresponse(res, 500, "Error deleting arrears record", error);
  }
};

// Update arrears status
const updateArrearsStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!status || !['Pending', 'Approved', 'Rejected'].includes(status)) {
      return errorRresponse(res, 400, "Valid status is required (Pending, Approved, Rejected)");
    }

    const arrears = await Arrears.findById(id);
    if (!arrears) {
      return errorRresponse(res, 404, "Arrears record not found");
    }

    arrears.status = status;
    await arrears.save();

    return successResponse(
      res,
      200,
      `Arrears record ${status.toLowerCase()} successfully`,
      arrears
    );
  } catch (error) {
    console.error("Error updating arrears status:", error);
    return errorRresponse(res, 500, "Error updating arrears status", error);
  }
};

// Delete multiple arrears records
const deleteMultipleArrearsRecords = async (req, res) => {
  try {
    const { ids } = req.body;

    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return errorRresponse(res, 400, "Valid array of arrears record IDs is required");
    }

    const result = await Arrears.deleteMany({ _id: { $in: ids } });

    return successResponse(
      res,
      200,
      `${result.deletedCount} arrears records deleted successfully`,
      { deletedCount: result.deletedCount }
    );
  } catch (error) {
    console.error("Error deleting multiple arrears records:", error);
    return errorRresponse(res, 500, "Error deleting multiple arrears records", error);
  }
};

module.exports = {
  createArrears,
  updateArrears,
  getArrearsRecords,
  getArrearsRecord,
  deleteArrearsRecord,
  updateArrearsStatus,
  deleteMultipleArrearsRecords
};
