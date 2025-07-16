const { successResponse, errorRresponse } = require("../utils/response");
const Employee = require("../models/employee");
const bcrypt = require("bcryptjs");
const { generateScheduleForNewEmployee } = require("./employeeScheduleController");

const createRecord = async (req, res) => {
  console.log(req.body, "req . body");
  try {
    const {
      name,
      father_or_husband_name,
      salutation,
      d_o_b,
      mobile_no,
      cnic_no,
      nationality,
      gender,
      user_defined_code,
      joining_date,
      // probation,
      location,
      department,
      designation,
      job_title,
      official_email,
      employee_type,
      payroll,
      payroll_type,
      payment_method,
      currency,
      // probation_salary,
      after_probation_gross_salary,
      description,
      employment_type,
      email_username,
      password,
      role,
      timeSlot,
      leaveTypes,
      workDays,
      _id, // Extract custom _id if provided
    } = req.body;
    console.log(req.body, "cre  ateRecord");

    // Validate password is provided during creation
    if (!password || password.trim() === "") {
      return errorRresponse(res, 400, "Password is required for employee creation");
    }

    const isExist = await Employee.findOne({
      user_defined_code,
    });
    console.log({ isExist });

    if (isExist) {
      return errorRresponse(res, 400, "Employee already exists");
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    // Create employee object with all the fields
    const employeeData = {
      name,
      father_or_husband_name,
      salutation,
      d_o_b,
      mobile_no,
      cnic_no,
      nationality,
      gender,
      user_defined_code,
      joining_date,
      // probation,
      location,
      department,
      designation,
      job_title,
      official_email,
      employee_type,
      payroll,
      payroll_type,
      payment_method,
      currency,
      // probation_salary,
      after_probation_gross_salary,
      description,
      employment_type,
      email_username,
      password: hashedPassword,
      role,
      timeSlot,
      leaveTypes,
      workDays,
    };

    // Add _id if provided from client
    if (_id) {
      employeeData._id = _id;
    }

    console.log({ employeeData }, "creat e  Record");
    const data = new Employee(employeeData);
    console.log({ data }, "createRecord");

    await data.save();

    // Generate schedule for the new employee
    await generateScheduleForNewEmployee(data);

    return successResponse(res, 201, "Record Created Successfully", data);
  } catch (error) {
    console.error("Error creating Record:", error);
    return errorRresponse(res, 500, "Error Creating Record", error);
  }
};

const updateRecord = async (req, res) => {
  console.log(req.body, "updateRecord");
  try {
    const {
      name,
      father_or_husband_name,
      salutation,
      d_o_b,
      mobile_no,
      cnic_no,
      nationality,
      gender,
      user_defined_code,
      joining_date,
      // probation,
      location,
      department,
      designation,
      job_title,
      official_email,
      employee_type,
      payroll,
      payroll_type,
      payment_method,
      currency,
      // probation_salary,
      after_probation_gross_salary,
      description,
      employment_type,
      email_username,
      password,
      role,
      timeSlot,
      leaveTypes,
      workDays,
    } = req.body;

    const { id } = req.params;

    const existing = await Employee.findById(id);
    if (!existing) {
      return errorRresponse(res, 404, "Employee Not Found");
    }

    // Create update object with all fields
    const updateData = {
      name,
      father_or_husband_name,
      salutation,
      d_o_b,
      mobile_no,
      cnic_no,
      nationality,
      gender,
      user_defined_code,
      joining_date,
      // probation,
      location,
      department,
      designation,
      job_title,
      official_email,
      employee_type,
      payroll,
      payroll_type,
      payment_method,
      currency,
      // probation_salary,
      after_probation_gross_salary,
      description,
      employment_type,
      email_username,
      role,
      timeSlot,
      leaveTypes,
      workDays,
    };

    // Only hash and update password if it's provided
    if (password && password.trim() !== "") {
      const hashedPassword = await bcrypt.hash(password, 10);
      updateData.password = hashedPassword;
    }

    console.log({ updateData }, "updateRecord");
    const data = await Employee.findByIdAndUpdate(id, updateData, {
      new: true,
    });
    console.log({ data }, "updateRecord");

    // If timeSlot was updated, regenerate the schedule
    if (req.body.timeSlot) {
      await generateScheduleForNewEmployee(data);
    }

    return successResponse(res, 201, "Data Updated Successfully", data);
  } catch (error) {
    console.error("Error updating data:", error);
    return errorRresponse(res, 500, "Error updating Data", error);
  }
};

const getRecords = async (req, res) => {
  try {
    let {
      page = 1,
      perPage = 5,
      sortOrder = "Desc",
      sortField = "createdAt",
      search = "",
      department = "",
      designation = "",
      employeeType = "",
      payrollType = "",
      location = "",
      joiningDateFrom = "",
      joiningDateTo = "",
      salaryFrom = "",
      salaryTo = "",
      status = "",
      gender = "",
      nationality = "",
    } = req.query;

    page = parseInt(page);
    perPage = parseInt(perPage);

    console.log({ page, perPage });
    const sortOptions = {
      [sortField]: sortOrder === "Desc" ? -1 : 1,
    };

    // Build search query with all filters
    let searchQuery = {};
    const andConditions = [];

    // Text search across multiple fields (only if search term is provided)
    if (search) {
      const searchConditions = [
        { name: { $regex: search, $options: "i" } },
        { official_email: { $regex: search, $options: "i" } },
        { email_username: { $regex: search, $options: "i" } },
        { department: { $regex: search, $options: "i" } },
        { designation: { $regex: search, $options: "i" } },
        { location: { $regex: search, $options: "i" } },
      ];

      // If search is a number, also search by user_defined_code
      if (!isNaN(parseFloat(search)) && isFinite(search)) {
        searchConditions.push({ user_defined_code: parseFloat(search) });
      }

      andConditions.push({ $or: searchConditions });
    }

    // Department filter
    if (department) {
      andConditions.push({ department: { $regex: department, $options: "i" } });
    }

    // Designation filter
    if (designation) {
      andConditions.push({ designation: { $regex: designation, $options: "i" } });
    }

    // Employee Type filter
    if (employeeType) {
      andConditions.push({ employee_type: { $regex: employeeType, $options: "i" } });
    }

    // Payroll Type filter
    if (payrollType) {
      andConditions.push({ payroll_type: { $regex: payrollType, $options: "i" } });
    }

    // Location filter
    if (location) {
      andConditions.push({ location: { $regex: location, $options: "i" } });
    }

    // Gender filter
    if (gender) {
      andConditions.push({ gender: { $regex: gender, $options: "i" } });
    }

    // Nationality filter
    if (nationality) {
      andConditions.push({ nationality: { $regex: nationality, $options: "i" } });
    }

    // Status filter (you might need to add a status field to your schema)
    if (status) {
      andConditions.push({ status: { $regex: status, $options: "i" } });
    }

    // Joining date range filter
    if (joiningDateFrom || joiningDateTo) {
      const dateCondition = {};
      if (joiningDateFrom) {
        dateCondition.$gte = new Date(joiningDateFrom);
      }
      if (joiningDateTo) {
        dateCondition.$lte = new Date(joiningDateTo);
      }
      andConditions.push({ joining_date: dateCondition });
    }

    // Salary range filter (using after_probation_gross_salary)
    if (salaryFrom || salaryTo) {
      const salaryCondition = {};
      if (salaryFrom) {
        salaryCondition.$gte = parseFloat(salaryFrom);
      }
      if (salaryTo) {
        salaryCondition.$lte = parseFloat(salaryTo);
      }
      andConditions.push({ after_probation_gross_salary: salaryCondition });
    }

    // Combine all conditions with $and if there are any conditions
    if (andConditions.length > 0) {
      searchQuery.$and = andConditions;
    }

    const skips = (page - 1) * perPage;

    console.log(
      { searchQuery },
      { page, perPage, sortOrder, sortField, skips, sortOptions }
    );

    // Execute query with filters
    const data = await Employee.find(searchQuery)
      .sort(sortOptions)
      .skip(skips)
      .limit(perPage);

    // Get total count with filters applied
    const totalRecords = await Employee.countDocuments(searchQuery);
    
    // Get total count without filters for comparison
    const allRecords = await Employee.countDocuments();

    const dataList = data.map((item) => item._id);
    // console.log({ dataList });

    return successResponse(res, 200, "Data Fetched Successfully", {
      data: data,
      meta: { 
        total: totalRecords,
        totalWithoutFilters: allRecords,
        filteredCount: totalRecords,
        page: page,
        perPage: perPage,
        totalPages: Math.ceil(totalRecords / perPage)
      },
    });
  } catch (error) {
    console.error("Error fetching data:", error);
    return errorRresponse(res, 500, "Error Fetching Data", error);
  }
};

const getRecord = async (req, res) => {
  try {
    let { id } = req.params;

    const data = await Employee.findById(id);

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

    const data = await Employee.findByIdAndDelete(id);
    console.log("deleted Employee", { data });

    return successResponse(res, 200, "Deleted Successfully", {
      data: data,
    });
  } catch (error) {
    console.error("Error deleting:", error);
    return errorRresponse(res, 500, "Error deleting Data", error);
  }
};

const searchRecords = async (req, res) => {
  try {
    let { search = "" } = req.query;

    const searchQuery = search
      ? {
          name: { $regex: search, $options: "i" },
        }
      : {};

    console.log({ searchQuery });
    const data = await Employee.find(searchQuery);

    return successResponse(res, 200, "Data Fetched Successfully", {
      data: data,
    });
  } catch (error) {
    console.error("Error fetching data:", error);
    return errorRresponse(res, 500, "Error Fetching Data", error);
  }
};

const updateSalaryRecord = async (req, res) => {
  try {
    const updateFields = req.body;

    const { id } = req.params;

    const existing = await Employee.findById(id);
    if (!existing) {
      return errorRresponse(res, 404, "Employee Not Found");
    }

    const data = await Employee.findByIdAndUpdate(
      id,
      { $set: updateFields },
      { new: true, runValidators: true }
    );

    if (!data) {
      return errorRresponse(res, 404, "Employee Not Found");
    }
    return successResponse(res, 200, "Data Updated Successfully", data);
  } catch (error) {
    console.error("Error updating data:", error);
    return errorRresponse(res, 500, "Error updating Data", error);
  }
};

module.exports = {
  createRecord,
  getRecords,
  getRecord,
  updateRecord,
  deleteRecord,
  searchRecords,
  updateSalaryRecord,
};
