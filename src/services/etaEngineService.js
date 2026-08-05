const { queryAsync } = require('../config/database');
const { haversineDistanceKm, calculateEtaMinutes } = require('../utils/geoUtils');

async function calculateTripProgressAndEta({ schoolId, tripId, routeId = null, busLat, busLng, speedKmh = 0 }) {
    try {
        if (!Number.isFinite(busLat) || !Number.isFinite(busLng)) {
            return null;
        };

        let activeRouteId = routeId;
        if (!activeRouteId && tripId) {
            const [trip] = await queryAsync(
                `SELECT route_id FROM transport_trips WHERE id = ? AND school_id = ? LIMIT 1`,
                [tripId, schoolId]
            );
            activeRouteId = trip?.route_id || null;
        };

        if (!activeRouteId) return null;
        const stops = await queryAsync(
            `SELECT id, stop_name, stop_order, latitude, longitude, pickup_time, drop_time
            FROM transport_route_stops
            WHERE school_id = ? AND route_id = ? AND status != 'deleted'
            ORDER BY stop_order ASC, id ASC`,
            [schoolId, activeRouteId]
        );

        if (!stops || stops.length === 0) {
            return {
                current_stop: null,
                next_stop: null,
                progress: {
                    total_stops: 0,
                    completed_stops: 0,
                    remaining_stops: 0,
                    current_stop_number: 0,
                    completion_percentage: 0,
                    distance_remaining_km: 0,
                    total_eta_minutes: 0
                }
            };
        };

        let minDistance = Infinity;
        let nearestStopIndex = 0
        const evaluatedStops = stops.map((st, idx) => {
            const stLat = Number(st.latitude);
            const stLng = Number(st.longitude);
            const dist = (Number.isFinite(stLat) && Number.isFinite(stLng))
                ? haversineDistanceKm(busLat, busLng, stLat, stLng)
                : 999;

            if (dist < minDistance) {
                minDistance = dist;
                nearestStopIndex = idx;
            };

            return {
                ...st,
                distanceFromBus: dist
            };
        });

        const currentStopIndex = minDistance < 0.15 ? nearestStopIndex : Math.max(0, nearestStopIndex);
        const nextStopIndex = Math.min(evaluatedStops.length - 1, currentStopIndex + (minDistance < 0.15 ? 1 : 0));
        const currentStop = evaluatedStops[currentStopIndex];
        const nextStop = evaluatedStops[nextStopIndex] || currentStop;
        const completedStopsCount = currentStopIndex;
        const remainingStopsCount = evaluatedStops.length - completedStopsCount;
        const completionPercentage = Math.round((completedStopsCount / evaluatedStops.length) * 100);
        const distToNextKm = nextStop.distanceFromBus;
        const etaNextMin = calculateEtaMinutes(distToNextKm, speedKmh);

        let totalRemainingKm = distToNextKm;
        for (let i = nextStopIndex; i < evaluatedStops.length - 1; i++) {
            const s1 = evaluatedStops[i];
            const s2 = evaluatedStops[i + 1];
            if (Number.isFinite(Number(s1.latitude)) && Number.isFinite(Number(s2.latitude))) {
                totalRemainingKm += haversineDistanceKm(Number(s1.latitude), Number(s1.longitude), Number(s2.latitude), Number(s2.longitude));
            };
        };

        totalRemainingKm = Number(totalRemainingKm.toFixed(2));
        const totalEtaMin = calculateEtaMinutes(totalRemainingKm, speedKmh);

        const scheduledTimeStr = nextStop.pickup_time || nextStop.drop_time || null;
        let isDelayed = false;
        let delayMinutes = 0;
        if (scheduledTimeStr) {
            try {
                const now = new Date();
                const [schedH, schedM] = scheduledTimeStr.split(':').map(Number);
                const schedDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), schedH, schedM, 0);
                const estimatedArrivalDate = new Date(now.getTime() + etaNextMin * 60000);

                const diffMs = estimatedArrivalDate.getTime() - schedDate.getTime();
                const diffMin = Math.round(diffMs / 60000);

                if (diffMin > 5) { 
                    isDelayed = true;
                    delayMinutes = diffMin;
                };
            } catch (_) {};
        };
        return {
            current_stop: {
                id: currentStop.id,
                stop_name: currentStop.stop_name,
                stop_order: currentStop.stop_order
            },
            next_stop: {
                id: nextStop.id,
                stop_name: nextStop.stop_name,
                stop_order: nextStop.stop_order,
                distance_km: distToNextKm,
                eta_minutes: etaNextMin,
                scheduled_time: scheduledTimeStr || '—',
                is_delayed: isDelayed,
                delay_minutes: delayMinutes
            },
            progress: {
                total_stops: evaluatedStops.length,
                completed_stops: completedStopsCount,
                remaining_stops: remainingStopsCount,
                current_stop_number: currentStopIndex + 1,
                completion_percentage: completionPercentage,
                distance_remaining_km: totalRemainingKm,
                total_eta_minutes: totalEtaMin
            }
        };
    } catch (err) {
        console.error('[EtaEngine Error]:', err.message);
        return null;
    };
};

module.exports = { calculateTripProgressAndEta};