const { successResponse, errorRresponse } = require("../utils/response");
const SalaryRevisions = require("../models/salaryRevisions");
const Employee = require("../models/employee");
const mongoose = require("mongoose");

const createRecord = async (req, res) => {
  console.log(req.body, "req . body");
  try {
    const {
      name,
      employment, // This is the user_defined_code
      effectiveDate,
      previousSalary,
      salary,
      description,
    } = req.body;
    console.log(req.body, "SalaryRevisions req Record");

    // Convert employment code to number and find employee
    const employeeCode = Number(employment);
    if (isNaN(employeeCode)) {
      return errorRresponse(res, 400, "Invalid employee code");
    }

    const employee = await Employee.findOne({
      user_defined_code: employeeCode,
    });
    if (!employee) {
      return errorRresponse(res, 404, "Employee not found");
    }

    // Create a new salary revision record
    const data = new SalaryRevisions({
      name,
      employment: employee._id, // Now correctly using the string _id
      effectiveDate,
      previousSalary,
      salary,
      description,
    });
    console.log({ data }, "createRecord");

    await data.save();

    return successResponse(res, 201, "Record Created Successfully", data);
  } catch (error) {
    console.error("Error creating Record:", error);
    return errorRresponse(res, 500, "Error Creating Record", error);
  }
};

const getRecords = async (req, res) => {
  try {
    let {
      page = 1,
      perPage = 10,
      sortOrder = "Desc",
      sortField = "created_at",
      search = "",
    } = req.query;

    page = parseInt(page, 10);
    perPage = parseInt(perPage, 10);

    const sortOptions = {
      [sortField]: sortOrder.toLowerCase() === "desc" ? -1 : 1,
    };

    const searchQuery = search
      ? {
          name: { $regex: search, $options: "i" }, // "i" makes it case-insensitive
        }
      : {};

    console.log({ searchQuery });
    const data = await SalaryRevisions.find(searchQuery)
      .populate("employment")
      .sort(sortOptions)
      .skip((page - 1) * perPage)
      .limit(perPage);
    console.log(data);
    const totalRecords = await SalaryRevisions.countDocuments();

    return successResponse(res, 200, "Data Fetched Successfully", {
      data: data,
      meta: { total: totalRecords },
    });
  } catch (error) {
    console.error("Error fetching data:", error);
    return errorRresponse(res, 500, "Error Fetching Data", error);
  }
};

const getRecord = async (req, res) => {
  try {
    let { id } = req.params;

    const data = await SalaryRevisions.findById(id).populate("employment");

    return successResponse(res, 200, "Data Fetched Successfully", {
      data: data,
    });
  } catch (error) {
    console.error("Error fetching:", error);
    return errorRresponse(res, 500, "Error Fetching Data", error);
  }
};

const deleteRecord = async (req, res) => {
  try {
    let { id } = req.params;

    const data = await SalaryRevisions.findByIdAndDelete(id);
    console.log("deleted Record", { data });

    return successResponse(res, 200, "Deleted Successfully", {
      data: data,
    });
  } catch (error) {
    console.error("Error deleting:", error);
    return errorRresponse(res, 500, "Error deleting Data", error);
  }
};

module.exports = {
  createRecord,
  getRecords,
  getRecord,
  // updateRecord,
  deleteRecord,
};
