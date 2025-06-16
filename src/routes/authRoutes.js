const express = require("express");
const router = express.Router();

// This is a placeholder controller function - ideally should be in a separate controller file
const getProfile = (req, res) => {
  // Mock user profile data for now
  return res.status(200).json({
    success: true,
    data: {
      id: "1",
      name: "John Doe",
      email: "john.doe@example.com",
      role: "admin",
      permissions: ["view", "edit", "delete"]
    }
  });
};

// Profile route
router.get("/get_profile", getProfile);

module.exports = router; 