// Keep one canonical upload route. Re-exporting the owner-authorized router
// prevents this legacy module from becoming an authentication-only bypass if
// it is mounted again in the future.
module.exports = require("./uploadRoutes");
