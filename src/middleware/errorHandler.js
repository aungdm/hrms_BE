const { errorRresponse } = require("../utils/response");

const errorHandler = (err, req, res, next) => {
  console.err(err.stack);
  console.err(err);
  return errorRresponse(res, 500, "Internal Server Error", err.message);
};

module.exports = errorHandler;
