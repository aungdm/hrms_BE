const mongoose = require("mongoose");

const EmployeeScheduleSchema = new mongoose.Schema({
  employee_id: {
    type: String,
    ref: "Employee",
    required: true
  },
  time_slot_id: {
    type: String,
    ref: "WorkSchedule",
    required: true
  },
  month: {
    type: Number, // 1-12 representing months
    required: true
  },
  year: {
    type: Number,
    required: true
  },
  schedules: [
    {
      date: {
        type: Date,
        required: true
      },
      start: {
        type: Date,
        required: true
      },
      end: {
        type: Date,
        required: true
      },
      day_changed: {
        type: Boolean,
        default: false
      },
      isDayOff: {
        type: Boolean,
        default: false
      },
      is_full_overtime_shift: {
        type: Boolean,
        default: false
      },
      actual_expected_minutes: {
        type: Number,
        required: true
      },
      notes: {
        type: String,
        default: ""
      }
    }
  ]
}, {
  timestamps: true
});

// Compound index to ensure one schedule per employee per month/year
EmployeeScheduleSchema.index({ employee_id: 1, month: 1, year: 1 }, { unique: true });

module.exports = mongoose.model("EmployeeSchedule", EmployeeScheduleSchema); 