const nodemailer = require("nodemailer");

/**
 * Send an email using Nodemailer
 * @param {Object} options - { to, subject, text, html }
 */
async function sendEmail({ to, subject, text, html }) {
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || "smtp.gmail.com",
    port: parseInt(process.env.SMTP_PORT || "587"),
    secure: process.env.SMTP_PORT === "465", // true for 465, false for other ports
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });

  const info = await transporter.sendMail({
    from: process.env.EMAIL_FROM || '"TodoApp" <noreply@todoapp.com>',
    to,
    subject,
    text,
    html,
  });

  console.log(`📧 Email sent to ${to}: ${info.messageId}`);
  return info;
}

module.exports = { sendEmail };
