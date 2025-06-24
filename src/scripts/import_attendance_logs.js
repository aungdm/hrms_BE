const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

// Import the AttendanceLog model with the correct filename
const AttendanceLog = require('../models/attendanceLogs');

// Path to the JSON file
const jsonFilePath = 'C:\\Users\\PC-Office\\Downloads\\attendence_json_utc.json';

// Function to import logs from JSON file
const importLogsFromJsonFile = async (filePath) => {
  try {
    console.log(`Reading attendance logs from file: ${filePath}`);
    
    // Read and parse the JSON file
    const jsonData = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    
    if (!jsonData || !Array.isArray(jsonData)) {
      console.log('No valid data found in the JSON file');
      return 0;
    }
    
    console.log(`Found ${jsonData.length} records in the JSON file`);
    
    // Process in batches to avoid overwhelming the database
    const batchSize = 500;
    let insertedTotal = 0;
    
    for (let i = 0; i < jsonData.length; i += batchSize) {
      const batch = jsonData.slice(i, i + batchSize);
      console.log(`Processing batch ${Math.floor(i/batchSize) + 1} of ${Math.ceil(jsonData.length/batchSize)}, size: ${batch.length}`);
      
      // Prepare logs for insertion
      const newLogs = batch.map(log => ({
        deviceUserId: log.deviceUserId,
        recordTime: new Date(log.recordTime),
        deviceId: log.deviceId,
        syncedAt: new Date(),
        isProcessed: false,
      }));
      
      try {
        const result = await AttendanceLog.bulkWrite(
          newLogs.map((log) => ({
            updateOne: {
              filter: {
                deviceUserId: log.deviceUserId,
                recordTime: log.recordTime,
                deviceId: log.deviceId
              },
              update: { $setOnInsert: log },
              upsert: true,
            },
          }))
        );
        
        // Get the number of new records inserted in this batch
        const insertedCount = result.upsertedCount || 0;
        insertedTotal += insertedCount;
        console.log(`Batch ${Math.floor(i/batchSize) + 1} complete: ${insertedCount} new records inserted`);
      } catch (error) {
        if (error.code === 11000) {
          console.warn(`Skipping duplicate attendance records in batch ${Math.floor(i/batchSize) + 1}`);
        } else {
          throw error;
        }
      }
    }
    
    console.log(`Successfully imported a total of ${insertedTotal} new attendance records`);
    return insertedTotal;
  } catch (error) {
    console.error(`Error during attendance import:`, error);
    return 0;
  }
};

// Connect to MongoDB
const connectDB = async () => {
  try {
    console.log('Connecting to MongoDB...');
    console.log('MongoDB URI:', process.env.MONGO_URI);
    
    const conn = await mongoose.connect(process.env.MONGO_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log(`MongoDB Connected: ${conn.connection.host}`);
    return true;
  } catch (error) {
    console.error(`Error connecting to MongoDB: ${error.message}`);
    process.exit(1);
  }
};

// Main function to run the import
const main = async () => {
  // Connect to the database
  await connectDB();
  
  // Import the logs
  const importedCount = await importLogsFromJsonFile(jsonFilePath);
  
  console.log(`Import process completed. Total records imported: ${importedCount}`);
  
  // Close the database connection
  mongoose.connection.close();
};

// Run the main function
main().catch(err => {
  console.error('Error in main function:', err);
  mongoose.connection.close();
}); 