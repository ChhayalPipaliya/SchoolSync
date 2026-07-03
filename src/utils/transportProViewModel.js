const db = require('../config/database');

function mapTripStatus(trip) {
  return trip ? trip.trip_status || trip.status || 'pending' : 'not_started';
}

async function getStudentTransportViewModel(schoolId, studentId) {
  const [[student]] = await db.query(
    `SELECT s.id, s.school_id, s.roll_no, u.first_name AS first_name, u.last_name AS last_name,
            c.class_name, c.section
     FROM students s
     JOIN users u ON s.user_id = u.id
     LEFT JOIN classes c ON s.class_id = c.id
     WHERE s.id = ? AND s.school_id = ? AND s.deleted_at IS NULL
     LIMIT 1`,
    [studentId, schoolId]
  );

  const [[allocation]] = await db.query(
    `SELECT sta.id AS allocationId, sta.route_id AS routeId, sta.pickup_stop_id AS pickupStopId,
            sta.drop_stop_id AS dropStopId, sta.status AS allocationStatus,
            r.route_name AS routeName, r.start_point AS startPoint, r.end_point AS endPoint,
            ps.stop_name AS pickupStopName, ps.pickup_time AS pickupTime,
            ds.stop_name AS dropStopName, ds.drop_time AS dropTime,
            v.id AS vehicleId, v.vehicle_number AS vehicleNumber, v.model AS vehicleModel,
            d.id AS driverId, du.first_name AS driverfirst_name, du.last_name AS driverlast_name, du.phone AS driverPhone,
            sat.emergency_contact AS emergencyContact, sat.emergency_contact_name AS emergencyContactName
     FROM student_transport_allocations sta
     JOIN routes r ON sta.route_id = r.id AND r.school_id = sta.school_id
     LEFT JOIN transport_route_stops ps ON sta.pickup_stop_id = ps.id AND ps.school_id = sta.school_id
     LEFT JOIN transport_route_stops ds ON sta.drop_stop_id = ds.id AND ds.school_id = sta.school_id
     LEFT JOIN vehicles v ON r.vehicle_id = v.id AND v.school_id = sta.school_id
     LEFT JOIN drivers d ON r.driver_id = d.id AND d.school_id = sta.school_id
     LEFT JOIN users du ON d.user_id = du.id
     JOIN student_address_transport sat ON sat.student_id = sta.student_id AND sat.transport_required = 1
     WHERE sta.school_id = ? AND sta.student_id = ? AND sta.status = 'active'
     ORDER BY sta.id DESC
     LIMIT 1`,
    [schoolId, studentId]
  );

  let legacy = null;
  let routeId = allocation?.routeId || null;

  if (!allocation) {
    const [[legacyRow]] = await db.query(
      `SELECT sat.transport_required AS transportRequired, sat.transport_route AS routeName,
              sat.transport_vehicle_no AS vehicleNumber, sat.pickup_point AS pickupPoint,
              sat.drop_point AS dropPoint, sat.emergency_contact AS emergencyContact,
              sat.emergency_contact_name AS emergencyContactName,
              r.id AS routeId, r.route_name AS matchedRouteName,
              v.vehicle_number AS matchedVehicleNumber, v.model AS vehicleModel,
              d.id AS driverId, du.first_name AS driverfirst_name, du.last_name AS driverlast_name, du.phone AS driverPhone
       FROM student_address_transport sat
       JOIN students s ON sat.student_id = s.id
       LEFT JOIN routes r ON r.school_id = s.school_id AND r.route_name = sat.transport_route
       LEFT JOIN vehicles v ON r.vehicle_id = v.id AND v.school_id = s.school_id
       LEFT JOIN drivers d ON r.driver_id = d.id AND d.school_id = s.school_id
       LEFT JOIN users du ON d.user_id = du.id
       WHERE sat.student_id = ? AND s.school_id = ? AND sat.transport_required = 1
       LIMIT 1`,
      [studentId, schoolId]
    );
    legacy = legacyRow || null;
    routeId = legacy?.routeId || null;
  }

  const [todayTrips] = routeId ? await db.query(
    `SELECT tt.id AS trip_id, tt.trip_type, tt.status AS trip_status, tt.start_at, tt.end_at,
            tts.status AS studentStatus, tts.picked_at, tts.dropped_at,
            r.route_name AS routeName,
            v.vehicle_number AS vehicleNumber, v.model AS vehicleModel,
            du.first_name AS driver_first_name, du.last_name AS driver_last_name, du.phone AS driver_phone
     FROM transport_trips tt
     JOIN routes r ON tt.route_id = r.id AND r.school_id = tt.school_id
     LEFT JOIN transport_trip_students tts ON tts.trip_id = tt.id AND tts.school_id = tt.school_id AND tts.student_id = ?
     LEFT JOIN vehicles v ON tt.vehicle_id = v.id AND v.school_id = tt.school_id
     LEFT JOIN drivers d ON tt.driver_id = d.id AND d.school_id = tt.school_id
     LEFT JOIN users du ON d.user_id = du.id
     WHERE tt.school_id = ? AND tt.route_id = ? AND tt.trip_date = CURDATE()
     ORDER BY tt.id DESC`,
    [studentId, schoolId, routeId]
  ) : [[]];

  const pickupTrip = todayTrips.find(trip => trip.trip_type === 'pickup') || null;
  const dropTrip = todayTrips.find(trip => trip.trip_type === 'drop') || null;
  const activeTrip = todayTrips.find(trip => trip.trip_status === 'running') || null;

  let latestLocation = null;
  if (activeTrip || routeId) {
    const locationParams = activeTrip
      ? [schoolId, activeTrip.trip_id]
      : [schoolId, routeId];
    const locationWhere = activeTrip
      ? 'ttl.school_id = ? AND ttl.trip_id = ?'
      : 'ttl.school_id = ? AND tt.route_id = ?';
    const [[location]] = await db.query(
      `SELECT ttl.latitude, ttl.longitude, ttl.speed, ttl.heading, ttl.accuracy, ttl.recorded_at AS recordedAt
       FROM transport_trip_locations ttl
       JOIN transport_trips tt ON ttl.trip_id = tt.id AND tt.school_id = ttl.school_id
       WHERE ${locationWhere}
       ORDER BY ttl.recorded_at DESC, ttl.id DESC
       LIMIT 1`,
      locationParams
    );
    latestLocation = location || null;
  }

  const [recentActivity] = await db.query(
    `SELECT tt.trip_type, tt.trip_date, tts.status, tts.picked_at AS pickedAt,
            tts.dropped_at AS droppedAt, tts.updated_at AS updatedAt,
            ps.stop_name AS pickupStopName, ds.stop_name AS dropStopName
     FROM transport_trip_students tts
     JOIN transport_trips tt ON tts.trip_id = tt.id AND tt.school_id = tts.school_id
     LEFT JOIN transport_route_stops ps ON tts.pickup_stop_id = ps.id AND ps.school_id = tts.school_id
     LEFT JOIN transport_route_stops ds ON tts.drop_stop_id = ds.id AND ds.school_id = tts.school_id
     WHERE tts.school_id = ? AND tts.student_id = ? AND tts.status <> 'pending'
     ORDER BY COALESCE(tts.dropped_at, tts.picked_at, tts.updated_at) DESC
     LIMIT 8`,
    [schoolId, studentId]
  );

  const source = allocation ? 'advanced' : legacy ? 'legacy' : 'none';
  const routeName = allocation?.routeName || legacy?.matchedRouteName || legacy?.routeName || null;
  const vehicleNumber = allocation?.vehicleNumber || legacy?.matchedVehicleNumber || legacy?.vehicleNumber || null;

  return {
    student,
    source,
    allocation,
    legacy,
    route: routeId ? {
      id: routeId,
      name: routeName,
      startPoint: allocation?.startPoint || null,
      endPoint: allocation?.endPoint || null
    } : null,
    stops: {
      pickupName: allocation?.pickupStopName || legacy?.pickupPoint || null,
      dropName: allocation?.dropStopName || legacy?.dropPoint || null,
      pickupTime: allocation?.pickupTime || null,
      dropTime: allocation?.dropTime || null
    },
    vehicle: {
      number: vehicleNumber,
      model: allocation?.vehicleModel || legacy?.vehicleModel || null
    },
    driver: {
      name: [allocation?.driverfirst_name || legacy?.driverfirst_name, allocation?.driverlast_name || legacy?.driverlast_name].filter(Boolean).join(' '),
      phone: allocation?.driverPhone || legacy?.driverPhone || null
    },
    contact: {
      name: allocation?.emergencyContactName || legacy?.emergencyContactName || 'School Transport Desk',
      phone: allocation?.emergencyContact || legacy?.emergencyContact || null
    },
    trips: {
      pickup: pickupTrip,
      drop: dropTrip,
      active: activeTrip,
      pickupStatus: pickupTrip?.studentStatus || mapTripStatus(pickupTrip),
      dropStatus: dropTrip?.studentStatus || mapTripStatus(dropTrip),
      liveStatus: activeTrip ? activeTrip.trip_status : 'not_live'
    },
    latestLocation,
    recentActivity,
    message: source === 'legacy'
      ? 'Advanced transport allocation is not configured yet.'
      : source === 'none'
        ? 'Transport is not configured for this student yet.'
        : null
  };
}

module.exports = {
  getStudentTransportViewModel
};
