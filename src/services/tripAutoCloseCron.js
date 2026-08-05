const cron = require('node-cron');
const config = require('../config/transportConfig');
const tripAutoCloseService = require('./tripAutoCloseService');

async function runTripAutoCloseScan() {
    // console.log('[TripAutoCloseCron] Executing scheduled transport trip auto-close scan...');
    await tripAutoCloseService.scanAndAutoCloseTrips();
};

function initTripAutoCloseCron() {
    const schedule = config.TRIP_AUTO_CLOSE_CRON_SCHEDULE || '*/5 * * * *';
    cron.schedule(schedule, () => {
        runTripAutoCloseScan().catch(err => {
            console.error('[TripAutoCloseCron] Unhandled error during auto-close scan:', err.message || err);
        });
    });
    // console.log(`[TripAutoCloseCron] Transport Trip Auto-Close Cron initialized (Schedule: ${schedule})`);
};

module.exports = { runTripAutoCloseScan, initTripAutoCloseCron };