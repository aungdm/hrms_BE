const { successResponse, errorRresponse } = require("../utils/response");
const Employee = require("../models/employee");
const AdvancedSalary = require("../models/advancedSalary");

// Create a new advanced salary request
const createAdvancedSalary = async (req, res) => {
  try {
    const {
      employeeId,
      requestedAmount,
      description,
      requiredDate,
      processed
    } = req.body;

    // Validate required fields
    if (!employeeId || !requestedAmount || !requiredDate) {
      return errorRresponse(
        res,
        400,
        "Employee ID, requested amount, and required date are required"
      );
    }

    // Check if employee exists
    const employee = await Employee.findById(employeeId);
    if (!employee) {
      return errorRresponse(res, 404, "Employee not found");
    }

    // Create new advanced salary request
    const advancedSalary = new AdvancedSalary({
      employeeId,
      requestedAmount,
      description: description || "",
      requiredDate: new Date(requiredDate),
      processed: processed || false
    });

    await advancedSalary.save();

    return successResponse(
      res,
      201,
      "Advanced Salary Request Created Successfully",
      advancedSalary
    );
  } catch (error) {
    console.error("Error creating advanced salary request:", error);
    return errorRresponse(res, 500, "Error creating advanced salary request", error);
  }
};

// Update an advanced salary
const updateAdvancedSalary = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      employeeId,
      requestedAmount,
      approvedAmount,
      description,
      status,
      requiredDate,
      processed
    } = req.body;

    // Find the advanced salary
    const advancedSalary = await AdvancedSalary.findById(id);
    if (!advancedSalary) {
      return errorRresponse(res, 404, "Advanced salary request not found");
    }

    // Check if employee exists if employeeId is being updated
    if (employeeId && employeeId !== advancedSalary.employeeId.toString()) {
      const employee = await Employee.findById(employeeId);
      if (!employee) {
        return errorRresponse(res, 404, "Employee not found");
      }
      advancedSalary.employeeId = employeeId;
    }

    // Update fields
    if (requestedAmount !== undefined) advancedSalary.requestedAmount = requestedAmount;
    if (description !== undefined) advancedSalary.description = description;
    if (requiredDate !== undefined) advancedSalary.requiredDate = new Date(requiredDate);
    if (processed !== undefined) advancedSalary.processed = processed;
    
    // Handle status change and approval
    if (status && status !== advancedSalary.status) {
      advancedSalary.status = status;
      
      if (status === "Approved" && approvedAmount) {
        advancedSalary.approvedAmount = approvedAmount;
        advancedSalary.approvalDate = new Date();
      }
    }

    await advancedSalary.save();

    return successResponse(
      res,
      200,
      "Advanced Salary Updated Successfully",
      advancedSalary
    );
  } catch (error) {
    console.error("Error updating advanced salary:", error);
    return errorRresponse(res, 500, "Error updating advanced salary", error);
  }
};

// Get all advanced salaries with filtering and pagination
const getAdvancedSalaries = async (req, res) => {
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

    const [advancedSalaries, total] = await Promise.all([
      AdvancedSalary.find(query)
        .populate('employeeId', 'name user_defined_code department')
        .sort(sortOptions)
        .skip((page - 1) * perPage)
        .limit(perPage),
      AdvancedSalary.countDocuments(query),
    ]);

    return successResponse(res, 200, "Advanced Salaries Fetched Successfully", {
      data: advancedSalaries,
      meta: {
        total,
        page: Number(page),
        perPage: Number(perPage),
        totalPages: Math.ceil(total / perPage),
      },
    });
  } catch (error) {
    console.error("Error fetching advanced salaries:", error);
    return errorRresponse(res, 500, "Error fetching advanced salaries", error);
  }
};

// Get a single advanced salary
const getAdvancedSalary = async (req, res) => {
  try {
    const { id } = req.params;

    const advancedSalary = await AdvancedSalary.findById(id)
      .populate('employeeId', 'name user_defined_code department');
    
    if (!advancedSalary) {
      return errorRresponse(res, 404, "Advanced salary not found");
    }

    return successResponse(
      res,
      200,
      "Advanced Salary Fetched Successfully",
      advancedSalary
    );
  } catch (error) {
    console.error("Error fetching advanced salary:", error);
    return errorRresponse(res, 500, "Error fetching advanced salary", error);
  }
};

// Delete an advanced salary
const deleteAdvancedSalary = async (req, res) => {
  try {
    const { id } = req.params;

    const advancedSalary = await AdvancedSalary.findByIdAndDelete(id);
    if (!advancedSalary) {
      return errorRresponse(res, 404, "Advanced salary not found");
    }

    return successResponse(
      res,
      200,
      "Advanced Salary Deleted Successfully",
      advancedSalary
    );
  } catch (error) {
    console.error("Error deleting advanced salary:", error);
    return errorRresponse(res, 500, "Error deleting advanced salary", error);
  }
};

// Update advanced salary status
const updateAdvancedSalaryStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, approvedAmount } = req.body;

    console.log("Received status update request:", { id, status, approvedAmount });

    // Validate ID
    if (!id || id === 'undefined') {
      return errorRresponse(res, 400, "Valid advanced salary ID is required");
    }

    if (!status || !['Pending', 'Approved', 'Rejected', 'Completed'].includes(status)) {
      return errorRresponse(res, 400, "Valid status is required (Pending, Approved, Rejected, Completed)");
    }

    // Find the advanced salary with more detailed error handling
    let advancedSalary;
    try {
      advancedSalary = await AdvancedSalary.findById(id);
    } catch (error) {
      console.error("Error finding advanced salary:", error);
      return errorRresponse(res, 400, `Invalid ID format: ${id}`);
    }

    if (!advancedSalary) {
      return errorRresponse(res, 404, `Advanced salary not found with ID: ${id}`);
    }

    advancedSalary.status = status;
    
    if (status === "Approved") {
      if (!approvedAmount || isNaN(parseFloat(approvedAmount)) || parseFloat(approvedAmount) <= 0) {
        return errorRresponse(res, 400, "Valid approved amount is required for approval");
      }
      
      advancedSalary.approvedAmount = parseFloat(approvedAmount);
      advancedSalary.approvalDate = new Date();
    }
    
    await advancedSalary.save();

    return successResponse(
      res,
      200,
      `Advanced Salary ${status.toLowerCase()} successfully`,
      advancedSalary
    );
  } catch (error) {
    console.error("Error updating advanced salary status:", error);
    return errorRresponse(res, 500, "Error updating advanced salary status", error);
  }
};

// Delete multiple advanced salaries
const deleteMultipleAdvancedSalaries = async (req, res) => {
  try {
    const { ids } = req.body;

    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return errorRresponse(res, 400, "Valid array of advanced salary IDs is required");
    }

    const result = await AdvancedSalary.deleteMany({ _id: { $in: ids } });

    return successResponse(
      res,
      200,
      `${result.deletedCount} advanced salaries deleted successfully`,
      { deletedCount: result.deletedCount }
    );
  } catch (error) {
    console.error("Error deleting multiple advanced salaries:", error);
    return errorRresponse(res, 500, "Error deleting multiple advanced salaries", error);
  }
};

module.exports = {
  createAdvancedSalary,
  updateAdvancedSalary,
  getAdvancedSalaries,
  getAdvancedSalary,
  deleteAdvancedSalary,
  updateAdvancedSalaryStatus,
  deleteMultipleAdvancedSalaries
};
