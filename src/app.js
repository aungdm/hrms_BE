const express = require("express");
const app = express();
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
const compression = require("compression");
const connectDB = require("./config/db");
const errorHandler = require("./middleware/errorHandler");
const mongoSanitize = require("express-mongo-sanitize");
const xss = require("xss-clean");
const fs = require("fs");
const path = require("path");
require("dotenv").config();

// Import startup sequence instead of directly importing the job scheduler
// const { initializeStartupSequence } = require('./jobs/startupSequence');

// For serverless environments, use in-memory logging instead of file system
// const isServerless = process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME;
// let accessLogStream;

// if (!isServerless) {
//   try {
//     // Ensure logs directory exists
//     const logDir = path.join(__dirname, "logs");
//     if (!fs.existsSync(logDir)) {
//       fs.mkdirSync(logDir, { recursive: true });
//     }

//     accessLogStream = fs.createWriteStream(
//       path.join(logDir, "access.log"),
//       {
//         flags: "a",
//       }
//     );
//   } catch (error) {
//     console.error("Error setting up log file:", error);
//     // Fallback to console logging
//     accessLogStream = {
//       write: (message) => console.log(message)
//     };
//   }
// } else {
//   // Use console logging in serverless environment
//   accessLogStream = {
//     write: (message) => console.log(message)
//   };
// }

// Configure CORS to specifically allow requests from the frontend application
// const corsOptions = {
//   origin: ['https://gdmhrms.vercel.app', 'http://localhost:3000', 'http://localhost:5173'],
//   methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
//   credentials: true,
//   optionsSuccessStatus: 204
// };
// app.use(cors(corsOptions));

app.use(
  cors({
    origin: "https://gdmhrms.vercel.app",
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "x-current-language"],
    credentials: true,
  })
);

// Optional: Handle OPTIONS explicitly (if needed)
app.options("*", cors());
app.use(helmet());
app.use(compression());
app.use(morgan("combined", { stream: accessLogStream }));
app.use(morgan("dev"));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(mongoSanitize());
app.use(xss());

// Connect to MongoDB
connectDB();

// Define all routes
app.use("/api/v1/employee", require("./routes/employeeRoutes"));
// app.use("/api/v1/salaryRevisions", require("./routes/salaryRevisionsRoutes"));
// app.use("/api/v1/attendanceLogs", require("./routes/attendanceLogsRoutes"));
// app.use("/api/v1/timeSheet", require("./routes/timeSheetRoutes"));
// app.use("/api/v1/dailyAttendance", require("./routes/dailyAttendanceRoutes"));
// app.use("/api/v1/workSchedule", require("./routes/workScheduleRoutes"));
// app.use("/api/v1/leave", require("./routes/leaveRoutes"));
// app.use("/api/v1/punch", require("./routes/punchRoutes"));

// Add a health check route for Vercel
// app.get("/api/health", (req, res) => {
//   res.status(200).json({ status: "ok", environment: isServerless ? "serverless" : "server" });
// });

// Error handler should be after all routes
app.use(errorHandler);

app.get("/", (req, res) => {
  res.status(200).json({ status: "ok" });
});
// Initialize the startup sequence only in non-serverless environments
// if (!isServerless) {
//   initializeStartupSequence();
// } else {
//   console.log("Running inn serverless environment - startup sequence skipped");
// }

module.exports = app;
