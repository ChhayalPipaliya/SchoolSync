const db = require('../../config/database');
const { logSchoolActivity } = require('../../utils/auditLogger');

function getSchoolId(req) {
    return req.user?.school_id || req.session?.user?.school_id || null;
}

exports.getMediums = async (req, res) => {
    try {
        const schoolId = getSchoolId(req);
        const [allMediums] = await db.query(
            'SELECT * FROM mediums WHERE is_active = 1 ORDER BY sort_order ASC'
        );

        const [schoolMediums] = await db.query(
            'SELECT * FROM school_mediums WHERE school_id = ? ORDER BY is_primary DESC',
            [schoolId]
        );

        const selectedCodes = schoolMediums.map(m => m.medium_code);
        res.render('schoolAdmin/settings/mediums', {
            title: 'Medium Settings',
            allMediums,
            schoolMediums,
            selectedCodes,
            currentPath: req.path,
            user: req.user
        });
    } catch (err) {
        console.error('getMediums Error:', err);
        req.flash('error', 'Failed to load medium settings');
        res.redirect('/schooladmin/settings');
    };
};

exports.postMediums = async (req, res) => {
    const conn = await db.getConnection();
    try {
        await conn.beginTransaction();
        const schoolId = getSchoolId(req);
        let { mediums, primary_medium } = req.body;
        if (!mediums) mediums = [];
        if (!Array.isArray(mediums)) mediums = [mediums];
        mediums = mediums.filter(Boolean);

        if (mediums.length === 0) {
            req.flash('error', 'Please select at least one medium');
            await conn.rollback();
            conn.release();
            return res.redirect('/schooladmin/settings/mediums');
        };

        const [masterMediums] = await conn.query(
            'SELECT * FROM mediums WHERE medium_code IN (?)',
            [mediums]
        );

        await conn.query('DELETE FROM school_mediums WHERE school_id = ?', [schoolId]);
        for (const m of masterMediums) {
            await conn.query(
                `INSERT INTO school_mediums (school_id, medium_code, medium_name, is_primary)
                VALUES (?, ?, ?, ?)`,
                [schoolId, m.medium_code, m.medium_name, m.medium_code === primary_medium ? 1 : 0]
            );
        };

        const mediumNames = masterMediums.map(m => m.medium_name).join(', ');
        await conn.query(
            'UPDATE schools SET medium = ? WHERE id = ?',
            [mediumNames, schoolId]
        );

        await conn.commit();
        conn.release();
        await logSchoolActivity(req, {
            action: 'update_mediums',
            entityType: 'school',
            entityId: schoolId,
            description: `Updated school mediums: ${mediumNames}`
        });

        req.flash('success', 'Medium settings saved successfully');
        res.redirect('/schooladmin/settings/mediums');
    } catch (err) {
        await conn.rollback();
        conn.release();
        console.error('postMediums Error:', err);
        req.flash('error', 'Failed to save medium settings');
        res.redirect('/schooladmin/settings/mediums');
    };
};
