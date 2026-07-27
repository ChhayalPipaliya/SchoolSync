const db = require('../../config/database');
const bcrypt = require('bcryptjs');

function getSchoolId(req) {
    return req.user?.school_id || req.session?.user?.school_id || null;
};

async function getExistingLibraryAccount(schoolId, excludeLibrarianId = null, tx = db, forUpdate = false) {
    const params = [schoolId];
    let excludeSql = '';

    if (excludeLibrarianId) {
        excludeSql = ' AND l.id != ?';
        params.push(excludeLibrarianId);
    };

    const result = await tx.query(
        `SELECT l.id, l.library_id, l.status, u.first_name AS first_name, u.last_name AS last_name, u.email
        FROM librarians l
        JOIN users u ON l.user_id = u.id
        WHERE l.school_id = ? AND u.deleted_at IS NULL${excludeSql}
        LIMIT 1${forUpdate ? ' FOR UPDATE' : ''}`,
        params
    );
    const rows = Array.isArray(result?.[0]) ? result[0] : result;
    return Array.isArray(rows) ? rows[0] : null;
};

exports.listLibrarians = async (req, res) => {
    try {
        const schoolId = getSchoolId(req);
        const [librarians] = await db.query(
            `SELECT l.*, u.first_name as first_name, u.last_name as last_name, u.email, u.phone
            FROM librarians l
            JOIN users u ON l.user_id = u.id
            WHERE l.school_id = ? AND u.deleted_at IS NULL
            ORDER BY l.created_at DESC`,
            [schoolId]
        );

        res.render('schoolAdmin/librarians/index', {
            title: 'Librarians',
            librarians,
            hasLibraryAccount: librarians.length > 0,
            existingLibraryAccount: librarians[0] || null
        });
    } catch (err) {
        console.error(err);
        req.flash('error', 'Failed to load librarians');
        res.redirect('/schooladmin/dashboard');
    };
};

exports.showAddForm = async (req, res) => {
    try {
        const schoolId = getSchoolId(req);
        const existingLibrary = await getExistingLibraryAccount(schoolId);

        if (existingLibrary) {
            req.flash('error', 'This school already has one library account. Please edit the existing library account instead.');
            return res.redirect('/schooladmin/librarians');
        };
        res.render('schoolAdmin/librarians/add', { title: 'Add Librarian' });
    } catch (err) {
        console.error(err);
        req.flash('error', 'Failed to load add form');
        res.redirect('/schooladmin/librarians');
    };
};

exports.createLibrarian = async (req, res) => {
    try {
        const schoolId = getSchoolId(req);
        const { first_name, last_name, email, phone, password, employee_code, library_id, joining_date, status } = req.body;
        const existingLibrary = await getExistingLibraryAccount(schoolId);

        if (existingLibrary) {
            req.flash('error', 'Only one library is allowed per school. Please edit the existing library account.');
            return res.redirect('/schooladmin/librarians');
        };

        const [existing] = await db.query(
            'SELECT id FROM users WHERE email = ? AND deleted_at IS NULL LIMIT 1',
            [email]
        );

        if (existing.length > 0) {
            req.flash('error', 'Email is already registered');
            return res.redirect('/schooladmin/librarians/add');
        };

        const hashedPassword = await bcrypt.hash(password, 10);
        const libId = library_id || 'LIB-' + Math.floor(100000 + Math.random() * 900000);

        await db.withTransaction(async (tx) => {
            const duplicateLibrary = await getExistingLibraryAccount(schoolId, null, tx, true);
            if (duplicateLibrary) {
                throw new Error('LIBRARY_LIMIT_REACHED');
            };

            const userResult = await tx.query(
                `INSERT INTO users (school_id, first_name, last_name, email, phone, password, role, status)
                VALUES (?, ?, ?, ?, ?, ?, 'librarian', ?)`,
                [schoolId, first_name, last_name, email, phone || null, hashedPassword, status]
            );

            await tx.query(
                `INSERT INTO librarians (school_id, user_id, employee_code, library_id, joining_date, status, created_by)
                VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [schoolId, userResult.insertId, employee_code || null, libId, joining_date || null, status, (req.user?.id || req.session.user?.id)]
            );
        });

        req.flash('success', 'Librarian account created successfully');
        res.redirect('/schooladmin/librarians');
    } catch (err) {
        console.error(err);
        if (err.message === 'LIBRARY_LIMIT_REACHED') {
            req.flash('error', 'Only one library is allowed per school. Please edit the existing library account.');
            return res.redirect('/schooladmin/librarians');
        };
        req.flash('error', 'Failed to create librarian');
        res.redirect('/schooladmin/librarians/add');
    };
};

exports.showEditForm = async (req, res) => {
    try {
        const schoolId = getSchoolId(req);
        const { id } = req.params;

        const [[librarian]] = await db.query(
            `SELECT l.*, u.first_name as first_name, u.last_name as last_name, u.email, u.phone
            FROM librarians l
            JOIN users u ON l.user_id = u.id
            WHERE l.id = ? AND l.school_id = ? AND u.deleted_at IS NULL
            LIMIT 1`,
            [id, schoolId]
        );

        if (!librarian) {
            req.flash('error', 'Librarian not found');
            return res.redirect('/schooladmin/librarians');
        };

        res.render('schoolAdmin/librarians/edit', { title: 'Edit Librarian', librarian });
    } catch (err) {
        console.error(err);
        req.flash('error', 'Failed to load edit form');
        res.redirect('/schooladmin/librarians');
    };
};

exports.updateLibrarian = async (req, res) => {
    try {
        const schoolId = getSchoolId(req);
        const { id } = req.params;
        const { first_name, last_name, phone, employee_code, library_id, joining_date, status } = req.body;

        const [[librarian]] = await db.query(
            'SELECT user_id FROM librarians WHERE id = ? AND school_id = ? LIMIT 1',
            [id, schoolId]
        );

        if (!librarian) {
            req.flash('error', 'Librarian not found');
            return res.redirect('/schooladmin/librarians');
        };

        const duplicateLibrary = await getExistingLibraryAccount(schoolId, id);
        if (duplicateLibrary) {
            req.flash('error', 'Only one library is allowed per school. Please keep this school linked to a single library account.');
            return res.redirect('/schooladmin/librarians');
        };

        await db.withTransaction(async (tx) => {
            await tx.query(
                `UPDATE users SET first_name = ?, last_name = ?, phone = ?, status = ? WHERE id = ?`,
                [first_name, last_name, phone || null, status, librarian.user_id]
            );

            await tx.query(
                `UPDATE librarians SET employee_code = ?, library_id = ?, joining_date = ?, status = ?, updated_by = ?
            WHERE id = ? AND school_id = ?`,
                [employee_code || null, library_id || null, joining_date || null, status, (req.user?.id || req.session.user?.id), id, schoolId]
            );
        });

        req.flash('success', 'Librarian account updated successfully');
        res.redirect('/schooladmin/librarians');
    } catch (err) {
        console.error(err);
        req.flash('error', 'Failed to update librarian');
        res.redirect('/schooladmin/librarians');
    };
};

exports.deleteLibrarian = async (req, res) => {
    try {
        const schoolId = getSchoolId(req);
        const { id } = req.params;

        const [[librarian]] = await db.query(
            'SELECT id FROM librarians WHERE id = ? AND school_id = ? LIMIT 1',
            [id, schoolId]
        );

        if (!librarian) {
            req.flash('error', 'Librarian not found');
            return res.redirect('/schooladmin/librarians');
        };

        await db.withTransaction(async (tx) => {
            await tx.query(
                `UPDATE users SET deleted_at = NOW(), status = 'inactive' WHERE id = (SELECT user_id FROM librarians WHERE id = ? AND school_id = ?)`,
                [id, schoolId]
            );

            await tx.query(
                `UPDATE librarians SET status = 'inactive' WHERE id = ? AND school_id = ?`,
                [id, schoolId]
            );
        });

        req.flash('success', 'Librarian deleted successfully');
        res.redirect('/schooladmin/librarians');
    } catch (err) {
        console.error(err);
        req.flash('error', 'Failed to delete librarian');
        res.redirect('/schooladmin/librarians');
    };
};