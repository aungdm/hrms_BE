/**
 * Attendance Processor Tests
 * Tests the hourly attendance processor functionality
 */
const mongoose = require('mongoose');
const moment = require('moment');
const { expect } = require('chai');
const sinon = require('sinon');

// Import models and processor
const AttendanceLog = require('../models/attendanceLogs');
const DailyAttendance = require('../models/dailyAttendance');
const Employee = require('../models/employee');
const WorkSchedule = require('../models/workSchedule');
const ProcessTracking = require('../models/processTracking');
const { processHourlyAttendanceLogs, determineShiftDate } = require('../utils/attendanceProcessor');

// Test environment configuration
require('dotenv').config({ path: '.env.test' });

describe('Attendance Processor', function() {
  // Increase timeout for database operations
  this.timeout(10000);
  
  // Mock data
  let testEmployee;
  let testWorkSchedule;
  let clock;
  
  // Connect to test database before tests
  before(async function() {
    // Connect to test database
    await mongoose.connect(process.env.MONGO_URI_TEST || 'mongodb://localhost:27017/hrms_test');
    
    // Clear test collections
    await AttendanceLog.deleteMany({});
    await DailyAttendance.deleteMany({});
    await Employee.deleteMany({});
    await WorkSchedule.deleteMany({});
    await ProcessTracking.deleteMany({});
    
    // Create test work schedule
    testWorkSchedule = await WorkSchedule.create({
      name: 'Standard 9-5',
      workDays: [1, 2, 3, 4, 5], // Monday to Friday
      shiftStart: '09:00',
      shiftEnd: '17:00',
      graceTimeInMinutes: 15,
      minWorkHours: 8,
      minWorkHoursForHalfDay: 4
    });
    
    // Create test employee
    testEmployee = await Employee.create({
      _id: 'EMP001',
      name: 'Test Employee',
      email_username: 'test@example.com',
      password: 'password123',
      timeSlot: 'Standard 9-5',
      role: 'Employee',
      leaveTypes: 'Annual Leaves'
    });
  });
  
  // Disconnect after all tests
  after(async function() {
    await mongoose.disconnect();
  });
  
  // Clean up after each test
  afterEach(async function() {
    await AttendanceLog.deleteMany({});
    await DailyAttendance.deleteMany({});
    await ProcessTracking.deleteMany({});
    
    // Restore any stubs or mocks
    if (clock) {
      clock.restore();
      clock = null;
    }
    sinon.restore();
  });
  
  describe('determineShiftDate function', function() {
    it('should correctly identify current day for normal hours', function() {
      // Wednesday, July 12, 2023, 10:30 AM
      const timestamp = new Date('2023-07-12T10:30:00.000Z');
      const result = determineShiftDate(timestamp, testWorkSchedule);
      expect(result.format('YYYY-MM-DD')).to.equal('2023-07-12');
    });
    
    it('should correctly identify current day for early check-in', function() {
      // Wednesday, July 12, 2023, 6:30 AM (early check-in)
      const timestamp = new Date('2023-07-12T06:30:00.000Z');
      const result = determineShiftDate(timestamp, testWorkSchedule);
      expect(result.format('YYYY-MM-DD')).to.equal('2023-07-12');
    });
    
    it('should correctly identify current day for late check-out', function() {
      // Wednesday, July 12, 2023, 7:30 PM (late check-out)
      const timestamp = new Date('2023-07-12T19:30:00.000Z');
      const result = determineShiftDate(timestamp, testWorkSchedule);
      expect(result.format('YYYY-MM-DD')).to.equal('2023-07-12');
    });
    
    it('should correctly identify previous day for very late check-out', function() {
      // Thursday, July 13, 2023, 12:30 AM (very late check-out from previous day)
      const timestamp = new Date('2023-07-13T00:30:00.000Z');
      const result = determineShiftDate(timestamp, testWorkSchedule);
      expect(result.format('YYYY-MM-DD')).to.equal('2023-07-12');
    });
    
    it('should correctly identify next day for very early check-in', function() {
      // Tuesday, July 11, 2023, 11:30 PM (very early check-in for next day)
      const timestamp = new Date('2023-07-11T23:30:00.000Z');
      const result = determineShiftDate(timestamp, testWorkSchedule);
      expect(result.format('YYYY-MM-DD')).to.equal('2023-07-12');
    });
  });
  
  describe('processHourlyAttendanceLogs function', function() {
    it('should process normal attendance logs within shift hours', async function() {
      // Create test logs for normal hours
      const checkInTime = new Date('2023-07-12T09:05:00.000Z'); // 9:05 AM
      const checkOutTime = new Date('2023-07-12T17:10:00.000Z'); // 5:10 PM
      
      await AttendanceLog.create([
        { deviceUserId: 'EMP001', recordTime: checkInTime, isProcessed: false },
        { deviceUserId: 'EMP001', recordTime: checkOutTime, isProcessed: false }
      ]);
      
      // Run the processor
      const result = await processHourlyAttendanceLogs();
      
      // Verify results
      expect(result.processed).to.equal(2);
      expect(result.created + result.updated).to.be.at.least(1);
      
      // Verify attendance record
      const attendance = await DailyAttendance.findOne({ employeeId: 'EMP001' });
      expect(attendance).to.exist;
      expect(attendance.status).to.equal('Present');
      expect(attendance.firstEntry.toISOString()).to.equal(checkInTime.toISOString());
      expect(attendance.lastExit.toISOString()).to.equal(checkOutTime.toISOString());
      
      // Verify logs are marked as processed
      const logs = await AttendanceLog.find({ deviceUserId: 'EMP001' });
      expect(logs.every(log => log.isProcessed)).to.be.true;
    });
    
    it('should process early check-in attendance logs', async function() {
      // Create test logs for early check-in
      const checkInTime = new Date('2023-07-12T06:30:00.000Z'); // 6:30 AM (2.5 hours early)
      const checkOutTime = new Date('2023-07-12T17:05:00.000Z'); // 5:05 PM
      
      await AttendanceLog.create([
        { deviceUserId: 'EMP001', recordTime: checkInTime, isProcessed: false },
        { deviceUserId: 'EMP001', recordTime: checkOutTime, isProcessed: false }
      ]);
      
      // Run the processor
      const result = await processHourlyAttendanceLogs();
      
      // Verify results
      expect(result.processed).to.equal(2);
      
      // Verify attendance record
      const attendance = await DailyAttendance.findOne({ employeeId: 'EMP001' });
      expect(attendance).to.exist;
      expect(attendance.status).to.equal('Present');
      expect(attendance.firstEntry.toISOString()).to.equal(checkInTime.toISOString());
      expect(attendance.lastExit.toISOString()).to.equal(checkOutTime.toISOString());
      expect(attendance.date.toISOString().split('T')[0]).to.equal('2023-07-12');
    });
    
    it('should process late check-out attendance logs', async function() {
      // Create test logs for late check-out
      const checkInTime = new Date('2023-07-12T09:05:00.000Z'); // 9:05 AM
      const checkOutTime = new Date('2023-07-12T20:30:00.000Z'); // 8:30 PM (3.5 hours late)
      
      await AttendanceLog.create([
        { deviceUserId: 'EMP001', recordTime: checkInTime, isProcessed: false },
        { deviceUserId: 'EMP001', recordTime: checkOutTime, isProcessed: false }
      ]);
      
      // Run the processor
      const result = await processHourlyAttendanceLogs();
      
      // Verify results
      expect(result.processed).to.equal(2);
      
      // Verify attendance record
      const attendance = await DailyAttendance.findOne({ employeeId: 'EMP001' });
      expect(attendance).to.exist;
      expect(attendance.status).to.equal('Present');
      expect(attendance.firstEntry.toISOString()).to.equal(checkInTime.toISOString());
      expect(attendance.lastExit.toISOString()).to.equal(checkOutTime.toISOString());
      expect(attendance.date.toISOString().split('T')[0]).to.equal('2023-07-12');
    });
    
    it('should process cross-day attendance logs (midnight shift)', async function() {
      // Create a special midnight shift work schedule
      const midnightSchedule = await WorkSchedule.create({
        name: 'Midnight Shift',
        workDays: [1, 2, 3, 4, 5], // Monday to Friday
        shiftStart: '22:00', // 10 PM
        shiftEnd: '06:00', // 6 AM next day
        graceTimeInMinutes: 15,
        minWorkHours: 8,
        minWorkHoursForHalfDay: 4
      });
      
      // Create employee with midnight shift
      const nightEmployee = await Employee.create({
        _id: 'EMP002',
        name: 'Night Employee',
        email_username: 'night@example.com',
        password: 'password123',
        timeSlot: 'Midnight Shift',
        role: 'Employee',
        leaveTypes: 'Annual Leaves'
      });
      
      // Wednesday shift starts Wednesday night and ends Thursday morning
      const checkInTime = new Date('2023-07-12T22:05:00.000Z'); // 10:05 PM Wednesday
      const checkOutTime = new Date('2023-07-13T06:10:00.000Z'); // 6:10 AM Thursday
      
      await AttendanceLog.create([
        { deviceUserId: 'EMP002', recordTime: checkInTime, isProcessed: false },
        { deviceUserId: 'EMP002', recordTime: checkOutTime, isProcessed: false }
      ]);
      
      // Run the processor
      const result = await processHourlyAttendanceLogs();
      
      // Verify results
      expect(result.processed).to.equal(2);
      
      // Verify attendance record - should be recorded for Wednesday
      const attendance = await DailyAttendance.findOne({ employeeId: 'EMP002' });
      expect(attendance).to.exist;
      expect(attendance.status).to.equal('Present');
      expect(attendance.firstEntry.toISOString()).to.equal(checkInTime.toISOString());
      expect(attendance.lastExit.toISOString()).to.equal(checkOutTime.toISOString());
      expect(attendance.date.toISOString().split('T')[0]).to.equal('2023-07-12');
    });
    
    it('should maintain idempotency when run multiple times', async function() {
      // Create test logs
      const checkInTime = new Date('2023-07-12T09:05:00.000Z');
      const checkOutTime = new Date('2023-07-12T17:10:00.000Z');
      
      await AttendanceLog.create([
        { deviceUserId: 'EMP001', recordTime: checkInTime, isProcessed: false },
        { deviceUserId: 'EMP001', recordTime: checkOutTime, isProcessed: false }
      ]);
      
      // Run the processor twice
      await processHourlyAttendanceLogs();
      const result2 = await processHourlyAttendanceLogs();
      
      // Second run should process 0 logs since they're already marked as processed
      expect(result2.processed).to.equal(0);
      
      // Verify only one attendance record exists
      const count = await DailyAttendance.countDocuments({ employeeId: 'EMP001' });
      expect(count).to.equal(1);
    });
  });
}); 