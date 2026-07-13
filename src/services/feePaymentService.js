const db = require("../config/database");

const COMPLETED_STATUSES = new Set(["completed", "paid"]);
const CAPTURABLE_STATUSES = new Set(["pending", "failed"]);

function paymentError(message, statusCode = 400, code = "PAYMENT_ERROR") {
    const error = new Error(message);
    error.statusCode = statusCode;
    error.code = code;
    return error;
};

function normalizeFeeIds(feeIds) {
    const values = Array.isArray(feeIds) ? feeIds : [feeIds];
    const normalized = [...new Set(values.map(Number))].sort((left, right) => left - right);
    if (!normalized.length || normalized.some((id) => !Number.isSafeInteger(id) || id <= 0)) {
        throw paymentError("Select valid fee items.");
    };
    return normalized;
};

async function lockPayableFeeItems(connection, { feeIds, studentId, schoolId }) {
    const normalizedIds = normalizeFeeIds(feeIds);
    const fees = [];

    for (const feeId of normalizedIds) {
        const [[fee]] = await connection.query(
            `SELECT sf.*, fp.status AS allocated_payment_status
            FROM student_fees sf
            LEFT JOIN fee_payments fp ON fp.id = sf.payment_id
            WHERE sf.id = ?
                AND sf.student_id = ?
                AND sf.school_id = ?
                AND sf.status IN ('pending', 'partial')
            FOR UPDATE`,
            [feeId, studentId, schoolId]
        );
        if (!fee) {
            throw paymentError(`Fee item not found or already paid: ${feeId}`);
        };
        if (fee.payment_id && fee.allocated_payment_status === "pending") {
            throw paymentError(
                "A payment is already in progress for one or more selected fee items.",
                409,
                "FEE_ALREADY_ALLOCATED"
            );
        };
        fees.push(fee);
    };
    return fees;
};

async function recordFeePaymentAllocation(connection, { schoolId, paymentId, studentFeeId, amount }) {
    const allocationAmount = Number(amount);
    if (!Number.isFinite(allocationAmount) || allocationAmount <= 0) {
        throw paymentError("Fee allocation amount must be greater than zero.");
    };
    const [result] = await connection.query(
        `INSERT INTO fee_payment_allocations
        (school_id, payment_id, student_fee_id, amount, created_at)
        VALUES (?, ?, ?, ?, NOW())`,
        [schoolId, paymentId, studentFeeId, allocationAmount]
    );
    return result;
};

async function claimFeeItems(connection, { fees, paymentId, studentId, schoolId }) {
    for (const fee of fees) {
        if (fee.payment_id && fee.allocated_payment_status === "failed") {
            await connection.query(
                `UPDATE fee_payments
                SET status = 'superseded'
                WHERE id = ? AND school_id = ? AND status = 'failed'`,
                [fee.payment_id, schoolId]
            );
        };
        const [result] = await connection.query(
            `UPDATE student_fees
            SET payment_id = ?
            WHERE id = ?
                AND student_id = ?
                AND school_id = ?
                AND status IN ('pending', 'partial')
                AND (payment_id IS NULL OR payment_id = ?)`,
            [paymentId, fee.id, studentId, schoolId, fee.payment_id]
        );
        if (result.affectedRows !== 1) {
            throw paymentError(
                "A selected fee item was claimed by another payment.",
                409,
                "FEE_ALLOCATION_CONFLICT"
            );
        };
        await recordFeePaymentAllocation(connection, {
            schoolId,
            paymentId,
            studentFeeId: fee.id,
            amount: Number(fee.total_amount) - Number(fee.paid_amount || 0)
        });
    };
};

function buildReceiptNumber(payment, now = new Date()) {
    const year = now.getFullYear();
    return `RCP-${payment.school_id}-${year}-${String(payment.id).padStart(8, "0")}`;
};

function assertSamePaymentIdentity(payment, razorpayPaymentId) {
    if (
        payment.razorpay_payment_id &&
        razorpayPaymentId &&
        payment.razorpay_payment_id !== razorpayPaymentId
    ) {
        throw new Error("Payment record is already linked to a different Razorpay payment.");
    };
};

async function completeFeePaymentInTransaction(
    connection,
    { paymentId, razorpayPaymentId, razorpaySignature, now = new Date() }
) {
    const [[payment]] = await connection.query(
        "SELECT * FROM fee_payments WHERE id = ? FOR UPDATE",
        [paymentId]
    );

    if (!payment) {
        throw new Error("Payment record not found");
    };

    assertSamePaymentIdentity(payment, razorpayPaymentId);
    if (COMPLETED_STATUSES.has(payment.status)) {
        return { payment, studentUser: null, alreadyProcessed: true };
    };
    if (!CAPTURABLE_STATUSES.has(payment.status)) {
        throw new Error(`Payment cannot be completed from status "${payment.status}".`);
    };

    let [allocations] = await connection.query(
        `SELECT sf.id, sf.total_amount, sf.paid_amount, sf.status,
            fpa.amount AS allocated_amount
        FROM fee_payment_allocations fpa
        JOIN student_fees sf ON sf.id = fpa.student_fee_id
            AND sf.school_id = fpa.school_id
            AND sf.payment_id = fpa.payment_id
        WHERE fpa.payment_id = ? AND fpa.school_id = ? AND sf.status IN ('pending', 'partial')
        ORDER BY sf.id
        FOR UPDATE`,
        [payment.id, payment.school_id]
    );
    if (!allocations.length) {
        [allocations] = await connection.query(
            `SELECT id, total_amount, paid_amount, status,
                (total_amount - paid_amount) AS allocated_amount
            FROM student_fees
            WHERE payment_id = ? AND school_id = ? AND status IN ('pending', 'partial')
            ORDER BY id
            FOR UPDATE`,
            [payment.id, payment.school_id]
        );
    };
    if (!allocations.length) {
        throw new Error("Payment has no allocated fee items.");
    };

    const allocatedAmount = allocations.reduce(
        (sum, fee) => sum + Number(fee.allocated_amount),
        0
    );
    const expectedAmount = allocatedAmount - Number(payment.discount || 0);
    if (!Number.isFinite(expectedAmount) || Math.abs(Number(payment.amount) - expectedAmount) > 0.01) {
        throw new Error("Payment amount does not match its allocated fee items.");
    };

    const receiptNumber = buildReceiptNumber(payment, now);
    const [paymentUpdate] = await connection.query(
        `UPDATE fee_payments
        SET status = 'completed',
            payment_method = 'online',
            razorpay_payment_id = ?,
            razorpay_signature = ?,
            transaction_id = COALESCE(transaction_id, ?),
            receipt_no = ?,
            receipt_number = ?,
            paid_at = NOW(),
            payment_date = CURDATE()
        WHERE id = ? AND status IN ('pending', 'failed')`,
        [razorpayPaymentId, razorpaySignature, razorpayPaymentId, receiptNumber, receiptNumber, payment.id]
    );
    if (paymentUpdate.affectedRows !== 1) {
        throw new Error("Payment status changed while it was being completed.");
    };

    for (const allocation of allocations) {
        const newPaidAmount = Number(allocation.paid_amount || 0) + Number(allocation.allocated_amount);
        if (newPaidAmount > Number(allocation.total_amount) + 0.01) {
            throw new Error("A fee allocation exceeds the remaining fee balance.");
        };
        const newStatus = newPaidAmount >= Number(allocation.total_amount) - 0.01 ? "paid" : "partial";
        const [feeUpdate] = await connection.query(
            `UPDATE student_fees
            SET status = ?, paid_amount = ?, paid_at = NOW(), payment_id = ?
            WHERE id = ? AND school_id = ?`,
            [newStatus, newPaidAmount, payment.id, allocation.id, payment.school_id]
        );
        if (feeUpdate.affectedRows !== 1) {
            throw new Error("Not every allocated fee item was completed.");
        };
    };

    const [[studentUser]] = await connection.query(
        `SELECT s.id, u.id AS user_id, u.first_name, u.last_name, u.email
        FROM students s
        JOIN users u ON s.user_id = u.id
        WHERE s.id = ? AND s.school_id = ?`,
        [payment.student_id, payment.school_id]
    );

    return {
        payment: { ...payment, status: "completed", receipt_no: receiptNumber, receipt_number: receiptNumber },
        studentUser: studentUser || null,
        alreadyProcessed: false
    };
};

async function completeFeePayment({ paymentId, razorpayPaymentId, razorpaySignature }) {
    const connection = await db.getConnection();
    try {
        await connection.beginTransaction();
        const result = await completeFeePaymentInTransaction(connection, {
            paymentId,
            razorpayPaymentId,
            razorpaySignature
        });
        await connection.commit();
        return result;
    } catch (error) {
        await connection.rollback();
        throw error;
    } finally {
        connection.release();
    };
};

module.exports = {
    claimFeeItems,
    completeFeePayment,
    lockPayableFeeItems,
    normalizeFeeIds,
    recordFeePaymentAllocation,
    _test: Object.freeze({
        buildReceiptNumber,
        claimFeeItems,
        completeFeePaymentInTransaction,
        lockPayableFeeItems,
        normalizeFeeIds
    })
};
