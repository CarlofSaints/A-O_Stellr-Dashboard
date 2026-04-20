import { NextRequest, NextResponse } from 'next/server';
import { Resend } from 'resend';

export const dynamic = 'force-dynamic';

const FROM = 'A&O Dashboard <noreply@outerjoin.co.za>';

function getResend() {
  if (!process.env.RESEND_API_KEY) throw new Error('RESEND_API_KEY not set');
  return new Resend(process.env.RESEND_API_KEY);
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { emails, filename, xlsxBase64, senderName } = body as {
      emails: string[];
      filename: string;
      xlsxBase64: string;
      senderName: string;
    };

    if (!emails || !Array.isArray(emails) || emails.length === 0) {
      return NextResponse.json({ error: 'At least one email address is required' }, { status: 400 });
    }
    if (!xlsxBase64 || !filename) {
      return NextResponse.json({ error: 'filename and xlsxBase64 are required' }, { status: 400 });
    }

    // Validate each email
    const invalid = emails.filter(e => !EMAIL_RE.test(e));
    if (invalid.length > 0) {
      return NextResponse.json({ error: `Invalid email(s): ${invalid.join(', ')}` }, { status: 400 });
    }

    // Cap at 10 recipients to prevent abuse
    if (emails.length > 10) {
      return NextResponse.json({ error: 'Maximum 10 recipients per send' }, { status: 400 });
    }

    const buffer = Buffer.from(xlsxBase64, 'base64');
    const sizeMB = (buffer.length / (1024 * 1024)).toFixed(1);

    // Hard cap at 10 MB (Resend limit)
    if (buffer.length > 10 * 1024 * 1024) {
      return NextResponse.json({ error: `File too large (${sizeMB} MB). Maximum attachment size is 10 MB.` }, { status: 400 });
    }

    const resend = getResend();

    await resend.emails.send({
      from: FROM,
      to: emails,
      subject: `A&O Visit Report — ${filename.replace('.xlsx', '')}`,
      html: `
        <div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;color:#222">
          <div style="background:#1B3A6B;padding:20px 24px;border-radius:8px 8px 0 0">
            <p style="color:#fff;font-size:16px;font-weight:bold;margin:0">A&amp;O Interactive Services</p>
            <p style="color:#93c5fd;font-size:12px;margin:4px 0 0">Visit Report</p>
          </div>
          <div style="background:#fff;border:1px solid #e5e7eb;border-top:none;padding:24px;border-radius:0 0 8px 8px">
            <p style="font-size:14px;margin:0 0 12px">Hi,</p>
            <p style="font-size:14px;margin:0 0 16px">Please find attached the visit report <strong>${filename}</strong>.</p>
            <p style="font-size:13px;color:#6b7280;margin:0 0 4px">Sent by: ${senderName || 'A&O Dashboard'}</p>
            <p style="font-size:13px;color:#6b7280;margin:0 0 0">File size: ${sizeMB} MB</p>
            <hr style="border:none;border-top:1px solid #f3f4f6;margin:20px 0">
            <p style="color:#9ca3af;font-size:11px">This is an automated message from the A&amp;O Dashboard system.</p>
          </div>
        </div>
      `,
      attachments: [
        {
          filename,
          content: buffer,
        },
      ],
    });

    return NextResponse.json({ ok: true, sentTo: emails.length, sizeMB });
  } catch (err) {
    console.error('Visit report email error:', err);
    const msg = err instanceof Error ? err.message : 'Email send failed';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
