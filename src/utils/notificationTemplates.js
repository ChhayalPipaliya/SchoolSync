module.exports = {
    homeworkAssigned(homeworkTitle, className, subjectName, homeworkId) {
        return {
            title: `New Assignment: ${subjectName}`,
            message: `A new homework task "${homeworkTitle}" has been assigned for class ${className}.`,
            type: "homework",
            category: "academic",
            actionUrl: `/student/homework?status=pending`
        };
    },

    homeworkSubmitted(studentName, homeworkTitle, homeworkId) {
        return {
            title: `Homework Submitted`,
            message: `${studentName} has submitted homework for "${homeworkTitle}".`,
            type: "info",
            category: "academic",
            actionUrl: `/teacher/homework`
        };
    },

    feePaid(studentName, amount, receiptId) {
        return {
            title: `Fee Payment Successful`,
            message: `Fee payment of ₹${parseFloat(amount).toFixed(2)} received for ${studentName}. Receipt #${String(receiptId).padStart(6, '0')}.`,
            type: "success",
            category: "fee",
            actionUrl: `/schooladmin/fees`
        };
    },

    feePaidStudent(amount, receiptId) {
        return {
            title: `Fee Payment Receipt`,
            message: `Your payment of ₹${parseFloat(amount).toFixed(2)} was received successfully. Receipt #${String(receiptId).padStart(6, '0')}.`,
            type: "success",
            category: "fee",
            actionUrl: `/student/fees`
        };
    },

    feeDueReminder(feeName, dueDate, amount) {
        return {
            title: `Fee Payment Reminder`,
            message: `Your fee for "${feeName}" of ₹${parseFloat(amount).toFixed(2)} is due on ${new Date(dueDate).toLocaleDateString('en-IN')}. Please pay on time.`,
            type: "warning",
            category: "fee",
            actionUrl: `/student/fees`
        };
    },

    studentAbsent(date) {
        return {
            title: `Student Absent Notification`,
            message: `The student was marked ABSENT on ${new Date(date).toLocaleDateString('en-IN')}.`,
            type: "warning",
            category: "general",
            actionUrl: `/student/attendance`
        };
    },

    noticePublished(noticeTitle, priority = "normal") {
        const typeMap = {
            urgent: "emergency",
            high: "warning",
            normal: "notice",
            low: "info"
        };
        return {
            title: `Notice Board: ${noticeTitle}`,
            message: `A new ${priority} notice has been published on the board.`,
            type: typeMap[priority] || "notice",
            category: "notice",
            disable_email: true,
            skip_email: true,
            actionUrl: `/home`
        };
    },

    bookDueReminder(bookTitle, dueDate) {
        return {
            title: `Book Return Reminder`,
            message: `The library book "${bookTitle}" is due for return on ${new Date(dueDate).toLocaleDateString('en-IN')}.`,
            type: "warning",
            category: "library",
            actionUrl: `/student/library`
        };
    },

    routeChanged(routeName, vehicleNo) {
        return {
            title: `Transport Route Change`,
            message: `The route "${routeName}" (Vehicle: ${vehicleNo}) has been updated. Please check the new route schedule.`,
            type: "warning",
            category: "transport",
            actionUrl: `/student/transport`
        };
    },

    ticketStatusUpdate(ticketNo, status) {
        return {
            title: `Support Ticket Updated`,
            message: `Your support ticket #${ticketNo} has been updated to status: ${status.toUpperCase()}.`,
            type: "info",
            category: "system",
            actionUrl: `/support`
        };
    },

    systemWarning(metric, issue) {
        return {
            title: `System Alert: ${metric}`,
            message: `Warning: ${issue}. Action required immediately.`,
            type: "emergency",
            category: "system",
            actionUrl: `/superadmin/dashboard`
        };
    },

    emailWrapper(title, bodyHtml) {
        return `<!DOCTYPE html>
            <html>
            <head>
                <meta charset="utf-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>${title}</title>
                <style>
                    body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #F3F4F6; margin: 0; padding: 0; color: #1F2937; -webkit-font-smoothing: antialiased; }
                    .email-container { max-width: 600px; margin: 40px auto; background-color: #FFFFFF; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05); border: 1px solid #E5E7EB; }
                    .email-header { background: linear-gradient(135deg, #4338CA 0%, #312E81 100%); padding: 32px 24px; text-align: center; color: #FFFFFF; }
                    .email-header h1 { margin: 0; font-size: 24px; font-weight: 800; letter-spacing: -0.5px; }
                    .email-header p { margin: 8px 0 0; font-size: 14px; opacity: 0.9; }
                    .email-body { padding: 40px 32px; line-height: 1.6; font-size: 16px; color: #374151; }
                    .email-body h2 { color: #111827; font-size: 20px; font-weight: 700; margin-top: 0; margin-bottom: 16px; }
                    .email-body p { margin-top: 0; margin-bottom: 20px; }
                    .btn-container { text-align: center; margin: 30px 0; }
                    .btn-primary { display: inline-block; padding: 14px 32px; background-color: #4338CA; color: #FFFFFF !important; text-decoration: none; border-radius: 8px; font-weight: 700; font-size: 15px; box-shadow: 0 4px 6px rgba(67, 56, 202, 0.15); transition: background-color 0.2s; }
                    .btn-primary:hover { background-color: #3730A3; }
                    .info-card { background-color: #F9FAFB; border: 1px solid #E5E7EB; border-radius: 12px; padding: 20px; margin: 24px 0; }
                    .info-row { display: flex; justify-content: space-between; margin-bottom: 10px; font-size: 14px; }
                    .info-row:last-child { margin-bottom: 0; }
                    .info-label { font-weight: 600; color: #6B7280; }
                    .info-value { font-weight: 700; color: #111827; word-break: break-all; }
                    .email-footer { background-color: #F9FAFB; padding: 24px 32px; border-top: 1px solid #F3F4F6; text-align: center; font-size: 12px; color: #9CA3AF; }
                    .email-footer a { color: #4338CA; text-decoration: none; font-weight: 600; }
                    .email-footer p { margin: 4px 0; }
                </style>
            </head>
            <body>
                <div class="email-container">
                    <div class="email-header">
                        <h1>SchoolSync</h1>
                        <p>Smarter School Management Platform</p>
                    </div>
                    <div class="email-body">
                        ${bodyHtml}
                    </div>
                    <div class="email-footer">
                        <p>&copy; 2026 SchoolSync. All rights reserved.</p>
                        <p>Surat, Gujarat, India</p>
                        <p style="margin-top: 12px;">This email was sent to notify you about your subscription/registration activities. <a href="#">Unsubscribe</a></p>
                    </div>
                </div>
            </body>
            </html>`;
    },

    registrationReceived(adminName, schoolName, requestId, planName, subdomain) {
        const title = "Registration Request Received";
        const body = `
            <h2>Hello ${adminName},</h2>
            <p>Your registration request for <strong>${schoolName}</strong> has been successfully submitted to SchoolSync.</p>      
            <div class="info-card">
                <div class="info-row">
                    <span class="info-label">Request ID:</span>
                    <span class="info-value">#${requestId}</span>
                </div>
                <div class="info-row">
                    <span class="info-label">Selected Plan:</span>
                    <span class="info-value">${planName || 'Standard'}</span>
                </div>
                <div class="info-row">
                    <span class="info-label">Requested Subdomain:</span>
                    <span class="info-value">${subdomain}.schoolsync.in</span>
                </div>
            </div>
            <p>Our team is currently reviewing your registration. This process typically takes 24-48 hours. Once approved, you will receive login credentials to set up your portal.</p>
            <p>If you have any questions, feel free to reply to this email or contact support at <a href="mailto:support@schoolsync.com">support@schoolsync.com</a>.</p>
            <p>Best regards,<br>The SchoolSync Onboarding Team</p>
        `;
        return {
            subject: "School Registration Request Received - SchoolSync",
            bodyHtml: this.emailWrapper(title, body)
        };
    },

    registrationApproved(adminName, schoolName, subdomain, email, planName, trialEndDate, tempPassword) {
        const title = "Your School is Approved!";
        const loginUrl = `https://${subdomain}.schoolsync.in/login`;
        let passwordMessage = "Use the password you set during registration.";
        if (tempPassword) {
            passwordMessage = `Your temporary password is: <code style="background:#F3F4F6; padding: 2px 6px; border-radius: 4px; font-weight: bold; color: #DC2626;">${tempPassword}</code><br><span style="font-size:13px; color:#6B7280;">(You will be prompted to change this password on your first login)</span>`;
        };
        const body = `
            <h2>Congratulations ${adminName}!</h2>
            <p>We are thrilled to inform you that your registration request for <strong>${schoolName}</strong> has been approved! Your school workspace has been created and is ready to use.</p>  
            <div class="info-card">
                <div class="info-row">
                    <span class="info-label">Login Workspace URL:</span>
                    <span class="info-value"><a href="${loginUrl}" target="_blank">${loginUrl}</a></span>
                </div>
                <div class="info-row">
                    <span class="info-label">Administrator Email:</span>
                    <span class="info-value">${email}</span>
                </div>
                <div class="info-row">
                    <span class="info-label">Plan details:</span>
                    <span class="info-value">${planName || 'Standard'} (30-day Free Trial)</span>
                </div>
                <div class="info-row">
                    <span class="info-label">Trial Expiry Date:</span>
                    <span class="info-value">${trialEndDate}</span>
                </div>
            </div>            
            <div style="margin-bottom: 24px; padding: 16px; background-color: #EFF6FF; border: 1px solid #BFDBFE; border-radius: 12px;">
                <h3 style="margin-top:0; color:#1E3A8A; font-size:15px; font-weight:700;">Your Credentials</h3>
                <p style="margin-bottom:0; font-size:14px; color:#1E40AF;">
                    <strong>Login Email:</strong> ${email}<br>
                    <strong>Password:</strong> ${passwordMessage}
                </p>
            </div>
            <div class="btn-container">
                <a href="${loginUrl}" class="btn btn-primary" target="_blank">Access Your Workspace</a>
            </div>
            <p>Welcome to SchoolSync! We are excited to support you in driving your school operations forward.</p>
            <p>Best regards,<br>The SchoolSync Team</p>
        `;
        return {
            subject: "Your School Registration is Approved!",
            bodyHtml: this.emailWrapper(title, body)
        };
    },

    registrationRejected(adminName, schoolName, reason) {
        const title = "School Registration Update";
        const body = `
            <h2>Hello ${adminName},</h2>
            <p>Thank you for your interest in SchoolSync. We regret to inform you that your registration request for <strong>${schoolName}</strong> could not be approved at this time.</p>
            <div class="info-card" style="border-left: 4px solid #EF4444;">
                <h3 style="margin-top:0; color:#B91C1C; font-size:15px; font-weight:700;">Reason for Rejection:</h3>
                <p style="margin-bottom:0; font-style:italic;">"${reason}"</p>
            </div>
            <p>If you believe this was an error, or if you would like to submit additional information for consideration, please contact our support team at <a href="mailto:support@schoolsync.com">support@schoolsync.com</a> or call +91 98765 43210.</p>
            <p>Best regards,<br>The SchoolSync Review Panel</p>
        `;
        return {
            subject: "School Registration Update - SchoolSync",
            bodyHtml: this.emailWrapper(title, body)
        };
    },

    subscriptionExpiringSoon(schoolName, planName, expiryDate, daysRemaining, renewalUrl) {
        const title = "Subscription Expiring Soon";
        const body = `
            <h2>Hello School Administrator,</h2>
            <p>This is an automated notification that the subscription for <strong>${schoolName}</strong> is expiring soon.</p>
            <div class="info-card" style="border-left: 4px solid #F59E0B;">
                <div class="info-row">
                    <span class="info-label">Active Plan:</span>
                    <span class="info-value">${planName}</span>
                </div>
                <div class="info-row">
                    <span class="info-label">Expiry Date:</span>
                    <span class="info-value">${expiryDate}</span>
                </div>
                <div class="info-row">
                    <span class="info-label">Days Remaining:</span>
                    <span class="info-value" style="color:#D97706; font-weight:bold;">${daysRemaining} Days</span>
                </div>
            </div>
            <div style="margin-bottom: 24px; padding: 16px; background-color: #FEF3C7; border: 1px solid #FDE68A; border-radius: 12px; font-size: 14px; color: #78350F;">
                <strong>Please Note:</strong> Upon expiration, portal access will be temporarily deactivated, blocking attendance logs, grades management, fee processing, and reports.
            </div>
            <div class="btn-container">
                <a href="${renewalUrl || '#'}" class="btn btn-primary" target="_blank">Renew Subscription</a>
            </div>
            <p>If you have any questions or need billing assistance, please feel free to reach out to our support team.</p>
            <p>Thank you for choosing SchoolSync,<br>The Billing Team</p>
        `;
        return {
            subject: `Action Required: Subscription Expires in ${daysRemaining} Days`,
            bodyHtml: this.emailWrapper(title, body)
        };
    },

    subscriptionExpired(schoolName, planName, renewalUrl) {
        const title = "URGENT: School Account Deactivated";
        const body = `
            <h2>URGENT: School Account Deactivated</h2>
            <p>We are writing to inform you that your subscription for <strong>${schoolName}</strong> has expired, and your school portal has been deactivated.</p>
            <div class="info-card" style="border-left: 4px solid #EF4444; background-color: #FEF2F2;">
                <p style="margin-top:0; color:#991B1B; font-weight:bold;">Account Deactivation Status</p>
                <p style="margin-bottom:0; font-size:14px; color:#7F1D1D;">
                    - <strong>Deactivation Date:</strong> Today<br>
                    - <strong>Grace Period:</strong> 7 Days (Ends in 7 days)<br>
                    - <strong>Data Deletion Policy:</strong> If the subscription is not renewed within 7 days, your workspace and all student/staff records will be permanently archived.
                </p>
            </div>
            <p>To restore portal access instantly and avoid permanent data loss, please click the button below to renew your plan.</p>
            <div class="btn-container">
                <a href="${renewalUrl || '#'}" class="btn btn-primary" style="background-color:#EF4444;" target="_blank">Restore & Renew Portal</a>
            </div>
            <p>If you have any concerns or need assistance recovering your account, please contact us immediately at <a href="mailto:support@schoolsync.com">support@schoolsync.com</a>.</p>
            <p>Best regards,<br>SchoolSync Billing & Support</p>
        `;
        return {
            subject: "URGENT: School Account Deactivated",
            bodyHtml: this.emailWrapper(title, body)
        };
    },

    subscriptionExpiryReminder({ schoolName, principalName, planName, daysRemaining, endDate, renewUrl }) {
        const title = "Subscription Expiry Reminder";
        const body = `
            <h2>Hello ${principalName || 'Principal'},</h2>
            <p>This is a reminder that the subscription for <strong>${schoolName}</strong> is expiring in <strong>${daysRemaining} day(s)</strong> on <strong>${endDate}</strong>.</p>
            <div class="info-card" style="border-left: 4px solid #3B82F6;">
                <div class="info-row">
                    <span class="info-label">Plan Name:</span>
                    <span class="info-value">${planName}</span>
                </div>
                <div class="info-row">
                    <span class="info-label">Expiry Date:</span>
                    <span class="info-value">${endDate}</span>
                </div>
                <div class="info-row">
                    <span class="info-label">Time Remaining:</span>
                    <span class="info-value" style="color:#3B82F6; font-weight:bold;">${daysRemaining} Day(s)</span>
                </div>
            </div>
            <div style="margin-bottom: 24px; padding: 16px; background-color: #FEF3C7; border: 1px solid #FDE68A; border-radius: 12px; font-size: 14px; color: #78350F;">
                <strong>Warning:</strong> Once your subscription expires, access to your school portal will be blocked, and all administrative, teacher, student, and driver functions will be paused.
            </div>
            <div class="btn-container">
                <a href="${renewUrl || '#'}" class="btn-primary" style="background-color: #3B82F6; color: #FFFFFF; text-decoration: none; display: inline-block; padding: 14px 32px; border-radius: 8px; font-weight: 700; font-size: 15px; box-shadow: 0 4px 6px rgba(59, 130, 246, 0.15);" target="_blank">Renew Subscription Now</a>
            </div>
            <p>To ensure uninterrupted service for your students and staff, please renew your subscription as soon as possible.</p>
            <p>If you have any questions or need assistance, please contact support.</p>
            <p>Best regards,<br>The SchoolSync Team</p>
        `;
        return {
            subject: `Action Required: Your SchoolSync subscription expires in ${daysRemaining} day(s)`,
            html: this.emailWrapper(title, body)
        };
    },

    subscriptionExpiredNotice({ schoolName, principalName, planName, expiredDate, renewUrl }) {
        const title = "Subscription Expired";
        const body = `
            <h2>Hello ${principalName || 'Principal'},</h2>
            <p>We regret to inform you that your subscription for <strong>${schoolName}</strong> has expired on <strong>${expiredDate}</strong>, and access to your school portal has been restricted.</p>
            <div class="info-card" style="border-left: 4px solid #EF4444; background-color: #FEF2F2;">
                <div class="info-row">
                    <span class="info-label">Expired Plan:</span>
                    <span class="info-value">${planName}</span>
                </div>
                <div class="info-row">
                    <span class="info-label">Expiration Date:</span>
                    <span class="info-value">${expiredDate}</span>
                </div>
                <div class="info-row">
                    <span class="info-label">Portal Status:</span>
                    <span class="info-value" style="color:#DC2626; font-weight:bold;">Restricted</span>
                </div>
            </div>
            <p>To restore access and continue using SchoolSync, please click the button below to renew your subscription.</p>
            <div class="btn-container">
                <a href="${renewUrl || '#'}" class="btn-primary" style="background-color: #3B82F6; color: #FFFFFF; text-decoration: none; display: inline-block; padding: 14px 32px; border-radius: 8px; font-weight: 700; font-size: 15px; box-shadow: 0 4px 6px rgba(59, 130, 246, 0.15);" target="_blank">Renew Plan</a>
            </div>       
            <p>If you require any billing assistance or support, please reach out to us at support@schoolsync.com.</p>
            <p>Best regards,<br>The SchoolSync Team</p>
        `;
        return {
            subject: "Your SchoolSync subscription has expired",
            html: this.emailWrapper(title, body)
        };
    }
};