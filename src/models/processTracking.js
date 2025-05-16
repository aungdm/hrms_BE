/**
 * Process Tracking Model
 * Keeps track of when scheduled processes were last run
 * Used for idempotent processing and preventing duplicate processing
 */
const mongoose = require("mongoose");

const ProcessTrackingSchema = new mongoose.Schema(
  // {
  //   // Unique identifier for the process
  //   processId: {
  //     type: String,
  //     required: true,
  //     unique: true,
  //     index: true,
  //   },

  //   // Last time the process was successfully run
  //   lastRunTime: {
  //     type: Date,
  //     required: true,
  //   },

  //   // Additional metadata about the process
  //   metadata: {
  //     type: Object,
  //     default: {},
  //   },
  // },
  // {
  //   timestamps: true, // Adds createdAt and updatedAt fields
  // }
  {
    processId: { type: String, required: true, unique: true },
    lastRunTime: { type: Date, required: true },
    updatedAt: { type: Date, default: Date.now },
  }
);

module.exports = mongoose.model("ProcessTracking", ProcessTrackingSchema);
