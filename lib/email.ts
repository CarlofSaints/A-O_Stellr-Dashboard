import { Resend } from 'resend';

const FROM    = 'A&O Dashboard <noreply@outerjoin.co.za>';
const APP_URL = 'https://ao-dashboard-eta.vercel.app';

function getResend() {
  if (!process.env.RESEND_API_KEY) throw new Error('RESEND_API_KEY not set');
  return new Resend(process.env.RESEND_API_KEY);
}

function wrap(body: string) {
  return `
    <div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;color:#222">
      <div style="background:#1B3A6B;padding:20px 24px;border-radius:8px 8px 0 0">
        <p style="color:#fff;font-size:16px;font-weight:bold;margin:0">A&amp;O Interactive Services</p>
        <p style="color:#93c5fd;font-size:12px;margin:4px 0 0">Dashboard Portal</p>
      </div>
      <div style="background:#fff;border:1px solid #e5e7eb;border-top:none;padding:24px;border-radius:0 0 8px 8px">
        ${body}
        <hr style="border:none;border-top:1px solid #f3f4f6;margin:20px 0">
        <p style="color:#9ca3af;font-size:11px">This is an automated message from the A&amp;O Dashboard system.</p>
      </div>
    </div>
  `;
}

export async function sendWelcomeEmail(to: string, name: string, password: string) {
  await getResend().emails.send({
    from: FROM,
    to,
    subject: 'Welcome to the A&O Dashboard',
    html: wrap(`
      <p style="font-size:15px;font-weight:600;margin:0 0 8px">Hello ${name},</p>
      <p style="margin:0 0 16px">Your A&amp;O Dashboard account has been created. Use the details below to sign in:</p>
      <table style="width:100%;border-collapse:collapse;margin:0 0 16px;font-size:13px">
        <tr><td style="padding:6px 12px 6px 0;color:#6b7280;white-space:nowrap">URL</td><td><a href="${APP_URL}" style="color:#1B3A6B">${APP_URL}</a></td></tr>
        <tr><td style="padding:6px 12px 6px 0;color:#6b7280">Email</td><td>${to}</td></tr>
        <tr><td style="padding:6px 12px 6px 0;color:#6b7280">Password</td><td style="font-family:monospace;background:#f3f4f6;padding:3px 8px;border-radius:4px">${password}</td></tr>
      </table>
      <p style="font-size:12px;color:#6b7280;margin:0">Please change your password after first login.</p>
    `),
  });
}

export async function sendPasswordResetEmail(to: string, name: string, password: string) {
  await getResend().emails.send({
    from: FROM,
    to,
    subject: 'A&O Dashboard — Password Reset',
    html: wrap(`
      <p style="font-size:15px;font-weight:600;margin:0 0 8px">Hello ${name},</p>
      <p style="margin:0 0 16px">Your A&amp;O Dashboard password has been reset by an administrator.</p>
      <table style="width:100%;border-collapse:collapse;margin:0 0 16px;font-size:13px">
        <tr><td style="padding:6px 12px 6px 0;color:#6b7280;white-space:nowrap">URL</td><td><a href="${APP_URL}" style="color:#1B3A6B">${APP_URL}</a></td></tr>
        <tr><td style="padding:6px 12px 6px 0;color:#6b7280">Email</td><td>${to}</td></tr>
        <tr><td style="padding:6px 12px 6px 0;color:#6b7280">New Password</td><td style="font-family:monospace;background:#f3f4f6;padding:3px 8px;border-radius:4px">${password}</td></tr>
      </table>
    `),
  });
}

export async function sendLoginReminderEmail(to: string, name: string) {
  await getResend().emails.send({
    from: FROM,
    to,
    subject: 'A&O Dashboard — Your Login Details',
    html: wrap(`
      <p style="font-size:15px;font-weight:600;margin:0 0 8px">Hello ${name},</p>
      <p style="margin:0 0 16px">Here are your A&amp;O Dashboard login details:</p>
      <table style="width:100%;border-collapse:collapse;margin:0 0 16px;font-size:13px">
        <tr><td style="padding:6px 12px 6px 0;color:#6b7280;white-space:nowrap">URL</td><td><a href="${APP_URL}" style="color:#1B3A6B">${APP_URL}</a></td></tr>
        <tr><td style="padding:6px 12px 6px 0;color:#6b7280">Email</td><td>${to}</td></tr>
      </table>
      <p style="font-size:12px;color:#6b7280;margin:0">If you have forgotten your password, contact your administrator.</p>
    `),
  });
}
