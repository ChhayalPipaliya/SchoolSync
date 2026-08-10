const cron = require('node-cron');
const config = require('../config/transportConfig');
const tripAutoCloseService = require('./tripAutoCloseService');

async function runTripAutoCloseScan() {
    await tripAutoCloseService.scanAndAutoCloseTrips();
};

function initTripAutoCloseCron() {
    const schedule = config.TRIP_AUTO_CLOSE_CRON_SCHEDULE || '*/5 * * * *';
    cron.schedule(schedule, () => {
        runTripAutoCloseScan().catch(err => {
            console.error('[TripAutoCloseCron] Unhandled error during auto-close scan:', err.message || err);
        });
    });
};

module.exports = { runTripAutoCloseScan, initTripAutoCloseCron };