const { successResponse, errorRresponse } = require("../utils/response");
const OtherIncentive = require("../models/otherIncentives");
const Employee = require("../models/employee");

// Create a new incentive
const createIncentive = async (req, res) => {
  try {
    const {
      employeeId,
      incentiveType,
      amount,
      incentiveDate,
      description,
      status
    } = req.body;

    // Validate required fields
    if (!employeeId || !incentiveType || !amount || !incentiveDate) {
      return errorRresponse(
        res,
        400,
        "Employee ID, incentive type, amount, and incentive date are required"
      );
    }

    // Check if employee exists
    const employee = await Employee.findById(employeeId);
    if (!employee) {
      return errorRresponse(res, 404, "Employee not found");
    }

    // Create new incentive
    const incentive = new OtherIncentive({
      employeeId,
      incentiveType,
      amount,
      incentiveDate,
      description: description || "",
      status: status || "Pending"
    });

    await incentive.save();

    return successResponse(
      res,
      201,
      "Incentive Created Successfully",
      incentive
    );
  } catch (error) {
    console.error("Error creating incentive:", error);
    return errorRresponse(res, 500, "Error creating incentive", error);
  }
};

// Update an incentive
const updateIncentive = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      employeeId,
      incentiveType,
      amount,
      incentiveDate,
      description,
      status,
      processed
    } = req.body;

    // Find the incentive
    const incentive = await OtherIncentive.findById(id);
    if (!incentive) {
      return errorRresponse(res, 404, "Incentive not found");
    }

    // Check if employee exists if employeeId is being updated
    if (employeeId && employeeId !== incentive.employeeId) {
      const employee = await Employee.findById(employeeId);
      if (!employee) {
        return errorRresponse(res, 404, "Employee not found");
      }
    }

    // Update fields
    if (employeeId) incentive.employeeId = employeeId;
    if (incentiveType) incentive.incentiveType = incentiveType;
    if (amount !== undefined) incentive.amount = amount;
    if (incentiveDate) incentive.incentiveDate = incentiveDate;
    if (description !== undefined) incentive.description = description;
    if (status) incentive.status = status;
    if (processed !== undefined) incentive.processed = processed;

    await incentive.save();

    return successResponse(
      res,
      200,
      "Incentive Updated Successfully",
      incentive
    );
  } catch (error) {
    console.error("Error updating incentive:", error);
    return errorRresponse(res, 500, "Error updating incentive", error);
  }
};

// Get all incentives with filtering and pagination
const getIncentives = async (req, res) => {
  try {
    const {
      page = 1,
      perPage = 10,
      status,
      employeeId,
      startDate,
      endDate,
      sortOrder = "Desc",
      sortField = "incentiveDate",
      search = "",
    } = req.query;

    const query = {};

    // Apply filters
    if (status) query.status = status;
    if (employeeId) query.employeeId = employeeId;
    
    // Date range filter
    if (startDate || endDate) {
      query.incentiveDate = {};
      if (startDate) query.incentiveDate.$gte = new Date(startDate);
      if (endDate) query.incentiveDate.$lte = new Date(endDate);
    }

    // Search by description or incentive type
    if (search) {
      query.$or = [
        { description: { $regex: search, $options: "i" } },
        { incentiveType: { $regex: search, $options: "i" } }
      ];
    }

    const sortOptions = {
      [sortField]: sortOrder.toLowerCase() === "desc" ? -1 : 1,
    };

    const [incentives, total] = await Promise.all([
      OtherIncentive.find(query)
        .sort(sortOptions)
        .skip((page - 1) * perPage)
        .limit(perPage),
      OtherIncentive.countDocuments(query),
    ]);

    // Manually populate employee data
    const incentivesWithEmployees = await Promise.all(
      incentives.map(async (incentive) => {
        const employee = await Employee.findById(incentive.employeeId).select('name user_defined_code department');
        return {
          ...incentive.toObject(),
          employeeId: employee || null
        };
      })
    );

    return successResponse(res, 200, "Incentives Fetched Successfully", {
      data: incentivesWithEmployees,
      meta: {
        total,
        page: Number(page),
        perPage: Number(perPage),
        totalPages: Math.ceil(total / perPage),
      },
    });
  } catch (error) {
    console.error("Error fetching incentives:", error);
    return errorRresponse(res, 500, "Error fetching incentives", error);
  }
};

// Get a single incentive
const getIncentive = async (req, res) => {
  try {
    const { id } = req.params;

    const incentive = await OtherIncentive.findById(id);
    
    if (!incentive) {
      return errorRresponse(res, 404, "Incentive not found");
    }

    // Manually populate employee data
    const employee = await Employee.findById(incentive.employeeId).select('name user_defined_code department');
    const incentiveWithEmployee = {
      ...incentive.toObject(),
      employeeId: employee || null
    };

    return successResponse(
      res,
      200,
      "Incentive Fetched Successfully",
      incentiveWithEmployee
    );
  } catch (error) {
    console.error("Error fetching incentive:", error);
    return errorRresponse(res, 500, "Error fetching incentive", error);
  }
};

// Delete an incentive
const deleteIncentive = async (req, res) => {
  try {
    const { id } = req.params;

    const incentive = await OtherIncentive.findByIdAndDelete(id);
    if (!incentive) {
      return errorRresponse(res, 404, "Incentive not found");
    }

    return successResponse(
      res,
      200,
      "Incentive Deleted Successfully",
      incentive
    );
  } catch (error) {
    console.error("Error deleting incentive:", error);
    return errorRresponse(res, 500, "Error deleting incentive", error);
  }
};

// Update incentive status
const updateIncentiveStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!status || !['Pending', 'Approved', 'Rejected'].includes(status)) {
      return errorRresponse(res, 400, "Valid status is required (Pending, Approved, Rejected)");
    }

    const incentive = await OtherIncentive.findById(id);
    if (!incentive) {
      return errorRresponse(res, 404, "Incentive not found");
    }

    incentive.status = status;
    await incentive.save();

    return successResponse(
      res,
      200,
      `Incentive ${status.toLowerCase()} successfully`,
      incentive
    );
  } catch (error) {
    console.error("Error updating incentive status:", error);
    return errorRresponse(res, 500, "Error updating incentive status", error);
  }
};

// Delete multiple incentives
const deleteMultipleIncentives = async (req, res) => {
  try {
    const { ids } = req.body;

    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return errorRresponse(res, 400, "Valid array of incentive IDs is required");
    }

    const result = await OtherIncentive.deleteMany({ _id: { $in: ids } });

    return successResponse(
      res,
      200,
      `${result.deletedCount} incentives deleted successfully`,
      { deletedCount: result.deletedCount }
    );
  } catch (error) {
    console.error("Error deleting multiple incentives:", error);
    return errorRresponse(res, 500, "Error deleting multiple incentives", error);
  }
};

module.exports = {
  createIncentive,
  updateIncentive,
  getIncentives,
  getIncentive,
  deleteIncentive,
  updateIncentiveStatus,
  deleteMultipleIncentives
};
