const { error } = require("console");

const successResponse = (res, statusCode = 200, message, data = {}) => {
  return res.status(statusCode).json({
    success: true,
    message,
    data,
  });
};

const errorRresponse = (res, statusCode = 400, message, error = {}) => {
  return res.status(statusCode).json({
    success: false,
    message,
    error,
  });
};

module.exports = { successResponse, errorRresponse };
