const QRCode = require('qrcode');
const db = require('../../config/database');
const razorpayConfig = require('../../config/razorpay');
const { canAccessStudent, createParentStudentService } = require('../../services/parentStudentService');
const { claimFeeItems, lockPayableFeeItems, normalizeFeeIds } = require('../../services/feePaymentService');

async function verifyParentStudentLink(parentUserId, schoolId, studentId, database = db) {
    const checker = database === db
        ? canAccessStudent
        : createParentStudentService(database).canAccessStudent;
    return checker({ parentUserId, schoolId, studentId });
};

exports.createOrder = async (req, res, next) => {
    let connection;
    try {
        const parentUserId = req.user?.id;
        const schoolId = req.user?.school_id;
        if (!parentUserId || !schoolId) {
            return res.status(401).json({ success: false, message: 'Session expired' });
        };
        if (!razorpayConfig.isConfigured || !razorpayConfig.instance) {
            return res.status(503).json({ success: false, message: 'Payment gateway is not configured. Please contact support.' });
        };

        const { studentId, fee_ids } = req.body;
        if (!studentId || !fee_ids) {
            return res.status(400).json({ success: false, message: 'Missing studentId or fee_ids' });
        };

        const feeIds = normalizeFeeIds(fee_ids);
        connection = await db.getConnection();
        await connection.beginTransaction();
        const isLinked = await verifyParentStudentLink(parentUserId, schoolId, studentId, connection);
        if (!isLinked) {
            await connection.rollback();
            return res.status(403).json({ success: false, message: 'Access Denied: Student is not linked to your account' });
        };

        const fees = await lockPayableFeeItems(connection, { feeIds, studentId, schoolId });
        const totalPending = fees.reduce(
            (sum, fee) => sum + Number(fee.total_amount) - Number(fee.paid_amount || 0),
            0
        );

        let finalAmount = totalPending;
        const requestedAmount = parseFloat(req.body.amount || req.body.custom_amount || req.body.installment_amount);
        if (!isNaN(requestedAmount) && requestedAmount > 0) {
            if (requestedAmount > totalPending + 0.01) {
                await connection.rollback();
                return res.status(400).json({
                    success: false,
                    message: `Payment amount (₹${requestedAmount.toFixed(2)}) cannot exceed total pending balance (₹${totalPending.toFixed(2)})`
                });
            };
            finalAmount = requestedAmount;
        };

        if (finalAmount <= 0) {
            await connection.rollback();
            return res.status(400).json({ success: false, message: 'Amount must be greater than zero' });
        };

        const feeAmounts = {};
        if (fees.length === 1) {
            feeAmounts[fees[0].id] = finalAmount;
        } else {
            let rem = finalAmount;
            fees.forEach((f, i) => {
                const itemPending = Number(f.total_amount) - Number(f.paid_amount || 0);
                const alloc = i === fees.length - 1 ? rem : Math.min(rem, itemPending);
                feeAmounts[f.id] = alloc;
                rem = Math.max(0, rem - alloc);
            });
        };

        const STALE_PAYMENT_THRESHOLD_MS = 30 * 60 * 1000;
        const now = Date.now();

        const activePendingPayments = fees
            .filter(f => f.payment_id && f.allocated_payment_status === 'pending' && f.allocated_payment_created_at && (now - new Date(f.allocated_payment_created_at).getTime() <= STALE_PAYMENT_THRESHOLD_MS))
            .map(f => ({
                id: f.payment_id,
                orderId: f.allocated_razorpay_order_id,
                userId: f.allocated_user_id,
                amount: f.allocated_payment_amount
            }));

        const uniquePendingIds = [...new Set(activePendingPayments.map(p => p.id))];

        if (uniquePendingIds.length === 1 && activePendingPayments.length === fees.length && Math.abs(Number(activePendingPayments[0].amount) - finalAmount) < 0.01) {
            const existing = activePendingPayments[0];
            if (existing.orderId && String(existing.userId) === String(parentUserId)) {
                await connection.commit();
                return res.json({
                    success: true,
                    data: {
                        order_id: existing.orderId,
                        amount: Math.round(Number(existing.amount) * 100),
                        currency: 'INR',
                        payment_id: existing.id,
                        key_id: razorpayConfig.keyId,
                        reused: true
                    }
                });
            }
        }

        const receiptId = `rcpt_${studentId}_${Date.now()}`;
        const order = await razorpayConfig.instance.orders.create({
            amount: Math.round(finalAmount * 100),
            currency: 'INR',
            receipt: receiptId
        });

        const [payment] = await connection.query(
            `INSERT INTO fee_payments 
            (school_id, student_id, initiated_by_user_id, initiated_by_role, amount, status, payment_method, razorpay_order_id, created_at)
            VALUES (?, ?, ?, 'parent', ?, 'pending', 'online', ?, NOW())`,
            [schoolId, studentId, req.user.id, finalAmount, order.id]
        );

        await claimFeeItems(connection, {
            fees,
            paymentId: payment.insertId,
            studentId,
            schoolId,
            feeAmounts
        });

        await connection.commit();
        res.json({
            success: true,
            data: {
                order_id: order.id,
                amount: order.amount,
                currency: order.currency,
                payment_id: payment.insertId,
                key_id: razorpayConfig.keyId
            }
        });
    } catch (err) {
        if (connection) await connection.rollback();
        console.error("Parent Razorpay createOrder Error:", err);
        res.status(err.statusCode || 500).json({ success: false, message: err.message || 'Failed to create payment order' });
    } finally {
        if (connection) connection.release();
    };
};

exports.generateQRCode = async (req, res, next) => {
    let connection;
    try {
        const parentUserId = req.user?.id;
        const schoolId = req.user?.school_id;
        if (!parentUserId || !schoolId) {
            return res.status(401).json({ success: false, message: 'Session expired' });
        };
        if (!razorpayConfig.isConfigured || !razorpayConfig.instance) {
            return res.status(503).json({ success: false, message: 'Payment gateway is not configured. Please contact support.' });
        };

        const { paymentId } = req.params;
        if (!paymentId) {
            return res.status(400).json({ success: false, message: 'Payment ID is required' });
        };

        connection = await db.getConnection();
        await connection.beginTransaction();
        const [[payment]] = await connection.query(
            `SELECT fp.*
            FROM fee_payments fp
            JOIN students s
                ON s.id = fp.student_id
                AND s.school_id = fp.school_id
            JOIN student_family sf
                ON sf.student_id = s.id
                AND sf.school_id = s.school_id
            WHERE fp.id = ?
                AND fp.school_id = ?
                AND fp.status = 'pending'
                AND fp.initiated_by_user_id = ?
                AND fp.initiated_by_role = 'parent'
                AND sf.parent_user_id = ?
                AND s.parent_portal_enabled = 1
                AND s.status = 'active'
                AND s.deleted_at IS NULL
            FOR UPDATE`,
            [paymentId, schoolId, parentUserId, parentUserId]
        );
        if (!payment) {
            await connection.rollback();
            return res.status(404).json({ success: false, message: 'Pending payment record not found' });
        };
        if (payment.razorpay_qr_id) {
            let existingQrImage = null;
            try {
                const fetchedQr = await razorpayConfig.instance.qrCode.fetch(payment.razorpay_qr_id);
                existingQrImage = fetchedQr?.image_url || null;
            } catch (qrFetchErr) {
                console.warn("[generateQRCode] Failed to fetch existing QR code from Razorpay:", qrFetchErr.message);
            }
            await connection.commit();
            return res.json({
                success: true,
                data: {
                    qr_id: payment.razorpay_qr_id,
                    image_url: existingQrImage,
                    payment_id: payment.id,
                    amount: payment.amount,
                    order_id: payment.razorpay_order_id || payment.razorpay_qr_id
                }
            });
        };

        let qrCodeId = null;
        let qrImageUrl = null;

        try {
            const rzpQr = await razorpayConfig.instance.qrCode.create({
                type: "upi_qr",
                name: `SchoolSync Fee #${payment.id}`,
                usage: "single_use",
                fixed_amount: true,
                payment_amount: Math.round(payment.amount * 100),
                description: `SchoolSync Fee Payment #${payment.id}`
            });
            qrCodeId = rzpQr.id;
            qrImageUrl = rzpQr.image_url;
        } catch (qrCreateError) {
            console.warn("[generateQRCode] Razorpay dynamic QR unavailable, generating fallback UPI QR code:", qrCreateError.message || qrCreateError);
            qrCodeId = `upi_qr_${payment.id}_${Date.now()}`;
            const schoolVpa = process.env.SCHOOL_UPI_VPA || 'schoolsync@upi';
            const payeeName = 'SchoolSync Fees';
            const upiString = `upi://pay?pa=${encodeURIComponent(schoolVpa)}&pn=${encodeURIComponent(payeeName)}&am=${Number(payment.amount).toFixed(2)}&cu=INR&tn=${encodeURIComponent(`Fee Payment #${payment.id}`)}&tr=${payment.id}`;
            qrImageUrl = await QRCode.toDataURL(upiString, {
                width: 300,
                margin: 2,
                color: { dark: '#1E293B', light: '#FFFFFF' }
            });
        };

        const [paymentUpdate] = await connection.query(
            `UPDATE fee_payments SET razorpay_qr_id = ?
            WHERE id = ? AND school_id = ? AND initiated_by_user_id = ?
                AND initiated_by_role = 'parent' AND status = 'pending' AND razorpay_qr_id IS NULL`,
            [qrCodeId, payment.id, schoolId, parentUserId]
        );
        if (paymentUpdate.affectedRows !== 1) {
            throw new Error('Payment changed while its QR code was being generated.');
        };
        await connection.commit();

        res.json({
            success: true,
            data: {
                qr_id: qrCodeId,
                image_url: qrImageUrl,
                payment_id: payment.id,
                amount: payment.amount,
                order_id: payment.razorpay_order_id || qrCodeId
            }
        });
    } catch (err) {
        if (connection) await connection.rollback();
        console.error("Parent Razorpay generateQRCode Error:", err);
        res.status(err.statusCode || 500).json({ success: false, message: err.message || 'Failed to generate QR Code' });
    } finally {
        if (connection) connection.release();
    };
};

exports.getPaymentStatus = async (req, res, next) => {
    try {
        const parentUserId = req.user?.id;
        const schoolId = req.user?.school_id;
        const { paymentId } = req.params;

        if (!parentUserId || !schoolId) {
            return res.status(401).json({ success: false, message: 'Session expired' });
        };

        const numericPaymentId = Number(paymentId);
        if (!Number.isSafeInteger(numericPaymentId) || numericPaymentId <= 0) {
            return res.status(400).json({ success: false, message: 'Invalid payment ID' });
        };

        const [[payment]] = await db.query(
            `SELECT fp.id, fp.status, fp.receipt_no, fp.receipt_number, fp.amount
            FROM fee_payments fp
            JOIN students s ON s.id = fp.student_id AND s.school_id = fp.school_id
            JOIN student_family sf ON sf.student_id = s.id AND sf.school_id = s.school_id
            WHERE fp.id = ? AND fp.school_id = ? AND sf.parent_user_id = ?
            LIMIT 1`,
            [numericPaymentId, schoolId, parentUserId]
        );

        if (!payment) {
            return res.status(404).json({ success: false, message: 'Payment record not found' });
        };

        let normalizedStatus = 'PENDING';
        if (['completed', 'paid'].includes(payment.status)) {
            normalizedStatus = 'SUCCESS';
        } else if (payment.status === 'failed') {
            normalizedStatus = 'FAILED';
        } else if (payment.status === 'superseded') {
            normalizedStatus = 'EXPIRED';
        };

        res.json({
            success: true,
            status: normalizedStatus,
            payment_id: payment.id,
            receipt_no: payment.receipt_no || payment.receipt_number || null,
            receipt_url: `/parent/fees/receipts/${payment.id}`,
            amount: payment.amount
        });
    } catch (err) {
        console.error("Parent getPaymentStatus Error:", err);
        res.status(500).json({ success: false, message: 'Failed to retrieve payment status' });
    };
};

exports.initiateSchoolQrPayment = async (req, res, next) => {
    let connection;
    try {
        const parentUserId = req.user?.id;
        const schoolId = req.user?.school_id;
        if (!parentUserId || !schoolId) {
            return res.status(401).json({ success: false, message: 'Session expired' });
        };

        const { studentId, fee_ids } = req.body;
        if (!studentId || !fee_ids) {
            return res.status(400).json({ success: false, message: 'Missing studentId or fee_ids' });
        };

        connection = await db.getConnection();
        await connection.beginTransaction();

        const isLinked = await verifyParentStudentLink(parentUserId, schoolId, studentId, connection);
        if (!isLinked) {
            await connection.rollback();
            return res.status(403).json({ success: false, message: 'Access Denied: Student is not linked to your account' });
        };

        const [[schoolInfo]] = await connection.query(
            'SELECT upi_qr_enabled, upi_qr_image, upi_id FROM schools WHERE id = ? FOR UPDATE',
            [schoolId]
        );

        if (!schoolInfo || !schoolInfo.upi_qr_enabled || !schoolInfo.upi_qr_image) {
            await connection.rollback();
            return res.status(403).json({ success: false, message: 'School UPI QR payment is not enabled or configured.' });
        };

        const feeIds = normalizeFeeIds(fee_ids);
        const fees = await lockPayableFeeItems(connection, { feeIds, studentId, schoolId });
        const totalPending = fees.reduce(
            (sum, fee) => sum + Number(fee.total_amount) - Number(fee.paid_amount || 0),
            0
        );

        let finalAmount = totalPending;
        const requestedAmount = parseFloat(req.body.amount || req.body.custom_amount || req.body.installment_amount);
        if (!isNaN(requestedAmount) && requestedAmount > 0) {
            if (requestedAmount > totalPending + 0.01) {
                await connection.rollback();
                return res.status(400).json({
                    success: false,
                    message: `Payment amount (₹${requestedAmount.toFixed(2)}) cannot exceed total pending balance (₹${totalPending.toFixed(2)})`
                });
            };
            finalAmount = requestedAmount;
        };

        if (finalAmount <= 0) {
            await connection.rollback();
            return res.status(400).json({ success: false, message: 'Amount must be greater than zero' });
        };

        const feeAmounts = {};
        if (fees.length === 1) {
            feeAmounts[fees[0].id] = finalAmount;
        } else {
            let rem = finalAmount;
            fees.forEach((f, i) => {
                const itemPending = Number(f.total_amount) - Number(f.paid_amount || 0);
                const alloc = i === fees.length - 1 ? rem : Math.min(rem, itemPending);
                feeAmounts[f.id] = alloc;
                rem = Math.max(0, rem - alloc);
            });
        };

        const now = new Date();
        const datePart = now.toISOString().slice(0, 10).replace(/-/g, '');
        const randomPart = String(Math.floor(100000 + Math.random() * 900000));
        const paymentReference = `SCHOOLSYNC-FEE-${datePart}-${randomPart}`;

        const [payment] = await connection.query(
            `INSERT INTO fee_payments 
            (school_id, student_id, initiated_by_user_id, initiated_by_role, amount, status, payment_method, transaction_id, payment_reference, created_at)
            VALUES (?, ?, ?, 'parent', ?, 'pending_verification', 'school_upi_qr', ?, ?, NOW())`,
            [schoolId, studentId, parentUserId, finalAmount, paymentReference, paymentReference]
        );

        await claimFeeItems(connection, {
            fees,
            paymentId: payment.insertId,
            studentId,
            schoolId,
            feeAmounts
        });

        await connection.commit();

        res.json({
            success: true,
            data: {
                payment_id: payment.insertId,
                amount: finalAmount,
                payment_reference: paymentReference,
                upi_id: schoolInfo.upi_id || 'N/A',
                qr_image_url: schoolInfo.upi_qr_image
            }
        });
    } catch (err) {
        if (connection) await connection.rollback();
        console.error("Parent initiateSchoolQrPayment Error:", err);
        res.status(err.statusCode || 500).json({ success: false, message: err.message || 'Failed to initiate School QR Payment' });
    } finally {
        if (connection) connection.release();
    };
};

exports.submitSchoolQrPayment = async (req, res, next) => {
    try {
        const parentUserId = req.user?.id;
        const schoolId = req.user?.school_id;
        const { paymentId, utrNumber } = req.body;

        if (!parentUserId || !schoolId || !paymentId) {
            return res.status(400).json({ success: false, message: 'Missing paymentId or session' });
        };

        const numericPaymentId = Number(paymentId);
        const [[payment]] = await db.query(
            `SELECT fp.*, s.first_name, s.last_name
            FROM fee_payments fp
            JOIN students s ON s.id = fp.student_id AND s.school_id = fp.school_id
            JOIN student_family sf ON sf.student_id = s.id AND sf.school_id = s.school_id
            WHERE fp.id = ? AND fp.school_id = ? AND sf.parent_user_id = ? AND fp.payment_method = 'school_upi_qr'
            LIMIT 1`,
            [numericPaymentId, schoolId, parentUserId]
        );

        if (!payment) {
            return res.status(404).json({ success: false, message: 'Pending QR payment record not found' });
        };

        let proofImagePath = null;
        if (req.file) {
            proofImagePath = `/uploads/schoolAdmin/${req.file.filename}`;
        };

        await db.query(
            `UPDATE fee_payments 
            SET status = 'pending_verification', 
                transaction_id = COALESCE(?, transaction_id), 
                proof_image = COALESCE(?, proof_image)
            WHERE id = ? AND school_id = ?`,
            [utrNumber ? utrNumber.trim() : null, proofImagePath, payment.id, schoolId]
        );

        const NotificationService = require('../../services/notificationService');
        const studentName = `${payment.first_name || ''} ${payment.last_name || ''}`.trim() || 'a student';
        NotificationService.notifyAdmins(
            schoolId,
            {
                title: 'New QR Fee Payment Submitted',
                message: `Parent submitted QR fee payment of ₹${payment.amount} for ${studentName}. Reference: ${payment.payment_reference || payment.transaction_id || payment.id}. Requires verification.`
            },
            null
        ).catch(err => console.error("Admin QR payment submit notification error:", err));

        res.json({
            success: true,
            message: 'Payment submitted successfully! School Admin will verify your transaction.',
            payment_id: payment.id,
            payment_reference: payment.payment_reference || payment.transaction_id
        });
    } catch (err) {
        console.error("Parent submitSchoolQrPayment Error:", err);
        res.status(500).json({ success: false, message: 'Failed to submit payment confirmation' });
    };
};

exports._test = Object.freeze({ verifyParentStudentLink });
