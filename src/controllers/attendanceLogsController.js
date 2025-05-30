const { successResponse, errorRresponse } = require("../utils/response");
const ZKLib = require("node-zklib");
const AttendanceLog = require("../models/attendanceLogs");
const cron = require("node-cron");
const { getAttendanceMachines } = require("../utils/attendanceMachineConfig");

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
    } = req.query;

    const query = {};

    if (startDate || endDate) {
      query.recordTime = {};
      if (startDate) query.recordTime.$gte = new Date(startDate);
      if (endDate) query.recordTime.$lte = new Date(endDate);
    }

    if (userId) query.deviceUserId = userId;
    if (processed !== undefined) query.isProcessed = processed === "true";
    if (deviceId) query.deviceId = deviceId;

    console.log({ query });
    const [records, total] = await Promise.all([
      AttendanceLog.find(query)
        .populate("deviceUserId")
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

module.exports = {
  getRecords,
  forceSyncRecords,
  syncAttendanceLogs,
  getMachinesInfo
};
