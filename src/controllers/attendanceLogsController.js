const { successResponse, errorRresponse } = require("../utils/response");
const ZKLib = require("node-zklib");
const AttendanceLog = require("../models/attendanceLogs");
const cron = require("node-cron");
const { getAttendanceMachines } = require("../utils/attendanceMachineConfig");
const moment = require("moment"); // Added moment.js for date filtering

let isSyncing = false;

// Get attendance machine configurations
const attendanceMachines = getAttendanceMachines();

// Function to check if a machine is reachable
const checkMachineConnectivity = async (machine) => {
  const zkInstance = new ZKLib(machine.ip, machine.port, machine.timeout);
  try {
    console.log(`Testing connectivity to ${machine.name} (${machine.ip})...`);
    await zkInstance.createSocket();
    console.log(`Successfully connected to ${machine.name} (${machine.ip})`);
    return true;
  } catch (error) {
    console.error(`Connection failed to ${machine.name} (${machine.ip}):`, error.message);
    return false;
  } finally {
    try {
      await zkInstance.disconnect();
    } catch (e) {
      // Ignore disconnect errors
    }
  }
};

// Function to sync attendance logs from a single machine
const syncMachineLogs = async (machine) => {
  // First check if machine is reachable
  const isConnected = await checkMachineConnectivity(machine);
  if (!isConnected) {
    console.log(`Skipping sync for ${machine.name} (${machine.ip}) due to connection issues`);
    return 0;
  }

  const zkInstance = new ZKLib(machine.ip, machine.port, machine.timeout);
  try {
    console.log(`Starting attendance sync for ${machine.name} (${machine.ip})...`);
    await zkInstance.createSocket();

    // Wrap data fetching and initial processing in a nested try-catch
    try {
      const logs = await zkInstance.getAttendances();
      console.log({ logs }, "logs");
      console.log(logs.data.length , "logs.data.lwngth");

      if (!logs || !logs.data || !Array.isArray(logs.data)) {
        console.log(`No valid data received from ${machine.name} (${machine.ip})`);
        return 0;
      }


      // Get the latest log timestamp from our database for this device
      const latestLog = await AttendanceLog.findOne(
        { deviceId: machine.ip },
        {},
        { sort: { recordTime: -1 } }
      );
      const latestTimestamp = latestLog ? latestLog.recordTime : new Date(0);

      // Filter and prepare new logs
      const newLogs = logs.data
        .filter((log) => new Date(log.recordTime) > latestTimestamp)
        .map((log) => ({
          deviceUserId: log.deviceUserId,
          recordTime: new Date(log.recordTime),
          deviceId: machine.ip,
          syncedAt: new Date(),
          isProcessed: false,
        }));

      if (newLogs.length > 0) {
        console.log({newLogs})
        // Use bulkWrite for efficient batch insertion
        // try {
          await AttendanceLog.bulkWrite(
            newLogs.map((log) => ({
              updateOne: {
                filter: {
                  deviceUserId: log.deviceUserId,
                  recordTime: log.recordTime,
                  deviceId: machine.ip
                },
                update: { $setOnInsert: log },
                upsert: true,
              },
            }))
          );
          console.log(`Synced ${newLogs.length} new attendance records from ${machine.name} (${machine.ip})`);
          return newLogs.length;
        // } catch (error) {
        //   if (error.code === 11000) {
        //     console.warn(`Skipping duplicate attendance records for ${machine.name} (${machine.ip}):`, error.message);
        //     // Optionally, you could try to insert non-duplicates here if needed,
        //     // but for simplicity, we'll just log and continue.
        //     return 0; // No new records successfully inserted in this case
        //   } else {
        //     // Re-throw other errors
        //     throw error;
        //   }
        // }
      } else {
        console.log(`No new attendance records to sync from ${machine.name} (${machine.ip})`);
        return 0;
      }
    } catch (error) {
      console.error(`Error during attendance sync for ${machine.name} (${machine.ip}):`, error);
      return 0;
    }
  } catch (error) {
    console.error(`Error during attendance sync for ${machine.name} (${machine.ip}):`, error);
    return 0;
  } finally {
    try {
      await zkInstance.disconnect();
    } catch (e) {
      console.error(`Error during disconnect for ${machine.name} (${machine.ip}):`, e);
    }
  }
};

// Function to sync attendance logs from all machines
const syncAttendanceLogs = async () => {
  if (isSyncing) {
    console.log("Sync already in progress, skipping...");
    return;
  }

  isSyncing = true;
  console.log("Starting attendance sync across all machines...");
  
  let totalRecordsSynced = 0;
  
  try {
    // Process each machine sequentially
    for (const machine of attendanceMachines) {
      try {
        const recordsSynced = await syncMachineLogs(machine);
        totalRecordsSynced += recordsSynced;
      } catch (machineError) {
        // Log the error but continue with other machines
        console.error(`Error syncing from ${machine.name} (${machine.ip}), continuing with other machines:`, machineError);
      }
    }
    
    console.log(`Completed attendance sync across all machines. Total records synced: ${totalRecordsSynced}`);
  } catch (error) {
    console.error("Error during attendance sync process:", error);
  } finally {
    isSyncing = false;
  }
};

// Initialize periodic sync (every 10 minutes)
// Commenting out the automatic sync since we're now handling it differently via startup sequence
// cron.schedule('*/5 * * * *', syncAttendanceLogs);

// API endpoint to get attendance records with pagination and filtering
const getRecords = async (req, res) => {
  try {
    const {
      page = 1,
      perPage = 10,
      startDate,
      endDate,
      userId,
      processed,
      deviceId,
      search
    } = req.query;

    console.log("Request query parameters:", { 
      page, 
      perPage, 
      startDate, 
      endDate, 
      userId, 
      processed: `'${processed}'`, // Log with quotes to see empty strings
      deviceId, 
      search 
    });

    const query = {};

    // Date range filter
    if (startDate || endDate) {
      query.recordTime = {};
      if (startDate) query.recordTime.$gte = moment(startDate).startOf('day').toDate();
      if (endDate) {
        query.recordTime.$lte = moment(endDate).endOf('day').toDate();
      }
    }

    // Employee ID filter
    if (userId) {
      console.log(`Processing userId filter: ${userId}`);
      try {
        // Check if userId is a valid ObjectId
        const mongoose = require('mongoose');
        
        // If userId is numeric (like "2002"), we need to handle it differently
        // as it's likely a user_defined_code rather than MongoDB ObjectId
        if (!isNaN(userId)) {
          console.log(`userId ${userId} appears to be numeric, treating as user_defined_code`);
          // First, find the employee with this user_defined_code
          const Employee = require('../models/employee');
          const employee = await Employee.findOne({ user_defined_code: userId });
          
          if (employee) {
            console.log(`Found employee with user_defined_code ${userId}: ${employee.name} (${employee._id})`);
            // If found, use the employee's _id
            query.deviceUserId = employee._id;
          } else {
            console.log(`No employee found with user_defined_code ${userId}, using directly as deviceUserId`);
            // If no employee found with this code, use it directly
            // This might be the case if the deviceUserId is stored as a string
            query.deviceUserId = userId;
          }
        } 
        // If it's a valid ObjectId, use it directly
        else if (mongoose.Types.ObjectId.isValid(userId)) {
          console.log(`userId ${userId} is a valid ObjectId`);
          query.deviceUserId = mongoose.Types.ObjectId(userId);
        }
        // Otherwise, it might be a string identifier
        else {
          console.log(`userId ${userId} is not a valid ObjectId or numeric ID, using as-is`);
          query.deviceUserId = userId;
        }
      } catch (error) {
        console.error(`Error processing userId filter: ${error.message}`);
        // Don't fail the whole request if there's an issue with the userId filter
        // Just use it as-is
        query.deviceUserId = userId;
      }
    }

    // Processed status filter - Only apply if explicitly set to "true" or "false"
    if (processed === "true" || processed === "false") {
      console.log(`Applying processed filter: ${processed}`);
      query.isProcessed = processed === "true";
    } else {
      console.log("No processed filter applied - showing all logs");
    }

    // Device ID filter
    if (deviceId) {
      query.deviceId = deviceId;
    }

    // Text search functionality
    if (search) {
      // We need to search in the related employee data
      // This will be handled by a separate aggregation pipeline
      console.log(`Searching for: ${search}`);
    }

    console.log("Query parameters:", { query, page, perPage, search });
    
    // If we have a search term, use aggregation to search in related employee data
    let records = [];
    let total = 0;
    
    if (search && search.trim() !== '') {
      const Employee = require('../models/employee');
      
      // First find employees matching the search term
      const matchingEmployees = await Employee.find({
        $or: [
          { name: { $regex: search, $options: 'i' } },
          { user_defined_code: { $regex: search, $options: 'i' } }
        ]
      }).select('_id');
      
      const employeeIds = matchingEmployees.map(emp => emp._id);
      
      if (employeeIds.length > 0) {
        // Add employee IDs to the query
        if (query.deviceUserId) {
          // If there's already a userId filter, we need to ensure it's one of these matching employees
          if (!employeeIds.includes(query.deviceUserId)) {
            // No matches possible, return empty result
            return successResponse(res, 200, "Data Fetched Successfully", {
              data: [],
              meta: {
                total: 0,
                page: Number(page),
                perPage: Number(perPage),
                totalPages: 0,
              },
            });
          }
        } else {
          // Add the employee IDs to the query
          query.deviceUserId = { $in: employeeIds };
        }
      } else if (search) {
        // If no employees match the search but search was provided, return empty results
        return successResponse(res, 200, "Data Fetched Successfully", {
          data: [],
          meta: {
            total: 0,
            page: Number(page),
            perPage: Number(perPage),
            totalPages: 0,
          },
        });
      }
      
      // Also check if search matches device ID
      if (search && !query.deviceId) {
        const deviceMatch = await AttendanceLog.distinct('deviceId', {
          deviceId: { $regex: search, $options: 'i' }
        });
        
        if (deviceMatch.length > 0) {
          if (query.deviceUserId) {
            // If we already have employee filters, use $or to combine with device search
            query.$or = [
              { deviceUserId: query.deviceUserId },
              { deviceId: { $in: deviceMatch } }
            ];
            delete query.deviceUserId; // Remove from the main query since it's in $or now
          } else {
            // Just add the device filter
            query.deviceId = { $in: deviceMatch };
          }
        }
      }
    }
    
    // Execute the query with all filters applied
    [records, total] = await Promise.all([
      AttendanceLog.find(query)
        .populate("deviceUserId", "name user_defined_code department designation")
        .sort({ recordTime: -1 })
        .skip((page - 1) * perPage)
        .limit(perPage),
      AttendanceLog.countDocuments(query),
    ]);

    return successResponse(res, 200, "Data Fetched Successfully", {
      data: records,
      meta: {
        total,
        page: Number(page),
        perPage: Number(perPage),
        totalPages: Math.ceil(total / perPage),
      },
    });
  } catch (error) {
    console.error("Error fetching attendance records:", error);
    return errorRresponse(res, 500, "Error fetching attendance records", error);
  }
};

// Force manual sync endpoint
const forceSyncRecords = async (req, res) => {
  try {
    await syncAttendanceLogs();
    return successResponse(res, 200, "Manual sync completed successfully");
  } catch (error) {
    return errorRresponse(res, 500, "Error during manual sync", error);
  }
};

// Get information about configured machines and their last sync status
const getMachinesInfo = async (req, res) => {
  try {
    const machineInfoPromises = attendanceMachines.map(async (machine) => {
      // Get latest log for this machine
      const latestLog = await AttendanceLog.findOne(
        { deviceId: machine.ip },
        {},
        { sort: { syncedAt: -1 } }
      );

      // Get count of logs from this machine
      const logsCount = await AttendanceLog.countDocuments({ deviceId: machine.ip });
      
      return {
        name: machine.name,
        ip: machine.ip,
        port: machine.port,
        lastSyncTime: latestLog ? latestLog.syncedAt : null,
        recordsCount: logsCount,
        status: await checkMachineConnectivity(machine) ? "Online" : "Offline"
      };
    });

    const machinesInfo = await Promise.all(machineInfoPromises);
    
    return successResponse(res, 200, "Machines information retrieved successfully", machinesInfo);
  } catch (error) {
    console.error("Error getting machines information:", error);
    return errorRresponse(res, 500, "Error getting machines information", error);
  }
};


const newSyncMachineLogsFromJson = async (machine) => {
  // First check if machine is reachable
  const isConnected = await checkMachineConnectivity(machine);
  if (!isConnected) {
    console.log(`Skipping sync for ${machine.name} (${machine.ip}) due to connection issues`);
    return 0;
  }

  const zkInstance = new ZKLib(machine.ip, machine.port, machine.timeout);
  try {
    console.log(`Starting attendance sync for ${machine.name} (${machine.ip})...`);
    await zkInstance.createSocket();

    // Wrap data fetching and initial processing in a nested try-catch
    try {
      const logs = await zkInstance.getAttendances();
      console.log({ logs }, "logs");
      if (!logs || !logs.data || !Array.isArray(logs.data)) {
        console.log(`No valid data received from ${machine.name} (${machine.ip})`);
        return 0;
      }

      // Get the latest log timestamp from our database for this device
      const latestLog = await AttendanceLog.findOne(
        { deviceId: machine.ip },
        {},
        { sort: { recordTime: -1 } }
      );
      const latestTimestamp = latestLog ? latestLog.recordTime : new Date(0);

      // Filter and prepare new logs
      const newLogs = logs.data
        .filter((log) => new Date(log.recordTime) > latestTimestamp)
        .map((log) => ({
          deviceUserId: log.deviceUserId,
          recordTime: new Date(log.recordTime),
          deviceId: machine.ip,
          syncedAt: new Date(),
          isProcessed: false,
        }));

      if (newLogs.length > 0) {
        console.log({newLogs})
        // Use bulkWrite for efficient batch insertion
        // try {
          await AttendanceLog.bulkWrite(
            newLogs.map((log) => ({
              updateOne: {
                filter: {
                  deviceUserId: log.deviceUserId,
                  recordTime: log.recordTime,
                  deviceId: machine.ip
                },
                update: { $setOnInsert: log },
                upsert: true,
              },
            }))
          );
          console.log(`Synced ${newLogs.length} new attendance records from ${machine.name} (${machine.ip})`);
          return newLogs.length;
        // } catch (error) {
        //   if (error.code === 11000) {
        //     console.warn(`Skipping duplicate attendance records for ${machine.name} (${machine.ip}):`, error.message);
        //     // Optionally, you could try to insert non-duplicates here if needed,
        //     // but for simplicity, we'll just log and continue.
        //     return 0; // No new records successfully inserted in this case
        //   } else {
        //     // Re-throw other errors
        //     throw error;
        //   }
        // }
      } else {
        console.log(`No new attendance records to sync from ${machine.name} (${machine.ip})`);
        return 0;
      }
    } catch (error) {
      console.error(`Error during attendance sync for ${machine.name} (${machine.ip}):`, error);
      return 0;
    }
  } catch (error) {
    console.error(`Error during attendance sync for ${machine.name} (${machine.ip}):`, error);
    return 0;
  } finally {
    try {
      await zkInstance.disconnect();
    } catch (e) {
      console.error(`Error during disconnect for ${machine.name} (${machine.ip}):`, e);
    }
  }
};

// Get logs with processing errors
const getProcessingErrors = async (req, res) => {
  try {
    const {
      page = 1,
      perPage = 10,
      startDate,
      endDate,
      userId,
      deviceId
    } = req.query;

    const query = {
      processingError: { $ne: null }
    };

    // Date range filter
    if (startDate || endDate) {
      query.recordTime = {};
      if (startDate) query.recordTime.$gte = moment(startDate).startOf('day').toDate();
      if (endDate) {
        query.recordTime.$lte = moment(endDate).endOf('day').toDate();
      }
    }

    // Employee ID filter
    if (userId) {
      try {
        const mongoose = require('mongoose');
        
        // If userId is numeric (like "2002"), we need to handle it differently
        if (!isNaN(userId)) {
          const Employee = require('../models/employee');
          const employee = await Employee.findOne({ user_defined_code: userId });
          
          if (employee) {
            query.deviceUserId = employee._id;
          } else {
            query.deviceUserId = userId;
          }
        } 
        // If it's a valid ObjectId, use it directly
        else if (mongoose.Types.ObjectId.isValid(userId)) {
          query.deviceUserId = mongoose.Types.ObjectId(userId);
        }
        // Otherwise, it might be a string identifier
        else {
          query.deviceUserId = userId;
        }
      } catch (error) {
        console.error(`Error processing userId filter: ${error.message}`);
        query.deviceUserId = userId;
      }
    }

    // Device ID filter
    if (deviceId) {
      query.deviceId = deviceId;
    }

    // Get total count and paginated results
    const [records, total] = await Promise.all([
      AttendanceLog.find(query)
        .populate("deviceUserId", "name user_defined_code department designation")
        .sort({ lastProcessingAttempt: -1 })
        .skip((page - 1) * perPage)
        .limit(perPage),
      AttendanceLog.countDocuments(query),
    ]);

    return successResponse(res, 200, "Processing errors fetched successfully", {
      data: records,
      meta: {
        total,
        page: Number(page),
        perPage: Number(perPage),
        totalPages: Math.ceil(total / perPage),
      },
    });
  } catch (error) {
    console.error("Error fetching processing errors:", error);
    return errorRresponse(res, 500, "Error fetching processing errors", error);
  }
};

// Reset processing error for specific logs
const resetProcessingError = async (req, res) => {
  try {
    const { logIds } = req.body;
    
    if (!logIds || !Array.isArray(logIds) || logIds.length === 0) {
      return errorRresponse(res, 400, "Invalid request: logIds array is required");
    }
    
    // Reset processing error and attempts
    const result = await AttendanceLog.updateMany(
      { _id: { $in: logIds } },
      { 
        $set: { 
          processingError: null,
          isProcessed: false
        }
      }
    );
    
    return successResponse(res, 200, "Processing errors reset successfully", {
      modifiedCount: result.modifiedCount,
      matchedCount: result.matchedCount
    });
  } catch (error) {
    console.error("Error resetting processing errors:", error);
    return errorRresponse(res, 500, "Error resetting processing errors", error);
  }
};

module.exports = {
  getRecords,
  forceSyncRecords,
  syncAttendanceLogs,
  getMachinesInfo,
  getProcessingErrors,
  resetProcessingError
};
