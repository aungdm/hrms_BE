/**
 * Attendance Machine Configuration Utility
 * 
 * This file loads attendance machine configurations from environment variables
 * with fallback to default values if environment variables are not set.
 * 
 * Environment variables:
 * - ATTENDANCE_MACHINE_1_IP, ATTENDANCE_MACHINE_1_PORT, ATTENDANCE_MACHINE_1_TIMEOUT
 * - ATTENDANCE_MACHINE_2_IP, ATTENDANCE_MACHINE_2_PORT, ATTENDANCE_MACHINE_2_TIMEOUT
 * - ATTENDANCE_MACHINE_3_IP, ATTENDANCE_MACHINE_3_PORT, ATTENDANCE_MACHINE_3_TIMEOUT
 */

// Default configurations in case environment variables are not set
const defaultMachines = [
  { ip: "116.0.46.13", port: 4370, timeout: 10000, name: "Machine 1" },
  { ip: "116.0.46.12", port: 4370, timeout: 10000, name: "Machine 2" },
  { ip: "116.0.46.14", port: 4370, timeout: 10000, name: "Machine 3" }
];

/**
 * Load machine configuration from environment variables
 * @param {number} index - Machine index (1-based)
 * @returns {Object} Machine configuration
 */
const loadMachineConfig = (index) => {
  const envPrefix = `ATTENDANCE_MACHINE_${index}`;
  
  const ip = process.env[`${envPrefix}_IP`] || defaultMachines[index-1].ip;
  const port = parseInt(process.env[`${envPrefix}_PORT`] || defaultMachines[index-1].port, 10);
  const timeout = parseInt(process.env[`${envPrefix}_TIMEOUT`] || defaultMachines[index-1].timeout, 10);
  
  return {
    ip,
    port,
    timeout,
    name: `Machine ${index}`
  };
};

/**
 * Get all configured attendance machines
 * @returns {Array} Array of machine configurations
 */
const getAttendanceMachines = () => {
  return [
    loadMachineConfig(1),
    loadMachineConfig(2),
    loadMachineConfig(3)
  ];
};

module.exports = {
  getAttendanceMachines
};  