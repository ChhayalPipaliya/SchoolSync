const { withTransaction, queryAsync } = require("../config/database");
const libraryModel = require("../models/libraryModel");

const DAY_MS = 24 * 60 * 60 * 1000;

const isoDate = (date = new Date()) => date.toISOString().split("T")[0];
const addDays = (days) => isoDate(new Date(Date.now() + Number(days) * DAY_MS));

const calculateLateFine = (dueDate, returnDate, finePerDay) => {
    const due = new Date(dueDate);
    const ret = new Date(returnDate || Date.now());
    const overdueDays = Math.max(0, Math.floor((ret - due) / DAY_MS));
    return {
        overdueDays,
        fine: Number((overdueDays * Number(finePerDay || 0)).toFixed(2))
    };
};

const upsertFine = async (query, {
    schoolId,
    issueId,
    userId,
    fineType,
    amount,
    paidAmount = 0,
    paymentDate = null,
    paymentMode = null,
    receiptNo = null,
    status = "pending",
    remarks = null,
    actorId
}) => {
    const finalAmount = Math.max(0, Number(amount || 0));
    if (finalAmount <= 0) return null;

    const existing = await query(
        `SELECT id, status FROM library_fines
        WHERE school_id=? AND issue_id=? AND fine_type=?
        LIMIT 1 FOR UPDATE`,
        [schoolId, issueId, fineType]
    );

    if (existing.length) {
        if (["paid", "waived"].includes(existing[0].status)) {
            return existing[0];
        };

        await query(`
            UPDATE library_fines
            SET amount=?, paid_amount=?, payment_date=?, payment_mode=?, receipt_no=?,
                status=?, remarks=?, updated_by=?
            WHERE id=? AND school_id=?
        `, [finalAmount, Math.min(Number(paidAmount || 0), finalAmount), paymentDate, paymentMode, receiptNo, status, remarks, actorId, existing[0].id, schoolId]);
        return existing[0];
    };

    const result = await query(`
        INSERT INTO library_fines
            (school_id, issue_id, user_id, fine_type, amount, paid_amount,
            payment_date, payment_mode, receipt_no, status, remarks, created_by, updated_by)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
    `, [schoolId, issueId, userId, fineType, finalAmount, Math.min(Number(paidAmount || 0), finalAmount), paymentDate, paymentMode, receiptNo, status, remarks, actorId, actorId]);
    return { id: result.insertId, status };
};

const updateOverdueStatus = (schoolId) => queryAsync(`
    UPDATE library_issues
    SET status='overdue'
    WHERE school_id=? AND status IN ('issued','renewed') AND due_date < CURDATE()
`, [schoolId]);

const ensureMember = async (query, { schoolId, userId, actorId }) => {
    const users = await query(
        "SELECT id, role FROM users WHERE id=? AND school_id=? AND role IN ('student','teacher') LIMIT 1",
        [userId, schoolId]
    );

    if (!users.length) {
        throw new Error("Selected member must be an active student or teacher in this school.");
    };

    let members = await query(
        "SELECT * FROM library_members WHERE user_id=? AND school_id=? LIMIT 1",
        [userId, schoolId]
    );

    if (!members.length) {
        const memberType = users[0].role;
        const libraryId = `${memberType === "student" ? "STU" : "TCH"}-${schoolId}-${userId}`;
        await query(`
            INSERT INTO library_members
                (school_id, user_id, member_type, library_id, created_by, updated_by)
            VALUES (?,?,?,?,?,?)
        `, [schoolId, userId, memberType, libraryId, actorId, actorId]);

        members = await query(
            "SELECT * FROM library_members WHERE user_id=? AND school_id=? LIMIT 1",
            [userId, schoolId]
        );
    };

    if (members[0].status !== "active") {
        throw new Error("This library member is inactive.");
    };

    return members[0];
};

const issueBook = ({ schoolId, bookId, userId, dueDays, remarks, actorId, req }) => withTransaction(async ({ query }) => {
    const settings = await libraryModel.getSettings(schoolId);
    const books = await query(
        "SELECT * FROM library_books WHERE id=? AND school_id=? AND status='active' FOR UPDATE",
        [bookId, schoolId]
    );

    if (!books.length || books[0].available_copies < 1) {
        throw new Error("Book is not available.");
    };

    const member = await ensureMember(query, { schoolId, userId, actorId });
    const limit = member.issue_limit || (member.member_type === "teacher" ? settings.teacher_issue_limit : settings.student_issue_limit);
    const activeCount = await query(
        "SELECT COUNT(*) AS c FROM library_issues WHERE school_id=? AND user_id=? AND status IN ('issued','overdue','renewed')",
        [schoolId, userId]
    );

    if (activeCount[0].c >= limit) {
        throw new Error(`Issue limit reached. This member can hold ${limit} book(s).`);
    };

    const duplicate = await query(
        "SELECT id FROM library_issues WHERE school_id=? AND book_id=? AND user_id=? AND status IN ('issued','overdue','renewed') LIMIT 1",
        [schoolId, bookId, userId]
    );
    if (duplicate.length) {
        throw new Error("This member already has this book issued.");
    };

    const days = Math.max(1, parseInt(dueDays, 10) || settings.default_due_days || 14);
    const issueDate = isoDate();
    const dueDate = addDays(days);
    const issue = await query(`
        INSERT INTO library_issues
            (school_id, book_id, user_id, member_id, issue_date, due_date, fine_per_day, status, remarks, issued_by, created_by, updated_by)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
    `, [schoolId, bookId, userId, member.id, issueDate, dueDate, settings.fine_per_day, "issued", remarks || null, actorId, actorId, actorId]);

    await query(
        "UPDATE library_books SET available_copies = available_copies - 1, updated_by=? WHERE id=? AND school_id=?",
        [actorId, bookId, schoolId]
    );

    await libraryModel.logActivity(query, {
        schoolId,
        actorId,
        action: "issue_book",
        entityType: "library_issue",
        entityId: issue.insertId,
        metadata: { book_id: bookId, user_id: userId, due_date: dueDate },
        req
    });

    return { issueId: issue.insertId, book: books[0], dueDate };
});

const returnBook = ({ schoolId, issueId, fineAmount, finePaid, remarks, actorId, req }) => withTransaction(async ({ query }) => {
    const issues = await query(
        "SELECT * FROM library_issues WHERE id=? AND school_id=? FOR UPDATE",
        [issueId, schoolId]
    );

    if (!issues.length || ["returned", "lost"].includes(issues[0].status)) {
        throw new Error("Issue record not found or already closed.");
    };

    const issue = issues[0];
    const returnDate = isoDate();
    const calculated = calculateLateFine(issue.due_date, returnDate, issue.fine_per_day);
    const finalFine = Number.isFinite(Number(fineAmount)) ? Number(fineAmount) : calculated.fine;

    await query(`
        UPDATE library_issues
        SET status='returned', return_date=?, fine_amount=?, fine_paid=?,
            remarks=?, returned_by=?, updated_by=?
        WHERE id=? AND school_id=?
    `, [returnDate, finalFine, finePaid ? 1 : 0, remarks || null, actorId, actorId, issueId, schoolId]);

    await query(
        "UPDATE library_books SET available_copies = available_copies + 1, updated_by=? WHERE id=? AND school_id=?",
        [actorId, issue.book_id, schoolId]
    );

    if (finalFine > 0) {
        const status = finePaid ? "paid" : "pending";
        await upsertFine(query, {
            schoolId,
            issueId,
            userId: issue.user_id,
            fineType: "late",
            amount: finalFine,
            paidAmount: finePaid ? finalFine : 0,
            paymentDate: finePaid ? returnDate : null,
            status,
            remarks: remarks || null,
            actorId
        });
    };

    await libraryModel.logActivity(query, {
        schoolId,
        actorId,
        action: "return_book",
        entityType: "library_issue",
        entityId: issueId,
        metadata: { fine_amount: finalFine, fine_paid: Boolean(finePaid) },
        req
    });
    return { fine: finalFine, overdueDays: calculated.overdueDays };
});

const renewIssue = ({ schoolId, issueId, actorId, req }) => withTransaction(async ({ query }) => {
    const settings = await libraryModel.getSettings(schoolId);
    const issues = await query(
        "SELECT * FROM library_issues WHERE id=? AND school_id=? FOR UPDATE",
        [issueId, schoolId]
    );

    if (!issues.length || !["issued", "overdue", "renewed"].includes(issues[0].status)) {
        throw new Error("Issue record cannot be renewed.");
    };

    if (issues[0].renewal_count >= settings.max_renewals) {
        throw new Error("Maximum renewals reached for this issue.");
    };

    const dueDate = addDays(settings.renewal_days);
    await query(`
        UPDATE library_issues
        SET due_date=?, renewal_count=renewal_count+1, status='renewed', updated_by=?
        WHERE id=? AND school_id=?
    `, [dueDate, actorId, issueId, schoolId]);

    await libraryModel.logActivity(query, {
        schoolId,
        actorId,
        action: "renew_book",
        entityType: "library_issue",
        entityId: issueId,
        metadata: { due_date: dueDate },
        req
    });

    return { dueDate };
});

const markLost = ({ schoolId, issueId, actorId, remarks, req }) => withTransaction(async ({ query }) => {
    const settings = await libraryModel.getSettings(schoolId);
    const issues = await query(`
        SELECT li.*, lb.price
        FROM library_issues li
        JOIN library_books lb ON lb.id = li.book_id
        WHERE li.id=? AND li.school_id=?
        FOR UPDATE
    `, [issueId, schoolId]);

    if (!issues.length || ["returned", "lost"].includes(issues[0].status)) {
        throw new Error("Issue record cannot be marked lost.");
    };

    const issue = issues[0];
    const lateFine = calculateLateFine(issue.due_date, null, issue.fine_per_day).fine;
    const bookPrice = Number(issue.price || 0);
    const fixedCharge = Number(settings.fixed_lost_book_charge || 0);
    let lostCharge = bookPrice;
    let totalFine = bookPrice + lateFine;

    if (settings.lost_book_charge_mode === "fixed") {
        lostCharge = fixedCharge;
        totalFine = lostCharge + lateFine;
    } else if (settings.lost_book_charge_mode === "book_price") {
        lostCharge = bookPrice;
        totalFine = lostCharge + lateFine;
    } else {
        lostCharge = bookPrice + lateFine;
        totalFine = lostCharge;
    };

    await query(`
        UPDATE library_issues
        SET status='lost', fine_amount=?, lost_charge=?, remarks=?, updated_by=?
        WHERE id=? AND school_id=?
    `, [lateFine, lostCharge, remarks || null, actorId, issueId, schoolId]);

    await upsertFine(query, {
        schoolId,
        issueId,
        userId: issue.user_id,
        fineType: "lost",
        amount: totalFine,
        status: "pending",
        remarks: remarks || null,
        actorId
    });

    await libraryModel.logActivity(query, {
        schoolId,
        actorId,
        action: "mark_lost",
        entityType: "library_issue",
        entityId: issueId,
        metadata: { lost_charge: lostCharge, late_fine: lateFine, total_fine: totalFine },
        req
    });

    return { lostCharge, lateFine, totalFine };
});

module.exports = { calculateLateFine, issueBook, markLost, renewIssue, returnBook, updateOverdueStatus };