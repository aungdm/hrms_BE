const { successResponse, errorRresponse } = require("../utils/response");
const Employee = require("../models/employee");
const bcrypt = require("bcryptjs");

const createRecord = async (req, res) => {
  // console.log(req.body, "req . body");
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
      probation,
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
      probation_salary,
      after_probation_gross_salary,
      description,
      employment_type,
      email_username,
      password,
      role,
      timeSlot,
      leaveTypes,
    } = req.body;
    console.log(req.body, "cre  ateRecord");

    const isExist = await Employee.findOne({
      user_defined_code,
    });
    console.log({ isExist });

    if (isExist) {
      return errorRresponse(res, 400, "Employee already exists");
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const data = new Employee({
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
      probation,
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
      probation_salary,
      after_probation_gross_salary,
      description,
      employment_type,
      email_username,
      password: hashedPassword,
      role,
      timeSlot,
      leaveTypes,
    });
    console.log({ data }, "createRecord");

    await data.save();

    return successResponse(res, 201, "Record Created Successfully", data);
  } catch (error) {
    console.error("Error creating Record:", error);
    return errorRresponse(res, 500, "Error Creating Record", error);
  }
};

// const updateRecord = async (req, res) => {
//   try {
//     const {
//       first_name,
//       last_name,
//       father_or_husband_name,
//       salutation,
//       d_o_b,
//       mobile_no,
//       cnic_no,
//       nationality,
//       gender,
//       user_defined_code,
//       joining_date,
//       probation,
//       location,
//       department,
//       designation,
//       job_title,
//       official_email,
//       employee_type,
//       employment_type,
//       email_username,
//       password,
//       role,
//       timeSlot,
//       leaveTypes,
//     } = req.body;

//     const { id } = req.params;

//     const existing = await Employee.findById(id);
//     if (!existing) {
//       return errorRresponse(res, 404, "Employee Not Found");
//     }

//     let hashedPassword = existing.password;
//     if (password) {
//       hashedPassword = await bcrypt.hash(password, 10);
//     }
//     const data = await Employee.findByIdAndUpdate(
//       id,
//       {
//         first_name,
//         last_name,
//         father_or_husband_name,
//         salutation,
//         d_o_b,
//         mobile_no,
//         cnic_no,
//         nationality,
//         gender,
//         user_defined_code,
//         joining_date,
//         probation,
//         location,
//         department,
//         designation,
//         job_title,
//         official_email,
//         employee_type,
//         employment_type,
//         email_username,
//         password: hashedPassword,
//         role,
//         timeSlot,
//         leaveTypes,
//       },
//       { new: true }
//     );
//     return successResponse(res, 201, "Data Updated Successfully", data);
//   } catch (error) {
//     console.error("Error updating data:", error);
//     return errorRresponse(res, 500, "Error updating Data", error);
//   }
// };

// const getRecords = async (req, res) => {
//   try {
//     let {
//       page = 1,
//       perPage = 10,
//       sortOrder = "Desc",
//       sortField = "created_at",
//       search = "",
//     } = req.query;

//     page = parseInt(page, 10);
//     perPage = parseInt(perPage, 10);

//     const sortOptions = {
//       [sortField]: sortOrder.toLowerCase() === "desc" ? -1 : 1,
//     };

//     const searchQuery = search
//       ? {
//           name: search,
//         }
//       : {};

//     console.log({ searchQuery });
//     const data = await Employee.find(searchQuery)
//       .sort(sortOptions)
//       .skip((page - 1) * perPage)
//       .limit(perPage);

//     const totalRecords = await Employee.countDocuments();

//     return successResponse(res, 200, "Data Fetched Successfully", {
//       data: data,
//       meta: { total: totalRecords },
//     });
//   } catch (error) {
//     console.error("Error fetching data:", error);
//     return errorRresponse(res, 500, "Error Fetching Data", error);
//   }
// };

// const getRecord = async (req, res) => {
//   try {
//     let { id } = req.params;

//     const data = await Employee.findById(id);

//     return successResponse(res, 200, "Data Fetched Successfully", {
//       data: data,
//     });
//   } catch (error) {
//     console.error("Error fetching:", error);
//     return errorRresponse(res, 500, "Error Fetching Data", error);
//   }
// };

// const deleteRecord = async (req, res) => {
//   try {
//     let { id } = req.params;

//     const data = await Employee.findByIdAndDelete(id);
//     console.log("deleted Employee", { data });

//     return successResponse(res, 200, "Deleted Successfully", {
//       data: data,
//     });
//   } catch (error) {
//     console.error("Error deleting:", error);
//     return errorRresponse(res, 500, "Error deleting Data", error);
//   }
// };

// const searchRecords = async (req, res) => {
//   try {
//     let { search = "" } = req.query;

//     const searchQuery = search
//       ? {
//           name: { $regex: search, $options: "i" },
//         }
//       : {};

//     console.log({ searchQuery });
//     const data = await Employee.find(searchQuery);

//     return successResponse(res, 200, "Data Fetched Successfully", {
//       data: data,
//     });
//   } catch (error) {
//     console.error("Error fetching data:", error);
//     return errorRresponse(res, 500, "Error Fetching Data", error);
//   }
// };

// const updateSalaryRecord = async (req, res) => {
//   try {
//     const updateFields = req.body;

//     const { id } = req.params;

//     const existing = await Employee.findById(id);
//     if (!existing) {
//       return errorRresponse(res, 404, "Employee Not Found");
//     }

//     const data = await Employee.findByIdAndUpdate(
//       id,
//       { $set: updateFields },
//       { new: true, runValidators: true }
//     );

//     if (!data) {
//       return errorRresponse(res, 404, "Employee Not Found");
//     }
//     return successResponse(res, 200, "Data Updated Successfully", data);
//   } catch (error) {
//     console.error("Error updating data:", error);
//     return errorRresponse(res, 500, "Error updating Data", error);
//   }
// };

module.exports = {
  createRecord,
  // getRecords,
  // getRecord,
  // updateRecord,
  // deleteRecord,
  // searchRecords,
  // updateSalaryRecord,
};