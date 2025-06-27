const mongoose = require("mongoose");

const AdvancedSalarySchema = new mongoose.Schema({
  employeeId: { 
    type: String, 
    ref: 'Employee',
    required: true 
  },
  requestedAmount: { 
    type: Number, 
    required: true 
  },
  approvedAmount: { 
    type: Number,
    default: 0
  },
  requestDate: { 
    type: Date, 
    default: Date.now 
  },
  requiredDate: {
    type: Date,
    required: true
  },
  approvalDate: { 
    type: Date
  },
  description: { 
    type: String, 
    default: "" 
  },
  status: { 
    type: String, 
    enum: ["Pending", "Approved", "Rejected", "Completed"],
    default: "Pending"
  },
  processed: {
    type: Boolean,
    default: false
  }
}, { 
  timestamps: true 
});

module.exports = mongoose.model("AdvancedSalary", AdvancedSalarySchema);
