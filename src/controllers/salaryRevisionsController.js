const { successResponse, errorRresponse } = require("../utils/response");
const SalaryRevisions = require("../models/salaryRevisions");

const createRecord = async (req, res) => {
  // console.log(req.body, "req . body");
  try {
    const { employment, effectiveDate, previousSalary, salary, description } =
      req.body;
    console.log(req.body, "SalaryRevisions  req Record");

    // const isExist = await SalaryRevisions.findOne({
    //   user_defined_code,
    // });

    // console.log({ isExist });

    // if (isExist) {
    //   return errorRresponse(res, 400, "Employee already exists");
    // }

    const data = new SalaryRevisions({
      employment,
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
          $or: [
            { first_name: { $regex: search, $options: "i" } },
            { last_name: { $regex: search, $options: "i" } },
          ],
        }
      : {};

    // console.log({ searchQuery });
    const data = await SalaryRevisions.find()
      .populate("employment")
      .sort(sortOptions)
      .skip((page - 1) * perPage)
      .limit(perPage);

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
