const { queryAsync, executeAsync, withTransaction } = require("../../config/database");

const supportTicketController = {
    list: async (req, res) => {
        try {
            const { status, priority, category, school_id, page = 1 } = req.query;
            const limit = 20;
            const offset = (page - 1) * limit;

            await executeAsync(`
                UPDATE support_tickets 
                SET sla_breached = 1, priority = 'critical' 
                WHERE status IN ('open', 'in_progress') 
                    AND sla_due_at < CURRENT_TIMESTAMP 
                    AND sla_breached = 0
            `).catch(err => console.error("Auto-escalate query failed:", err));

            let whereClause = "WHERE 1=1";
            let params = [];

            if (status) { whereClause += " AND st.status = ?"; params.push(status); }
            if (priority) { whereClause += " AND st.priority = ?"; params.push(priority); }
            if (category) { whereClause += " AND st.category = ?"; params.push(category); }
            if (school_id) { whereClause += " AND st.school_id = ?"; params.push(school_id); }

            const tickets = await queryAsync(`
                SELECT 
                    st.*,
                    s.school_name,
                    u.first_name as user_first_name, u.last_name as user_last_name,
                    au.first_name as assigned_first_name, au.last_name as assigned_last_name
                FROM support_tickets st
                JOIN schools s ON st.school_id = s.id
                JOIN users u ON st.user_id = u.id
                LEFT JOIN users au ON st.assigned_to = au.id
                ${whereClause}
                ORDER BY 
                    st.sla_breached DESC,
                    CASE st.priority 
                        WHEN 'critical' THEN 1
                        WHEN 'urgent' THEN 2 
                        WHEN 'high' THEN 3 
                        WHEN 'normal' THEN 4 
                        ELSE 5 
                    END,
                    st.created_at DESC
                LIMIT ? OFFSET ?
            `, [...params, limit, offset]);

            const [totalResult] = await queryAsync(`
                SELECT COUNT(*) as total FROM support_tickets st ${whereClause}
            `, params);

            const schools = await queryAsync("SELECT id, school_name FROM schools");

            res.render("superAdmin/support/list", {
                title: "Support Tickets - SchoolSync",
                tickets,
                schools,
                filters: { status, priority, category, school_id },
                pagination: {
                    page: parseInt(page),
                    totalPages: Math.ceil(totalResult.total / limit),
                    total: totalResult.total
                },
                user: req.user,
                currentPath: req.path
            });
        } catch (error) {
            console.error("List Support Tickets Error:", error);
            req.flash("error", "Failed to load tickets");
            res.redirect("/superadmin/dashboard");
        };
    },

    detail: async (req, res) => {
        try {
            const ticketId = req.params.id;

            const [ticket] = await queryAsync(`
                SELECT 
                    st.*,
                    s.school_name, s.subdomain,
                    u.first_name, u.last_name, u.email, u.role,
                    au.first_name as assigned_first_name, au.last_name as assigned_last_name
                FROM support_tickets st
                JOIN schools s ON st.school_id = s.id
                JOIN users u ON st.user_id = u.id
                LEFT JOIN users au ON st.assigned_to = au.id
                WHERE st.id = ?
            `, [ticketId]);

            if (!ticket) {
                req.flash("error", "Ticket not found");
                return res.redirect("/superadmin/support");
            };

            const replies = await queryAsync(`
                SELECT 
                    tr.*,
                    u.first_name, u.last_name, u.role
                FROM ticket_replies tr
                JOIN users u ON tr.user_id = u.id
                WHERE tr.ticket_id = ?
                ORDER BY tr.created_at
            `, [ticketId]);

            const admins = await queryAsync(`
                SELECT id, first_name, last_name
                FROM users 
                WHERE role IN ('super_admin') AND status = 'active'
            `);

            const kbArticles = await queryAsync("SELECT id, title FROM knowledge_base WHERE is_published = 1 ORDER BY title");

            res.render("superAdmin/support/detail", {
                title: `Ticket ${ticket.ticket_no} - SchoolSync`,
                ticket,
                replies,
                admins,
                kbArticles,
                user: req.user,
                currentPath: req.path
            });
        } catch (error) {
            console.error("Support Ticket Detail Error:", error);
            req.flash("error", "Failed to load ticket");
            res.redirect("/superadmin/support");
        };
    },

    assign: async (req, res) => {
        try {
            const { assigned_to } = req.body;
            await executeAsync(
                "UPDATE support_tickets SET assigned_to = ?, status = 'in_progress' WHERE id = ?",
                [assigned_to || null, req.params.id]
            );

            queryAsync("SELECT st.user_id, st.school_id, st.ticket_no, u.role FROM support_tickets st JOIN users u ON st.user_id = u.id WHERE st.id = ?", [req.params.id]).then(([ticket]) => {
                if (ticket) {
                    const NotificationService = require("../../services/notificationService");
                    const templates = require("../../utils/notificationTemplates");
                    NotificationService.createAndSend({
                        recipient_id: ticket.user_id,
                        recipient_role: ticket.role,
                        school_id: ticket.school_id,
                        created_by: req.user.id,
                        ...templates.ticketStatusUpdate(ticket.ticket_no, "in_progress")
                    }).catch(err => console.error("Ticket assign notification failed:", err));
                };
            });

            req.flash("success", "Ticket assigned successfully");
            res.redirect(`/superadmin/support/${req.params.id}`);
        } catch (error) {
            console.error("Assign Ticket Error:", error);
            req.flash("error", "Assignment failed");
            res.redirect(`/superadmin/support/${req.params.id}`);
        };
    },

    reply: async (req, res) => {
        try {
            const { message, is_internal } = req.body;
            const ticketId = req.params.id;

            await withTransaction(async (tx) => {
                await tx.execute(
                    `INSERT INTO ticket_replies (ticket_id, user_id, message, is_internal)
                     VALUES (?, ?, ?, ?)`,
                    [ticketId, req.user.id, message, is_internal ? 1 : 0]
                );

                if (!is_internal && req.user.role === 'super_admin') {
                    const [ticket] = await tx.query("SELECT first_response_at FROM support_tickets WHERE id = ?", [ticketId]);
                    if (ticket && !ticket.first_response_at) {
                        await tx.execute("UPDATE support_tickets SET first_response_at = CURRENT_TIMESTAMP WHERE id = ?", [ticketId]);
                    };
                };
            });

            res.redirect(`/superadmin/support/${ticketId}`);
        } catch (error) {
            console.error("Ticket Reply Error:", error);
            req.flash("error", "Reply failed");
            res.redirect(`/superadmin/support/${req.params.id}`);
        };
    },

    resolve: async (req, res) => {
        try {
            await executeAsync(
                `UPDATE support_tickets SET 
                    status = 'resolved', resolved_at = CURRENT_TIMESTAMP 
                WHERE id = ?`,
                [req.params.id]
            );

            queryAsync("SELECT st.user_id, st.school_id, st.ticket_no, u.role FROM support_tickets st JOIN users u ON st.user_id = u.id WHERE st.id = ?", [req.params.id]).then(([ticket]) => {
                if (ticket) {
                    const NotificationService = require("../../services/notificationService");
                    const templates = require("../../utils/notificationTemplates");
                    NotificationService.createAndSend({
                        recipient_id: ticket.user_id,
                        recipient_role: ticket.role,
                        school_id: ticket.school_id,
                        created_by: req.user.id,
                        ...templates.ticketStatusUpdate(ticket.ticket_no, "resolved")
                    }).catch(err => console.error("Ticket resolve notification failed:", err));
                };
            });

            req.flash("success", "Ticket resolved successfully");
            res.redirect(`/superadmin/support/${req.params.id}`);
        } catch (error) {
            console.error("Resolve Ticket Error:", error);
            req.flash("error", "Failed to resolve ticket");
            res.redirect(`/superadmin/support/${req.params.id}`);
        };
    },

    close: async (req, res) => {
        try {
            await executeAsync(
                "UPDATE support_tickets SET status = 'closed' WHERE id = ?",
                [req.params.id]
            );

            queryAsync("SELECT st.user_id, st.school_id, st.ticket_no, u.role FROM support_tickets st JOIN users u ON st.user_id = u.id WHERE st.id = ?", [req.params.id]).then(([ticket]) => {
                if (ticket) {
                    const NotificationService = require("../../services/notificationService");
                    const templates = require("../../utils/notificationTemplates");
                    NotificationService.createAndSend({
                        recipient_id: ticket.user_id,
                        recipient_role: ticket.role,
                        school_id: ticket.school_id,
                        created_by: req.user.id,
                        ...templates.ticketStatusUpdate(ticket.ticket_no, "closed")
                    }).catch(err => console.error("Ticket close notification failed:", err));
                };
            });

            req.flash("success", "Ticket closed successfully");
            res.redirect("/superadmin/support");
        } catch (error) {
            console.error("Close Ticket Error:", error);
            req.flash("error", "Failed to close ticket");
            res.redirect(`/superadmin/support/${req.params.id}`);
        };
    },

    merge: async (req, res) => {
        try {
            const ticketId = req.params.id;
            const { parent_ticket_no } = req.body;

            const [parent] = await queryAsync("SELECT * FROM support_tickets WHERE ticket_no = ?", [parent_ticket_no]);
            if (!parent) {
                req.flash("error", "Parent ticket not found. Check the ticket number.");
                return res.redirect(`/superadmin/support/${ticketId}`);
            };

            if (parent.id === parseInt(ticketId)) {
                req.flash("error", "Cannot merge a ticket into itself.");
                return res.redirect(`/superadmin/support/${ticketId}`);
            };

            await withTransaction(async (tx) => {
                await tx.execute("UPDATE support_tickets SET merged_into_id = ?, status = 'closed' WHERE id = ?", [parent.id, ticketId]);
                await tx.execute(
                    `INSERT INTO ticket_replies (ticket_id, user_id, message, is_internal)
                    VALUES (?, ?, ?, 1)`,
                    [ticketId, req.user.id, `This duplicate ticket was merged into Parent Ticket #${parent_ticket_no}.`]
                );

                const [child] = await tx.query("SELECT ticket_no FROM support_tickets WHERE id = ?", [ticketId]);
                await tx.execute(
                    `INSERT INTO ticket_replies (ticket_id, user_id, message, is_internal)
                    VALUES (?, ?, ?, 1)`,
                    [parent.id, req.user.id, `Ticket #${child[0].ticket_no} has been merged into this ticket as a duplicate.`]
                );
            });

            req.flash("success", `Ticket successfully merged into #${parent_ticket_no}`);
            res.redirect(`/superadmin/support/${ticketId}`);
        } catch (error) {
            console.error("Merge Ticket Error:", error);
            req.flash("error", "Failed to merge ticket");
            res.redirect(`/superadmin/support/${req.params.id}`);
        };
    },

    listArticles: async (req, res) => {
        try {
            const articles = await queryAsync("SELECT * FROM knowledge_base ORDER BY created_at DESC");
            res.render("superAdmin/support/kb_list", {
                title: "Knowledge Base Articles - SchoolSync",
                articles,
                user: req.user,
                currentPath: req.path
            });
        } catch (error) {
            console.error("KB List Error:", error);
            req.flash("error", "Failed to load Knowledge Base");
            res.redirect("/superadmin/support");
        };
    },

    createArticle: async (req, res) => {
        try {
            const { title, category, content, is_published } = req.body;
            await executeAsync(
                "INSERT INTO knowledge_base (title, category, content, is_published) VALUES (?, ?, ?, ?)",
                [title, category, content, is_published ? 1 : 0]
            );
            req.flash("success", "FAQ Article published successfully");
            res.redirect("/superadmin/support/kb");
        } catch (error) {
            console.error("KB Create Error:", error);
            req.flash("error", "Failed to save article");
            res.redirect("/superadmin/support/kb");
        };
    },

    updateArticle: async (req, res) => {
        try {
            const { title, category, content, is_published } = req.body;
            await executeAsync(
                "UPDATE knowledge_base SET title = ?, category = ?, content = ?, is_published = ? WHERE id = ?",
                [title, category, content, is_published ? 1 : 0, req.params.id]
            );
            req.flash("success", "FAQ Article updated successfully");
            res.redirect("/superadmin/support/kb");
        } catch (error) {
            console.error("KB Update Error:", error);
            req.flash("error", "Failed to update article");
            res.redirect("/superadmin/support/kb");
        };
    },

    deleteArticle: async (req, res) => {
        try {
            await executeAsync("DELETE FROM knowledge_base WHERE id = ?", [req.params.id]);
            req.flash("success", "Article deleted from Knowledge Base");
            res.redirect("/superadmin/support/kb");
        } catch (error) {
            console.error("KB Delete Error:", error);
            req.flash("error", "Failed to delete article");
            res.redirect("/superadmin/support/kb");
        };
    }
};

module.exports = supportTicketController;