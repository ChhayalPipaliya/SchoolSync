const db = require('../../config/database');
const PDFDocument = require('pdfkit');
const { normalizeFeeIds, recordFeePaymentAllocation } = require('../../services/feePaymentService');

const handleDbError = (err, req, res, redirectPath, message = 'Operation failed') => {
    console.error(`[FeeController Error]:`, err);
    req.flash('error', message);
    res.redirect(redirectPath);
};

const validateRequired = (fields, body) => {
    const missing = fields.filter(field => !body[field] || body[field].toString().trim() === '');
    return missing.length > 0 ? missing : null;
};

const formatCurrency = (amount) => {
    return `₹${parseFloat(amount || 0).toFixed(2)}`;
};

exports.getFeeStructure = async (req, res) => {
    try {
        const schoolId = req.user?.school_id || req.session.user?.school_id;
        if (!schoolId) {
            req.flash('error', 'Session expired. Please login again.');
            return res.redirect('/login');
        };

        const [structures] = await db.query(
            `SELECT fs.*, c.class_name, c.section
            FROM fee_structures fs 
            JOIN classes c ON fs.class_id = c.id 
            WHERE fs.school_id = ? 
            ORDER BY c.class_name ASC, c.section ASC`,
            [schoolId]
        );

        const [classes] = await db.query(
            'SELECT * FROM classes WHERE school_id = ? ORDER BY class_name ASC, section ASC',
            [schoolId]
        );

        res.render('schoolAdmin/fees/structures', {
            title: 'Fee Structure',
            structures,
            classes,
            user: req.user || req.session.user
        });
    } catch (err) {
        handleDbError(err, req, res, '/schooladmin/dashboard', 'Failed to load fee structure');
    };
};

exports.saveFeeStructure = async (req, res) => {
    try {
        const schoolId = req.user?.school_id || req.session.user?.school_id;
        if (!schoolId) {
            req.flash('error', 'Session expired');
            return res.redirect('/login');
        };

        const { class_id, fee_name, amount, fee_type, due_date, frequency } = req.body;
        const missing = validateRequired(['class_id', 'amount'], req.body);
        if (missing) {
            req.flash('error', `Missing required fields: ${missing.join(', ')}`);
            return res.redirect('/schooladmin/fees/structures');
        };

        const finalFeeName = fee_name ? fee_name.trim() : 'Tuition Fee';
        const parsedAmount = parseFloat(amount);
        if (isNaN(parsedAmount) || parsedAmount <= 0) {
            req.flash('error', 'Amount must be a positive number');
            return res.redirect('/schooladmin/fees/structures');
        };

        const [[existing]] = await db.query(
            'SELECT id FROM fee_structures WHERE school_id = ? AND class_id = ? AND fee_name = ?',
            [schoolId, class_id, finalFeeName]
        );

        if (existing) {
            req.flash('error', 'Fee structure already exists for this class and fee name');
            return res.redirect('/schooladmin/fees/structures');
        };

        await db.query(
            `INSERT INTO fee_structures 
            (school_id, class_id, fee_name, amount, fee_type, due_date, frequency, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, NOW())`,
            [ schoolId, class_id, finalFeeName, parsedAmount, fee_type || 'tuition', due_date || null, frequency || 'monthly']
        );

        req.flash('success', 'Fee structure added successfully');
        res.redirect('/schooladmin/fees/structures');
    } catch (err) {
        handleDbError(err, req, res, '/schooladmin/fees/structures', 'Failed to save fee structure');
    };
};

exports.getCollectFee = async (req, res) => {
    try {
        const schoolId = req.user?.school_id || req.session.user?.school_id;
        if (!schoolId) {
            req.flash('error', 'Session expired');
            return res.redirect('/login');
        };

        const { student_id } = req.query;
        let student = null;
        let pendingFees = [];
        let studentsList = [];

        if (student_id) {
            if (isNaN(parseInt(student_id))) {
                req.flash('error', 'Invalid student ID');
                return res.redirect('/schooladmin/fees/collect');
            };

            [[student]] = await db.query(
                `SELECT s.*, u.first_name AS first_name, u.last_name AS last_name, u.email, 
                    c.class_name, c.section
                FROM students s 
                JOIN users u ON s.user_id = u.id
                LEFT JOIN classes c ON s.class_id = c.id 
                WHERE s.id = ? AND s.school_id = ? AND s.deleted_at IS NULL`,
                [student_id, schoolId]
            );

            if (!student) {
                req.flash('error', 'Student not found');
                return res.redirect('/schooladmin/fees/collect');
            };

            [pendingFees] = await db.query(
                `SELECT sf.*, COALESCE(fs.fee_name, 'School Fee') as fee_name, fs.frequency
                FROM student_fees sf 
                LEFT JOIN fee_structures fs ON sf.fee_structure_id = fs.id 
                WHERE sf.student_id = ? AND sf.school_id = ? AND sf.status != 'paid'
                ORDER BY sf.due_date ASC`,
                [student_id, schoolId]
            );
        } else {
            studentsList = await db.queryAsync(
                `SELECT s.id, u.first_name AS first_name, u.last_name AS last_name, 
                    c.class_name, c.section, s.roll_no, s.admission_no
                FROM students s 
                JOIN users u ON s.user_id = u.id
                LEFT JOIN classes c ON s.class_id = c.id 
                WHERE s.school_id = ? AND s.deleted_at IS NULL AND s.status = 'active'
                ORDER BY c.class_name ASC, c.section ASC, u.first_name ASC, u.last_name ASC`,
                [schoolId]
            );
        };

        res.render('schoolAdmin/fees/collect', {
            title: 'Collect Fee',
            student,
            pendingFees,
            studentsList,
            student_id: student_id || '',
            user: req.user || req.session.user
        });
    } catch (err) {
        handleDbError(err, req, res, '/schooladmin/dashboard', 'Failed to load fee collection');
    };
};

exports.postCollectFee = async (req, res) => {
    let connection;
    try {
        const schoolId = req.user?.school_id || req.session.user?.school_id;
        if (!schoolId) {
            req.flash('error', 'Session expired');
            return res.redirect('/login');
        };

        const { student_id, fee_ids, payment_mode, discount, remarks } = req.body;
        if (!student_id || !fee_ids) {
            req.flash('error', 'Please select student and fees to collect');
            return res.redirect('/schooladmin/fees/collect');
        };

        const feeIds = normalizeFeeIds(fee_ids);

        const validPaymentModes = ['cash', 'card', 'upi', 'cheque', 'bank_transfer'];
        if (!validPaymentModes.includes(payment_mode)) {
            req.flash('error', 'Invalid payment mode');
            return res.redirect('/schooladmin/fees/collect');
        };

        connection = await db.getConnection();
        await connection.beginTransaction();

        let totalAmount = 0;
        const processedFees = [];
        const payingAmounts = req.body.paying_amount || {};
        for (const feeId of feeIds) {
            const [[fee]] = await connection.query(
                `SELECT sf.*, COALESCE(fs.fee_name, 'School Fee') as fee_name, fs.amount as structure_amount,
                    allocated_payment.status AS allocated_payment_status
                FROM student_fees sf
                LEFT JOIN fee_structures fs ON sf.fee_structure_id = fs.id
                LEFT JOIN fee_payments allocated_payment
                    ON allocated_payment.id = sf.payment_id
                    AND allocated_payment.school_id = sf.school_id
                WHERE sf.id = ? AND sf.student_id = ? AND sf.school_id = ? AND sf.status != 'paid'
                FOR UPDATE`,
                [feeId, student_id, schoolId]
            );

            if (!fee) {
                await connection.rollback();
                req.flash('error', `Fee item not found or already paid: ${feeId}`);
                return res.redirect(`/schooladmin/fees/collect?student_id=${student_id}`);
            };
            if (fee.payment_id && fee.allocated_payment_status === 'pending') {
                await connection.rollback();
                req.flash('error', `An online payment is already in progress for fee item: ${feeId}`);
                return res.redirect(`/schooladmin/fees/collect?student_id=${student_id}`);
            };
            if (fee.payment_id && fee.allocated_payment_status === 'reconciliation_required') {
                const conflict = new Error(
                    `Fee item ${feeId} has a captured payment awaiting reconciliation and cannot accept another payment.`
                );
                conflict.statusCode = 409;
                throw conflict;
            };
            if (fee.payment_id && !fee.allocated_payment_status) {
                throw new Error(`Linked payment record not found for fee item: ${feeId}`);
            };
            if (fee.payment_id && fee.allocated_payment_status === 'failed') {
                const [supersededPayment] = await connection.query(
                    `UPDATE fee_payments
                    SET status = 'superseded'
                    WHERE id = ? AND school_id = ? AND status = 'failed'`,
                    [fee.payment_id, schoolId]
                );
                if (supersededPayment.affectedRows !== 1) {
                    throw new Error(`Failed payment state changed for fee item: ${feeId}`);
                };
            } else if (
                fee.payment_id &&
                !['superseded', 'refunded', 'completed', 'paid'].includes(fee.allocated_payment_status)
            ) {
                const conflict = new Error(`Linked payment state does not allow collection for fee item: ${feeId}`);
                conflict.statusCode = 409;
                throw conflict;
            };
            if (
                fee.payment_id &&
                ['completed', 'paid'].includes(fee.allocated_payment_status) &&
                Number(fee.paid_amount || 0) <= 0.005
            ) {
                throw new Error(`Fee item ${feeId} has inconsistent settled payment history.`);
            };

            const remainingBalance = parseFloat(fee.total_amount) - parseFloat(fee.paid_amount || 0);
            let payAmt = parseFloat(payingAmounts[feeId]);
            if (isNaN(payAmt) || payAmt <= 0) {
                payAmt = remainingBalance;
            };

            if (payAmt > remainingBalance + 0.01) {
                await connection.rollback();
                req.flash('error', `Paying amount ₹${payAmt.toFixed(2)} cannot exceed the remaining balance ₹${remainingBalance.toFixed(2)} for ${fee.fee_name}`);
                return res.redirect(`/schooladmin/fees/collect?student_id=${student_id}`);
            };

            const newPaidAmount = parseFloat(fee.paid_amount || 0) + payAmt;
            const newStatus = (newPaidAmount >= parseFloat(fee.total_amount) - 0.01) ? 'paid' : 'partial';
            totalAmount += payAmt;
            processedFees.push({ ...fee, paidAmount: payAmt });
            const [feeUpdate] = await connection.query(
                'UPDATE student_fees SET status = ?, paid_amount = ?, paid_at = NOW() WHERE id = ? AND school_id = ?',
                [newStatus, newPaidAmount, feeId, schoolId]
            );
            if (feeUpdate.affectedRows !== 1) {
                throw new Error(`Fee item changed while payment was being collected: ${feeId}`);
            };
        };

        const parsedDiscount = discount === undefined || discount === null || discount === '' ? 0 : Number(discount);
        if (!Number.isFinite(parsedDiscount) || parsedDiscount < 0 || parsedDiscount >= totalAmount) {
            throw new Error('Discount must be a non-negative amount below the collected total.');
        };
        const netAmount = totalAmount - parsedDiscount;
        if (netAmount <= 0) throw new Error('Discount cannot equal or exceed the collected amount.');
        const [payment] = await connection.query(
            `INSERT INTO fee_payments 
            (school_id, student_id, initiated_by_user_id, initiated_by_role, amount, discount, payment_date, payment_method, receipt_no, status, created_at)
            VALUES (?, ?, ?, 'school_admin', ?, ?, CURDATE(), ?, NULL, 'completed', NOW())`,
            [schoolId, student_id, (req.user?.id || req.session.user?.id), netAmount, parsedDiscount, payment_mode]
        );
        const receiptNo = `RCP-${schoolId}-${new Date().getFullYear()}-${String(payment.insertId).padStart(8, '0')}`;
        const [receiptUpdate] = await connection.query(
            'UPDATE fee_payments SET receipt_no = ?, receipt_number = ? WHERE id = ?',
            [receiptNo, receiptNo, payment.insertId]
        );
        if (receiptUpdate.affectedRows !== 1) throw new Error('Failed to assign the payment receipt.');

        for (const fee of processedFees) {
            await recordFeePaymentAllocation(connection, {
                schoolId,
                paymentId: payment.insertId,
                studentFeeId: fee.id,
                amount: fee.paidAmount
            });
            const [allocationUpdate] = await connection.query(
                'UPDATE student_fees SET payment_id = ? WHERE id = ? AND school_id = ?',
                [payment.insertId, fee.id, schoolId]
            );
            if (allocationUpdate.affectedRows !== 1) {
                throw new Error(`Failed to allocate payment to fee item: ${fee.id}`);
            };
        };

        const [[studentUser]] = await connection.query(
            `SELECT u.id as user_id, u.first_name AS first_name, u.last_name AS last_name 
            FROM students s 
            JOIN users u ON s.user_id = u.id 
            WHERE s.id = ? AND s.school_id = ?`,
            [student_id, schoolId]
        );

        await connection.commit();
        const committedConnection = connection;
        connection = null;
        committedConnection.release();
        if (studentUser) {
            const studentName = `${studentUser.first_name} ${studentUser.last_name}`;
            const NotificationService = require('../../services/notificationService');
            const templates = require('../../utils/notificationTemplates');

            NotificationService.createAndSend({
                recipient_id: studentUser.user_id,
                recipient_role: "student",
                school_id: schoolId,
                created_by: req.user?.id || req.session.user?.id,
                ...templates.feePaidStudent(netAmount, payment.insertId)
            }).catch(err => console.error("Failed to notify student of fee payment:", err));

            NotificationService.notifyAdmins(
                schoolId,
                templates.feePaid(studentName, netAmount, payment.insertId),
                req.user?.id || req.session.user?.id
            ).catch(err => console.error("Failed to notify admins of fee payment:", err));
        };

        req.flash('success', `Fee collected: ${formatCurrency(netAmount)} (Discount: ${formatCurrency(parsedDiscount)})`);
        res.redirect(`/schooladmin/fees/receipt/${payment.insertId}`);
    } catch (err) {
        if (connection) await connection.rollback();
        handleDbError(err, req, res, '/schooladmin/fees/collect', 'Failed to collect fee');
    } finally {
        if (connection) connection.release();
    };
};

exports.getPendingFees = async (req, res) => {
    try {
        const schoolId = req.user?.school_id || req.session.user?.school_id;
        if (!schoolId) {
            req.flash('error', 'Session expired');
            return res.redirect('/login');
        };

        const { class_id, search } = req.query;
        let sql = `
            SELECT sf.*, 
                u.first_name AS first_name, u.last_name AS last_name, 
                s.roll_no, s.admission_no,
                c.class_name, c.section, 
                fs.fee_name, fs.amount as structure_amount, fs.due_date
            FROM student_fees sf
            JOIN students s ON sf.student_id = s.id
            JOIN users u ON s.user_id = u.id
            JOIN fee_structures fs ON sf.fee_structure_id = fs.id
            LEFT JOIN classes c ON s.class_id = c.id
            WHERE sf.school_id = ? 
                AND sf.status IN ('pending', 'partial') 
                AND s.deleted_at IS NULL
        `;
        
        const params = [schoolId];
        if (class_id && !isNaN(parseInt(class_id))) {
            sql += ' AND s.class_id = ?';
            params.push(class_id);
        };

        if (search && search.trim()) {
            sql += ' AND (u.first_name LIKE ? OR u.last_name LIKE ? OR s.admission_no LIKE ?)';
            const searchTerm = `%${search.trim()}%`;
            params.push(searchTerm, searchTerm, searchTerm);
        };

        sql += ' ORDER BY sf.due_date ASC, u.first_name ASC';
        const [pendingFees] = await db.query(sql, params);
        const [classes] = await db.query(
            'SELECT * FROM classes WHERE school_id = ? ORDER BY class_name ASC, section ASC',
            [schoolId]
        );

        const totalPendingAmount = pendingFees.reduce((sum, fee) => sum + parseFloat((fee.total_amount - fee.paid_amount) || 0), 0);
        const overdueCount = pendingFees.filter(fee => new Date(fee.due_date) < new Date()).length;
        res.render('schoolAdmin/fees/pending', {
            title: 'Pending Fees',
            pendingFees,
            classes,
            class_id: class_id || '',
            search: search || '',
            totalPendingAmount,
            overdueCount,
            user: req.user || req.session.user
        });
    } catch (err) {
        handleDbError(err, req, res, '/schooladmin/dashboard', 'Failed to load pending fees');
    };
};

exports.downloadReceipt = async (req, res) => {
    try {
        const schoolId = req.user?.school_id || req.session.user?.school_id;
        if (!schoolId) {
            req.flash('error', 'Session expired');
            return res.redirect('/login');
        };

        const { paymentId } = req.params;
        if (!paymentId || isNaN(parseInt(paymentId))) {
            req.flash('error', 'Invalid receipt ID');
            return res.redirect('/schooladmin/fees/pending');
        };

        const [[payment]] = await db.query(
            `SELECT fp.*, 
                u.first_name AS first_name, u.last_name AS last_name, 
                sfam.father_name, sfam.mother_name, s.roll_no,
                c.class_name, c.section,
                sch.school_name, sch.school_address, sch.school_phone
            FROM fee_payments fp
            JOIN students s ON fp.student_id = s.id
            JOIN users u ON s.user_id = u.id
            LEFT JOIN student_family sfam ON sfam.student_id = s.id
            LEFT JOIN classes c ON s.class_id = c.id
            JOIN schools sch ON fp.school_id = sch.id
            WHERE fp.id = ? AND fp.school_id = ?`,
            [paymentId, schoolId]
        );

        if (!payment) {
            req.flash('error', 'Receipt not found');
            return res.redirect('/schooladmin/fees/pending');
        };

        let [feeItems] = await db.query(
            `SELECT sf.*, fpa.amount AS receipt_amount,
                COALESCE(fs.fee_name, 'School Fee') AS fee_name, fs.frequency
            FROM fee_payment_allocations fpa
            JOIN student_fees sf ON sf.id = fpa.student_fee_id AND sf.school_id = fpa.school_id
            LEFT JOIN fee_structures fs ON sf.fee_structure_id = fs.id
            WHERE fpa.payment_id = ? AND fpa.school_id = ?
            ORDER BY COALESCE(fs.fee_name, 'School Fee') ASC`,
            [paymentId, schoolId]
        );
        if (!feeItems.length) [feeItems] = await db.query(
            `SELECT sf.*, sf.total_amount AS receipt_amount,
                COALESCE(fs.fee_name, 'School Fee') AS fee_name, fs.frequency
            FROM student_fees sf
            LEFT JOIN fee_structures fs ON sf.fee_structure_id = fs.id
            WHERE sf.payment_id = ? AND sf.school_id = ?
            ORDER BY COALESCE(fs.fee_name, 'School Fee') ASC`,
            [paymentId, schoolId]
        );

        const doc = new PDFDocument({ margin: 50 });
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="receipt-${paymentId}-${Date.now()}.pdf"`);

        doc.pipe(res);
        doc.fontSize(22).font('Helvetica-Bold').text(payment.school_name, 50, 40);
        doc.fontSize(10).font('Helvetica').text(payment.school_address || '', 50, 70);
        if (payment.school_phone) {
            doc.text(`Phone: ${payment.school_phone}`, 50, 85);
        };
        doc.moveTo(50, 110).lineTo(550, 110).stroke();
        doc.fontSize(18).font('Helvetica-Bold').text('FEE RECEIPT', 50, 125);
        doc.fontSize(10).font('Helvetica')
            .text(`Receipt No: #${String(payment.id).padStart(6, '0')}`, 400, 125)
            .text(`Date: ${new Date(payment.created_at).toLocaleDateString('en-IN')}`, 400, 140);
        doc.fontSize(11).font('Helvetica-Bold').text('Student Details:', 50, 170);
        doc.fontSize(10).font('Helvetica')
            .text(`Name: ${payment.first_name} ${payment.last_name}`, 50, 190)
            .text(`Father: ${payment.father_name || 'N/A'}`, 50, 205)
            .text(`Class: ${payment.class_name || 'N/A'} ${payment.section ? `(${payment.section})` : ''}`, 50, 220)
            .text(`Roll No: ${payment.roll_no || 'N/A'}`, 300, 220);
        doc.moveTo(50, 250).lineTo(550, 250).stroke();
        doc.fontSize(11).font('Helvetica-Bold').text('Fee Details:', 50, 260);

        let y = 285;
        const colX = { item: 50, amount: 450 };
        doc.fontSize(10).font('Helvetica-Bold')
            .text('Fee Name', colX.item, y)
            .text('Amount', colX.amount, y);
        y += 20;

        let total = 0;
        doc.fontSize(10).font('Helvetica');

        for (const item of feeItems) {
            doc.text(item.fee_name, colX.item, y);
            doc.text(formatCurrency(item.receipt_amount), colX.amount, y);
            total += parseFloat(item.receipt_amount);
            y += 18;
        };

        y += 10;
        doc.moveTo(50, y).lineTo(550, y).stroke();
        y += 15;

        doc.fontSize(11).font('Helvetica-Bold')
            .text('Total Amount:', 350, y)
            .text(formatCurrency(total), colX.amount, y);

        if (parseFloat(payment.discount) > 0) {
            y += 20;
            doc.fontSize(10).font('Helvetica')
                .text('Discount:', 350, y)
                .text(`-${formatCurrency(payment.discount)}`, colX.amount, y);
            y += 20;
            doc.fontSize(12).font('Helvetica-Bold')
                .text('Net Amount:', 350, y)
                .text(formatCurrency(total - parseFloat(payment.discount)), colX.amount, y);
        };

        y += 40;
        doc.fontSize(10).font('Helvetica')
            .text(`Payment Mode: ${payment.payment_method?.toUpperCase() || 'N/A'}`, 50, y)
            .text(`Received by: ${req.user?.first_name || req.session.user?.first_name || 'Admin'}`, 50, y + 15)
            .text(`Remarks: ${payment.remarks || 'N/A'}`, 50, y + 30);
        doc.fontSize(9).font('Helvetica')
            .text('This is a computer generated receipt and does not require signature.', 50, 750, { align: 'center' });
        doc.end();
    } catch (err) {
        handleDbError(err, req, res, '/schooladmin/fees/pending', 'Failed to generate receipt');
    };
};

exports.sendFeeReminder = async (req, res) => {
    try {
        const schoolId = req.user?.school_id || req.session.user?.school_id;
        if (!schoolId) {
            req.flash('error', 'Session expired');
            return res.redirect('/login');
        };

        const { student_ids, message } = req.body;
        if (!student_ids || (Array.isArray(student_ids) && student_ids.length === 0)) {
            req.flash('error', 'Please select at least one student');
            return res.redirect('/schooladmin/fees/pending');
        };

        const studentIds = Array.isArray(student_ids) ? student_ids : [student_ids];
        const [students] = await db.query(
            `SELECT DISTINCT s.id as student_id, s.user_id, u.first_name AS first_name, u.last_name AS last_name, s.school_id, sf.total_amount, sf.paid_amount, sf.due_date, fs.fee_name
            FROM students s
            JOIN users u ON s.user_id = u.id
            JOIN student_fees sf ON sf.student_id = s.id
            LEFT JOIN fee_structures fs ON sf.fee_structure_id = fs.id
            WHERE s.id IN (?) AND s.school_id = ? AND sf.school_id = ? AND sf.status != 'paid' AND s.deleted_at IS NULL`,
            [studentIds, schoolId, schoolId]
        );

        const NotificationService = require('../../services/notificationService');
        for (const student of students) {
            const remainingAmount = parseFloat(student.total_amount || 0) - parseFloat(student.paid_amount || 0);
            if (remainingAmount <= 0) continue;

            const msg = message || `Dear ${student.first_name}, you have a pending fee payment for "${student.fee_name || 'School Fee'}" of ₹${remainingAmount.toFixed(2)} due on ${new Date(student.due_date).toLocaleDateString('en-IN')}. Please pay on time.`;
            await NotificationService.createAndSend({
                recipient_id: student.user_id,
                recipient_role: "student",
                school_id: student.school_id,
                created_by: req.user?.id || req.session.user?.id,
                title: "Fee Payment Reminder",
                message: msg,
                type: "warning",
                category: "fee",
                action_url: "/student/fees"
            });
        };

        req.flash('success', `Fee reminders sent to ${students.length} student(s)`);
        res.redirect('/schooladmin/fees/pending');
    } catch (err) {
        handleDbError(err, req, res, '/schooladmin/fees/pending', 'Failed to send reminders');
    };
};

exports.listFees = async (req, res) => {
    try {
        const schoolId = req.user?.school_id || req.session.user?.school_id;
        if (!schoolId) {
            req.flash('error', 'Session expired');
            return res.redirect('/login');
        };

        const [fees] = await db.query(
            `SELECT sf.*, u.first_name AS first_name, u.last_name AS last_name, c.class_name as className, c.section
            FROM student_fees sf
            JOIN students s ON sf.student_id = s.id
            JOIN users u ON s.user_id = u.id
            LEFT JOIN classes c ON s.class_id = c.id
            WHERE sf.school_id = ? AND s.deleted_at IS NULL
            ORDER BY sf.created_at DESC`,
            [schoolId]
        );

        const [[statsResult]] = await db.query(
            `SELECT 
                COUNT(id) as total,
                SUM(CASE WHEN status = 'paid' THEN 1 ELSE 0 END) as paid,
                SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
                SUM(CASE WHEN status = 'partial' THEN 1 ELSE 0 END) as partial,
                SUM(paid_amount) as totalCollected
            FROM student_fees
            WHERE school_id = ?`,
            [schoolId]
        );

        const stats = {
            total: statsResult.total || 0,
            paid: statsResult.paid || 0,
            pending: statsResult.pending || 0,
            partial: statsResult.partial || 0,
            totalCollected: statsResult.totalCollected || 0
        };

        res.render('schoolAdmin/fees/index', {
            title: 'Student Fees',
            fees,
            stats,
            user: req.user || req.session.user
        });
    } catch (err) {
        handleDbError(err, req, res, '/schooladmin/dashboard', 'Failed to load fee records');
    };
};

exports.showAddForm = async (req, res) => {
    try {
        const schoolId = req.user?.school_id || req.session.user?.school_id;
        if (!schoolId) {
            req.flash('error', 'Session expired');
            return res.redirect('/login');
        }

        const [students] = await db.query(
            `SELECT s.id, u.first_name AS first_name, u.last_name AS last_name, c.class_name as className
            FROM students s
            JOIN users u ON s.user_id = u.id
            LEFT JOIN classes c ON s.class_id = c.id
            WHERE s.school_id = ? AND s.deleted_at IS NULL
            ORDER BY u.first_name ASC, u.last_name ASC`,
            [schoolId]
        );

        res.render('schoolAdmin/fees/add', {
            title: 'Add Fee',
            students,
            user: req.user || req.session.user
        });
    } catch (err) {
        handleDbError(err, req, res, '/schooladmin/fees', 'Failed to load add form');
    };
};

exports.createFee = async (req, res) => {
    try {
        const schoolId = req.user?.school_id || req.session.user?.school_id;
        if (!schoolId) {
            req.flash('error', 'Session expired');
            return res.redirect('/login');
        };

        const { student_id, amount, due_date, discount, late_fee } = req.body;
        if (!student_id || !amount || !due_date || due_date.length < 7) {
            req.flash('error', 'Student, Amount and a valid Due Date are required');
            return res.redirect('/schooladmin/fees/add');
        };

        const parsedAmount = parseFloat(amount || 0);
        const parsedDiscount = parseFloat(discount || 0);
        const parsedLateFee = parseFloat(late_fee || 0);

        if (isNaN(parsedAmount) || parsedAmount < 0 || isNaN(parsedDiscount) || parsedDiscount < 0 || isNaN(parsedLateFee) || parsedLateFee < 0) {
            req.flash('error', 'Amount, Discount and Late Fee must be valid positive numbers');
            return res.redirect('/schooladmin/fees/add');
        };

        const totalAmount = parsedAmount - parsedDiscount + parsedLateFee;
        if (totalAmount <= 0) {
            req.flash('error', 'Final fee amount must be greater than zero');
            return res.redirect('/schooladmin/fees/add');
        };

        const [[student]] = await db.query(
            'SELECT id FROM students WHERE id = ? AND school_id = ? AND deleted_at IS NULL LIMIT 1',
            [student_id, schoolId]
        );
        if (!student) {
            req.flash('error', 'Student not found or unauthorized');
            return res.redirect('/schooladmin/fees/add');
        };

        const feeMonth = due_date.substring(0, 7);
        await db.query(
            `INSERT INTO student_fees 
            (school_id, student_id, fee_structure_id, fee_month, due_date, total_amount, paid_amount, status, created_at)
            VALUES (?, ?, NULL, ?, ?, ?, 0, 'pending', NOW())`,
            [schoolId, student_id, feeMonth, due_date, totalAmount]
        );

        req.flash('success', 'Fee added successfully');
        res.redirect('/schooladmin/fees');
    } catch (err) {
        if (err.code === 'ER_DUP_ENTRY' || err.errno === 1062) {
            req.flash('error', 'A fee record already exists for this student for the selected month.');
            return res.redirect('/schooladmin/fees/add');
        }
        handleDbError(err, req, res, '/schooladmin/fees/add', 'Failed to create fee');
    };
};

exports.showEditForm = async (req, res) => {
    try {
        const schoolId = req.user?.school_id || req.session.user?.school_id;
        if (!schoolId) {
            req.flash('error', 'Session expired');
            return res.redirect('/login');
        };

        const { id } = req.params;
        const [[fee]] = await db.query(
            `SELECT sf.*, sf.total_amount as amount, u.first_name AS first_name, u.last_name AS last_name, fp.payment_method
            FROM student_fees sf
            JOIN students s ON sf.student_id = s.id
            JOIN users u ON s.user_id = u.id
            LEFT JOIN fee_payments fp ON sf.payment_id = fp.id
            WHERE sf.id = ? AND sf.school_id = ?`,
            [id, schoolId]
        );

        if (!fee) {
            req.flash('error', 'Fee record not found');
            return res.redirect('/schooladmin/fees');
        };

        res.render('schoolAdmin/fees/edit', {
            title: 'Edit Fee',
            fee,
            user: req.user || req.session.user
        });
    } catch (err) {
        handleDbError(err, req, res, '/schooladmin/fees', 'Failed to load edit form');
    };
};

exports.updateFee = async (req, res) => {
    let connection;
    try {
        const schoolId = req.user?.school_id || req.session.user?.school_id;
        if (!schoolId) {
            req.flash('error', 'Session expired');
            return res.redirect('/login');
        };

        const { id } = req.params;
        const { amount, due_date, status, payment_method, discount, late_fee } = req.body;
        if (!amount || !due_date || due_date.length < 7) {
            req.flash('error', 'Amount and a valid Due Date are required');
            return res.redirect(`/schooladmin/fees/${id}/edit`);
        };
        const manualPaymentMethod = payment_method || 'cash';
        const manualPaymentMethods = ['cash', 'card', 'upi', 'cheque', 'bank_transfer'];
        if (status === 'paid' && !manualPaymentMethods.includes(manualPaymentMethod)) {
            req.flash('error', 'Select a valid offline payment method');
            return res.redirect(`/schooladmin/fees/${id}/edit`);
        };

        const parsedAmount = parseFloat(amount || 0);
        const parsedDiscount = parseFloat(discount || 0);
        const parsedLateFee = parseFloat(late_fee || 0);
        if (isNaN(parsedAmount) || parsedAmount < 0 || isNaN(parsedDiscount) || parsedDiscount < 0 || isNaN(parsedLateFee) || parsedLateFee < 0) {
            req.flash('error', 'Amount, Discount and Late Fee must be valid positive numbers');
            return res.redirect(`/schooladmin/fees/${id}/edit`);
        };

        const totalAmount = parsedAmount - parsedDiscount + parsedLateFee;
        if (totalAmount <= 0) {
            req.flash('error', 'Final fee amount must be greater than zero');
            return res.redirect(`/schooladmin/fees/${id}/edit`);
        };

        connection = await db.getConnection();
        await connection.beginTransaction();
        const [[currentFee]] = await connection.query(
            'SELECT * FROM student_fees WHERE id = ? AND school_id = ? FOR UPDATE',
            [id, schoolId]
        );

        if (!currentFee) {
            await connection.rollback();
            req.flash('error', 'Fee record not found');
            return res.redirect('/schooladmin/fees');
        };

        let existingPayment = null;
        if (currentFee.payment_id) {
            [[existingPayment]] = await connection.query(
                `SELECT id, status, payment_method, razorpay_order_id, razorpay_payment_id,
                    razorpay_signature, transaction_id
                FROM fee_payments
                WHERE id = ? AND school_id = ?
                FOR UPDATE`,
                [currentFee.payment_id, schoolId]
            );
            if (!existingPayment) throw new Error('Allocated payment record not found.');
        };
        const [[settledAllocation]] = await connection.query(
            `SELECT fp.id
            FROM fee_payment_allocations fpa
            JOIN fee_payments fp
                ON fp.id = fpa.payment_id
                AND fp.school_id = fpa.school_id
            WHERE fpa.student_fee_id = ?
                AND fpa.school_id = ?
                AND fp.status IN ('completed', 'paid')
            ORDER BY fp.id DESC
            LIMIT 1
            FOR UPDATE`,
            [currentFee.id, schoolId]
        );
        const hasSettledState =
            Number(currentFee.paid_amount || 0) > 0.005 ||
            ['paid', 'partial'].includes(currentFee.status) ||
            ['completed', 'paid'].includes(existingPayment?.status) ||
            Boolean(settledAllocation);
        if (hasSettledState) {
            const conflict = new Error(
                'Settled or partially paid fees require a refund/reversal workflow and cannot be edited.'
            );
            conflict.statusCode = 409;
            throw conflict;
        };
        if (existingPayment?.status === 'pending') {
            const conflict = new Error('A payment is already in progress for this fee.');
            conflict.statusCode = 409;
            throw conflict;
        };

        if (existingPayment?.status === 'failed') {
            const [supersededPayment] = await connection.query(
                `UPDATE fee_payments
                SET status = 'superseded'
                WHERE id = ? AND school_id = ? AND status = 'failed'`,
                [existingPayment.id, schoolId]
            );
            if (supersededPayment.affectedRows !== 1) {
                throw new Error('Failed payment state changed while the fee was being updated.');
            };
        } else if (
            existingPayment &&
            !['superseded', 'refunded'].includes(existingPayment.status)
        ) {
            const conflict = new Error('Linked payment history cannot be modified from this screen.');
            conflict.statusCode = 409;
            throw conflict;
        };

        const feeMonth = due_date.substring(0, 7);
        let paidAmount = 0;
        let paidAt = null;
        let paymentId = null;

        if (status === 'paid') {
            paidAmount = totalAmount;
            paidAt = new Date();
            const [paymentResult] = await connection.query(
                `INSERT INTO fee_payments
                (school_id, student_id, initiated_by_user_id, initiated_by_role, amount, payment_date, payment_method, receipt_no, status, created_at)
                VALUES (?, ?, ?, 'school_admin', ?, CURDATE(), ?, NULL, 'completed', NOW())`,
                [schoolId, currentFee.student_id, (req.user?.id || req.session.user?.id), totalAmount, manualPaymentMethod]
            );
            paymentId = paymentResult.insertId;
            const receiptNo = `RCP-${schoolId}-${new Date().getFullYear()}-${String(paymentId).padStart(8, '0')}`;
            const [receiptUpdate] = await connection.query(
                'UPDATE fee_payments SET receipt_no = ?, receipt_number = ? WHERE id = ?',
                [receiptNo, receiptNo, paymentId]
            );
            if (receiptUpdate.affectedRows !== 1) throw new Error('Failed to assign the payment receipt.');
            await connection.query(
                `INSERT INTO fee_payment_allocations
                (school_id, payment_id, student_fee_id, amount, created_at)
                VALUES (?, ?, ?, ?, NOW())
                ON DUPLICATE KEY UPDATE amount = VALUES(amount)`,
                [schoolId, paymentId, currentFee.id, totalAmount]
            );
        };

        const [feeUpdate] = await connection.query(
            `UPDATE student_fees 
            SET total_amount = ?, due_date = ?, fee_month = ?, status = ?, paid_amount = ?, paid_at = ?, payment_id = ?
            WHERE id = ? AND school_id = ?`,
            [totalAmount, due_date, feeMonth, status === 'overdue' ? 'pending' : status, paidAmount, paidAt, paymentId, id, schoolId]
        );
        if (feeUpdate.affectedRows !== 1) throw new Error('Fee record changed while it was being updated.');
        await connection.commit();

        req.flash('success', 'Fee record updated successfully');
        res.redirect('/schooladmin/fees');
    } catch (err) {
        if (connection) await connection.rollback();
        handleDbError(err, req, res, `/schooladmin/fees/${req.params.id}/edit`, 'Failed to update fee');
    } finally {
        if (connection) connection.release();
    };
};

exports.showGenerateForm = async (req, res) => {
    try {
        const schoolId = req.user?.school_id || req.session.user?.school_id;
        if (!schoolId) {
            req.flash('error', 'Session expired');
            return res.redirect('/login');
        };

        const [students] = await db.query(
            `SELECT s.id, u.first_name AS first_name, u.last_name AS last_name, c.class_name as className, c.section
            FROM students s
            JOIN users u ON s.user_id = u.id
            LEFT JOIN classes c ON s.class_id = c.id
            WHERE s.school_id = ? AND s.deleted_at IS NULL
            ORDER BY u.first_name ASC, u.last_name ASC`,
            [schoolId]
        );

        res.render('schoolAdmin/fees/generate', {
            title: 'Generate Student Fee',
            students,
            user: req.user || req.session.user
        });
    } catch (err) {
        handleDbError(err, req, res, '/schooladmin/fees', 'Failed to load generate form');
    };
};

exports.generateFee = async (req, res) => {
    try {
        const schoolId = req.user?.school_id || req.session.user?.school_id;
        if (!schoolId) {
            req.flash('error', 'Session expired');
            return res.redirect('/login');
        };

        const { student_id, fee_month } = req.body;
        if (!student_id || !fee_month || !/^\d{4}-\d{2}$/.test(fee_month)) {
            req.flash('error', 'Please select a valid student and fee month');
            return res.redirect('/schooladmin/fees/generate');
        };

        const [[student]] = await db.query(
            'SELECT class_id FROM students WHERE id = ? AND school_id = ? AND deleted_at IS NULL',
            [student_id, schoolId]
        );

        if (!student || !student.class_id) {
            req.flash('error', 'Student not found or not assigned to any class');
            return res.redirect('/schooladmin/fees/generate');
        };

        const [feeStructures] = await db.query(
            'SELECT id, amount FROM fee_structures WHERE class_id = ? AND school_id = ? ORDER BY id ASC',
            [student.class_id, schoolId]
        );

        if (!feeStructures.length) {
            req.flash('error', 'No fee structure set for this class. Please define a fee structure first.');
            return res.redirect('/schooladmin/fees/generate');
        };

        const totalStructureAmount = feeStructures.reduce((sum, s) => sum + parseFloat(s.amount), 0);
        const primaryStructureId = feeStructures[0].id;

        const [[existing]] = await db.query(
            'SELECT id FROM student_fees WHERE student_id = ? AND fee_month = ? AND school_id = ? AND fee_structure_id IS NOT NULL',
            [student_id, fee_month, schoolId]
        );
        if (existing) {
            req.flash('error', 'A fee record already exists for this student for the selected month.');
            return res.redirect('/schooladmin/fees/generate');
        };

        const dueDate = fee_month + '-10';
        await db.query(
            `INSERT INTO student_fees 
            (school_id, student_id, fee_structure_id, fee_month, due_date, total_amount, paid_amount, status, created_at)
            VALUES (?, ?, ?, ?, ?, ?, 0, 'pending', NOW())`,
            [schoolId, student_id, primaryStructureId, fee_month, dueDate, totalStructureAmount]
        );
        req.flash('success', 'Fee invoice generated successfully');
        res.redirect('/schooladmin/fees');
    } catch (err) {
        if (err.code === 'ER_DUP_ENTRY' || err.errno === 1062) {
            req.flash('error', 'A fee record already exists for this student for the selected month.');
            return res.redirect('/schooladmin/fees/generate');
        };
        handleDbError(err, req, res, '/schooladmin/fees/generate', 'Failed to generate fee');
    };
};

exports.showBulkGenerateForm = async (req, res) => {
    try {
        const schoolId = req.user?.school_id || req.session.user?.school_id;
        if (!schoolId) {
            req.flash('error', 'Session expired');
            return res.redirect('/login');
        };

        const [classes] = await db.query(
            `SELECT c.id, c.class_name as name, c.section, COUNT(s.id) as studentCount
            FROM classes c
            LEFT JOIN students s ON s.class_id = c.id AND s.deleted_at IS NULL AND s.status = 'active'
            WHERE c.school_id = ?
            GROUP BY c.id
            ORDER BY c.class_name ASC, c.section ASC`,
            [schoolId]
        );

        const [structures] = await db.query(
            'SELECT class_id, amount FROM fee_structures WHERE school_id = ?',
            [schoolId]
        );

        const structMap = {};
        structures.forEach(fs => {
            structMap[fs.class_id] = { amount: parseFloat(fs.amount) };
        });

        res.render('schoolAdmin/fees/bulkGenerate', {
            title: 'Bulk Generate Fees',
            classes,
            structMap,
            user: req.user || req.session.user
        });
    } catch (err) {
        handleDbError(err, req, res, '/schooladmin/fees', 'Failed to load bulk generate form');
    };
};

exports.bulkGenerateFee = async (req, res) => {
    try {
        const schoolId = req.user?.school_id || req.session.user?.school_id;
        if (!schoolId) {
            req.flash('error', 'Session expired');
            return res.redirect('/login');
        };

        const { class_id, fee_month } = req.body;
        if (!class_id || isNaN(parseInt(class_id)) || !fee_month || !/^\d{4}-\d{2}$/.test(fee_month)) {
            req.flash('error', 'Please select a valid class and fee month');
            return res.redirect('/schooladmin/fees/bulk-generate');
        };

        const [students] = await db.query(
            'SELECT id FROM students WHERE class_id = ? AND school_id = ? AND deleted_at IS NULL AND status = "active"',
            [class_id, schoolId]
        );

        if (students.length === 0) {
            req.flash('error', 'No active students found in the selected class');
            return res.redirect('/schooladmin/fees/bulk-generate');
        };

        const [feeStructures] = await db.query(
            'SELECT id, amount FROM fee_structures WHERE class_id = ? AND school_id = ? ORDER BY id ASC',
            [class_id, schoolId]
        );

        if (!feeStructures.length) {
            req.flash('error', 'No fee structure set for this class. Please define a fee structure first.');
            return res.redirect('/schooladmin/fees/bulk-generate');
        };

        const totalStructureAmount = feeStructures.reduce((sum, s) => sum + parseFloat(s.amount), 0);
        const primaryStructureId = feeStructures[0].id;

        const dueDate = fee_month + '-10';
        let count = 0;
        for (const student of students) {
            const [[existing]] = await db.query(
                'SELECT id FROM student_fees WHERE student_id = ? AND fee_month = ? AND school_id = ? AND fee_structure_id IS NOT NULL',
                [student.id, fee_month, schoolId]
            );
            if (!existing) {
                await db.query(
                    `INSERT INTO student_fees 
                    (school_id, student_id, fee_structure_id, fee_month, due_date, total_amount, paid_amount, status, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, 0, 'pending', NOW())`,
                    [schoolId, student.id, primaryStructureId, fee_month, dueDate, totalStructureAmount]
                );
                count++;
            };
        };

        req.flash('success', `Fee invoices generated for ${count} students successfully (skipped existing records).`);
        res.redirect('/schooladmin/fees');
    } catch (err) {
        handleDbError(err, req, res, '/schooladmin/fees/bulk-generate', 'Failed to bulk generate fees');
    };
};

exports.getFeeHistory = async (req, res) => {
    try {
        const schoolId = req.user?.school_id || req.session.user?.school_id;
        if (!schoolId) {
            req.flash('error', 'Session expired');
            return res.redirect('/login');
        };

        const studentId = req.params.studentId || req.query.student_id;
        const params = [schoolId];
        let historyWhere = 'fp.school_id = ?';

        if (studentId) {
            historyWhere += ' AND fp.student_id = ?';
            params.push(studentId);
        };

        const [payments] = await db.query(
            `SELECT fp.*, u.first_name AS first_name, u.last_name AS last_name, 
                COALESCE(
                    (SELECT GROUP_CONCAT(sf_alloc.fee_month SEPARATOR ', ')
                     FROM fee_payment_allocations fpa
                     JOIN student_fees sf_alloc ON sf_alloc.id=fpa.student_fee_id AND sf_alloc.school_id=fpa.school_id
                     WHERE fpa.payment_id=fp.id),
                    (SELECT GROUP_CONCAT(sf_legacy.fee_month SEPARATOR ', ')
                     FROM student_fees sf_legacy WHERE sf_legacy.payment_id=fp.id)
                ) AS fee_month
            FROM fee_payments fp
            JOIN students s ON fp.student_id = s.id
            JOIN users u ON s.user_id = u.id
            WHERE ${historyWhere}
            ORDER BY fp.created_at DESC`,
            params
        );

        res.render('schoolAdmin/fees/history', {
            title: 'Payment History',
            payments,
            user: req.user || req.session.user
        });
    } catch (err) {
        handleDbError(err, req, res, '/schooladmin/fees', 'Failed to load fee history');
    };
};

exports.getDashboard = async (req, res) => {
    try {
        const schoolId = req.user?.school_id || req.session.user?.school_id;
        if (!schoolId) { req.flash('error', 'Session expired'); return res.redirect('/login'); }

        const [[monthData]] = await db.query(
            `SELECT COALESCE(SUM(amount), 0) AS total, COUNT(*) AS count
            FROM fee_payments
            WHERE school_id = ? AND MONTH(payment_date) = MONTH(NOW()) AND YEAR(payment_date) = YEAR(NOW()) AND status = 'completed'`,
            [schoolId]
        );

        const [[outstanding]] = await db.query(
            `SELECT COALESCE(SUM(total_amount - paid_amount), 0) AS total
            FROM student_fees WHERE school_id = ? AND status != 'paid'`,
            [schoolId]
        );

        const [[overdue]] = await db.query(
            `SELECT COALESCE(SUM(total_amount - paid_amount), 0) AS total
            FROM student_fees WHERE school_id = ? AND status != 'paid' AND due_date < CURDATE()`,
            [schoolId]
        );

        const [recentPayments] = await db.query(
            `SELECT fp.id, fp.amount, fp.payment_method, fp.created_at,
                u.first_name, u.last_name
            FROM fee_payments fp
            JOIN students s ON fp.student_id = s.id
            JOIN users u ON s.user_id = u.id
            WHERE fp.school_id = ? AND fp.status IN ('completed', 'paid')
            ORDER BY fp.created_at DESC LIMIT 10`,
            [schoolId]
        );

        const [chartData] = await db.query(
            `SELECT DATE_FORMAT(payment_date, '%Y-%m') AS month,
                COALESCE(SUM(amount), 0) AS total
            FROM fee_payments
            WHERE school_id = ? AND status IN ('completed', 'paid') AND payment_date >= DATE_SUB(NOW(), INTERVAL 6 MONTH)
            GROUP BY DATE_FORMAT(payment_date, '%Y-%m')
            ORDER BY month ASC`,
            [schoolId]
        );

        res.render('schoolAdmin/fees/dashboard', {
            title: 'Fee Dashboard',
            stats: {
                collectedThisMonth: parseFloat(monthData.total),
                collectionCount: monthData.count,
                outstanding: parseFloat(outstanding.total),
                overdue: parseFloat(overdue.total)
            },
            recentPayments,
            chartData,
            user: req.user || req.session.user
        });
    } catch (err) {
        console.error('[FeeController getDashboard]', err);
        req.flash('error', 'Failed to load fee dashboard');
        res.redirect('/schooladmin/dashboard');
    };
};

exports.applyFeeWaiver = async (req, res) => {
    try {
        const schoolId = req.user?.school_id || req.session.user?.school_id;
        if (!schoolId) { req.flash('error', 'Session expired'); return res.redirect('/login'); };
        const { id } = req.params;
        const waiverAmount = parseFloat(req.body.waiver_amount);
        const waiverReason = (req.body.waiver_reason || '').trim();

        if (isNaN(waiverAmount) || waiverAmount <= 0) {
            req.flash('error', 'Enter a valid waiver amount');
            return res.redirect('/schooladmin/fees/pending');
        };

        const [[fee]] = await db.query(
            'SELECT * FROM student_fees WHERE id = ? AND school_id = ?',
            [id, schoolId]
        );
        if (!fee) { req.flash('error', 'Fee record not found'); return res.redirect('/schooladmin/fees/pending'); }

        const remaining = parseFloat(fee.total_amount) - parseFloat(fee.paid_amount || 0);
        if (waiverAmount > remaining + 0.01) {
            req.flash('error', `Waiver ₹${waiverAmount} cannot exceed remaining balance ₹${remaining.toFixed(2)}`);
            return res.redirect('/schooladmin/fees/pending');
        };

        const newTotal = parseFloat(fee.total_amount) - waiverAmount;
        const newStatus = newTotal <= parseFloat(fee.paid_amount || 0) + 0.01 ? 'paid' : fee.status;

        await db.query(
            `UPDATE student_fees
            SET total_amount = ?, waiver_amount = COALESCE(waiver_amount, 0) + ?,
                waiver_reason = ?, status = ?, updated_at = NOW()
            WHERE id = ? AND school_id = ?`,
            [newTotal, waiverAmount, waiverReason || null, newStatus, id, schoolId]
        );

        req.flash('success', `Waiver of ₹${waiverAmount.toFixed(2)} applied successfully`);
        res.redirect('/schooladmin/fees/pending');
    } catch (err) {
        console.error('[FeeController applyFeeWaiver]', err);
        req.flash('error', 'Failed to apply waiver');
        res.redirect('/schooladmin/fees/pending');
    };
};

exports.calculateLateFees = async (req, res) => {
    try {
        const schoolId = req.user?.school_id || req.session.user?.school_id;
        if (!schoolId) return res.status(401).json({ success: false, message: 'Session expired' });
        const perDay = parseFloat(req.body.late_fee_per_day) || 5;
        const maxFee = parseFloat(req.body.max_late_fee) || 500;

        if (perDay <= 0 || maxFee <= 0) {
            return res.status(400).json({ success: false, message: 'Invalid late fee values' });
        };

        const [overdueFees] = await db.query(
            `SELECT id, total_amount, DATEDIFF(CURDATE(), due_date) AS days_overdue
            FROM student_fees
            WHERE school_id = ? AND status != 'paid' AND due_date < CURDATE() AND late_fee_applied = 0`,
            [schoolId]
        );

        if (overdueFees.length === 0) {
            return res.json({ success: true, updated: 0, totalLateFeeAdded: 0 });
        };

        let totalAdded = 0;
        for (const fee of overdueFees) {
            const addition = Math.min(fee.days_overdue * perDay, maxFee);
            const newTotal = parseFloat(fee.total_amount) + addition;
            await db.query(
                `UPDATE student_fees SET total_amount = ?, late_fee_applied = 1, updated_at = NOW()
                WHERE id = ? AND school_id = ?`,
                [newTotal, fee.id, schoolId]
            );
            totalAdded += addition;
        };
        res.json({ success: true, updated: overdueFees.length, totalLateFeeAdded: totalAdded });
    } catch (err) {
        console.error('[FeeController calculateLateFees]', err);
        res.status(500).json({ success: false, message: 'Failed to calculate late fees' });
    };
};

exports.exportFeeReport = async (req, res) => {
    try {
        const schoolId = req.user?.school_id || req.session.user?.school_id;
        if (!schoolId) { req.flash('error', 'Session expired'); return res.redirect('/login'); }
        const month = req.query.month || new Date().toISOString().slice(0, 7);
        const format = req.query.format === 'pdf' ? 'pdf' : 'excel';

        const [payments] = await db.query(
            `SELECT fp.id, fp.receipt_no, fp.amount, fp.payment_method, fp.payment_date,
                u.first_name, u.last_name,
                c.class_name, c.section
            FROM fee_payments fp
            JOIN students s ON fp.student_id = s.id
            JOIN users u ON s.user_id = u.id
            LEFT JOIN classes c ON s.class_id = c.id
            WHERE fp.school_id = ? AND fp.status IN ('completed', 'paid') AND DATE_FORMAT(fp.payment_date, '%Y-%m') = ?
            ORDER BY fp.payment_date DESC`,
            [schoolId, month]
        );

        if (format === 'excel') {
            const ExcelJS = require('exceljs');
            const wb = new ExcelJS.Workbook();
            const ws = wb.addWorksheet('Fee Report');

            ws.columns = [
                { header: 'Receipt No', key: 'receipt', width: 15 },
                { header: 'Student', key: 'student', width: 25 },
                { header: 'Class', key: 'class', width: 15 },
                { header: 'Amount (₹)', key: 'amount', width: 12 },
                { header: 'Mode', key: 'mode', width: 15 },
                { header: 'Date', key: 'date', width: 15 },
            ];

            ws.getRow(1).font = { bold: true };
            ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF10B981' } };
            ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };

            payments.forEach(p => {
                ws.addRow({
                    receipt: p.receipt_no || `#${p.id}`,
                    student: `${p.first_name} ${p.last_name}`,
                    class: `${p.class_name || ''} ${p.section || ''}`.trim(),
                    amount: parseFloat(p.amount),
                    mode: p.payment_method || '—',
                    date: p.payment_date ? new Date(p.payment_date).toLocaleDateString('en-IN') : '—'
                });
            });

            ws.addRow({});
            const totalRow = ws.addRow({ student: 'TOTAL', amount: payments.reduce((s, p) => s + parseFloat(p.amount), 0) });
            totalRow.font = { bold: true };

            res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
            res.setHeader('Content-Disposition', `attachment; filename="fee-report-${month}.xlsx"`);
            await wb.xlsx.write(res);
            res.end();
        } else {
            const PDFDocument = require('pdfkit');
            const doc = new PDFDocument({ margin: 50 });
            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader('Content-Disposition', `attachment; filename="fee-report-${month}.pdf"`);
            doc.pipe(res);
            doc.fontSize(18).font('Helvetica-Bold').text('Fee Collection Report', 50, 40);
            doc.fontSize(11).font('Helvetica').text(`Month: ${month}`, 50, 68);
            doc.moveTo(50, 90).lineTo(550, 90).stroke();

            const headers = ['Receipt', 'Student', 'Class', 'Amount', 'Mode', 'Date'];
            const colX = [50, 120, 270, 340, 410, 470];
            let y = 105;

            doc.fontSize(9).font('Helvetica-Bold');
            headers.forEach((h, i) => doc.text(h, colX[i], y));
            y += 18;
            doc.moveTo(50, y).lineTo(550, y).stroke();
            y += 8;

            doc.font('Helvetica').fontSize(8);
            let grandTotal = 0;
            for (const p of payments) {
                if (y > 720) { doc.addPage(); y = 50; }
                doc.text(p.receipt_no || `#${p.id}`, colX[0], y, { width: 65 });
                doc.text(`${p.first_name} ${p.last_name}`, colX[1], y, { width: 145 });
                doc.text(`${p.class_name || ''} ${p.section || ''}`.trim(), colX[2], y, { width: 65 });
                doc.text(`₹${parseFloat(p.amount).toFixed(2)}`, colX[3], y, { width: 65 });
                doc.text(p.payment_method || '—', colX[4], y, { width: 55 });
                doc.text(p.payment_date ? new Date(p.payment_date).toLocaleDateString('en-IN') : '—', colX[5], y);
                grandTotal += parseFloat(p.amount);
                y += 16;
            }

            y += 10;
            doc.moveTo(50, y).lineTo(550, y).stroke();
            y += 10;
            doc.fontSize(10).font('Helvetica-Bold').text(`Grand Total: ₹${grandTotal.toFixed(2)}`, 340, y);
            doc.end();
        };
    } catch (err) {
        console.error('[FeeController exportFeeReport]', err);
        req.flash('error', 'Failed to export fee report');
        res.redirect('/schooladmin/fees/dashboard');
    };
};

exports.getStudentFeeView = async (req, res) => {
    try {
        const schoolId = req.user?.school_id || req.session?.user?.school_id;
        const userId = req.user?.id || req.session?.user?.id;
        if (!schoolId || !userId) {
            if (req.flash) req.flash('error', 'Session expired');
            return res.redirect('/login');
        };

        const [[student]] = await db.query(
            `SELECT s.id, s.roll_no, s.admission_no,
                c.class_name, c.section
            FROM students s
            LEFT JOIN classes c ON s.class_id = c.id
            WHERE s.user_id = ? AND s.school_id = ? AND s.deleted_at IS NULL
            LIMIT 1`,
            [userId, schoolId]
        );

        if (!student) {
            if (req.flash) req.flash('error', 'Student record not found');
            return res.redirect('/student/dashboard');
        };

        const [pendingFees] = await db.query(
            `SELECT sf.id, sf.total_amount, sf.total_amount AS amount, sf.paid_amount, sf.status,
                sf.due_date, sf.fee_month, sf.waiver_amount,
                COALESCE(fs.fee_name, 'School Fee') AS fee_name
            FROM student_fees sf
            LEFT JOIN fee_structures fs ON sf.fee_structure_id = fs.id
            WHERE sf.student_id = ? AND sf.school_id = ?
            ORDER BY sf.due_date ASC`,
            [student.id, schoolId]
        );

        const [payments] = await db.query(
            `SELECT fp.id, fp.amount, fp.payment_method,
                fp.receipt_no, fp.payment_date, fp.created_at,
                COALESCE(fs.fee_name, sf.fee_month, 'School Fee') AS fee_name
            FROM fee_payments fp
            LEFT JOIN student_fees sf ON sf.id = fp.student_fee_id
            LEFT JOIN fee_structures fs ON fs.id = sf.fee_structure_id
            WHERE fp.student_id = ? AND fp.school_id = ? AND fp.status IN ('completed', 'paid')
            ORDER BY fp.created_at DESC LIMIT 20`,
            [student.id, schoolId]
        );

        const totalPending = pendingFees
            .filter(f => f.status !== 'paid')
            .reduce((sum, f) => sum + parseFloat(f.total_amount - (f.paid_amount || 0)), 0);
        const totalPaid = payments
            .reduce((sum, p) => sum + parseFloat(p.amount), 0);
        const totalFees = pendingFees
            .reduce((sum, f) => sum + parseFloat(f.total_amount || 0), 0);
        const totalDiscount = pendingFees
            .reduce((sum, f) => sum + parseFloat(f.waiver_amount || 0), 0);
        const summary = {
            totalFees: totalFees.toFixed(2),
            totalPaid: totalPaid.toFixed(2),
            totalDiscount: totalDiscount.toFixed(2),
            pendingAmount: totalPending.toFixed(2)
        };

        res.render('student/fees', {
            title: 'My Fees',
            student,
            pendingFees,
            fees: pendingFees,
            payments,
            totalPending,
            totalPaid,
            summary,
            user: req.user || req.session?.user,
            layout: false
        });
    } catch (err) {
        console.error('[FeeController getStudentFeeView]', err);
        if (req.flash) req.flash('error', 'Failed to load fee details');
        res.redirect('/student/dashboard');
    };
};

exports.getPendingQrVerifications = async (req, res) => {
    try {
        const schoolId = req.user?.school_id || req.session.user?.school_id;
        if (!schoolId) {
            req.flash('error', 'Session expired');
            return res.redirect('/login');
        };

        const [pendingPayments] = await db.query(
            `SELECT fp.id, fp.amount, fp.transaction_id, fp.payment_reference, fp.created_at, fp.status, fp.proof_image,
                    s.id AS student_id, u.first_name, u.last_name, s.roll_no, c.class_name, c.section,
                    COALESCE(
                        (SELECT GROUP_CONCAT(sf_alloc.fee_month SEPARATOR ', ')
                         FROM fee_payment_allocations fpa
                         JOIN student_fees sf_alloc ON sf_alloc.id=fpa.student_fee_id AND sf_alloc.school_id=fpa.school_id
                         WHERE fpa.payment_id=fp.id AND sf_alloc.student_id=s.id),
                        (SELECT GROUP_CONCAT(sf_legacy.fee_month SEPARATOR ', ')
                         FROM student_fees sf_legacy
                         WHERE sf_legacy.payment_id=fp.id AND sf_legacy.student_id=s.id)
                    ) AS fee_name
            FROM fee_payments fp
            JOIN students s ON s.id = fp.student_id AND s.school_id = fp.school_id
            JOIN users u ON s.user_id = u.id
            LEFT JOIN classes c ON s.class_id = c.id
            WHERE fp.school_id = ? AND fp.payment_method = 'school_upi_qr' AND fp.status = 'pending_verification'
            ORDER BY fp.created_at DESC`,
            [schoolId]
        );

        res.render('schoolAdmin/fees/qr-verifications', {
            title: 'QR Payment Verification',
            pendingPayments,
            user: req.user || req.session.user
        });
    } catch (err) {
        handleDbError(err, req, res, '/schooladmin/dashboard', 'Failed to load QR payment verifications');
    };
};

exports.verifySchoolQrPayment = async (req, res) => {
    try {
        const schoolId = req.user?.school_id || req.session.user?.school_id;
        const { id } = req.params;
        if (!schoolId || !id) {
            req.flash('error', 'Invalid request parameters');
            return res.redirect('/schooladmin/fees/qr-verifications');
        };

        const { completeFeePayment } = require('../../services/feePaymentService');
        const result = await completeFeePayment({
            paymentId: Number(id),
            razorpayPaymentId: null,
            razorpaySignature: null
        });

        if (result.alreadyProcessed) {
            req.flash('info', 'This payment has already been verified and processed.');
            return res.redirect('/schooladmin/fees/qr-verifications');
        };

        const { payment, studentUser } = result;
        const NotificationService = require('../../services/notificationService');
        const templates = require('../../utils/notificationTemplates');

        if (studentUser) {
            NotificationService.createAndSend({
                recipient_id: studentUser.user_id,
                recipient_role: "student",
                school_id: schoolId,
                created_by: req.user?.id || null,
                ...templates.feePaidStudent(payment.amount, payment.id)
            }).catch(err => console.error("QR verify notification error student:", err));
        };

        if (payment.initiated_by_role === 'parent' && payment.initiated_by_user_id) {
            NotificationService.createAndSend({
                recipient_id: payment.initiated_by_user_id,
                recipient_role: "parent",
                school_id: schoolId,
                created_by: req.user?.id || null,
                title: "Fee Payment Verified",
                message: `Your QR payment of ₹${payment.amount} (Ref: ${payment.payment_reference || payment.transaction_id || payment.id}) was verified successfully. Receipt: ${payment.receipt_no}`,
                type: "info",
                category: "general",
                action_url: "/parent/fees"
            }).catch(err => console.error("QR verify notification error parent:", err));
        };

        req.flash('success', `QR Payment #${payment.id} verified successfully! Receipt: ${payment.receipt_no}`);
        res.redirect('/schooladmin/fees/qr-verifications');
    } catch (err) {
        handleDbError(err, req, res, '/schooladmin/fees/qr-verifications', err.message || 'Failed to verify QR payment');
    };
};

exports.rejectSchoolQrPayment = async (req, res) => {
    let connection;
    try {
        const schoolId = req.user?.school_id || req.session.user?.school_id;
        const { id } = req.params;
        const { rejection_reason } = req.body;
        if (!schoolId || !id) {
            req.flash('error', 'Invalid request parameters');
            return res.redirect('/schooladmin/fees/qr-verifications');
        };

        connection = await db.getConnection();
        await connection.beginTransaction();

        const [[payment]] = await connection.query(
            `SELECT * FROM fee_payments WHERE id = ? AND school_id = ? FOR UPDATE`,
            [Number(id), schoolId]
        );

        if (!payment || payment.status !== 'pending_verification') {
            await connection.rollback();
            req.flash('error', 'Payment record not found or not in pending verification status.');
            return res.redirect('/schooladmin/fees/qr-verifications');
        };

        await connection.query(
            `UPDATE fee_payments SET status = 'failed', remarks = ? WHERE id = ? AND school_id = ?`,
            [rejection_reason ? rejection_reason.trim() : 'Payment rejected by admin', payment.id, schoolId]
        );

        await connection.query(
            `UPDATE student_fees SET payment_id = NULL WHERE payment_id = ? AND school_id = ? AND status IN ('pending', 'partial')`,
            [payment.id, schoolId]
        );

        await connection.commit();

        const NotificationService = require('../../services/notificationService');
        if (payment.initiated_by_role === 'parent' && payment.initiated_by_user_id) {
            NotificationService.createAndSend({
                recipient_id: payment.initiated_by_user_id,
                recipient_role: "parent",
                school_id: schoolId,
                created_by: req.user?.id || null,
                title: "Fee Payment Request Rejected",
                message: `Your QR payment request of ₹${payment.amount} (Ref: ${payment.payment_reference || payment.transaction_id}) was rejected: ${rejection_reason || 'Verification failed'}. You may re-submit your payment.`,
                type: "warning",
                category: "general",
                action_url: "/parent/fees"
            }).catch(err => console.error("QR reject notification error parent:", err));
        };

        req.flash('success', `Payment #${payment.id} rejected.`);
        res.redirect('/schooladmin/fees/qr-verifications');
    } catch (err) {
        if (connection) await connection.rollback();
        handleDbError(err, req, res, '/schooladmin/fees/qr-verifications', 'Failed to reject payment');
    } finally {
        if (connection) connection.release();
    };
};