const https = require('https');

const routeCache = new Map();
const CACHE_TTL_MS = 60 * 60 * 1000; 

async function fetchOsrmRoadPath(waypoints) {
    if (!Array.isArray(waypoints) || waypoints.length < 2) {
        return waypoints.map(w => Array.isArray(w) ? [Number(w[0]), Number(w[1])] : [Number(w.latitude), Number(w.longitude)]);
    };

    const validPoints = [];
    waypoints.forEach(w => {
        const lat = Array.isArray(w) ? Number(w[0]) : Number(w.latitude);
        const lng = Array.isArray(w) ? Number(w[1]) : Number(w.longitude);
        if (Number.isFinite(lat) && Number.isFinite(lng) && lat !== 0 && lng !== 0) {
            const last = validPoints[validPoints.length - 1];
            if (!last || Math.abs(last.lat - lat) > 0.0001 || Math.abs(last.lng - lng) > 0.0001) {
                validPoints.push({ lat, lng });
            }
        }
    });

    if (validPoints.length < 2) {
        return validPoints.map(p => [p.lat, p.lng]);
    };

    const osrmCoordsStr = validPoints.map(p => `${p.lng},${p.lat}`).join(';');
    const url = `https://router.project-osrm.org/route/v1/driving/${osrmCoordsStr}?overview=full&geometries=geojson`;

    return new Promise((resolve) => {
        const req = https.get(url, { headers: { 'User-Agent': 'SchoolSync-ERP/1.0' }, timeout: 5000 }, (res) => {
            let data = '';
            res.on('data', chunk => { data += chunk; });
            res.on('end', () => {
                try {
                    const parsed = JSON.parse(data);
                    if (parsed.code === 'Ok' && parsed.routes && parsed.routes[0] && parsed.routes[0].geometry && parsed.routes[0].geometry.coordinates) {
                        const roadPath = parsed.routes[0].geometry.coordinates.map(coord => [coord[1], coord[0]]);
                        return resolve(roadPath);
                    };
                } catch (e) {
                    console.warn('[OSRM Route Parse Warning]:', e.message);
                };
                resolve(validPoints.map(p => [p.lat, p.lng]));
            });
        });

        req.on('error', (err) => {
            console.warn('[OSRM Route Fetch Error]:', err.message);
            resolve(validPoints.map(p => [p.lat, p.lng]));
        });

        req.on('timeout', () => {
            req.destroy();
            resolve(validPoints.map(p => [p.lat, p.lng]));
        });
    });
};

async function getCachedRoadRoute(routeId, waypoints) {
    if (!Array.isArray(waypoints) || waypoints.length === 0) {
        return [];
    }

    const pointsHash = waypoints.map(w => {
        const lat = Array.isArray(w) ? Number(w[0]) : Number(w.latitude);
        const lng = Array.isArray(w) ? Number(w[1]) : Number(w.longitude);
        return `${lat.toFixed(5)},${lng.toFixed(5)}`;
    }).join('|');

    const cacheKey = `route_${routeId}_${pointsHash}`;
    const cached = routeCache.get(cacheKey);
    const now = Date.now();

    if (cached && (now - cached.timestamp < CACHE_TTL_MS)) {
        return cached.path;
    };

    const roadPath = await fetchOsrmRoadPath(waypoints);
    routeCache.set(cacheKey, {
        timestamp: now,
        path: roadPath
    });
    return roadPath;
};

function clearRouteCache(routeId = null) {
    if (!routeId) {
        routeCache.clear();
    } else {
        const prefix = `route_${routeId}_`;
        for (const key of routeCache.keys()) {
            if (key.startsWith(prefix)) {
                routeCache.delete(key);
            };
        };
    };
};

module.exports = { fetchOsrmRoadPath, getCachedRoadRoute, clearRouteCache };