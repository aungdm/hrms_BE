const mongoose = require("mongoose");

const EmployeeSchema = new mongoose.Schema(
  {
    _id: {
      type: String,
      required: false,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    father_or_husband_name: {
      type: String,
      required: true,
      trim: true,
    },
    salutation: {
      type: String,
      required: true,
      enum: ["Mr.", "Mrs.", "Ms.", "Dr."],
    },
    d_o_b: {
      type: Date,
      required: true,
    },
    mobile_no: {
      type: String,
      required: true,
      match: [/^\d{10,15}$/, "Please enter a valid mobile number"],
    },
    cnic_no: {
      type: String,
      required: true,
      match: [/^\d{13}$/, "CNIC must be a 13-digit number"],
    },
    nationality: {
      type: String,
      required: true,
    },
    gender: {
      type: String,
      required: true,
      enum: ["Male", "Female", "Other"],
    },
    user_defined_code: {
      type: Number,
      required: true,
      unique: true,
    },
    joining_date: {
      type: Date,
      required: true,
    },
    probation: {
      type: Boolean,
      default: false,
    },
    location: {
      type: String,
      required: true,
    },
    department: {
      type: String,
      required: true,
    },
    designation: {
      type: String,
      required: true,
    },
    job_title: {
      type: String,
      required: true,
    },
    official_email: {
      type: String,
      required: true,
      // unique: true,
      lowercase: true,
      match: [/\S+@\S+\.\S+/, "Invalid email format"],
    },
    employee_type: {
      type: String,
      required: true,
    },
    payroll: {
      type: String,
      required: true,
    },
    payroll_type: {
      type: String,
      required: true,
    },
    payment_method: {
      type: String,
      required: true,
    },
    currency: {
      type: String,
      required: true,
    },
    probation_salary: {
      type: String,
      required: true,
    },
    after_probation_gross_salary: {
      type: String,
      required: true,
    },
    description: {
      type: String,
      required: true,
    },
    employment_type: {
      type: String,
      required: true,
    },
    email_username: {
      type: String,
      required: true,
    },
    password: {
      type: String,
      required: true,
      minlength: 6,
    },
    role: {
      type: String,
      required: true,
    },
    timeSlot: {
      type: String,
      default: null,
    },
    leaveTypes: {
      type: String,
      required: true,
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model("Employee", EmployeeSchema);
