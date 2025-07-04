const mongoose = require("mongoose");

const AttendanceLogSchema = new mongoose.Schema({
  deviceUserId: {
    type: String,
    ref: "Employee",
    required: true,
    index: true
  }, 
  recordTime: {
    type: Date,
    required: true,
    index: true
  },
  deviceId: {
    type: String,
    default: "default"
  },
  syncedAt: {
    type: Date,
    default: Date.now
  },
  isProcessed: {
    type: Boolean,
    default: false,
    index: true
  },
  processingError: {
    type: String,
    default: null
  },
  processingAttempts: {
    type: Number,
    default: 0
  },
  lastProcessingAttempt: {
    type: Date,
    default: null
  }
}, {
  timestamps: true
});

// Compound index for efficient querying
// AttendanceLogSchema.index({ deviceUserId: 1, recordTime: 1 }, { unique: true });

module.exports = mongoose.model("AttendanceLog", AttendanceLogSchema); 