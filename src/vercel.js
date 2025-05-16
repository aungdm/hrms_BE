/**
 * Vercel Serverless Entry Point for HRMS Backend
 * 
 * This file serves as the entry point for Vercel serverless deployment.
 * Unlike the standard server.js, it doesn't start a separate listener
 * as Vercel handles that automatically.
 */

const app = require('./app');

// Set a flag indicating we're in a serverless environment
process.env.VERCEL = 'true';

// Export the Express app directly for serverless use
module.exports = app; 