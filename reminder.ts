import { createClient } from '@supabase/supabase-js';
import nodemailer from 'nodemailer';
import twilio from 'twilio';

// ── Config ──────────────────────────────────────────────────────────────
const supabaseUrl = process.env.VITE_SUPABASE_URL || '';
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const smtpEmail = process.env.SMTP_EMAIL || '';
const smtpPassword = process.env.SMTP_PASSWORD || '';
const twilioSid = process.env.TWILIO_ACCOUNT_SID || '';
const twilioToken = process.env.TWILIO_AUTH_TOKEN || '';
const twilioWhatsAppFrom = process.env.TWILIO_WHATSAPP_FROM || '';

if (!serviceRoleKey) {
  console.error('❌ SUPABASE_SERVICE_ROLE_KEY is required');
  process.exit(1);
}
if (!smtpEmail || !smtpPassword) {
  console.error('❌ SMTP_EMAIL and SMTP_PASSWORD are required in .env');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey);

// Twilio client (optional — only if credentials provided)
const twilioClient = twilioSid && twilioToken ? twilio(twilioSid, twilioToken) : null;
const whatsappEnabled = !!(twilioClient && twilioWhatsAppFrom);

// Gmail SMTP transport
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: smtpEmail,
    pass: smtpPassword,
  },
});

// ── Email Template ──────────────────────────────────────────────────────
function buildEmail(reminder: any) {
  const deadlineDate = new Date(reminder.deadline);
  const formattedDeadline = deadlineDate.toLocaleString('en-IN', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Kolkata',
  });

  return {
    from: `"OppTracker 🚀" <${smtpEmail}>`,
    to: reminder.email,
    subject: `⏰ Reminder: ${reminder.role} at ${reminder.company} — Deadline in ~12 hours!`,
    html: `
      <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 520px; margin: 0 auto; padding: 32px; background: #f8fafc; border-radius: 16px;">
        <div style="background: linear-gradient(135deg, #3b82f6, #8b5cf6); border-radius: 12px; padding: 24px; color: white; text-align: center; margin-bottom: 24px;">
          <h1 style="margin: 0; font-size: 22px;">⏰ Deadline Reminder</h1>
          <p style="margin: 8px 0 0; opacity: 0.9; font-size: 14px;">Don't miss this opportunity!</p>
        </div>
        
        <div style="background: white; border-radius: 12px; padding: 24px; border: 1px solid #e2e8f0;">
          <h2 style="margin: 0 0 4px; font-size: 18px; color: #1e293b;">${reminder.role}</h2>
          <p style="margin: 0 0 16px; color: #64748b; font-size: 14px;">🏢 ${reminder.company}</p>
          
          <div style="background: #fef3c7; border-radius: 8px; padding: 16px; text-align: center; margin-bottom: 16px;">
            <p style="margin: 0; font-size: 14px; color: #92400e; font-weight: 600;">
              📅 Deadline: ${formattedDeadline}
            </p>
            <p style="margin: 4px 0 0; font-size: 12px; color: #a16207;">
              Less than 12 hours remaining!
            </p>
          </div>
          
          <p style="color: #475569; font-size: 14px; line-height: 1.6;">
            This is a friendly reminder that the application deadline for <strong>${reminder.role}</strong> at <strong>${reminder.company}</strong> is approaching. Make sure to submit your application before it closes!
          </p>
        </div>
        
        <p style="text-align: center; color: #94a3b8; font-size: 12px; margin-top: 16px;">
          Sent by OppTracker • You set this reminder on our platform
        </p>
      </div>
    `,
  };
}

// ── WhatsApp Message Builder ────────────────────────────────────────────
function buildWhatsAppMessage(reminder: any) {
  const deadlineDate = new Date(reminder.deadline);
  const formattedDeadline = deadlineDate.toLocaleString('en-IN', {
    weekday: 'short', year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata',
  });
  return `⏰ *Deadline Reminder!*\n\n🏢 *${reminder.company}*\n💼 ${reminder.role}\n📅 Deadline: ${formattedDeadline}\n\nDon't forget to submit your application before it closes! 🚀\n\n— OppTracker`;
}

// ── Send WhatsApp ───────────────────────────────────────────────────────
async function sendWhatsApp(userId: string, reminder: any) {
  if (!whatsappEnabled) return;

  // Look up user's WhatsApp number from profile
  const { data: profile } = await supabase
    .from('user_profiles')
    .select('phone, whatsapp_number, notification_whatsapp')
    .eq('id', userId)
    .single();

  const whatsappNum = profile?.whatsapp_number || profile?.phone;
  if (!whatsappNum || profile?.notification_whatsapp === false) return;

  // Format number — ensure it starts with whatsapp:+
  let toNumber = whatsappNum.replace(/[\s-]/g, '');
  if (!toNumber.startsWith('+')) toNumber = '+91' + toNumber; // default India
  if (!toNumber.startsWith('whatsapp:')) toNumber = 'whatsapp:' + toNumber;

  try {
    await twilioClient!.messages.create({
      body: buildWhatsAppMessage(reminder),
      from: twilioWhatsAppFrom,
      to: toNumber,
    });
    console.log(`  📱 WhatsApp sent to ${toNumber}`);
  } catch (err: any) {
    console.error(`  ⚠️ WhatsApp failed for ${toNumber}: ${err.message}`);
  }
}

// ── Checker Loop ────────────────────────────────────────────────────────
async function checkAndSendReminders() {
  const now = new Date().toISOString();

  // Fetch unsent reminders where remind_at has passed
  const { data: reminders, error } = await supabase
    .from('reminders')
    .select('*')
    .eq('sent', false)
    .lte('remind_at', now);

  if (error) {
    console.error('❌ Error fetching reminders:', error.message);
    return;
  }

  if (!reminders || reminders.length === 0) {
    return; // Nothing to send
  }

  console.log(`📬 Found ${reminders.length} reminder(s) to send...`);

  for (const reminder of reminders) {
    try {
      // Send email
      const mailOptions = buildEmail(reminder);
      await transporter.sendMail(mailOptions);
      console.log(`  ✉️ Email sent to ${reminder.email}`);

      // Send WhatsApp
      await sendWhatsApp(reminder.user_id, reminder);

      // Mark as sent
      await supabase
        .from('reminders')
        .update({ sent: true })
        .eq('id', reminder.id);

      console.log(`  ✅ Done: "${reminder.role}" at ${reminder.company}`);
    } catch (err: any) {
      console.error(`  ❌ Failed for ${reminder.email}: ${err.message}`);
    }
  }
}

// ── Main Loop ───────────────────────────────────────────────────────────
const CHECK_INTERVAL_MS = 10 * 1000; // 10 seconds

console.log('📧 OppTracker Reminder Service started!');
console.log(`   Checking every ${CHECK_INTERVAL_MS / 1000} seconds for due reminders...`);
console.log(`   📧 Email: ${smtpEmail}`);
console.log(`   📱 WhatsApp: ${whatsappEnabled ? 'ENABLED (' + twilioWhatsAppFrom + ')' : 'DISABLED (no Twilio credentials)'}`);
console.log('');

// Run on start and on interval
checkAndSendReminders();
setInterval(checkAndSendReminders, CHECK_INTERVAL_MS);
