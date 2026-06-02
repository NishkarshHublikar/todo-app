const nodemailer = require("nodemailer");
const dns = require("dns");

dns.setDefaultResultOrder("ipv4first");

/**
 * Send an email using Nodemailer
 * @param {Object} options - { to, subject, text, html }
 */
async function sendEmail({ to, subject, text, html }) {
  try {
    console.log("===== SMTP DEBUG =====");
    console.log("SMTP_HOST:", process.env.SMTP_HOST);
    console.log("SMTP_PORT:", process.env.SMTP_PORT);
    console.log("SMTP_USER:", process.env.SMTP_USER);
    console.log("EMAIL_FROM:", process.env.EMAIL_FROM);
    console.log("======================");

    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST || "smtp.gmail.com",
      port: Number(process.env.SMTP_PORT || 587),
      secure: Number(process.env.SMTP_PORT) === 465,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
      tls: {
        rejectUnauthorized: false,
      },
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 10000,
    });

    console.log("🔍 Verifying SMTP connection...");
    await transporter.verify();
    console.log("✅ SMTP verified successfully");

    const info = await transporter.sendMail({
      from:
        process.env.EMAIL_FROM ||
        `"TodoApp" <${process.env.SMTP_USER}>`,
      to,
      subject,
      text,
      html,
    });

    console.log(`📧 Email sent to ${to}: ${info.messageId}`);
    return info;
  } catch (err) {
    console.error("❌ EMAIL ERROR");
    console.error("Message:", err.message);
    console.error("Code:", err.code);
    console.error("Response:", err.response);
    console.error(err);
    throw err;
  }
}

module.exports = { sendEmail };