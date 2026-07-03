const db = require("../config/database");
const { logSchoolActivity } = require("../utils/auditLogger");
const fs = require("fs");
const path = require("path");
const { validateMagicNumbers } = require("../middleware/eventUpload");

const getSchoolId = (req) => req.user?.school_id || req.session?.user?.school_id;
const getUserId = (req) => req.user?.id || req.session?.user?.id;

const cleanupFiles = (files) => {
    if (!files) return;
    const fileList = Array.isArray(files) ? files : Object.values(files).flat();
    fileList.forEach(file => {
        if (file && file.path && fs.existsSync(file.path)) {
            try {
                fs.unlinkSync(file.path);
            } catch (e) {
                console.error("Cleanup file failed:", file.path, e.message);
            }
        }
    });
};

exports.listEvents = async (req, res) => {
    try {
        const schoolId = getSchoolId(req);
        const { search, type, year, page = 1 } = req.query;
        const limit = 10;
        const offset = (page - 1) * limit;

        let whereClause = "WHERE school_id = ?";
        const params = [schoolId];

        if (search) {
            whereClause += " AND (title LIKE ? OR description LIKE ? OR venue LIKE ?)";
            const term = `%${search}%`;
            params.push(term, term, term);
        }

        if (type) {
            whereClause += " AND event_type = ?";
            params.push(type);
        }

        if (year) {
            whereClause += " AND YEAR(event_date) = ?";
            params.push(year);
        }

        const countRes = await db.queryAsync(`SELECT COUNT(*) as total FROM events ${whereClause}`, params);
        const total = countRes[0]?.total || 0;
        const totalPages = Math.ceil(total / limit);

        const events = await db.queryAsync(`
            SELECT e.*, 
            (SELECT id FROM event_media WHERE event_id = e.id AND media_type = 'image' LIMIT 1) as cover_media_id,
            (SELECT COUNT(*) FROM event_media WHERE event_id = e.id) as media_count
            FROM events e
            ${whereClause}
            ORDER BY event_date DESC
            LIMIT ? OFFSET ?
        `, [...params, limit, offset]);

        const yearsRes = await db.queryAsync(`
            SELECT DISTINCT YEAR(event_date) as yearVal 
            FROM events 
            WHERE school_id = ? 
            ORDER BY yearVal DESC
        `, [schoolId]);
        const years = yearsRes.map(y => y.yearVal);

        res.render("schoolAdmin/events/list", {
            title: "School Events",
            events,
            years,
            search: search || "",
            selectedType: type || "",
            selectedYear: year || "",
            currentPage: parseInt(page),
            totalPages,
            user: req.session?.user || req.user
        });
    } catch (err) {
        console.error("listEvents error:", err);
        req.flash("error", "Failed to load events list.");
        res.redirect("/schooladmin/dashboard");
    }
};

exports.showAddForm = async (req, res) => {
    try {
        res.render("schoolAdmin/events/add", {
            title: "Add Event",
            user: req.session?.user || req.user
        });
    } catch (err) {
        console.error("showAddForm error:", err);
        req.flash("error", "Failed to render event form.");
        res.redirect("/schooladmin/events");
    }
};

exports.createEvent = async (req, res) => {
    const files = req.files || [];
    try {
        const schoolId = getSchoolId(req);
        const userId = getUserId(req);

        const { title, description, event_date, event_type, venue, download_allowed, watermark_enabled } = req.body;

        if (!title || !event_date || !event_type || !venue) {
            throw new Error("Missing required fields.");
        }

        const isDownloadAllowed = (download_allowed === "1" || download_allowed === "on") ? 1 : 0;
        const isWatermarkEnabled = (watermark_enabled === "1" || watermark_enabled === "on") ? 1 : 0;

        for (const file of files) {
            const isImage = file.mimetype.startsWith("image/");
            if (isImage && file.size > 5 * 1024 * 1024) {
                throw new Error(`Image ${file.originalname} exceeds the 5MB size limit.`);
            }

            const isValidSig = await validateMagicNumbers(file.path);
            if (!isValidSig) {
                throw new Error(`File ${file.originalname} failed security verification (invalid magic numbers).`);
            }
        }

        const eventId = await db.withTransaction(async (tx) => {
            const result = await tx.execute(`
                INSERT INTO events (school_id, title, description, event_date, event_type, venue, download_allowed, watermark_enabled, created_by)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            `, [schoolId, title, description || null, event_date, event_type, venue, isDownloadAllowed, isWatermarkEnabled, userId]);
            
            const insertId = result.insertId;

            const captions = req.body.captions || [];
            for (let i = 0; i < files.length; i++) {
                const file = files[i];
                const relativePath = `src/public/uploads/${file.filename}`;
                const mType = file.mimetype.startsWith("video/") ? "video" : "image";
                const cap = captions[i] || null;

                await tx.execute(`
                    INSERT INTO event_media (event_id, media_type, file_path, file_name, file_size, mime_type, caption, uploaded_by)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                `, [insertId, mType, relativePath, file.originalname, file.size, file.mimetype, cap, userId]);
            }

            return insertId;
        });

        await logSchoolActivity(req, {
            action: "create_event",
            entityType: "event",
            entityId: eventId,
            description: `Created school event: "${title}" with ${files.length} media files.`
        });

        req.flash("success", "Event created successfully!");
        res.redirect("/schooladmin/events");
    } catch (err) {
        console.error("createEvent error:", err);
        cleanupFiles(files);
        req.flash("error", err.message || "Failed to create event.");
        res.redirect("/schooladmin/events/add");
    }
};

exports.showEditForm = async (req, res) => {
    try {
        const schoolId = getSchoolId(req);
        const { id } = req.params;

        const events = await db.queryAsync("SELECT * FROM events WHERE id = ? AND school_id = ?", [id, schoolId]);
        if (events.length === 0) {
            req.flash("error", "Event not found.");
            return res.redirect("/schooladmin/events");
        }

        const event = events[0];
        const media = await db.queryAsync("SELECT * FROM event_media WHERE event_id = ?", [id]);

        res.render("schoolAdmin/events/edit", {
            title: "Edit Event",
            event,
            media,
            user: req.session?.user || req.user
        });
    } catch (err) {
        console.error("showEditForm error:", err);
        req.flash("error", "Failed to retrieve event information.");
        res.redirect("/schooladmin/events");
    }
};

exports.updateEvent = async (req, res) => {
    try {
        const schoolId = getSchoolId(req);
        const { id } = req.params;
        const { title, description, event_date, event_type, venue, download_allowed, watermark_enabled } = req.body;

        const events = await db.queryAsync("SELECT id FROM events WHERE id = ? AND school_id = ?", [id, schoolId]);
        if (events.length === 0) {
            req.flash("error", "Event not found.");
            return res.redirect("/schooladmin/events");
        }

        if (!title || !event_date || !event_type || !venue) {
            throw new Error("Missing required fields.");
        }

        const isDownloadAllowed = (download_allowed === "1" || download_allowed === "on") ? 1 : 0;
        const isWatermarkEnabled = (watermark_enabled === "1" || watermark_enabled === "on") ? 1 : 0;

        await db.executeAsync(`
            UPDATE events 
            SET title = ?, description = ?, event_date = ?, event_type = ?, venue = ?, download_allowed = ?, watermark_enabled = ?
            WHERE id = ?
        `, [title, description || null, event_date, event_type, venue, isDownloadAllowed, isWatermarkEnabled, id]);

        const existingCaptions = req.body.existing_captions || {};
        for (const [mediaId, captionVal] of Object.entries(existingCaptions)) {
            await db.executeAsync("UPDATE event_media SET caption = ? WHERE id = ? AND event_id = ?", [captionVal || null, mediaId, id]);
        }

        await logSchoolActivity(req, {
            action: "update_event",
            entityType: "event",
            entityId: id,
            description: `Updated details for event: "${title}"`
        });

        req.flash("success", "Event details updated successfully!");
        res.redirect("/schooladmin/events");
    } catch (err) {
        console.error("updateEvent error:", err);
        req.flash("error", err.message || "Failed to update event.");
        res.redirect(`/schooladmin/events/edit/${req.params.id}`);
    }
};

exports.uploadMedia = async (req, res) => {
    const files = req.files || [];
    try {
        const schoolId = getSchoolId(req);
        const userId = getUserId(req);
        const { id } = req.params;

        const events = await db.queryAsync("SELECT id FROM events WHERE id = ? AND school_id = ?", [id, schoolId]);
        if (events.length === 0) {
            throw new Error("Event not found or unauthorized.");
        }

        for (const file of files) {
            const isImage = file.mimetype.startsWith("image/");
            if (isImage && file.size > 5 * 1024 * 1024) {
                throw new Error(`Image ${file.originalname} exceeds the 5MB size limit.`);
            }

            const isValidSig = await validateMagicNumbers(file.path);
            if (!isValidSig) {
                throw new Error(`File ${file.originalname} failed security verification.`);
            }
        }

        await db.withTransaction(async (tx) => {
            const captions = req.body.captions || [];
            for (let i = 0; i < files.length; i++) {
                const file = files[i];
                const relativePath = `src/public/uploads/${file.filename}`;
                const mType = file.mimetype.startsWith("video/") ? "video" : "image";
                const cap = captions[i] || null;

                await tx.execute(`
                    INSERT INTO event_media (event_id, media_type, file_path, file_name, file_size, mime_type, caption, uploaded_by)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                `, [id, mType, relativePath, file.originalname, file.size, file.mimetype, cap, userId]);
            }
        });

        await logSchoolActivity(req, {
            action: "upload_event_media",
            entityType: "event",
            entityId: id,
            description: `Uploaded ${files.length} additional media files to event ID ${id}`
        });

        req.flash("success", `Successfully uploaded ${files.length} new media files.`);
        res.redirect(`/schooladmin/events/edit/${id}`);
    } catch (err) {
        console.error("uploadMedia error:", err);
        cleanupFiles(files);
        req.flash("error", err.message || "Failed to upload media.");
        res.redirect(`/schooladmin/events/edit/${req.params.id}`);
    }
};

exports.deleteEvent = async (req, res) => {
    try {
        const schoolId = getSchoolId(req);
        const { id } = req.params;

        const events = await db.queryAsync("SELECT id, title FROM events WHERE id = ? AND school_id = ?", [id, schoolId]);
        if (events.length === 0) {
            req.flash("error", "Event not found.");
            return res.redirect("/schooladmin/events");
        }

        const title = events[0].title;
        const media = await db.queryAsync("SELECT file_path FROM event_media WHERE event_id = ?", [id]);
        
        media.forEach(item => {
            const absolutePath = path.join(__dirname, "../../", item.file_path);
            if (fs.existsSync(absolutePath)) {
                try {
                    fs.unlinkSync(absolutePath);
                } catch (e) {
                    console.error("Failed to delete media file from disk:", absolutePath, e.message);
                }
            }
        });

        await db.executeAsync("DELETE FROM events WHERE id = ?", [id]);
        await logSchoolActivity(req, {
            action: "delete_event",
            entityType: "event",
            entityId: id,
            description: `Deleted event "${title}" and all associated files.`
        });

        req.flash("success", "Event deleted successfully.");
        res.redirect("/schooladmin/events");
    } catch (err) {
        console.error("deleteEvent error:", err);
        req.flash("error", "Failed to delete event.");
        res.redirect("/schooladmin/events");
    }
};

exports.deleteMedia = async (req, res) => {
    try {
        const schoolId = getSchoolId(req);
        const { mediaId } = req.params;

        const mediaRows = await db.queryAsync(`
            SELECT em.*, e.school_id 
            FROM event_media em 
            JOIN events e ON em.event_id = e.id 
            WHERE em.id = ? AND e.school_id = ?
        `, [mediaId, schoolId]);

        if (mediaRows.length === 0) {
            return res.status(404).json({ success: false, message: "Media file not found or unauthorized." });
        }

        const item = mediaRows[0];
        const absolutePath = path.join(__dirname, "../../", item.file_path);

        await db.executeAsync("DELETE FROM event_media WHERE id = ?", [mediaId]);
        if (fs.existsSync(absolutePath)) {
            try {
                fs.unlinkSync(absolutePath);
            } catch (e) {
                console.error("Failed to delete specific media file from disk:", absolutePath, e.message);
            }
        }

        await logSchoolActivity(req, {
            action: "delete_event_media",
            entityType: "event_media",
            entityId: mediaId,
            description: `Deleted media file: "${item.file_name}" from event ID ${item.event_id}`
        });

        res.json({ success: true, message: "Media deleted successfully." });
    } catch (err) {
        console.error("deleteMedia error:", err);
        res.status(500).json({ success: false, message: "Failed to delete media file." });
    }
};

exports.viewEventAdmin = async (req, res) => {
    try {
        const schoolId = getSchoolId(req);
        const { id } = req.params;

        const events = await db.queryAsync("SELECT * FROM events WHERE id = ? AND school_id = ?", [id, schoolId]);
        if (events.length === 0) {
            req.flash("error", "Event not found.");
            return res.redirect("/schooladmin/events");
        }

        const event = events[0];
        const media = await db.queryAsync("SELECT * FROM event_media WHERE event_id = ?", [id]);

        res.render("schoolAdmin/events/gallery", {
            title: event.title,
            event,
            media,
            user: req.session?.user || req.user
        });
    } catch (err) {
        console.error("viewEventAdmin error:", err);
        req.flash("error", "Failed to retrieve gallery view.");
        res.redirect("/schooladmin/events");
    }
};

exports.listEventsPublic = async (req, res) => {
    try {
        const schoolId = getSchoolId(req);
        const { search, type, year, page = 1 } = req.query;
        const limit = 12;
        const offset = (page - 1) * limit;

        let whereClause = "WHERE school_id = ?";
        const params = [schoolId];

        if (search) {
            whereClause += " AND (title LIKE ? OR description LIKE ? OR venue LIKE ?)";
            const term = `%${search}%`;
            params.push(term, term, term);
        }

        if (type) {
            whereClause += " AND event_type = ?";
            params.push(type);
        }

        if (year) {
            whereClause += " AND YEAR(event_date) = ?";
            params.push(year);
        }

        const countRes = await db.queryAsync(`SELECT COUNT(*) as total FROM events ${whereClause}`, params);
        const total = countRes[0]?.total || 0;
        const totalPages = Math.ceil(total / limit);

        const events = await db.queryAsync(`
            SELECT e.*, 
            (SELECT id FROM event_media WHERE event_id = e.id AND media_type = 'image' LIMIT 1) as cover_media_id,
            (SELECT COUNT(*) FROM event_media WHERE event_id = e.id) as media_count
            FROM events e
            ${whereClause}
            ORDER BY event_date DESC
            LIMIT ? OFFSET ?
        `, [...params, limit, offset]);

        const yearsRes = await db.queryAsync(`
            SELECT DISTINCT YEAR(event_date) as yearVal 
            FROM events 
            WHERE school_id = ? 
            ORDER BY yearVal DESC
        `, [schoolId]);
        const years = yearsRes.map(y => y.yearVal);

        res.render("events/list", {
            title: "School Events",
            events,
            years,
            search: search || "",
            selectedType: type || "",
            selectedYear: year || "",
            currentPage: parseInt(page),
            totalPages,
            user: req.session?.user || req.user
        });
    } catch (err) {
        console.error("listEventsPublic error:", err);
        req.flash("error", "Failed to load events list.");
        res.redirect("/");
    }
};

exports.viewEventPublic = async (req, res) => {
    try {
        const schoolId = getSchoolId(req);
        const { id } = req.params;

        const events = await db.queryAsync("SELECT * FROM events WHERE id = ? AND school_id = ?", [id, schoolId]);
        if (events.length === 0) {
            req.flash("error", "Event not found.");
            return res.redirect("/events");
        }

        const event = events[0];
        const media = await db.queryAsync("SELECT * FROM event_media WHERE event_id = ?", [id]);

        res.render("events/gallery", {
            title: event.title,
            event,
            media,
            user: req.session?.user || req.user
        });
    } catch (err) {
        console.error("viewEventPublic error:", err);
        req.flash("error", "Failed to load gallery.");
        res.redirect("/events");
    }
};
