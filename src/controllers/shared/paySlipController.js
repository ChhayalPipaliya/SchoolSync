const PDFDocument = require('pdfkit');
const db = require('../../config/database');

exports.myPayslips = async (req, res) => {
    try {
        const schoolId = req.user?.school_id;
        const userId = req.user?.id;
        const role = req.user?.role || 'teacher';

        const sql = `
            SELECT ms.*, ms.salary_month, ss.amount AS base_salary
            FROM monthly_salaries ms
            JOIN salary_structures ss ON ss.user_id = ms.user_id AND ss.school_id = ms.school_id
            WHERE ms.user_id = ? AND ms.school_id = ?
            ORDER BY ms.salary_month DESC
        `;
        const [payslips] = await db.query(sql, [userId, schoolId]);

        res.render(`${role}/payslips`, {
            title: 'My Payslips',
            payslips,
            user: req.user,
            currentPath: `/${role}/payslips`
        });
    } catch (err) {
        console.error('[PaySlip Controller myPayslips]', err);
        req.flash('error', 'Failed to load payslips.');
        res.redirect(`/${req.user?.role || 'teacher'}/dashboard`);
    };
};

exports.downloadMyPayslip = async (req, res) => {
    try {
        const schoolId = req.user?.school_id;
        const userId = req.user?.id;
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
            WHERE ms.id = ? AND ms.user_id = ? AND ms.school_id = ?`,
            [id, userId, schoolId]
        );

        if (!salary) {
            return res.status(404).render('errors/404', { title: 'Not Found', message: 'Payslip not found' });
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
        console.error('[PaySlip Controller downloadMyPayslip]', err);
        if (!res.headersSent) {
            return res.status(500).render('errors/500', { title: 'Download Error', message: 'Failed to generate pay slip' });
        };
    };
};