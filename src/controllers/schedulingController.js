const { successResponse, errorRresponse } = require("../utils/response");
const Scheduling = require("../models/scheduling");

// Create a new work schedule
const createScheduling = async (req, res) => {
  try {
    const {
      name,
      workDays,
      shiftStart,
      shiftEnd,
      graceTimeInMinutes,
      minWorkHours,
      minWorkHoursForHalfDay,
      description,
    } = req.body;

    // Validate required fields
    if (!name || !shiftStart || !shiftEnd) {
      return errorRresponse(
        res,
        400,
        "Name, shift start time, and shift end time are required"
      );
    }

    // Check if schedule with same name already exists
    const existing = await Scheduling.findOne({ name });
    if (existing) {
      return errorRresponse(
        res,
        400,
        "A schedule with this name already exists"
      );
    }

    // Create new schedule
    const schedule = new Scheduling({
      name,
      workDays: workDays || [1, 2, 3, 4, 5, 6, 7],
      shiftStart,
      shiftEnd,
      graceTimeInMinutes: graceTimeInMinutes || 15,
      minWorkHours: minWorkHours || 8,
      minWorkHoursForHalfDay: minWorkHoursForHalfDay || 4,
      description: description || "",
    });

    await schedule.save();

    return successResponse(
      res,
      201,
      "Work Schedule Created Successfully",
      schedule
    );
  } catch (error) {
    console.error("Error creating work schedule:", error);
    return errorRresponse(res, 500, "Error creating work schedule", error);
  }
};

// Update a work schedule
const updateScheduling = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      name,
      workDays,
      shiftStart,
      shiftEnd,
      graceTimeInMinutes,
      minWorkHours,
      minWorkHoursForHalfDay,
      description,
      isActive,
    } = req.body;

    // Find the schedule
    const schedule = await Scheduling.findById(id);
    if (!schedule) {
      return errorRresponse(res, 404, "Work schedule not found");
    }

    // Check for name clash if name is being changed
    if (name !== schedule.name) {
      const nameExists = await Scheduling.findOne({ name });
      if (nameExists) {
        return errorRresponse(
          res,
          400,
          "A schedule with this name already exists"
        );
      }
    }

    // Update fields
    if (name) schedule.name = name;
    if (workDays) schedule.workDays = workDays;
    if (shiftStart) schedule.shiftStart = shiftStart;
    if (shiftEnd) schedule.shiftEnd = shiftEnd;
    if (graceTimeInMinutes !== undefined)
      schedule.graceTimeInMinutes = graceTimeInMinutes;
    if (minWorkHours !== undefined) schedule.minWorkHours = minWorkHours;
    if (minWorkHoursForHalfDay !== undefined)
      schedule.minWorkHoursForHalfDay = minWorkHoursForHalfDay;
    if (description !== undefined) schedule.description = description;
    if (isActive !== undefined) schedule.isActive = isActive;

    await schedule.save();

    return successResponse(
      res,
      200,
      "Work Schedule Updated Successfully",
      schedule
    );
  } catch (error) {
    console.error("Error updating work schedule:", error);
    return errorRresponse(res, 500, "Error updating work schedule", error);
  }
};

// Get all work schedules
const getSchedulings = async (req, res) => {
  try {
    const {
      page = 1,
      perPage = 10,
      isActive,
      sortOrder = "Desc",
      sortField = "created_at",
      search = "",
    } = req.query;

    const query = {};

    const sortOptions = {
      [sortField]: sortOrder.toLowerCase() === "desc" ? -1 : 1,
    };

    const searchQuery = search
      ? {
          name: { $regex: search, $options: "i" },
        }
      : {};
    console.log({ searchQuery });
    console.log({ sortOptions });

    const [schedules, total] = await Promise.all([
      Scheduling.find(searchQuery)
        .sort(sortOptions)
        .skip((page - 1) * perPage)
        .limit(perPage),
      Scheduling.countDocuments(query),
    ]);

    return successResponse(res, 200, "Work Schedules Fetched Successfully", {
      data: schedules,
      meta: {
        total,
        page: Number(page),
        perPage: Number(perPage),
        totalPages: Math.ceil(total / perPage),
      },
    });
  } catch (error) {
    console.error("Error fetching work schedules:", error);
    return errorRresponse(res, 500, "Error fetching work schedules", error);
  }
};

// Get a single work schedule
const getScheduling = async (req, res) => {
  try {
    const { id } = req.params;

    const schedule = await Scheduling.findById(id);
    if (!schedule) {
      return errorRresponse(res, 404, "Work schedule not found");
    }

    return successResponse(
      res,
      200,
      "Work Schedule Fetched Successfully",
      schedule
    );
  } catch (error) {
    console.error("Error fetching work schedule:", error);
    return errorRresponse(res, 500, "Error fetching work schedule", error);
  }
};

// Delete a work schedule
const deleteScheduling = async (req, res) => {
  try {
    const { id } = req.params;

    const schedule = await Scheduling.findByIdAndDelete(id);
    if (!schedule) {
      return errorRresponse(res, 404, "Work schedule not found");
    }

    return successResponse(
      res,
      200,
      "Work Schedule Deleted Successfully",
      schedule
    );
  } catch (error) {
    console.error("Error deleting work schedule:", error);
    return errorRresponse(res, 500, "Error deleting work schedule", error);
  }
};

module.exports = {
  createScheduling,
  updateScheduling,
  getSchedulings,
  getScheduling,
  deleteScheduling,
};
