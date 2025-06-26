const mongoose = require("mongoose");

const OtherIncentiveSchema = new mongoose.Schema({
  employeeId: { 
    type: String, 
    required: true 
  },
  incentiveType: { 
    type: String, 
    required: true 
  },
  amount: { 
    type: Number, 
    required: true 
  },
  incentiveDate: { 
    type: Date, 
    required: true 
  },
  description: { 
    type: String, 
    default: "" 
  },
  status: { 
    type: String, 
    enum: ["Pending", "Approved", "Rejected"],
    default: "Pending"
  },
  processed: { 
    type: Boolean, 
    default: false 
  },
}, { 
  timestamps: true 
});

module.exports = mongoose.model("OtherIncentive", OtherIncentiveSchema);
