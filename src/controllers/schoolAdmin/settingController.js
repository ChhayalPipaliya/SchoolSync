const db = require('../../config/database');
const fs = require('fs');
const path = require('path');
const chatPermissionService = require('../../services/chatPermissionService');

exports.getSettings = async (req, res) => {
    try {
        const schoolId = (req.user?.school_id || req.session.user?.school_id);
        const [[school]] = await db.query('SELECT * FROM schools WHERE id = ?', [schoolId]);
        const [[settings]] = await db.query('SELECT * FROM settings WHERE school_id = ?', [schoolId]);

        res.render('schoolAdmin/settings/index', {
            title: 'School Settings',
            school,
            settings: settings || {}
        });
    } catch (err) {
        console.error(err);
        req.flash('error', 'Failed to load settings');
        res.redirect('/schooladmin/dashboard');
    };
};

exports.postSettings = async (req, res) => {
    try {
        const userRole = req.session?.user?.role || req.user?.role;
        if (userRole === 'school_admin') {
            const protectedFields = ['school_group_id', 'branch_name', 'branch_code', 'area'];
            const attemptedProtectedFields = protectedFields.filter(f => req.body[f] !== undefined);
            if (attemptedProtectedFields.length > 0) {
                return res.status(403).json({
                    success: false,
                    message: 'School Admin is not permitted to modify branch/group details. Please contact your Group Admin.'
                });
            };
        };

        const schoolId = (req.user?.school_id || req.session.user?.school_id);
        const [[existingSchool]] = await db.query('SELECT * FROM schools WHERE id = ?', [schoolId]);
        if (!existingSchool) {
            req.flash('error', 'School not found');
            return res.redirect('/schooladmin/settings');
        };

        const { school_name, school_email, school_phone, website, school_address, city, state, pincode, school_principal_name, school_principal_email, school_principal_phone, establishment_year, school_type, medium, board, gender_type, latitude, longitude } = req.body;
        const logo = req.file?.filename || null;
        const final_school_name = school_name !== undefined ? school_name : existingSchool.school_name;
        const final_school_email = school_email !== undefined ? school_email : existingSchool.school_email;
        const final_school_phone = school_phone !== undefined ? school_phone : existingSchool.school_phone;
        const final_website = website !== undefined ? (website || null) : existingSchool.website;
        const final_school_address = school_address !== undefined ? (school_address || null) : existingSchool.school_address;
        const final_city = city !== undefined ? (city || null) : existingSchool.city;
        const final_state = state !== undefined ? (state || null) : existingSchool.state;
        const final_pincode = pincode !== undefined ? (pincode || null) : existingSchool.pincode;
        const final_school_principal_name = school_principal_name !== undefined ? (school_principal_name || null) : existingSchool.school_principal_name;
        const final_school_principal_email = school_principal_email !== undefined ? (school_principal_email || null) : existingSchool.school_principal_email;
        const final_school_principal_phone = school_principal_phone !== undefined ? (school_principal_phone || null) : existingSchool.school_principal_phone;
        const final_establishment_year = establishment_year !== undefined ? (establishment_year || null) : existingSchool.establishment_year;
        const final_school_type = school_type !== undefined ? school_type : existingSchool.school_type;
        const final_medium = medium !== undefined ? medium : existingSchool.medium;
        const final_board = board !== undefined ? board : existingSchool.board;
        const final_gender_type = gender_type !== undefined ? gender_type : existingSchool.gender_type;

        let final_latitude = existingSchool.latitude;
        if (latitude !== undefined) {
            if (latitude === null || String(latitude).trim() === "") {
                final_latitude = null;
            } else {
                const parsedLat = parseFloat(latitude);
                if (isNaN(parsedLat) || parsedLat < -90 || parsedLat > 90) {
                    throw new Error("Latitude must be a valid number between -90 and 90.");
                };
                final_latitude = parsedLat;
            };
        };

        let final_longitude = existingSchool.longitude;
        if (longitude !== undefined) {
            if (longitude === null || String(longitude).trim() === "") {
                final_longitude = null;
            } else {
                const parsedLng = parseFloat(longitude);
                if (isNaN(parsedLng) || parsedLng < -180 || parsedLng > 180) {
                    throw new Error("Longitude must be a valid number between -180 and 180.");
                };
                final_longitude = parsedLng;
            };
        };

        let sql = `
            UPDATE schools SET 
                school_name = ?, school_email = ?, school_phone = ?, website = ?,
                school_address = ?, city = ?, state = ?, pincode = ?, latitude = ?, longitude = ?,
                school_principal_name = ?, school_principal_email = ?, school_principal_phone = ?,
                establishment_year = ?, school_type = ?, medium = ?, board = ?, gender_type = ?
        `;
        
        const params = [ final_school_name, final_school_email, final_school_phone, final_website, final_school_address, final_city, final_state, final_pincode, final_latitude, final_longitude, final_school_principal_name, final_school_principal_email, final_school_principal_phone, final_establishment_year, final_school_type, final_medium, final_board, final_gender_type ];
        if (logo) {
            sql += ', logo = ?';
            params.push(logo);
        };

        sql += ' WHERE id = ?';
        params.push(schoolId);
        await db.query(sql, params);
        const [[existingSettings]] = await db.query(
            'SELECT id FROM settings WHERE school_id = ?',
            [schoolId]
        );

        if (existingSettings) {
            await db.query('UPDATE settings SET updated_at = NOW() WHERE school_id = ?', [schoolId]);
        } else {
            await db.query('INSERT INTO settings (school_id) VALUES (?)', [schoolId]);
        };

        req.flash('success', 'Settings updated successfully');
        res.redirect('/schooladmin/settings');
    } catch (err) {
        console.error(err);
        req.flash('error', 'Failed to update settings');
        res.redirect('/schooladmin/settings');
    };
};

exports.getBankDetails = async (req, res) => {
    try {
        const schoolId = (req.user?.school_id || req.session.user?.school_id);
        const [banks] = await db.query(
            'SELECT * FROM school_bank_details WHERE school_id = ?',
            [schoolId]
        );

        res.render('schoolAdmin/settings/bank', { title: 'Bank Details', banks });
    } catch (err) {
        console.error(err);
        req.flash('error', 'Failed to load bank details');
        res.redirect('/schooladmin/settings');
    };
};

exports.postBankDetails = async (req, res) => {
    try {
        const schoolId = (req.user?.school_id || req.session.user?.school_id);
        const { account_holder_name, bank_name, account_number, ifsc_code, branch_name, is_primary } = req.body;

        if (is_primary) {
            await db.query(
                'UPDATE school_bank_details SET is_primary = FALSE WHERE school_id = ?',
                [schoolId]
            );
        };

        await db.query(
            `INSERT INTO school_bank_details (school_id, account_holder_name, bank_name, account_number, ifsc_code, branch_name, is_primary)
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [schoolId, account_holder_name, bank_name, account_number, ifsc_code, branch_name, is_primary ? 1 : 0]
        );

        req.flash('success', 'Bank details added successfully');
        res.redirect('/schooladmin/settings/bank');
    } catch (err) {
        console.error(err);
        req.flash('error', 'Failed to add bank details');
        res.redirect('/schooladmin/settings/bank');
    };
};

exports.getDocuments = async (req, res) => {
    try {
        const schoolId = (req.user?.school_id || req.session.user?.school_id);
        const [documents] = await db.query(
            'SELECT * FROM school_documents WHERE school_id = ?',
            [schoolId]
        );

        res.render('schoolAdmin/settings/documents', { title: 'School Documents', documents });
    } catch (err) {
        console.error(err);
        req.flash('error', 'Failed to load documents');
        res.redirect('/schooladmin/settings');
    };
};

exports.postDocuments = async (req, res) => {
    try {
        const schoolId = (req.user?.school_id || req.session.user?.school_id);
        const { document_type } = req.body;

        if (req.files?.documents) {
            for (let i = 0; i < req.files.documents.length; i++) {
                await db.query(
                    'INSERT INTO school_documents (school_id, document_type, file_path) VALUES (?, ?, ?)',
                    [schoolId, Array.isArray(document_type) ? document_type[i] : document_type, req.files.documents[i].filename]
                );
            };
        };

        req.flash('success', 'Documents uploaded successfully');
        res.redirect('/schooladmin/settings/documents');
    } catch (err) {
        console.error(err);
        req.flash('error', 'Failed to upload documents');
        res.redirect('/schooladmin/settings/documents');
    };
};

exports.getChatPermissions = async (req, res) => {
    try {
        const schoolId = (req.user?.school_id || req.session.user?.school_id);
        const matrix = await chatPermissionService.getSchoolChatPermissionMatrix(schoolId);

        res.render('schoolAdmin/settings/chatPermissions', {
            title: 'Chat Permissions',
            roles: matrix.roles,
            roleLabels: matrix.roleLabels,
            permissionMap: matrix.permissionMap
        });
    } catch (err) {
        console.error('[Settings getChatPermissions]', err);
        req.flash('error', 'Failed to load chat permissions');
        res.redirect('/schooladmin/settings');
    };
};

exports.postChatPermissions = async (req, res) => {
    try {
        const schoolId = (req.user?.school_id || req.session.user?.school_id);
        const updatedBy = (req.user?.id || req.session.user?.id) || null;
        const selectedPermissions = req.body.permissions || [];
        const allowedPairs = Array.isArray(selectedPermissions) ? selectedPermissions : [selectedPermissions];

        await chatPermissionService.updateSchoolChatPermissions(schoolId, allowedPairs, updatedBy);

        req.flash('success', 'Chat permissions updated successfully');
        res.redirect('/schooladmin/settings/chat-permissions');
    } catch (err) {
        console.error('[Settings postChatPermissions]', err);
        req.flash('error', 'Failed to update chat permissions');
        res.redirect('/schooladmin/settings/chat-permissions');
    };
};