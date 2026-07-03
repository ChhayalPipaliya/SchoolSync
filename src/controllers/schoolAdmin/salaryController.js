const db = require('../../config/database');
const PDFDocument = require('pdfkit');
const NotificationService = require('../../services/notificationService');

exports.listStructures = async (req, res) => {
    try {
        const schoolId = req.user?.school_id || req.session.user?.school_id;
        if (!schoolId) { 
            req.flash('error', 'Session expired'); 
            return res.redirect('/login'); 
        };

        const [structures] = await db.query(
            `SELECT ss.*, u.first_name AS first_name, u.last_name AS last_name, u.email 
            FROM salary_structures ss
            JOIN users u ON ss.user_id = u.id
            WHERE ss.school_id = ? AND u.deleted_at IS NULL AND u.role IN ('teacher', 'driver', 'librarian')
            ORDER BY ss.created_at DESC`,
            [schoolId]
        );

        res.render('schoolAdmin/salary/structures', {
            title: 'Salary Structures',
            structures,
            currentPath: '/schooladmin/salary/structures'
        });
    } catch (err) {
        console.error(err);
        req.flash('error', 'Failed to load salary structures');
        res.redirect('/schooladmin/dashboard');
    };
};

exports.addStructureForm = async (req, res) => {
    try {
        const schoolId = req.user?.school_id || req.session.user?.school_id;
        if (!schoolId) { req.flash('error', 'Session expired'); return res.redirect('/login'); }
        const [users] = await db.query(
            `SELECT id, first_name AS first_name, last_name AS last_name, role, email 
            FROM users 
            WHERE school_id = ? 
                AND role IN ('teacher', 'driver', 'librarian') 
                AND status = 'active' 
                AND deleted_at IS NULL 
                AND id NOT IN (SELECT user_id FROM salary_structures WHERE school_id = ?)
            ORDER BY role, first_name, last_name`,
            [schoolId, schoolId]
        );

        res.render('schoolAdmin/salary/addStructure', {
            title: 'Add Salary Structure',
            users,
            currentPath: '/schooladmin/salary/structures'
        });
    } catch (err) {
        console.error(err);
        req.flash('error', 'Failed to load add salary structure form');
        res.redirect('/schooladmin/salary/structures');
    };
};

exports.createStructure = async (req, res) => {
    try {
        const schoolId = req.user?.school_id || req.session.user?.school_id;
        if (!schoolId) { 
            req.flash('error', 'Session expired'); 
            return res.redirect('/login'); 
        };

        const { user_id, amount } = req.body;
        if (!user_id || !amount || parseFloat(amount) <= 0) {
            req.flash('error', 'Please select a user and enter a valid positive salary amount');
            return res.redirect('/schooladmin/salary/structures/add');
        };

        const [[user]] = await db.query(
            `SELECT role FROM users WHERE id = ? AND school_id = ? AND deleted_at IS NULL AND role IN ('teacher', 'driver', 'librarian') LIMIT 1`,
            [user_id, schoolId]
        );

        if (!user) {
            req.flash('error', 'User not found or inactive');
            return res.redirect('/schooladmin/salary/structures/add');
        };

        const [[duplicate]] = await db.query(
            `SELECT id FROM salary_structures WHERE school_id = ? AND user_id = ? LIMIT 1`,
            [schoolId, user_id]
        );

        if (duplicate) {
            req.flash('error', 'Salary structure already exists for this user');
            return res.redirect('/schooladmin/salary/structures/add');
        };

        await db.query(
            `INSERT INTO salary_structures (school_id, user_id, role, amount) VALUES (?, ?, ?, ?)`,
            [schoolId, user_id, user.role, parseFloat(amount)]
        );
        req.flash('success', 'Salary structure added successfully');
        res.redirect('/schooladmin/salary/structures');
    } catch (err) {
        console.error(err);
        req.flash('error', 'Failed to create salary structure');
        res.redirect('/schooladmin/salary/structures/add');
    };
};

exports.editStructureForm = async (req, res) => {
    try {
        const schoolId = req.user?.school_id || req.session.user?.school_id;
        if (!schoolId) { req.flash('error', 'Session expired'); return res.redirect('/login'); }
        const { id } = req.params;
        const [[structure]] = await db.query(
            `SELECT ss.*, u.first_name AS first_name, u.last_name AS last_name 
            FROM salary_structures ss
            JOIN users u ON ss.user_id = u.id
            WHERE ss.id = ? AND ss.school_id = ?`,
            [id, schoolId]
        );

        if (!structure) {
            req.flash('error', 'Salary structure not found');
            return res.redirect('/schooladmin/salary/structures');
        };

        res.render('schoolAdmin/salary/editStructure', {
            title: 'Edit Salary Structure',
            structure,
            currentPath: '/schooladmin/salary/structures'
        });
    } catch (err) {
        console.error(err);
        req.flash('error', 'Failed to load edit salary structure form');
        res.redirect('/schooladmin/salary/structures');
    };
};

exports.updateStructure = async (req, res) => {
    const { id } = req.params;
    try {
        const schoolId = req.user?.school_id || req.session.user?.school_id;
        if (!schoolId) { req.flash('error', 'Session expired'); return res.redirect('/login'); }
        
        const { amount } = req.body;
        if (!amount || parseFloat(amount) <= 0) {
            req.flash('error', 'Please enter a valid positive salary amount');
            return res.redirect(`/schooladmin/salary/structures/edit/${id}`);
        };

        const [result] = await db.query(
            `UPDATE salary_structures SET amount = ? WHERE id = ? AND school_id = ?`,
            [parseFloat(amount), id, schoolId]
        );

        if (result.affectedRows === 0) {
            req.flash('error', 'Salary structure not found or unauthorized');
            return res.redirect('/schooladmin/salary/structures');
        };

        req.flash('success', 'Salary structure updated successfully');
        res.redirect('/schooladmin/salary/structures');
    } catch (err) {
        console.error(err);
        req.flash('error', 'Failed to update salary structure');
        res.redirect(`/schooladmin/salary/structures/edit/${id}`);
    };
};

exports.deleteStructure = async (req, res) => {
    try {
        const schoolId = req.user?.school_id || req.session.user?.school_id;
        if (!schoolId) { req.flash('error', 'Session expired'); return res.redirect('/login'); }
        const { id } = req.params;

        const [result] = await db.query(
            `DELETE FROM salary_structures WHERE id = ? AND school_id = ?`,
            [id, schoolId]
        );

        if (result.affectedRows === 0) {
            req.flash('error', 'Salary structure not found or unauthorized');
        } else {
            req.flash('success', 'Salary structure deleted successfully');
        };
        res.redirect('/schooladmin/salary/structures');
    } catch (err) {
        console.error(err);
        req.flash('error', 'Failed to delete salary structure');
        res.redirect('/schooladmin/salary/structures');
    };
};

exports.generateSalariesForm = async (req, res) => {
    res.render('schoolAdmin/salary/generate', {
        title: 'Generate Salaries',
        currentPath: '/schooladmin/salary/monthly'
    });
};

exports.generateSalaries = async (req, res) => {
    try {
        const schoolId = req.user?.school_id || req.session.user?.school_id;
        if (!schoolId) { req.flash('error', 'Session expired'); return res.redirect('/login'); }
        
        const { salary_month } = req.body;
        if (!salary_month || !/^\d{4}-\d{2}$/.test(salary_month)) {
            req.flash('error', 'Please select a valid month');
            return res.redirect('/schooladmin/salary/generate');
        };

        const [[existing]] = await db.query(
            `SELECT COUNT(*) as count FROM monthly_salaries WHERE school_id = ? AND salary_month = ?`,
            [schoolId, salary_month]
        );

        if (existing && existing.count > 0) {
            req.flash('warning', `Salaries have already been generated for ${salary_month}`);
            return res.redirect('/schooladmin/salary/generate');
        };

        const [structures] = await db.query(
            `SELECT ss.user_id, ss.amount 
            FROM salary_structures ss
            JOIN users u ON ss.user_id = u.id
            WHERE ss.school_id = ? AND u.deleted_at IS NULL AND u.status = 'active' AND u.role IN ('teacher', 'driver', 'librarian')`,
            [schoolId]
        );

        if (structures.length === 0) {
            req.flash('error', 'No salary structures found. Please define salary structures first.');
            return res.redirect('/schooladmin/salary/structures');
        };

        await db.withTransaction(async (tx) => {
            for (const struct of structures) {
                await tx.query(
                    `INSERT INTO monthly_salaries (school_id, user_id, salary_month, total_amount, paid_amount, status) 
                    VALUES (?, ?, ?, ?, 0.00, 'pending')`,
                    [schoolId, struct.user_id, salary_month, struct.amount]
                );
            };
        });

        req.flash('success', `Monthly salaries generated successfully for ${salary_month}`);
        res.redirect('/schooladmin/salary/monthly');
    } catch (err) {
        console.error(err);
        req.flash('error', 'Failed to generate monthly salaries');
        res.redirect('/schooladmin/salary/generate');
    };
};

exports.listMonthlySalaries = async (req, res) => {
    try {
        const schoolId = req.user?.school_id || req.session.user?.school_id;
        if (!schoolId) { req.flash('error', 'Session expired'); return res.redirect('/login'); }
        const { month, status, role } = req.query;

        let sql = `
            SELECT ms.*, u.first_name AS first_name, u.last_name AS last_name, u.role
            FROM monthly_salaries ms
            JOIN users u ON ms.user_id = u.id
            WHERE ms.school_id = ? AND u.deleted_at IS NULL
        `;
        const params = [schoolId];

        if (month) {
            sql += ' AND ms.salary_month = ?';
            params.push(month);
        };
        if (status) {
            sql += ' AND ms.status = ?';
            params.push(status);
        };
        if (role) {
            sql += ' AND u.role = ?';
            params.push(role);
        };

        sql += ' ORDER BY ms.salary_month DESC, u.first_name ASC, u.last_name ASC';
        const [salaries] = await db.query(sql, params);
        const [months] = await db.query(
            `SELECT DISTINCT salary_month FROM monthly_salaries WHERE school_id = ? ORDER BY salary_month DESC`,
            [schoolId]
        );

        res.render('schoolAdmin/salary/monthly', {
            title: 'Monthly Salaries',
            salaries,
            months: months.map(m => m.salary_month),
            filters: req.query,
            currentPath: '/schooladmin/salary/monthly'
        });
    } catch (err) {
        console.error(err);
        req.flash('error', 'Failed to load monthly salaries');
        res.redirect('/schooladmin/dashboard');
    };
};

exports.paySalaryForm = async (req, res) => {
    try {
        const schoolId = req.user?.school_id || req.session.user?.school_id;
        if (!schoolId) { req.flash('error', 'Session expired'); return res.redirect('/login'); }
        const { id } = req.params;

        const [[salary]] = await db.query(
            `SELECT ms.*, u.first_name AS first_name, u.last_name AS last_name, u.role, u.email
            FROM monthly_salaries ms
            JOIN users u ON ms.user_id = u.id
            WHERE ms.id = ? AND ms.school_id = ?`,
            [id, schoolId]
        );

        if (!salary) {
            req.flash('error', 'Salary record not found');
            return res.redirect('/schooladmin/salary/monthly');
        };

        const [payments] = await db.query(
            `SELECT * FROM salary_payments WHERE monthly_salary_id = ? AND school_id = ? ORDER BY payment_date DESC, created_at DESC`,
            [id, schoolId]
        );

        res.render('schoolAdmin/salary/pay', {
            title: 'Pay Salary',
            salary,
            payments,
            currentPath: '/schooladmin/salary/monthly'
        });
    } catch (err) {
        console.error(err);
        req.flash('error', 'Failed to load payment form');
        res.redirect('/schooladmin/salary/monthly');
    };
};

exports.paySalary = async (req, res) => {
    const { id } = req.params;
    try {
        const schoolId = req.user?.school_id || req.session.user?.school_id;
        if (!schoolId) { req.flash('error', 'Session expired'); return res.redirect('/login'); }
        const { amount, payment_date, payment_method, receipt_no } = req.body;

        const paymentAmount = parseFloat(amount);
        if (!amount || isNaN(paymentAmount) || paymentAmount <= 0) {
            req.flash('error', 'Please enter a valid positive payment amount');
            return res.redirect(`/schooladmin/salary/pay/${id}`);
        };

        if (!payment_date) {
            req.flash('error', 'Please select a valid payment date');
            return res.redirect(`/schooladmin/salary/pay/${id}`);
        };

        if (!['cash', 'bank_transfer', 'online', 'upi'].includes(payment_method)) {
            req.flash('error', 'Please select a valid payment method');
            return res.redirect(`/schooladmin/salary/pay/${id}`);
        };

        await db.withTransaction(async (tx) => {
            const [salary] = await tx.query(
                `SELECT ms.*, u.role
                FROM monthly_salaries ms
                JOIN users u ON u.id = ms.user_id
                WHERE ms.id = ? AND ms.school_id = ? FOR UPDATE`,
                [id, schoolId]
            );

            if (!salary) {
                throw new Error('Salary record not found');
            };

            const totalAmount = parseFloat(salary.total_amount);
            const paidAmount = parseFloat(salary.paid_amount);
            const remaining = totalAmount - paidAmount;

            if (paymentAmount > remaining + 0.01) {
                throw new Error(`Payment amount (${paymentAmount}) exceeds remaining salary due (${remaining.toFixed(2)})`);
            };

            await tx.query(
                `INSERT INTO salary_payments (school_id, monthly_salary_id, role, amount, payment_date, payment_method, receipt_no)
                VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [schoolId, id, salary.role, paymentAmount, payment_date, payment_method, receipt_no || null]
            );

            const newPaidAmount = paidAmount + paymentAmount;
            let status = 'partial';
            if (Math.abs(newPaidAmount - totalAmount) < 0.01 || newPaidAmount >= totalAmount) {
                status = 'paid';
            };

            await tx.query(
                `UPDATE monthly_salaries SET paid_amount = ?, status = ? WHERE id = ? AND school_id = ?`,
                [newPaidAmount, status, id, schoolId]
            );
        });

        req.flash('success', 'Salary payment processed successfully');
        try {
            const [[paidUser]] = await db.query(
                `SELECT ms.user_id, u.role, ms.total_amount, ms.paid_amount, ms.salary_month
                FROM monthly_salaries ms
                JOIN users u ON u.id = ms.user_id AND u.school_id = ms.school_id
                WHERE ms.id = ? AND ms.school_id = ?`,
                [id, schoolId]
            );
            
            if (paidUser) {
                const rolePath = paidUser.role.replace('_', '');
                await NotificationService.createAndSend({
                    recipient_id: paidUser.user_id,
                    recipient_role: paidUser.role,
                    school_id: schoolId,
                    created_by: req.user?.id || req.session.user?.id,
                    title: 'Salary Payment Received',
                    message: `A salary payment has been credited for ${paidUser.salary_month}. Paid: ₹${parseFloat(req.body.amount).toFixed(2)}.`,
                    type: 'success',
                    category: 'general',
                    action_url: `/${rolePath}/dashboard`
                });
            };
        } catch (notifErr) {
            console.error('Salary payment notification failed:', notifErr.message);
        };
        res.redirect('/schooladmin/salary/monthly');
    } catch (err) {
        console.error(err);
        req.flash('error', err.message || 'Failed to process salary payment');
        res.redirect(`/schooladmin/salary/pay/${id}`);
    };
};

exports.salaryHistory = async (req, res) => {
    try {
        const schoolId = req.user?.school_id || req.session.user?.school_id;
        if (!schoolId) { req.flash('error', 'Session expired'); return res.redirect('/login'); }
        const { user_id, start_date, end_date } = req.query;

        let sql = `
            SELECT sp.*, ms.salary_month, u.first_name AS first_name, u.last_name AS last_name, u.role
            FROM salary_payments sp
            JOIN monthly_salaries ms ON sp.monthly_salary_id = ms.id
            JOIN users u ON ms.user_id = u.id
            WHERE sp.school_id = ?
        `;
        
        const params = [schoolId];
        if (user_id) {
            sql += ' AND ms.user_id = ?';
            params.push(user_id);
        };
        if (start_date) {
            sql += ' AND sp.payment_date >= ?';
            params.push(start_date);
        };
        if (end_date) {
            sql += ' AND sp.payment_date <= ?';
            params.push(end_date);
        };

        sql += ' ORDER BY sp.payment_date DESC, sp.created_at DESC';
        const [payments] = await db.query(sql, params);
        const [users] = await db.query(
            `SELECT DISTINCT u.id, u.first_name AS first_name, u.last_name AS last_name, u.role
            FROM users u
            JOIN salary_structures ss ON u.id = ss.user_id
            WHERE ss.school_id = ? AND u.deleted_at IS NULL AND u.role IN ('teacher', 'driver', 'librarian')
            ORDER BY u.first_name, u.last_name`,
            [schoolId]
        );

        res.render('schoolAdmin/salary/history', {
            title: 'Salary History',
            payments,
            users,
            filters: req.query,
            currentPath: '/schooladmin/salary/history'
        });
    } catch (err) {
        console.error(err);
        req.flash('error', 'Failed to load salary history');
        res.redirect('/schooladmin/dashboard');
    };
};

exports.downloadPaySlip = async (req, res) => {
    try {
        const schoolId = req.user?.school_id || req.session.user?.school_id;
        if (!schoolId) { req.flash('error', 'Session expired'); return res.redirect('/login'); }

        const { id } = req.params;

        const [[salary]] = await db.query(
            `SELECT ms.*, ms.salary_month,
                u.first_name, u.last_name, u.role, u.email,
                ss.amount AS base_salary,
                sch.school_name
            FROM monthly_salaries ms
            JOIN users u ON ms.user_id = u.id
            JOIN salary_structures ss ON ss.user_id = ms.user_id AND ss.school_id = ms.school_id
            JOIN schools sch ON ms.school_id = sch.id
            WHERE ms.id = ? AND ms.school_id = ?`,
            [id, schoolId]
        );

        if (!salary) {
            req.flash('error', 'Salary record not found');
            return res.redirect('/schooladmin/salary/monthly');
        };

        const [payments] = await db.query(
            `SELECT amount, payment_date, payment_method, receipt_no
            FROM salary_payments
            WHERE monthly_salary_id = ? AND school_id = ?
            ORDER BY payment_date ASC`,
            [id, schoolId]
        );

        const totalPaid = parseFloat(salary.paid_amount || 0);
        const totalAmount = parseFloat(salary.total_amount || 0);
        const balanceDue = Math.max(totalAmount - totalPaid, 0);
        const doc = new PDFDocument({ margin: 50, size: 'A4' });
        const safeName = `${salary.first_name}-${salary.last_name}`.replace(/\s+/g, '-');

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="payslip-${safeName}-${salary.salary_month}.pdf"`);
        doc.pipe(res);

        doc.fontSize(20).font('Helvetica-Bold').text(salary.school_name || 'School', 50, 45);
        doc.fontSize(10).font('Helvetica').fillColor('#666').text('SALARY SLIP', 50, 72);
        doc.moveTo(50, 90).lineTo(545, 90).stroke('#e2e8f0');
        doc.fillColor('#000').fontSize(11).font('Helvetica-Bold').text('Employee Details', 50, 105);
        doc.fontSize(10).font('Helvetica')
            .text(`Name: ${salary.first_name} ${salary.last_name}`, 50, 125)
            .text(`Role: ${salary.role?.replace(/_/g, ' ').toUpperCase() || '—'}`, 50, 142)
            .text(`Email: ${salary.email || '—'}`, 50, 159)
            .text(`Month: ${salary.salary_month}`, 300, 125)
            .text(`Generated: ${new Date().toLocaleDateString('en-IN')}`, 300, 142);
        doc.moveTo(50, 182).lineTo(545, 182).stroke('#e2e8f0');
        doc.fontSize(11).font('Helvetica-Bold').text('Earnings', 50, 197);
        doc.fontSize(10).font('Helvetica')
            .text('Base Salary', 50, 217)
            .text(`₹${totalAmount.toFixed(2)}`, 450, 217, { align: 'right', width: 95 });
        doc.moveTo(50, 240).lineTo(545, 240).stroke('#e2e8f0');
        doc.fontSize(11).font('Helvetica-Bold')
            .text('Net Payable:', 300, 257)
            .text(`₹${totalAmount.toFixed(2)}`, 450, 257, { align: 'right', width: 95 });
        doc.fontSize(10).font('Helvetica')
            .fillColor('#16a34a')
            .text('Amount Paid:', 300, 277)
            .text(`₹${totalPaid.toFixed(2)}`, 450, 277, { align: 'right', width: 95 });
        doc.fillColor(balanceDue > 0 ? '#dc2626' : '#000')
            .text('Balance Due:', 300, 294)
            .text(`₹${balanceDue.toFixed(2)}`, 450, 294, { align: 'right', width: 95 });

        const statusColor = salary.status === 'paid' ? '#16a34a' : salary.status === 'partial' ? '#d97706' : '#dc2626';
        doc.fillColor(statusColor).fontSize(12).font('Helvetica-Bold')
            .text(`Status: ${(salary.status || 'pending').toUpperCase()}`, 50, 277);
        doc.moveTo(50, 320).lineTo(545, 320).stroke('#e2e8f0');

        if (payments.length > 0) {
            doc.fillColor('#000').fontSize(11).font('Helvetica-Bold').text('Payment History', 50, 335);
            let y = 355;
            doc.fontSize(9).font('Helvetica-Bold')
                .text('Date', 50, y).text('Mode', 200, y).text('Receipt', 340, y).text('Amount', 450, y, { align: 'right', width: 95 });
            y += 16;
            doc.moveTo(50, y).lineTo(545, y).stroke('#e2e8f0');
            y += 8;

            doc.font('Helvetica').fontSize(9);
            for (const p of payments) {
                doc.fillColor('#000')
                    .text(new Date(p.payment_date).toLocaleDateString('en-IN'), 50, y)
                    .text(p.payment_method || '—', 200, y)
                    .text(p.receipt_no || '—', 340, y)
                    .text(`₹${parseFloat(p.amount).toFixed(2)}`, 450, y, { align: 'right', width: 95 });
                y += 18;
            };
        };

        doc.fontSize(8).fillColor('#999')
            .text('This is a computer generated salary slip and does not require a signature.', 50, 760, { align: 'center', width: 495 });
        doc.end();
    } catch (err) {
        console.error('[SalaryController downloadPaySlip]', err);
        req.flash('error', 'Failed to generate pay slip');
        res.redirect('/schooladmin/salary/monthly');
    };
};

exports.bulkPaySalaries = async (req, res) => {
    try {
        const schoolId = req.user?.school_id || req.session.user?.school_id;
        if (!schoolId) return res.status(401).json({ success: false, message: 'Session expired' });

        
        const { salary_ids, payment_method, payment_date } = req.body;
        if (!salary_ids || !Array.isArray(salary_ids) || salary_ids.length === 0) {
            return res.status(400).json({ success: false, message: 'No salary records selected' });
        };

        const validMethods = ['cash', 'bank_transfer', 'online', 'upi'];
        if (!validMethods.includes(payment_method)) {
            return res.status(400).json({ success: false, message: 'Invalid payment method' });
        };

        if (!payment_date) {
            return res.status(400).json({ success: false, message: 'Payment date is required' });
        };

        let processed = 0;
        let skipped = 0;
        await db.withTransaction(async (tx) => {
            for (const salaryId of salary_ids) {
                const [ms] = await tx.query(
                    `SELECT ms.id, ms.total_amount, ms.paid_amount, ms.status, ms.user_id, u.role
                    FROM monthly_salaries ms
                    JOIN users u ON u.id = ms.user_id AND u.school_id = ms.school_id
                    WHERE ms.id = ? AND ms.school_id = ? FOR UPDATE`,
                    [salaryId, schoolId]
                );

                if (!ms || ms.status === 'paid') {
                    skipped++;
                    continue;
                };

                const remaining = parseFloat(ms.total_amount) - parseFloat(ms.paid_amount || 0);
                if (remaining <= 0.01) {
                    skipped++;
                    continue;
                };

                await tx.query(
                    `INSERT INTO salary_payments
                    (school_id, monthly_salary_id, role, amount, payment_date, payment_method)
                    VALUES (?, ?, ?, ?, ?, ?)`,
                    [schoolId, ms.id, ms.role, remaining, payment_date, payment_method]
                );

                await tx.query(
                    `UPDATE monthly_salaries
                    SET paid_amount = total_amount, status = 'paid', updated_at = NOW()
                    WHERE id = ? AND school_id = ?`,
                    [ms.id, schoolId]
                );

                try {
                    await NotificationService.createAndSend({
                        recipient_id: ms.user_id,
                        recipient_role: ms.role,
                        school_id: schoolId,
                        created_by: req.user?.id || req.session.user?.id,
                        title: 'Salary Credited',
                        message: `Your salary of ₹${remaining.toFixed(2)} has been credited via ${payment_method}.`,
                        type: 'success',
                        category: 'general',
                        action_url: `/${ms.role.replace('_', '')}/dashboard`
                    });
                } catch (notifErr) {
                    console.error('Salary notification failed:', notifErr.message);
                };
                processed++;
            };
        });
        res.json({ success: true, processed, skipped });
    } catch (err) {
        console.error('[SalaryController bulkPaySalaries]', err);
        res.status(500).json({ success: false, message: err.message || 'Bulk pay failed' });
    };
};

exports.getSalaryStats = async (req, res) => {
    try {
        const schoolId = req.user?.school_id || req.session.user?.school_id;
        if (!schoolId) return res.status(401).json({ success: false, message: 'Session expired' });

        const currentMonth = new Date().toISOString().slice(0, 7);
        const [roleStats] = await db.query(
            `SELECT u.role,
                COALESCE(SUM(total_amount), 0) AS total,
                COALESCE(SUM(paid_amount), 0) AS paid
            FROM monthly_salaries ms
            JOIN users u ON u.id = ms.user_id AND u.school_id = ms.school_id
            WHERE ms.school_id = ? AND ms.salary_month = ?
            GROUP BY u.role`,
            [schoolId, currentMonth]
        );

        const [[totals]] = await db.query(
            `SELECT
                COALESCE(SUM(total_amount), 0) AS thisMonthTotal,
                COALESCE(SUM(paid_amount), 0) AS thisMonthPaid,
                COALESCE(SUM(total_amount) - SUM(paid_amount), 0) AS thisMonthPending
            FROM monthly_salaries
            WHERE school_id = ? AND salary_month = ?`,
            [schoolId, currentMonth]
        );

        const byRole = {};
        roleStats.forEach(r => {
            byRole[r.role] = {
                total: parseFloat(r.total),
                paid: parseFloat(r.paid),
                pending: parseFloat(r.total) - parseFloat(r.paid)
            };
        });

        res.json({
            success: true,
            thisMonthTotal: parseFloat(totals.thisMonthTotal),
            thisMonthPaid: parseFloat(totals.thisMonthPaid),
            thisMonthPending: parseFloat(totals.thisMonthPending),
            byRole
        });
    } catch (err) {
        console.error('[SalaryController getSalaryStats]', err);
        res.status(500).json({ success: false, message: 'Failed to load salary stats' });
    };
};