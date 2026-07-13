const db = require('../../config/database');

exports.listSchoolTypes = async (req, res) => {
    try {
        const [schoolTypes] = await db.query(`
            SELECT st.*,
                    COUNT(stm.id) AS class_count
            FROM   school_types st
            LEFT JOIN school_type_mappings stm ON stm.school_type_id = st.id
            GROUP BY st.id
            ORDER BY st.sort_order ASC, st.type_name ASC
        `);

        res.render('superAdmin/schoolTypes/index', {
            title: 'School Types',
            schoolTypes,
            currentPath: req.path,
            user: req.user
        });
    } catch (err) {
        console.error('listSchoolTypes Error:', err);
        req.flash('error', 'Failed to load school types');
        res.redirect('/superadmin/dashboard');
    };
};

exports.detailSchoolType = async (req, res) => {
    try {
        const { id } = req.params;
        const [[schoolType]] = await db.query(
            'SELECT * FROM school_types WHERE id = ?',
            [id]
        );
        if (!schoolType) {
            req.flash('error', 'School type not found');
            return res.redirect('/superadmin/school-types');
        };

        const [classMappings] = await db.query(
            `SELECT * FROM school_type_mappings
            WHERE school_type_id = ?
            ORDER BY sort_order ASC`,
            [id]
        );

        const [[{ schoolCount }]] = await db.query(
            `SELECT COUNT(*) AS schoolCount FROM schools WHERE school_type_id = ?`,
            [id]
        );

        res.render('superAdmin/schoolTypes/detail', {
            title: `School Type – ${schoolType.type_name}`,
            schoolType,
            classMappings,
            schoolCount,
            currentPath: req.path,
            user: req.user
        });
    } catch (err) {
        console.error('detailSchoolType Error:', err);
        req.flash('error', 'Failed to load school type details');
        res.redirect('/superadmin/school-types');
    };
};

exports.createSchoolType = async (req, res) => {
    try {
        const { type_key, type_name, description, sort_order } = req.body;
        const [[existing]] = await db.query(
            'SELECT id FROM school_types WHERE type_key = ?',
            [type_key]
        );
        if (existing) {
            req.flash('error', 'School type key already exists');
            return res.redirect('/superadmin/school-types');
        };

        const [result] = await db.query(
            `INSERT INTO school_types (type_key, type_name, description, sort_order)
            VALUES (?, ?, ?, ?)`,
            [type_key, type_name, description || null, parseInt(sort_order) || 0]
        );

        req.flash('success', `School type "${type_name}" created`);
        res.redirect('/superadmin/school-types');
    } catch (err) {
        console.error('createSchoolType Error:', err);
        req.flash('error', 'Failed to create school type');
        res.redirect('/superadmin/school-types');
    };
};

exports.toggleSchoolType = async (req, res) => {
    try {
        const { id } = req.params;
        await db.query(
            'UPDATE school_types SET is_active = NOT is_active WHERE id = ?',
            [id]
        );
        req.flash('success', 'School type status updated');
        res.redirect('/superadmin/school-types');
    } catch (err) {
        console.error('toggleSchoolType Error:', err);
        req.flash('error', 'Failed to update status');
        res.redirect('/superadmin/school-types');
    };
};

exports.addMapping = async (req, res) => {
    try {
        const {id} = req.params;
        const {class_name, class_code, sort_order } = req.body;

        const [[st]] = await db.query('SELECT id FROM school_types WHERE id = ?', [id]);
        if (!st) {
            req.flash('error', 'School type not found');
            return res.redirect('/superadmin/school-types');
        };

        await db.query(
            `INSERT IGNORE INTO school_type_mappings (school_type_id, class_name, class_code, sort_order)
            VALUES (?, ?, ?, ?)`,
            [id, class_name, class_code.toUpperCase(), parseInt(sort_order) || 0]
        );

        req.flash('success', `Class "${class_name}" added to school type`);
        res.redirect(`/superadmin/school-types/${id}`);
    } catch (err) {
        console.error('addMapping Error:', err);
        req.flash('error', 'Failed to add class mapping');
        res.redirect(`/superadmin/school-types/${req.params.id}`);
    };
};