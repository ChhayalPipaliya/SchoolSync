const cron = require('node-cron');
const db = require('../config/database');

async function updateMeetingStatuses() {
    try {
        // 1. scheduled -> live (when start time is reached)
        const liveResult = await db.executeAsync(
            `UPDATE meetings 
             SET status = 'live', started_at = NOW(), updated_at = NOW() 
             WHERE status IN ('scheduled', 'upcoming')
               AND scheduled_at <= NOW()
               AND NOW() <= DATE_ADD(scheduled_at, INTERVAL duration_minutes MINUTE)`
        );
        if (liveResult.affectedRows > 0) {
            console.log(`[MeetingCron] Marked ${liveResult.affectedRows} meetings as live.`);
        }

        // 2. Fetch IDs of meetings that are about to be marked as completed.
        const endingMeetings = await db.queryAsync(
            `SELECT id FROM meetings 
             WHERE status IN ('live', 'ongoing')
               AND DATE_ADD(scheduled_at, INTERVAL (duration_minutes + 15) MINUTE) <= NOW()`
        );

        if (endingMeetings && endingMeetings.length > 0) {
            const meetingIds = endingMeetings.map(m => m.id);

            // 3. Perform crash recovery for users who didn't explicitly trigger leave tracking
            const recoveryResult = await db.queryAsync(
                `UPDATE meeting_attendance 
                 SET left_at = last_seen_at, 
                     duration_minutes = GREATEST(0, TIMESTAMPDIFF(MINUTE, joined_at, last_seen_at))
                 WHERE meeting_id IN (?) AND left_at IS NULL`,
                [meetingIds]
            );
            if (recoveryResult.affectedRows > 0) {
                console.log(`[MeetingCron] Recovered attendance logs for ${recoveryResult.affectedRows} participants (crashes/unexpected exit).`);
            }

            // 4. Mark live -> completed.
            const endedResult = await db.queryAsync(
                `UPDATE meetings 
                 SET status = 'completed', ended_at = NOW(), updated_at = NOW() 
                 WHERE id IN (?)`,
                [meetingIds]
            );
            if (endedResult.affectedRows > 0) {
                console.log(`[MeetingCron] Marked ${endedResult.affectedRows} meetings as completed.`);
            }
        }

        const missedResult = await db.executeAsync(
            `UPDATE meetings
             SET status = 'completed', ended_at = NOW(), updated_at = NOW()
             WHERE status IN ('scheduled', 'upcoming')
               AND started_at IS NULL
               AND NOW() > DATE_ADD(scheduled_at, INTERVAL (duration_minutes + 15) MINUTE)`
        );
        if (missedResult.affectedRows > 0) {
            console.log(`[MeetingCron] Marked ${missedResult.affectedRows} missed meetings as completed.`);
        }
    } catch (err) {
        console.error('[MeetingCron] Error running meeting status update sweep:', err);
    }
}

function initMeetingCron() {
    // Run status update check every minute
    cron.schedule('* * * * *', () => {
        updateMeetingStatuses().catch(err => console.error(err));
    });
    console.log('[MeetingCron] Initialized successfully.');
}

module.exports = {
    initMeetingCron,
    updateMeetingStatuses
};
