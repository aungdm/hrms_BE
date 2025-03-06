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

const accessLogStream = fs.createWriteStream(
  path.join(__dirname, "logs", "access.log"),
  {
    flags: "a",
  }
);

app.use(cors());
app.use(helmet());
app.use(compression());
app.use(morgan("combined", { stream: accessLogStream }));
app.use(morgan("dev"));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(mongoSanitize());
app.use(xss());

connectDB();

app.use("/api/v1/employee", require("./routes/employeeRoutes"));
app.use("/api/v1/salaryRevisions", require("./routes/salaryRevisionsRoutes"));

app.use(errorHandler);

module.exports = app;