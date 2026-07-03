const nodemailer = require("nodemailer");

const transporter = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
    },
});

const sendOTP = async (email, otp) => {
    try {
        if (!email || !otp) {
            throw new Error("Email and OTP are required");
        }

        await transporter.sendMail({
            from: `"SchoolSync Verification" <${process.env.EMAIL_USER}>`,
            to: email,
            subject: `Your Verification Code: ${otp}`,
            html: `
            <div style="font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; background-color: #f4f7f9; padding: 50px 20px; color: #333;">
                <table align="center" border="0" cellpadding="0" cellspacing="0" width="100%" style="max-width: 450px; background-color: #ffffff; border-radius: 12px; box-shadow: 0 4px 15px rgba(0,0,0,0.05); border: 1px solid #e1e8ed;"> 
                    <tr>
                        <td style="padding: 30px 40px; text-align: center;">
                            <h2 style="margin: 0; color: #1a202c; font-size: 22px; font-weight: 700;">Confirm Your Identity</h2>
                        </td>
                    </tr>
                    <tr>
                        <td style="padding: 0 40px 20px 40px; text-align: center;">
                            <p style="font-size: 15px; color: #4a5568;">Use the OTP below to verify your account.</p>
                        </td>
                    </tr>
                    <tr>
                        <td style="padding: 10px 40px 30px 40px; text-align: center;">
                            <div style="background-color: #f8fafc; border-radius: 8px; padding: 20px;">
                                <span style="font-size: 36px; font-weight: 700; letter-spacing: 8px;">${otp}</span>
                            </div>
                            <p style="font-size: 12px; color: #a0aec0; margin-top: 15px;">
                                This code is valid for <b>5 minutes</b>. Do not share it.
                            </p>
                        </td>
                    </tr>
                    <tr>
                        <td style="padding: 0 40px 30px 40px; text-align: center;">
                            <p style="font-size: 13px; color: #718096;">
                                If you didn’t request this, ignore this email.
                            </p>
                        </td>
                    </tr>
                </table>
            </div>
            `,
        });
        return true; 
    } catch (error) {
        console.error("Send OTP Error:", error);
        return false;
    }
};

module.exports = sendOTP;