const db = require("../config/database");
const fs = require("fs");
const path = require("path");
const sharp = require("sharp");

const getSchoolId = (req) => req.user?.school_id || req.session?.user?.school_id;
const getRole = (req) => req.user?.role || req.session?.user?.role;
const getUserName = (req) => {
    const user = req.user || req.session?.user;
    if (!user) return "Unknown User";
    return user.name || `${user.first_name || ""} ${user.last_name || ""}`.trim() || "User";
};

/**
 * Log media access to media_access_logs
 */
const logMediaAccess = async (req, mediaId, schoolId, action) => {
    try {
        const userId = req.user?.id || req.session?.user?.id || null;
        const role = getRole(req) || "unknown";
        const ip = req.ip || req.headers?.["x-forwarded-for"] || req.socket?.remoteAddress || null;
        const ua = req.headers["user-agent"] || null;
        
        await db.executeAsync(`
            INSERT INTO media_access_logs (media_id, user_id, user_role, school_id, action, ip_address, user_agent)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `, [mediaId, userId, role, schoolId, action, ip, ua]);
    } catch (err) {
        console.error("[MediaAccessLog-Error] Failed to log media access:", err.message);
    }
};

const getValidatedMedia = async (req, res, mediaId) => {
    const schoolId = getSchoolId(req);
    const role = getRole(req);

    if (!schoolId) {
        res.status(401).json({ success: false, message: "Unauthorized. Please sign in." });
        return null;
    }

    // Fetch media and join with events to get school_id and toggles
    const mediaRows = await db.queryAsync(`
        SELECT em.*, e.school_id, e.download_allowed as event_download_allowed, e.watermark_enabled
        FROM event_media em
        JOIN events e ON em.event_id = e.id
        WHERE em.id = ?
    `, [mediaId]);

    if (mediaRows.length === 0) {
        res.status(404).json({ success: false, message: "Media not found." });
        return null;
    }

    const media = mediaRows[0];

    // Tenant Isolation Check
    if (media.school_id !== schoolId) {
        res.status(403).json({ success: false, message: "Forbidden. Tenant isolation violation." });
        return null;
    }

    return media;
};

/**
 * Streams media (view action)
 */
exports.streamMedia = async (req, res) => {
    try {
        const { mediaId } = req.params;
        const media = await getValidatedMedia(req, res, mediaId);
        if (!media) return; // Response is already handled

        const absolutePath = path.join(__dirname, "../../", media.file_path);
        if (!fs.existsSync(absolutePath)) {
            return res.status(404).json({ success: false, message: "Physical file not found on disk." });
        }

        const role = getRole(req);
        const isAdmin = (role === "school_admin" || role === "super_admin");

        // Log the view action
        await logMediaAccess(req, mediaId, media.school_id, "view");

        // 1. Handling Videos
        if (media.media_type === "video") {
            const stat = fs.statSync(absolutePath);
            const fileSize = stat.size;
            const range = req.headers.range;

            if (range) {
                const parts = range.replace(/bytes=/, "").split("-");
                const start = parseInt(parts[0], 10);
                const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;

                if (start >= fileSize || end >= fileSize) {
                    res.writeHead(416, { "Content-Range": `bytes */${fileSize}` });
                    return res.end();
                }

                const chunksize = (end - start) + 1;
                const file = fs.createReadStream(absolutePath, { start, end });

                res.writeHead(206, {
                    "Content-Range": `bytes ${start}-${end}/${fileSize}`,
                    "Accept-Ranges": "bytes",
                    "Content-Length": chunksize,
                    "Content-Type": media.mime_type,
                });
                return file.pipe(res);
            } else {
                res.writeHead(200, {
                    "Content-Length": fileSize,
                    "Content-Type": media.mime_type,
                });
                return fs.createReadStream(absolutePath).pipe(res);
            }
        }

        // 2. Handling Images
        const watermarkEnabled = media.watermark_enabled === 1;
        const applyWatermark = watermarkEnabled && !isAdmin;
        const reduceQuality = !isAdmin; // 60-70% quality for non-admins

        if (!applyWatermark && !reduceQuality) {
            // Stream the original image file directly
            res.setHeader("Content-Type", media.mime_type);
            return fs.createReadStream(absolutePath).pipe(res);
        }

        // Apply Sharp transformations
        try {
            let pipeline = sharp(absolutePath);
            
            if (applyWatermark) {
                const metadata = await sharp(absolutePath).metadata();
                const width = metadata.width || 800;
                const height = metadata.height || 600;

                const nameText = getUserName(req);
                const roleText = (role || "user").toUpperCase();
                const dateText = new Date().toISOString().split("T")[0];
                const watermarkText = `${nameText} (${roleText}) | ${dateText}`;

                // SVG text overlays
                const fontSize = Math.max(14, Math.floor(width / 22));
                const svgText = `
                <svg width="${width}" height="${height}">
                    <style>
                        .watermark {
                            fill: rgba(255, 255, 255, 0.22);
                            stroke: rgba(0, 0, 0, 0.15);
                            stroke-width: 1px;
                            font-size: ${fontSize}px;
                            font-family: 'DM Sans', 'Inter', 'Outfit', sans-serif;
                            font-weight: 800;
                        }
                    </style>
                    <text x="50%" y="50%" text-anchor="middle" class="watermark" transform="rotate(-30, ${width / 2}, ${height / 2})">
                        ${watermarkText}
                    </text>
                </svg>
                `;
                
                pipeline = pipeline.composite([{
                    input: Buffer.from(svgText),
                    gravity: "center"
                }]);
            }

            if (reduceQuality) {
                if (media.mime_type === "image/jpeg" || media.mime_type === "image/jpg") {
                    pipeline = pipeline.jpeg({ quality: 65 });
                } else if (media.mime_type === "image/png") {
                    pipeline = pipeline.png({ quality: 65, compressionLevel: 8 });
                } else if (media.mime_type === "image/webp") {
                    pipeline = pipeline.webp({ quality: 65 });
                }
            }

            const buffer = await pipeline.toBuffer();
            res.setHeader("Content-Type", media.mime_type);
            res.setHeader("Content-Length", buffer.length);
            return res.send(buffer);
        } catch (sharpErr) {
            console.error("Sharp processing error, falling back to original:", sharpErr);
            // Fallback to streaming original file
            res.setHeader("Content-Type", media.mime_type);
            return fs.createReadStream(absolutePath).pipe(res);
        }

    } catch (err) {
        console.error("streamMedia error:", err);
        res.status(500).json({ success: false, message: "Internal server error streaming media." });
    }
};

/**
 * Downloads media (download action with permission checks)
 */
exports.downloadMedia = async (req, res) => {
    try {
        const { mediaId } = req.params;
        const media = await getValidatedMedia(req, res, mediaId);
        if (!media) return; // Response is already handled

        const absolutePath = path.join(__dirname, "../../", media.file_path);
        if (!fs.existsSync(absolutePath)) {
            return res.status(404).json({ success: false, message: "Physical file not found on disk." });
        }

        const role = getRole(req);
        const isAdmin = (role === "school_admin" || role === "super_admin");

        // Resolve download permission
        // Inherits from event if media override is NULL, otherwise uses media-specific override
        const downloadAllowedOverride = media.download_allowed;
        const isDownloadAllowed = downloadAllowedOverride !== null ? downloadAllowedOverride === 1 : media.event_download_allowed === 1;

        if (!isAdmin && !isDownloadAllowed) {
            if (req.accepts("html")) {
                req.flash("error", "Downloading is disabled for this gallery.");
                return res.redirect("back");
            }
            return res.status(403).json({ success: false, message: "Forbidden. Downloading is disabled for this media." });
        }

        // Log the download action
        await logMediaAccess(req, mediaId, media.school_id, "download");

        // Set attachment headers and stream the file
        res.setHeader("Content-Disposition", `attachment; filename="${media.file_name}"`);
        res.setHeader("Content-Type", media.mime_type);
        
        return fs.createReadStream(absolutePath).pipe(res);

    } catch (err) {
        console.error("downloadMedia error:", err);
        res.status(500).json({ success: false, message: "Internal server error downloading media." });
    }
};
