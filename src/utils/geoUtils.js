function haversineDistanceKm(lat1, lon1, lat2, lon2) {
    if (!Number.isFinite(lat1) || !Number.isFinite(lon1) || !Number.isFinite(lat2) || !Number.isFinite(lon2)) {
        return 0;
    };

    const R = 6371;
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLon = ((lon2 - lon1) * Math.PI) / 180;
    const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) *
        Math.sin(dLon / 2) ** 2;
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return Number((R * c).toFixed(2));
};

function calculateEtaMinutes(distanceKm, speedKmh = 0) {
    if (!distanceKm || distanceKm <= 0) return 0;
    const effectiveSpeed = Number.isFinite(speedKmh) && speedKmh >= 5 ? speedKmh : 25;
    const hours = distanceKm / effectiveSpeed;
    return Math.max(1, Math.round(hours * 60));
};

module.exports = { haversineDistanceKm, calculateEtaMinutes };