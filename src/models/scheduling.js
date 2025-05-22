const mongoose = require("mongoose");

const SchedulingSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    unique: true
  },
  workDays: {
    type: [Number], // 0 = Sunday, 1 = Monday, etc.
    default: [1, 2, 3, 4, 5] // Default Monday to Friday
  },
  shiftStart: {
    type: String, // Format: "HH:MM" in 24-hour format
    required: true
  },
  shiftEnd: {
    type: String, // Format: "HH:MM" in 24-hour format
    required: true
  },
  graceTimeInMinutes: {
    type: Number,
    default: 15
  },
  minWorkHours: {
    type: Number, // Minimum hours required for full day
    default: 8
  },
  minWorkHoursForHalfDay: {
    type: Number,
    default: 4
  },
  description: {
    type: String,
    default: ""
  },
  isActive: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true
});

module.exports = mongoose.model("SchedulingSchema", SchedulingSchema); 