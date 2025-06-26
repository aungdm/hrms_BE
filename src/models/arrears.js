const mongoose = require("mongoose");

const ArrearsSchema = new mongoose.Schema({
  employeeId: { 
    type: String, 
    required: true 
  },
  deductionType: { 
    type: String, 
    required: true 
  },
  amount: { 
    type: Number, 
    required: true 
  },
  deductionDate: { 
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

module.exports = mongoose.model("Arrears", ArrearsSchema);
