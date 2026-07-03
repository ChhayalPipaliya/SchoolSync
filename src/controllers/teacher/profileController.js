const teacherModel = require('../../models/teacherModel');
const path = require('path');
const fs = require('fs');
const bcryptjs = require('bcryptjs');
const db = require('../../config/database');
const { isStrongPassword } = require('../../utils/validation');

exports.getProfile = async (req, res) => {
    try {
        const teacher = await teacherModel.getTeacherByUserId(req.user.id);
        const medical = await teacherModel.getMedicalInfo(teacher.id);
        const experiences = await teacherModel.getExperiences(teacher.id);
        const documents = await teacherModel.getDocuments(teacher.id);

        res.render('teacher/profile', {
            title: 'My Profile',
            user: req.user,
            teacher,
            medical,
            experiences,
            documents,
            layout: 'teacher/layout'
        });
    } catch (error) {
        req.flash('error', 'Failed to load profile');
        res.redirect('/teacher/dashboard');
    }
};

exports.updateProfile = async (req, res) => {
    try {
        const { currentPassword, newPassword, confirmPassword } = req.body;

        if (!currentPassword || !newPassword || !confirmPassword) {
            req.flash('error', 'Please fill all password fields');
            return res.redirect('/teacher/profile');
        }

        if (newPassword !== confirmPassword) {
            req.flash('error', 'New passwords do not match');
            return res.redirect('/teacher/profile');
        }

        if (!isStrongPassword(newPassword)) {
            req.flash('error', 'Password must be at least 8 characters and include letters and numbers');
            return res.redirect('/teacher/profile');
        }

        const [[user]] = await db.execute('SELECT password FROM users WHERE id = ?', [req.user.id]);
        if (!user) {
            req.flash('error', 'User not found');
            return res.redirect('/teacher/profile');
        }

        const isPasswordValid = await bcryptjs.compare(currentPassword, user.password);
        if (!isPasswordValid) {
            req.flash('error', 'Incorrect current password');
            return res.redirect('/teacher/profile');
        }

        const hashed = await bcryptjs.hash(newPassword, 10);
        await db.execute('UPDATE users SET password = ? WHERE id = ?', [hashed, req.user.id]);

        req.flash('success', 'Password updated successfully');
        res.redirect('/teacher/profile');
    } catch (error) {
        console.error('Update Password Error:', error);
        req.flash('error', 'Failed to update password');
        res.redirect('/teacher/profile');
    }
};

exports.addExperience = async (req, res) => {
    req.flash('error', 'Action not allowed');
    res.redirect('/teacher/profile');
};

exports.deleteExperience = async (req, res) => {
    req.flash('error', 'Action not allowed');
    res.redirect('/teacher/profile');
};

exports.uploadDocument = async (req, res) => {
    req.flash('error', 'Action not allowed');
    res.redirect('/teacher/profile');
};

exports.deleteDocument = async (req, res) => {
    req.flash('error', 'Action not allowed');
    res.redirect('/teacher/profile');
};

exports.getProfileStats = async (req, res) => {
    try {
        const db = require('../../config/database');
        const teacher = await teacherModel.getTeacherByUserId(req.user.id);

        const [[classes]] = await db.execute(
            `SELECT COUNT(DISTINCT class_id) as count FROM class_subjects WHERE teacher_id = ?`,
            [req.user.id]
        );
        const [[subjects]] = await db.execute(
            `SELECT COUNT(*) as count FROM class_subjects WHERE teacher_id = ?`,
            [req.user.id]
        );
        const [[students]] = await db.execute(
            `SELECT COUNT(DISTINCT s.id) as count FROM students s
             JOIN class_subjects cs ON s.class_id = cs.class_id
             WHERE cs.teacher_id = ?`,
            [req.user.id]
        );

        res.json({
            assignedClasses: classes.count || 0,
            subjects:        subjects.count || 0,
            totalStudents:   students.count || 0
        });
    } catch (error) {
        console.error('Profile Stats Error:', error);
        res.json({ assignedClasses: 0, subjects: 0, totalStudents: 0 });
    }
};

exports.downloadProfile = async (req, res) => {
    try {
        const db = require('../../config/database');
        const teacher = await teacherModel.getTeacherByUserId(req.user.id);
        if (!teacher) {
            req.flash('error', 'Teacher profile not found');
            return res.redirect('/teacher/profile');
        }

        const schoolId = req.user.school_id;
        const [schools] = await db.query('SELECT * FROM schools WHERE id = ?', [schoolId]);
        const school = schools[0] || {};

        teacher.first_name = teacher.first_name;
        teacher.last_name = teacher.last_name;
        teacher.photo = teacher.image;
        teacher.email = teacher.email;
        teacher.phone = teacher.phone;

        const { generateIdCardPdf } = require('../../utils/pdfHelper');
        const pdfDoc = await generateIdCardPdf({
            type: 'teacher',
            name: `${teacher.first_name} ${teacher.last_name}`,
            idNo: `T-${teacher.id}`,
            frontDetail1: teacher.designation || 'Teacher',
            frontDetail2: teacher.email || 'N/A',
            frontDetail3: '2026-2027',
            photo: teacher.photo,
            school,
            qrText: `VERIFY:TEACHER-ID-${teacher.id}:NAME-${teacher.first_name} ${teacher.last_name}:SCHOOL-${school.school_name || ''}`,
            backDetail1: teacher.phone || 'N/A',
            backDetail2: teacher.emergency_contact || 'N/A'
        });

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename=ID_Card_Teacher_${teacher.id}.pdf`);
        pdfDoc.pipe(res);
        pdfDoc.end();
    } catch (error) {
        console.error('Download Profile ID Card Error:', error);
        req.flash('error', 'Failed to download ID card PDF');
        res.redirect('/teacher/profile');
    }
};