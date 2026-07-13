const express = require("express");
const router = express.Router();
const { verifyToken } = require("../middleware/auth");
const searchController = require("../controllers/searchController");

router.get("/search", verifyToken, searchController.index);

module.exports = router;