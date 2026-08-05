const db = require('../../config/database');
const { getStudentTransportViewModel } = require('../../utils/transportProViewModel');
const { resolveUserSchoolId } = require('../../utils/resolveUserSchoolId');

exports.trackBus = async (req, res) => {
    try {
        const userId = req.user?.id;
        const schoolId = await resolveUserSchoolId(req.user);

        if (!schoolId) {
            req.flash('error', 'Session expired or school profile not found');
            return res.redirect('/student/dashboard');
        };

        const [[student]] = await db.query(
            `SELECT id FROM students WHERE user_id = ? AND school_id = ? AND deleted_at IS NULL LIMIT 1`,
            [userId, schoolId]
        );

        if (!student) {
            req.flash('error', 'Student profile not found');
            return res.redirect('/student/dashboard');
        }

        const transportProSql = `
            SELECT tt.id AS trip_id, tt.status AS trip_status, r.route_name AS routeName,
                u.first_name AS driver_first_name, u.last_name AS driver_last_name, u.phone AS driver_phone,
                v.vehicle_number AS vehicleNumber, v.model AS vehicleModel
            FROM students s
            JOIN student_transport_allocations sta ON sta.student_id = s.id AND sta.school_id = s.school_id AND sta.status = 'active'
            JOIN transport_trips tt ON tt.route_id = sta.route_id AND tt.school_id = sta.school_id AND tt.trip_date = CURDATE() AND tt.status = 'running'
            JOIN routes r ON tt.route_id = r.id AND r.school_id = tt.school_id
            LEFT JOIN drivers d ON tt.driver_id = d.id AND d.school_id = tt.school_id
            LEFT JOIN users u ON d.user_id = u.id
            LEFT JOIN vehicles v ON tt.vehicle_id = v.id AND v.school_id = tt.school_id
            WHERE s.user_id = ? AND s.school_id = ?
            ORDER BY tt.id DESC
            LIMIT 1
        `;
        let [trips] = await db.query(transportProSql, [userId, schoolId]);

        const activeTrip = trips[0] || null;
        const transportInfo = await getStudentTransportViewModel(schoolId, student.id);
        res.render('student/transport', {
            title: 'Live Bus Tracking',
            activeTrip,
            transportInfo,
            user: req.user,
            layout: 'student/layout',
            currentPath: '/student/transport'
        });
    } catch (err) {
        console.error('[Student Transport trackBus Error]', err);
        req.flash('error', 'Failed to load transport tracking');
        res.redirect('/student/dashboard');
    };
};