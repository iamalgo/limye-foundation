/**
 * _worker.js — Cloudflare Edge Engine for Limyè Foundation (limyefoundation.org)
 *
 * Capabilities:
 *  1. Web-to-CRM Compliance Pipeline (/api/contact) with TCPA/SMS audit telemetry.
 *  2. Telnyx Email API Alerts & Branded Customer Confirmation Receipts (Ref: LMY-2026-XXXX).
 *  3. Odoo 18 JSON-RPC synchronization (Company ID 5: Limyè Foundation, Team ID 5: Intake & Sales).
 *  4. Outbound SMS/MMS dispatch (/api/sms) with automatic Odoo Chatter auditing from +1-888-919-2059.
 *  5. Bidirectional Telnyx SMS/MMS tracking (/api/telnyx/webhook) with MMS attachment extraction.
 *  6. Vapi End-of-Call Webhook (/api/vapi/webhook) logging Jamie AI phone transcripts to Odoo Chatter.
 *  7. Non-blocking async execution (ctx.waitUntil) for ultra-fast visitor responses.
 *  8. Static asset serving with clean URL routing and strict edge security headers.
 */

const DEFAULT_TELNYX_API_KEY = typeof atob === 'function' ? atob('S0VZMDE5RThFQjc4NUE5ODJDQkZFMzlBMzcwMTI0MjdENjVfSGZudVlmQUxrdk1FTWR2R3hQMjc5WQ==') : '';
const DEFAULT_FROM_NUMBER = '+18665469311'; // Verified Toll-Free Line: 1-866-546-9311 (1-866-LIMYE-11)
const DEFAULT_MESSAGING_PROFILE_ID = '4001a0a7-b124-4319-92ac-564e68643b11'; // Limye Foundation Messaging Profile
const DEFAULT_COMPANY_ID = 5; // Limyè Foundation
const DEFAULT_TEAM_ID = 5;    // Limyè Foundation Sales & Intake
const SUPPORT_PHONE = '(205) 300-9531'; // 24/7 AI Navigator Jamie
const DIRECT_PHONE = '(205) 393-7396';

const CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With',
};

const SECURITY_HEADERS = {
    'Strict-Transport-Security': 'max-age=31536000; includeSubDomains; preload',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'SAMEORIGIN',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(self), geolocation=()'
};

// Internal Team Alert Inboxes (leaving off qruffin@iamalgo.com to avoid inbox clutter)
const DEFAULT_ALERT_RECIPIENTS = [
    { email: 'info@limyefoundation.org', name: 'Limyè Foundation Intake' },
    { email: 'qruffin@limyefoundation.org', name: 'Quincy Ruffin' }
];

function jsonResponse(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: {
            ...CORS_HEADERS,
            'Content-Type': 'application/json'
        }
    });
}

// ─────────────────────────────────────────────────────────────
// 1. Odoo 18 JSON-RPC Engine (Company ID 5, Team ID 5)
// ─────────────────────────────────────────────────────────────

/**
 * Executes an arbitrary method on an Odoo model via JSON-RPC with 4-second timeout protection
 */
async function callOdooRpc(env, service, method, args, timeoutMs = 4000) {
    const odooUrl = env.ODOO_URL || 'https://odoo.iamalgo.com';
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const res = await fetch(`${odooUrl}/jsonrpc`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'User-Agent': 'Limye-Edge-Worker/1.0' },
            signal: controller.signal,
            body: JSON.stringify({
                jsonrpc: '2.0',
                method: 'call',
                params: { service, method, args },
                id: Math.floor(Math.random() * 1000000)
            })
        });
        clearTimeout(timer);
        if (!res.ok) {
            throw new Error(`Odoo HTTP error ${res.status}`);
        }
        const data = await res.json();
        if (data.error) {
            throw new Error(data.error.data?.message || data.error.message || 'Odoo RPC exception');
        }
        return data.result;
    } catch (err) {
        clearTimeout(timer);
        throw err;
    }
}

/**
 * Authenticates against Odoo database
 */
async function getOdooAuth(env) {
    const odooDb = env.ODOO_DB || 'IAM_Main';
    const odooUser = env.ODOO_USER || 'Qruffin@iamalgo.com';
    const odooPass = env.ODOO_PASS || 'admin_master_password';
    const uid = await callOdooRpc(env, 'common', 'authenticate', [odooDb, odooUser, odooPass, {}]);
    if (!uid) {
        throw new Error(`Authentication failed for user ${odooUser} on db ${odooDb}`);
    }
    return { uid, odooDb, odooPass };
}

/**
 * Finds existing customer contact in res.partner by phone or email,
 * or creates a new customer profile under Company ID 5 (Limyè Foundation).
 */
async function findOrCreateOdooPartner(env, { name, email, phone, companyName }) {
    try {
        const { uid, odooDb, odooPass } = await getOdooAuth(env);
        const cleanDigits = phone ? phone.replace(/[^0-9]/g, '').slice(-10) : '';
        const companyId = parseInt(env.ODOO_COMPANY_ID || DEFAULT_COMPANY_ID, 10);

        const domain = [['company_id', 'in', [companyId, false]]];
        if (cleanDigits && email) {
            domain.push('|', ['phone', 'ilike', cleanDigits], ['email', '=ilike', email.trim()]);
        } else if (cleanDigits) {
            domain.push(['phone', 'ilike', cleanDigits]);
        } else if (email) {
            domain.push(['email', '=ilike', email.trim()]);
        }

        if (domain.length > 1) {
            const existing = await callOdooRpc(env, 'object', 'execute_kw', [
                odooDb, uid, odooPass, 'res.partner', 'search_read',
                [domain],
                { fields: ['id', 'name', 'phone', 'email'], limit: 1 }
            ]);
            if (existing && existing.length > 0) {
                return existing[0].id;
            }
        }

        const partnerName = name || companyName || (phone ? `Contact (${phone})` : 'New Limyè Intake Contact');
        const partnerId = await callOdooRpc(env, 'object', 'execute_kw', [
            odooDb, uid, odooPass, 'res.partner', 'create',
            [{
                name: partnerName,
                is_company: false,
                company_id: companyId,
                phone: phone || false,
                email: email || false,
                comment: 'Created automatically via Limyè Foundation Web & Telephony Compliance Engine'
            }]
        ]);
        return partnerId;
    } catch (err) {
        console.warn('[Odoo findOrCreateOdooPartner Warning]', err.message);
        return false;
    }
}

/**
 * Posts an activity note / comment into the Chatter of any Odoo model record
 */
async function postToOdooChatter(env, { model, resId, body, subject = 'Activity Log' }) {
    if (!resId) return { success: false, error: 'No resId provided' };

    try {
        const { uid, odooDb, odooPass } = await getOdooAuth(env);

        try {
            const messageId = await callOdooRpc(env, 'object', 'execute_kw', [
                odooDb, uid, odooPass, model, 'message_post',
                [[resId]],
                {
                    body: body,
                    subject: subject,
                    message_type: 'comment',
                    subtype_xmlid: 'mail.mt_note'
                }
            ]);
            return { success: true, messageId };
        } catch (postErr) {
            const messageId = await callOdooRpc(env, 'object', 'execute_kw', [
                odooDb, uid, odooPass, 'mail.message', 'create',
                [{
                    model: model,
                    res_id: resId,
                    body: body,
                    subject: subject,
                    message_type: 'comment'
                }]
            ]);
            return { success: true, messageId };
        }
    } catch (err) {
        return { success: false, error: err.message };
    }
}

/**
 * Creates/synchronizes an Opportunity/Intake in crm.lead under Company 5 and Team 5
 */
async function syncToOdooLead(env, { name, partnerName, contactName, email, phone, description, expectedRevenue = 0, chatterNote }) {
    try {
        const { uid, odooDb, odooPass } = await getOdooAuth(env);
        const companyId = parseInt(env.ODOO_COMPANY_ID || DEFAULT_COMPANY_ID, 10);
        const teamId = parseInt(env.ODOO_TEAM_ID || DEFAULT_TEAM_ID, 10);

        // 1. Locate or create customer contact profile (res.partner)
        const partnerId = await findOrCreateOdooPartner(env, {
            name: contactName || name,
            email: email,
            phone: phone,
            companyName: partnerName
        });

        // 2. Create crm.lead in Odoo under Company 5 and Team 5
        const leadId = await callOdooRpc(env, 'object', 'execute_kw', [
            odooDb, uid, odooPass, 'crm.lead', 'create',
            [{
                name: name,
                partner_id: partnerId || false,
                partner_name: partnerName || false,
                contact_name: contactName || false,
                email_from: email || false,
                phone: phone || false,
                company_id: companyId,
                team_id: teamId,
                description: description || '',
                type: 'opportunity',
                expected_revenue: expectedRevenue ? parseFloat(expectedRevenue) : 0.0
            }]
        ]);

        // 3. Post full conversation / submission to lead chatter
        if (leadId && chatterNote) {
            await postToOdooChatter(env, {
                model: 'crm.lead',
                resId: leadId,
                body: chatterNote,
                subject: 'Inbound Intake & TCPA Compliance Audit'
            });
        }

        // 4. Also post to customer profile chatter if partner exists
        if (partnerId && chatterNote) {
            await postToOdooChatter(env, {
                model: 'res.partner',
                resId: partnerId,
                body: chatterNote,
                subject: 'Intake Record & Telemetry Audit'
            });
        }

        return { success: true, leadId, partnerId };
    } catch (err) {
        console.warn('[Odoo syncToOdooLead Warning]', err.message);
        return { success: false, error: err.message };
    }
}

// ─────────────────────────────────────────────────────────────
// 2. Telnyx Email & SMS/MMS Subsystem
// ─────────────────────────────────────────────────────────────

function formatE164(phone) {
    if (!phone) return null;
    const digits = phone.replace(/\D/g, '');
    if (digits.length === 10) return `+1${digits}`;
    if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
    if (phone.startsWith('+')) return phone;
    return `+1${digits}`;
}

/**
 * Sends rich HTML email via Telnyx Email API (v2)
 */
async function sendTelnyxEmail(env, { to, subject, text, html, replyTo, fromName = 'Limyè Foundation' }) {
    const apiKey = env.TELNYX_API_KEY || DEFAULT_TELNYX_API_KEY;
    const recipients = Array.isArray(to) ? to : [{ email: to }];

    for (const recipient of recipients) {
        const payload = {
            from: `${fromName} <info@limyefoundation.org>`,
            to: recipient.email,
            subject: subject,
            text: text,
            html: html
        };
        if (replyTo) payload.reply_to = replyTo;

        try {
            const res = await fetch('https://api.telnyx.com/v2/email_messages', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(payload)
            });

            if (!res.ok) {
                const errText = await res.text();
                console.warn(`[Telnyx Email Error] ${recipient.email}: ${res.status} - ${errText}`);
            }
        } catch (e) {
            console.warn(`[Telnyx Email Exception] ${recipient.email}: ${e.message}`);
        }
    }
}

/**
 * Sends transactional SMS/MMS via Telnyx Messaging API and logs outbound note into Odoo Chatter
 */
async function sendTelnyxSms(env, { to, text, mediaUrls = [], partnerId = null, leadId = null }) {
    const apiKey = env.TELNYX_API_KEY || DEFAULT_TELNYX_API_KEY;
    const from = env.TELNYX_FROM_NUMBER || DEFAULT_FROM_NUMBER;
    const formattedTo = formatE164(to);

    if (!formattedTo) throw new Error('Invalid recipient phone number');

    const payload = {
        from: from,
        to: formattedTo,
        text: text,
        messaging_profile_id: env.TELNYX_MESSAGING_PROFILE_ID || DEFAULT_MESSAGING_PROFILE_ID
    };

    if (Array.isArray(mediaUrls) && mediaUrls.length > 0) {
        payload.media_urls = mediaUrls;
    }

    const res = await fetch('https://api.telnyx.com/v2/messages', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
    });

    if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Telnyx SMS error ${res.status}: ${errText}`);
    }

    const data = await res.json();
    const messageId = data.data?.id || 'unknown';

    // Log outbound note into Odoo Chatter
    try {
        let mediaHtml = '';
        if (mediaUrls.length > 0) {
            mediaHtml = `
            <div style="margin-top: 8px;">
                <p style="font-size: 11px; font-weight: bold; color: #64748b; margin: 0 0 4px 0;">Attached MMS Media (${mediaUrls.length}):</p>
                <div style="display: flex; flex-wrap: wrap; gap: 8px;">
                    ${mediaUrls.map(url => `
                        <a href="${url}" target="_blank" style="display: inline-block; border: 1px solid #cbd5e1; border-radius: 4px; overflow: hidden; max-width: 120px; text-decoration: none;">
                            <img src="${url}" alt="Outbound MMS" style="width: 100%; height: 80px; object-fit: cover; display: block;" onerror="this.parentElement.innerHTML='<span style=\\'font-size:10px;padding:4px;display:block;color:#0369a1;\\'>[Document Link]</span>'" />
                        </a>
                    `).join('')}
                </div>
            </div>`;
        }

        const chatterBody = `
        <div style="font-family: Arial, sans-serif; padding: 4px;">
            <div style="background-color: #fff7ed; border-left: 4px solid #ea580c; padding: 10px 14px; border-radius: 4px; font-size: 12px;">
                <p style="color: #9a3412; font-weight: bold; margin: 0 0 4px 0;">📤 Outbound SMS/MMS Dispatched (Limyè Foundation)</p>
                <p style="margin: 0 0 4px 0; color: #475569;"><b>To:</b> ${formattedTo} | <b>From:</b> ${from} | <b>ID:</b> <code>${messageId}</code></p>
                <div style="background: #ffffff; padding: 8px 12px; border-radius: 4px; border: 1px solid #fed7aa; color: #1e293b; margin-top: 6px;">
                    ${text}
                </div>
                ${mediaHtml}
            </div>
        </div>`;

        if (partnerId) {
            await postToOdooChatter(env, { model: 'res.partner', resId: partnerId, body: chatterBody, subject: 'Outbound SMS/MMS Record' });
        }
        if (leadId) {
            await postToOdooChatter(env, { model: 'crm.lead', resId: leadId, body: chatterBody, subject: 'Outbound SMS/MMS Record' });
        }
    } catch (chatterErr) {
        console.warn('[Outbound SMS Chatter Warning]', chatterErr.message);
    }

    return data;
}

// ─────────────────────────────────────────────────────────────
// 3. Web-to-CRM Compliance Form Handler (/api/contact)
// ─────────────────────────────────────────────────────────────

async function handleContactForm(request, env, ctx) {
    try {
        const clientIp = request.headers.get('cf-connecting-ip') || 'Unknown IP';
        const clientCountry = request.headers.get('cf-ipcountry') || 'US';
        const userAgent = request.headers.get('user-agent') || 'Unknown UA';

        const data = await request.json();
        const contactName = data.name || data.fullName || 'Prospective Client';
        const senderEmail = data.email || null;
        const senderPhone = data.phone || 'N/A';
        const formType = data.form_type || 'general_inquiry';
        const sourcePage = data.source_page || request.headers.get('referer') || 'https://limyefoundation.org/contact';
        const clientTimestamp = data.client_timestamp || new Date().toISOString();

        const hasTransactional = !!data.consent_transactional;
        const hasMarketing = !!data.consent_marketing;

        const randomRef = Math.floor(1000 + Math.random() * 9000);
        const quoteRef = `LMY-2026-${randomRef}`;

        const subject = `[Limyè Foundation] New Inbound ${formType === 'housing_application' ? 'Housing Application' : 'Inquiry'} - ${contactName} (#${quoteRef})`;

        // Build Internal HTML Alert with TCPA & SMS Opt-In Compliance Audit box
        const alertHtml = `
          <div style="font-family: Arial, sans-serif; max-width: 650px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden; background-color: #ffffff;">
            <div style="background-color: #ea580c; color: #ffffff; padding: 20px 24px; text-align: center;">
              <h2 style="margin: 0; font-size: 20px;">Limyè Foundation &bull; Inbound Client Intake</h2>
              <p style="margin: 6px 0 0 0; color: #ffedd5; font-size: 13px;">Captured via Web-to-CRM Compliance Engine</p>
            </div>
            
            <div style="padding: 24px;">
              <!-- TCPA Compliance Box -->
              <div style="background-color: #fff7ed; border: 1px solid #fdba74; border-radius: 6px; padding: 14px 18px; margin-bottom: 20px;">
                <h4 style="color: #9a3412; margin: 0 0 10px 0; font-size: 13px;">🛡️ TCPA & SMS Opt-In Compliance Audit Trail</h4>
                <table style="width: 100%; border-collapse: collapse; font-size: 12px; line-height: 1.6;">
                  <tr><td style="color: #64748b; width: 160px;"><strong>Client IP Address:</strong></td><td style="font-family: monospace;"><b>${clientIp}</b> (${clientCountry})</td></tr>
                  <tr><td style="color: #64748b;"><strong>Submission Timestamp:</strong></td><td><b>${clientTimestamp}</b></td></tr>
                  <tr><td style="color: #64748b;"><strong>Transactional SMS:</strong></td><td><span style="font-weight: bold; color: ${hasTransactional ? '#15803d' : '#b91c1c'};">${hasTransactional ? '✓ OPTED IN (Affirmative Checkbox)' : '✗ NOT OPTED IN'}</span></td></tr>
                  <tr><td style="color: #64748b;"><strong>Marketing SMS:</strong></td><td><span style="font-weight: bold; color: ${hasMarketing ? '#15803d' : '#b91c1c'};">${hasMarketing ? '✓ OPTED IN (Affirmative Checkbox)' : '✗ NOT OPTED IN'}</span></td></tr>
                  <tr><td style="color: #64748b;"><strong>Submission Source URL:</strong></td><td><a href="${sourcePage}" target="_blank" style="color: #ea580c;">${sourcePage}</a></td></tr>
                  <tr><td style="color: #64748b;"><strong>Form Type:</strong></td><td><b>${formType}</b></td></tr>
                  <tr><td style="color: #64748b;"><strong>Consent Disclosure:</strong></td><td style="font-size: 11px; color: #475569; font-style: italic;">"I consent to receive text messages from Limyè Foundation regarding program intake and supportive services. Reply STOP to cancel, HELP for help. Message & data rates may apply. View Terms and Privacy Policy."</td></tr>
                </table>
              </div>

              <h4 style="color: #0f172a; margin: 0 0 12px 0; font-size: 14px;">📋 Client & Inquiry Details</h4>
              <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
                <tr><td style="padding: 6px 0; color: #64748b; font-weight: bold; width: 140px;">Reference ID:</td><td style="padding: 6px 0; color: #ea580c; font-weight: bold; font-family: monospace;">#${quoteRef}</td></tr>
                <tr><td style="padding: 6px 0; color: #64748b; font-weight: bold;">Full Name:</td><td style="padding: 6px 0; color: #0f172a; font-weight: bold;">${contactName}</td></tr>
                <tr><td style="padding: 6px 0; color: #64748b; font-weight: bold;">Phone:</td><td style="padding: 6px 0; color: #0f172a;"><a href="tel:${senderPhone}">${senderPhone}</a></td></tr>
                <tr><td style="padding: 6px 0; color: #64748b; font-weight: bold;">Email:</td><td style="padding: 6px 0; color: #0f172a;"><a href="mailto:${senderEmail}">${senderEmail || 'N/A'}</a></td></tr>
                ${data.interest || data.service_interest ? `<tr><td style="padding: 6px 0; color: #64748b; font-weight: bold;">Interest/Program:</td><td style="padding: 6px 0; color: #0f172a;">${data.interest || data.service_interest}</td></tr>` : ''}
                ${data.housingNeed ? `<tr><td style="padding: 6px 0; color: #64748b; font-weight: bold;">Housing Need:</td><td style="padding: 6px 0; color: #0f172a;">${data.housingNeed}</td></tr>` : ''}
                ${data.moveInDate ? `<tr><td style="padding: 6px 0; color: #64748b; font-weight: bold;">Desired Move-In:</td><td style="padding: 6px 0; color: #0f172a;">${data.moveInDate}</td></tr>` : ''}
                ${data.incomeSource ? `<tr><td style="padding: 6px 0; color: #64748b; font-weight: bold;">Income Source:</td><td style="padding: 6px 0; color: #0f172a;">${data.incomeSource}</td></tr>` : ''}
                ${data.emergencyName ? `<tr><td style="padding: 6px 0; color: #64748b; font-weight: bold;">Emergency Contact:</td><td style="padding: 6px 0; color: #0f172a;">${data.emergencyName} (${data.emergencyPhone || 'N/A'})</td></tr>` : ''}
              </table>

              ${data.message ? `
                <div style="margin-top: 16px;">
                  <p style="color: #64748b; font-weight: bold; margin: 0 0 6px 0; font-size: 12px;">Client Message:</p>
                  <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 12px; font-size: 13px; color: #334155; white-space: pre-wrap;">${data.message}</div>
                </div>
              ` : ''}
            </div>
            
            <div style="background-color: #f8fafc; padding: 12px 24px; text-align: center; font-size: 11px; color: #94a3b8; border-top: 1px solid #e2e8f0;">
              Limyè Foundation &bull; Tuscaloosa & Huntsville, AL &bull; 501(c)(3) Pending
            </div>
          </div>
        `;

        // Branded Customer Confirmation Receipt Email
        const confirmationHtml = `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden; background-color: #ffffff;">
            <div style="background-color: #ea580c; color: #ffffff; padding: 24px; text-align: center;">
              <h2 style="margin: 0; font-size: 22px;">Limyè Foundation</h2>
              <p style="margin: 6px 0 0 0; color: #ffedd5; font-size: 14px;">Lighting the Way to Independence</p>
            </div>
            <div style="padding: 24px;">
              <p style="font-size: 15px; color: #0f172a; margin-top: 0;">Dear <strong>${contactName}</strong>,</p>
              <p style="font-size: 14px; color: #334155; line-height: 1.6;">
                Thank you for reaching out to <strong>Limyè Foundation</strong>. We have received your submission under reference number <strong style="color: #ea580c; font-family: monospace; font-size: 15px;">#${quoteRef}</strong>.
              </p>
              <div style="background-color: #fff7ed; border-left: 4px solid #ea580c; padding: 14px 18px; margin: 20px 0; border-radius: 4px;">
                <p style="margin: 0 0 6px 0; font-size: 13px; font-weight: bold; color: #9a3412;">Submission Overview:</p>
                <ul style="margin: 0; padding-left: 18px; font-size: 13px; color: #475569; line-height: 1.6;">
                  <li><strong>Reference ID:</strong> #${quoteRef}</li>
                  <li><strong>Status:</strong> Successfully Routed to Program Intake Coordinator</li>
                  ${data.interest || data.service_interest ? `<li><strong>Service Focus:</strong> ${data.interest || data.service_interest}</li>` : ''}
                  ${data.housingNeed ? `<li><strong>Housing Program Need:</strong> ${data.housingNeed}</li>` : ''}
                </ul>
              </div>
              <p style="font-size: 13px; color: #334155; line-height: 1.6;">
                An intake specialist is reviewing your parameters. For immediate assistance, case coordination, or to speak directly with our 24/7 AI assistant Jamie, please call <a href="tel:+12053009531" style="color: #ea580c; font-weight: bold;">(205) 300-9531</a>.
              </p>
              <div style="margin-top: 24px; padding-top: 16px; border-top: 1px solid #e2e8f0; font-size: 11px; color: #64748b; line-height: 1.5;">
                <p style="margin: 0 0 4px 0;"><strong>Compliance & Messaging Notice:</strong></p>
                <p style="margin: 0;">
                  If you opted into SMS notifications, you may receive status updates regarding this request. Standard message and data rates may apply. Message frequency varies. You can reply STOP at any time to unsubscribe, or HELP for help.
                </p>
              </div>
            </div>
            <div style="background-color: #f8fafc; padding: 14px 24px; text-align: center; font-size: 11px; color: #94a3b8; border-top: 1px solid #e2e8f0;">
              Limyè Foundation &bull; Tuscaloosa & Huntsville, AL &bull; 501(c)(3) Pending Non-Profit Organization
            </div>
          </div>
        `;

        // 1. Dispatch Internal Team Alert via Telnyx Email API
        const emailPromise = sendTelnyxEmail(env, {
            to: DEFAULT_ALERT_RECIPIENTS,
            subject: subject,
            text: JSON.stringify({ ...data, quote_ref: quoteRef, client_ip: clientIp, client_timestamp: clientTimestamp }, null, 2),
            html: alertHtml,
            replyTo: senderEmail,
            fromName: 'Limyè Foundation Intake Desk'
        });

        // 2. Dispatch Customer Confirmation Receipt
        let receiptPromise = null;
        if (senderEmail && senderEmail.includes('@')) {
            receiptPromise = sendTelnyxEmail(env, {
                to: senderEmail,
                subject: `Intake Received - Reference #${quoteRef} | Limyè Foundation`,
                text: `Thank you, ${contactName}! We received your request (Ref: #${quoteRef}). An intake coordinator is reviewing your details. 24/7 Hotline: (205) 300-9531.`,
                html: confirmationHtml,
                replyTo: 'info@limyefoundation.org',
                fromName: 'Limyè Foundation'
            });
        }

        // 3. Format Odoo Chatter Compliance Note
        const descriptionText = `Inbound Submission\\nRef: #${quoteRef}\\nContact: ${contactName}\\nEmail: ${senderEmail || 'N/A'}\\nPhone: ${senderPhone}\\nForm Type: ${formType}\\nInterest: ${data.interest || data.service_interest || 'N/A'}\\nHousing Need: ${data.housingNeed || 'N/A'}\\nMove-In Date: ${data.moveInDate || 'N/A'}\\nIncome: ${data.incomeSource || 'N/A'}\\nEmergency Contact: ${data.emergencyName || 'N/A'} (${data.emergencyPhone || 'N/A'})\\nNotes: ${data.message || 'N/A'}`;

        const odooChatterNote = `
<div style="font-family: Arial, sans-serif; padding: 4px;">
    <div style="background-color: #fff7ed; border-left: 4px solid #ea580c; padding: 12px 16px; margin-bottom: 12px; border-radius: 4px;">
        <h4 style="color: #9a3412; margin: 0 0 8px 0; font-size: 13px;">🛡️ TCPA & SMS Compliance Audit Record</h4>
        <table style="font-size: 12px; line-height: 1.6; border-collapse: collapse; width: 100%;">
            <tr><td style="color: #64748b; width: 160px;"><strong>Client IP Address:</strong></td><td style="font-family: monospace;"><b>${clientIp}</b> (${clientCountry})</td></tr>
            <tr><td style="color: #64748b;"><strong>Submission Timestamp:</strong></td><td><b>${clientTimestamp}</b></td></tr>
            <tr><td style="color: #64748b;"><strong>Transactional SMS:</strong></td><td><span style="font-weight: bold; color: ${hasTransactional ? '#15803d' : '#b91c1c'};">${hasTransactional ? '✓ OPTED IN (Affirmative Checkbox)' : '✗ NOT OPTED IN'}</span></td></tr>
            <tr><td style="color: #64748b;"><strong>Marketing SMS:</strong></td><td><span style="font-weight: bold; color: ${hasMarketing ? '#15803d' : '#b91c1c'};">${hasMarketing ? '✓ OPTED IN (Affirmative Checkbox)' : '✗ NOT OPTED IN'}</span></td></tr>
            <tr><td style="color: #64748b;"><strong>Source URL:</strong></td><td><a href="${sourcePage}" target="_blank" style="color: #ea580c;">${sourcePage}</a></td></tr>
            <tr><td style="color: #64748b;"><strong>Form Type:</strong></td><td><b>${formType}</b></td></tr>
            <tr><td style="color: #64748b;"><strong>Consent Disclosure:</strong></td><td style="font-size: 11px; color: #475569; font-style: italic;">"I consent to receive text messages from Limyè Foundation regarding program intake and supportive services. Reply STOP to cancel, HELP for help. Message & data rates may apply. View Terms and Privacy Policy."</td></tr>
        </table>
    </div>

    <h4 style="color: #ea580c; margin: 10px 0 6px 0; font-size: 13px;">📝 Full Client Intake Details</h4>
    <div style="font-size: 12px; line-height: 1.5; white-space: pre-wrap; color: #334155; background: #ffffff; border: 1px solid #fed7aa; padding: 10px 14px; border-radius: 4px;">
${descriptionText}
    </div>
</div>`;

        // 4. Sync to Odoo CRM (Company 5: Limyè Foundation, Team 5: Intake/Sales)
        const odooPromise = syncToOdooLead(env, {
            name: `Intake #${quoteRef} - ${contactName}`,
            partnerName: false,
            contactName: contactName,
            email: senderEmail,
            phone: senderPhone,
            description: descriptionText,
            expectedRevenue: 0,
            chatterNote: odooChatterNote
        });

        // 5. Automated Telnyx SMS confirmation receipt if transactional consent granted
        let smsPromise = null;
        if (hasTransactional && senderPhone && senderPhone !== 'N/A') {
            smsPromise = sendTelnyxSms(env, {
                to: senderPhone,
                text: `Limyè Foundation: Thank you, ${contactName}! We received your intake request (Ref: #${quoteRef}). An intake coordinator is reviewing your details. You can call our 24/7 assistant Jamie anytime at (205) 300-9531. Reply STOP to cancel.`
            }).catch(e => console.warn('[SMS Receipt Error]', e.message));
        }

        // 6. Fast non-blocking response via ctx.waitUntil
        if (ctx && typeof ctx.waitUntil === 'function') {
            ctx.waitUntil(Promise.allSettled([emailPromise, receiptPromise, odooPromise, smsPromise]));
        } else {
            await emailPromise;
            if (receiptPromise) await receiptPromise;
            try { await odooPromise; } catch (e) { console.warn('[Odoo sync notice]', e.message); }
        }

        return jsonResponse({
            success: true,
            quoteRef: quoteRef,
            ref: quoteRef,
            message: 'Your inquiry has been received, routed to our intake team, and recorded in our CRM.'
        });
    } catch (err) {
        console.error('Contact form error:', err);
        return jsonResponse({ error: err.message }, 500);
    }
}

// ─────────────────────────────────────────────────────────────
// 4. Outbound SMS API (/api/sms)
// ─────────────────────────────────────────────────────────────

async function handleSms(request, env) {
    try {
        const body = await request.json();
        const { to, text, mediaUrls = [], partnerId = null, leadId = null } = body;

        if (!to || !text) {
            return jsonResponse({ error: 'Missing required parameters: "to" and "text"' }, 400);
        }

        const result = await sendTelnyxSms(env, { to, text, mediaUrls, partnerId, leadId });
        return jsonResponse({ success: true, result });
    } catch (err) {
        console.error('SMS API error:', err);
        return jsonResponse({ error: err.message }, 500);
    }
}

// ─────────────────────────────────────────────────────────────
// 5. Inbound Telnyx SMS/MMS Webhook (/api/telnyx/webhook)
// ─────────────────────────────────────────────────────────────

async function handleTelnyxWebhook(request, env, ctx) {
    try {
        const body = await request.json();
        const eventType = body.data?.event_type || body.event_type;

        // Acknowledge delivery receipts & outbound status
        if (eventType === 'message.sent' || eventType === 'message.finalized') {
            return jsonResponse({ status: 'message_acknowledged', event: eventType });
        }

        if (eventType !== 'message.received') {
            return jsonResponse({ status: 'ignored_event_type', event: eventType });
        }

        const payload = body.data?.payload || body.payload || {};
        const fromNumber = payload.from?.phone_number || payload.from || 'Unknown';
        const toNumber = payload.to?.[0]?.phone_number || payload.to || 'Unknown';
        const messageText = payload.text || '(No text content)';
        const messageId = payload.id || 'unknown';
        const media = Array.isArray(payload.media) ? payload.media : [];

        // Build rich HTML card with MMS attachments
        let mediaHtml = '';
        if (media.length > 0) {
            mediaHtml = `
            <div style="margin-top: 10px; padding: 10px; background: #fff7ed; border-radius: 6px; border: 1px solid #fed7aa;">
                <p style="font-size: 12px; font-weight: bold; color: #9a3412; margin: 0 0 8px 0;">📎 Attached Media Documents (${media.length}):</p>
                <div style="display: flex; flex-wrap: wrap; gap: 10px;">
                    ${media.map((item, idx) => {
                        const url = typeof item === 'string' ? item : item.url;
                        const contentType = item.content_type || '';
                        const isImg = contentType.startsWith('image/') || url.match(/\.(jpg|jpeg|png|gif|webp)$/i);
                        return `
                        <div style="border: 1px solid #cbd5e1; border-radius: 6px; overflow: hidden; max-width: 140px; background: #ffffff; text-align: center;">
                            ${isImg ? `
                                <a href="${url}" target="_blank">
                                    <img src="${url}" alt="Attachment ${idx+1}" style="width: 100%; height: 90px; object-fit: cover; display: block;" />
                                </a>
                            ` : `
                                <div style="padding: 20px 10px; background: #f1f5f9; color: #475569; font-size: 11px;">
                                    📄 Document
                                </div>
                            `}
                            <a href="${url}" target="_blank" style="display: block; padding: 4px; font-size: 10px; color: #ea580c; text-decoration: none; border-top: 1px solid #e2e8f0; font-weight: bold;">
                                View / Download
                            </a>
                        </div>`;
                    }).join('')}
                </div>
            </div>`;
        }

        const smsChatterNote = `
        <div style="font-family: Arial, sans-serif; padding: 4px;">
            <div style="background-color: #fff7ed; border-left: 4px solid #ea580c; padding: 12px 16px; margin-bottom: 8px; border-radius: 4px;">
                <h4 style="color: #9a3412; margin: 0 0 6px 0; font-size: 13px;">📥 Inbound Telnyx ${media.length > 0 ? 'MMS' : 'SMS'} Received</h4>
                <p style="font-size: 12px; margin: 0 0 6px 0; color: #475569;">
                    <b>From:</b> ${fromNumber} | <b>To:</b> ${toNumber} | <b>ID:</b> <code>${messageId}</code>
                </p>
                <div style="font-size: 13px; line-height: 1.5; color: #1e293b; background: #ffffff; padding: 10px 14px; border-radius: 4px; border: 1px solid #fed7aa;">
                    ${messageText}
                </div>
                ${mediaHtml}
            </div>
        </div>`;

        // 1. Alert Team via Email
        const emailPromise = sendTelnyxEmail(env, {
            to: DEFAULT_ALERT_RECIPIENTS,
            subject: `[Limyè SMS/MMS Alert] Inbound message from ${fromNumber}`,
            text: `Inbound message from ${fromNumber}:\n\n${messageText}\n\nMessage ID: ${messageId}`,
            html: `
                <div style="font-family: Arial, sans-serif; padding: 16px;">
                    <h3 style="color: #ea580c; margin-top: 0;">Limyè Foundation &bull; Inbound SMS/MMS</h3>
                    <p><b>From:</b> ${fromNumber}</p>
                    <p><b>Message:</b> ${messageText}</p>
                    ${mediaHtml}
                </div>
            `,
            fromName: 'Limyè Foundation Telephony'
        });

        // 2. Log directly to Odoo Chatter (res.partner and crm.lead)
        const odooPromise = syncToOdooLead(env, {
            name: `SMS from ${fromNumber}`,
            partnerName: false,
            contactName: `SMS User (${fromNumber})`,
            email: 'info@limyefoundation.org',
            phone: fromNumber,
            description: `Inbound SMS received via Telnyx (+1-888-919-2059):\n\n${messageText}\nMessage ID: ${messageId}`,
            expectedRevenue: 0,
            chatterNote: smsChatterNote
        });

        if (ctx && typeof ctx.waitUntil === 'function') {
            ctx.waitUntil(Promise.allSettled([emailPromise, odooPromise]));
        } else {
            await emailPromise;
            try { await odooPromise; } catch (e) { console.warn('[Odoo Webhook Sync Warning]', e.message); }
        }

        return jsonResponse({ status: 'sms_logged', messageId });
    } catch (err) {
        console.error('Telnyx Webhook error:', err);
        return jsonResponse({ error: err.message }, 500);
    }
}

// ─────────────────────────────────────────────────────────────
// 6. Vapi End-of-Call Webhook (/api/vapi/webhook)
// ─────────────────────────────────────────────────────────────

async function handleVapiWebhook(request, env, ctx) {
    try {
        const body = await request.json();
        const messageType = body.message?.type || body.type;

        // Vapi sends 'end-of-call-report' or 'status-update'
        if (messageType !== 'end-of-call-report' && messageType !== 'transcript') {
            return jsonResponse({ status: 'ignored_event_type', type: messageType });
        }

        const callObj = body.message?.call || body.call || {};
        const customerPhone = callObj.customer?.number || body.message?.customer?.number || 'Unknown Caller';
        const transcript = body.message?.transcript || body.transcript || 'No transcript available';
        const summary = body.message?.summary || body.summary || 'Vapi automated call session completed';
        const recordingUrl = body.message?.recordingUrl || callObj.recordingUrl || null;
        const durationSec = callObj.duration || 0;

        const vapiChatterNote = `
        <div style="font-family: Arial, sans-serif; padding: 4px;">
            <div style="background-color: #f0fdf4; border-left: 4px solid #16a34a; padding: 12px 16px; margin-bottom: 8px; border-radius: 4px;">
                <h4 style="color: #166534; margin: 0 0 6px 0; font-size: 13px;">🎙️ Jamie AI Call Session &bull; Vapi Telephony Report</h4>
                <p style="font-size: 12px; margin: 0 0 6px 0; color: #475569;">
                    <b>Caller:</b> ${customerPhone} | <b>Duration:</b> ${Math.round(durationSec)}s | <b>Assistant:</b> Jamie (205-300-9531)
                </p>
                ${recordingUrl ? `<p style="margin: 0 0 8px 0;"><a href="${recordingUrl}" target="_blank" style="color: #16a34a; font-size: 12px; font-weight: bold;">▶ Listen to Call Audio Recording</a></p>` : ''}
                
                <div style="margin-bottom: 10px;">
                    <p style="font-size: 11px; font-weight: bold; color: #166534; margin: 0 0 4px 0;">Executive Summary:</p>
                    <div style="font-size: 12px; line-height: 1.5; color: #1e293b; background: #ffffff; padding: 8px 12px; border-radius: 4px; border: 1px solid #bbf7d0;">
                        ${summary}
                    </div>
                </div>

                <div>
                    <p style="font-size: 11px; font-weight: bold; color: #475569; margin: 0 0 4px 0;">Full Call Transcript:</p>
                    <div style="font-size: 11px; line-height: 1.5; color: #334155; background: #ffffff; padding: 8px 12px; border-radius: 4px; border: 1px solid #e2e8f0; max-height: 250px; overflow-y: auto; white-space: pre-wrap;">
${transcript}
                    </div>
                </div>
            </div>
        </div>`;

        // 1. Email Team Alert
        const emailPromise = sendTelnyxEmail(env, {
            to: DEFAULT_ALERT_RECIPIENTS,
            subject: `[Jamie AI Call] Call Report from ${customerPhone}`,
            text: `Jamie AI call with ${customerPhone}:\n\nSummary:\n${summary}\n\nTranscript:\n${transcript}`,
            html: `
                <div style="font-family: Arial, sans-serif; padding: 16px;">
                    <h3 style="color: #16a34a; margin-top: 0;">Limyè Foundation &bull; Jamie AI Call Completed</h3>
                    <p><b>Caller Phone:</b> ${customerPhone}</p>
                    <p><b>Call Duration:</b> ${Math.round(durationSec)} seconds</p>
                    ${recordingUrl ? `<p><a href="${recordingUrl}">Listen to Audio Recording</a></p>` : ''}
                    <div style="background: #f8fafc; padding: 12px; border-radius: 6px; border: 1px solid #e2e8f0; margin-top: 12px;">
                        <h4>Summary:</h4>
                        <p>${summary}</p>
                        <h4>Transcript:</h4>
                        <pre style="white-space: pre-wrap; font-size: 11px;">${transcript}</pre>
                    </div>
                </div>
            `,
            fromName: 'Jamie AI Navigator'
        });

        // 2. Sync to Odoo CRM & Chatter
        const odooPromise = syncToOdooLead(env, {
            name: `Jamie AI Call - ${customerPhone}`,
            partnerName: false,
            contactName: `Caller (${customerPhone})`,
            email: 'info@limyefoundation.org',
            phone: customerPhone,
            description: `Vapi Call Session with Jamie (205-300-9531):\nSummary: ${summary}\n\nTranscript:\n${transcript}`,
            expectedRevenue: 0,
            chatterNote: vapiChatterNote
        });

        if (ctx && typeof ctx.waitUntil === 'function') {
            ctx.waitUntil(Promise.allSettled([emailPromise, odooPromise]));
        } else {
            await emailPromise;
            try { await odooPromise; } catch (e) { console.warn('[Odoo Vapi Sync Warning]', e.message); }
        }

        return jsonResponse({ status: 'vapi_call_logged' });
    } catch (err) {
        console.error('Vapi Webhook error:', err);
        return jsonResponse({ error: err.message }, 500);
    }
}

// ─────────────────────────────────────────────────────────────
// 7. Telnyx Voice & AI Assistant Webhook (/api/telnyx/voice-webhook)
// ─────────────────────────────────────────────────────────────

async function handleTelnyxVoiceWebhook(request, env, ctx) {
    try {
        let callerPhone = 'Unknown Caller';
        let durationSec = 0;
        let recordingUrl = null;
        let transcript = 'No transcript captured';
        let summary = 'Telnyx Voice AI session completed';
        let callSid = 'unknown';

        const contentType = request.headers.get('content-type') || '';

        if (contentType.includes('application/json')) {
            const body = await request.json();
            const payload = body.data?.payload || body.payload || body;
            callerPhone = payload.from || payload.caller_phone || 'Unknown Caller';
            durationSec = payload.duration_secs || payload.call_duration || 0;
            recordingUrl = payload.recording_url || null;
            transcript = payload.transcription_text || payload.transcript || summary;
            summary = payload.summary || summary;
            callSid = payload.call_control_id || payload.call_sid || body.data?.id || 'unknown';
        } else {
            // Form URL Encoded (standard TeXML callback)
            const formData = await request.formData();
            callerPhone = formData.get('From') || formData.get('Caller') || 'Unknown Caller';
            durationSec = parseFloat(formData.get('CallDuration') || '0');
            recordingUrl = formData.get('RecordingUrl') || null;
            transcript = formData.get('TranscriptionText') || formData.get('Transcript') || 'Call session completed';
            summary = formData.get('Summary') || `Inbound call completed via Harry (Duration: ${durationSec}s)`;
            callSid = formData.get('CallSid') || 'unknown';
        }

        const voiceChatterNote = `
        <div style="font-family: Arial, sans-serif; padding: 4px;">
            <div style="background-color: #f0fdf4; border-left: 4px solid #16a34a; padding: 12px 16px; margin-bottom: 8px; border-radius: 4px;">
                <h4 style="color: #166534; margin: 0 0 6px 0; font-size: 13px;">🎙️ Harry AI Call Session &bull; Telnyx Telephony Report</h4>
                <p style="font-size: 12px; margin: 0 0 6px 0; color: #475569;">
                    <b>Caller:</b> ${callerPhone} | <b>Duration:</b> ${Math.round(durationSec)}s | <b>Toll-Free Line:</b> 1-866-546-9311 (1-866-LIMYE-11)
                </p>
                <p style="font-size: 11px; margin: 0 0 6px 0; color: #64748b;"><b>Assistant:</b> Harry (Limyè Foundation Inbound Coordinator) | <b>Call SID:</b> <code>${callSid}</code></p>
                ${recordingUrl ? `<p style="margin: 0 0 8px 0;"><a href="${recordingUrl}" target="_blank" style="color: #16a34a; font-size: 12px; font-weight: bold;">▶ Listen to Audio Recording</a></p>` : ''}
                
                <div style="margin-bottom: 10px;">
                    <p style="font-size: 11px; font-weight: bold; color: #166534; margin: 0 0 4px 0;">Call Summary:</p>
                    <div style="font-size: 12px; line-height: 1.5; color: #1e293b; background: #ffffff; padding: 8px 12px; border-radius: 4px; border: 1px solid #bbf7d0;">
                        ${summary}
                    </div>
                </div>

                <div>
                    <p style="font-size: 11px; font-weight: bold; color: #475569; margin: 0 0 4px 0;">Conversation Record / Transcript:</p>
                    <div style="font-size: 11px; line-height: 1.5; color: #334155; background: #ffffff; padding: 8px 12px; border-radius: 4px; border: 1px solid #e2e8f0; max-height: 250px; overflow-y: auto; white-space: pre-wrap;">
${transcript}
                    </div>
                </div>
            </div>
        </div>`;

        // 1. Email Team Alert
        const emailPromise = sendTelnyxEmail(env, {
            to: DEFAULT_ALERT_RECIPIENTS,
            subject: `[Harry AI Call] Toll-Free Intake Call from ${callerPhone}`,
            text: `Harry AI toll-free call from ${callerPhone} (1-866-546-9311):\n\nSummary:\n${summary}\n\nTranscript:\n${transcript}`,
            html: `
                <div style="font-family: Arial, sans-serif; padding: 16px;">
                    <h3 style="color: #16a34a; margin-top: 0;">Limyè Foundation &bull; Harry AI Call Completed</h3>
                    <p><b>Caller Phone:</b> ${callerPhone}</p>
                    <p><b>Toll-Free Number:</b> 1-866-546-9311 (1-866-LIMYE-11)</p>
                    <p><b>Call Duration:</b> ${Math.round(durationSec)} seconds</p>
                    ${recordingUrl ? `<p><a href="${recordingUrl}">Listen to Audio Recording</a></p>` : ''}
                    <div style="background: #f8fafc; padding: 12px; border-radius: 6px; border: 1px solid #e2e8f0; margin-top: 12px;">
                        <h4>Summary:</h4>
                        <p>${summary}</p>
                        <h4>Transcript:</h4>
                        <pre style="white-space: pre-wrap; font-size: 11px;">${transcript}</pre>
                    </div>
                </div>
            `,
            fromName: 'Harry AI Intake Coordinator'
        });

        // 2. Sync to Odoo CRM & Chatter
        const odooPromise = syncToOdooLead(env, {
            name: `Harry AI Call - ${callerPhone}`,
            partnerName: false,
            contactName: `Caller (${callerPhone})`,
            email: 'info@limyefoundation.org',
            phone: callerPhone,
            description: `Telnyx Toll-Free Call with Harry (1-866-546-9311 / 1-866-LIMYE-11):\nDuration: ${Math.round(durationSec)}s\nSummary: ${summary}\n\nTranscript:\n${transcript}`,
            expectedRevenue: 0,
            chatterNote: voiceChatterNote
        });

        if (ctx && typeof ctx.waitUntil === 'function') {
            ctx.waitUntil(Promise.allSettled([emailPromise, odooPromise]));
        } else {
            await emailPromise;
            try { await odooPromise; } catch (e) { console.warn('[Odoo Voice Sync Warning]', e.message); }
        }

        return jsonResponse({ status: 'voice_call_logged' });
    } catch (err) {
        console.error('Telnyx Voice Webhook error:', err);
        return jsonResponse({ error: err.message }, 500);
    }
}

// ─────────────────────────────────────────────────────────────
// 8. Cloudflare Worker Entry Point
// ─────────────────────────────────────────────────────────────

export default {
    async fetch(request, env, ctx) {
        const url = new URL(request.url);

        // 1. Handle CORS Preflight
        if (request.method === 'OPTIONS') {
            const apiRoutes = ['/api/contact', '/api/sms', '/api/telnyx/webhook', '/api/telnyx/voice-webhook', '/api/vapi/webhook', '/api/submit-housing-form', '/api/submit-contact-form', '/api/subscribe-newsletter'];
            if (apiRoutes.includes(url.pathname)) {
                return new Response(null, { status: 204, headers: CORS_HEADERS });
            }
        }

        // 2. Health check
        if (url.pathname === '/api/test-check') {
            return new Response(JSON.stringify({ ok: true, service: 'Limye Foundation Edge Engine', timestamp: Date.now() }), {
                headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
            });
        }

        // 3. API Endpoints
        if (request.method === 'POST' && (url.pathname === '/api/contact' || url.pathname === '/api/submit-housing-form' || url.pathname === '/api/submit-contact-form' || url.pathname === '/api/subscribe-newsletter')) {
            return handleContactForm(request, env, ctx);
        }

        if (request.method === 'POST' && url.pathname === '/api/sms') {
            return handleSms(request, env);
        }

        if (request.method === 'POST' && url.pathname === '/api/telnyx/webhook') {
            return handleTelnyxWebhook(request, env, ctx);
        }

        if (request.method === 'POST' && url.pathname === '/api/telnyx/voice-webhook') {
            return handleTelnyxVoiceWebhook(request, env, ctx);
        }

        if (request.method === 'POST' && url.pathname === '/api/vapi/webhook') {
            return handleVapiWebhook(request, env, ctx);
        }

        // 4. Static Assets & Clean URL Routing
        if (env.ASSETS && typeof env.ASSETS.fetch === 'function') {
            // Clean routing mapping: /housing -> /housing.html, etc.
            const cleanUrlMap = {
                '/housing': '/housing.html',
                '/transportation': '/transportation.html',
                '/nutrition': '/nutrition.html',
                '/about': '/about.html',
                '/contact': '/contact.html',
                '/sms-opt-in': '/sms-opt-in.html',
                '/terms': '/terms.html',
                '/privacy': '/privacy.html',
                '/disclosures': '/disclosures.html'
            };

            let targetReq = request;
            if (request.method === 'GET' && cleanUrlMap[url.pathname]) {
                const rewriteUrl = new URL(cleanUrlMap[url.pathname], request.url);
                targetReq = new Request(rewriteUrl.toString(), {
                    method: 'GET',
                    headers: request.headers
                });
            }

            const assetResponse = await env.ASSETS.fetch(targetReq);
            const newHeaders = new Headers(assetResponse.headers);
            for (const [k, v] of Object.entries(SECURITY_HEADERS)) {
                newHeaders.set(k, v);
            }

            // Special rules for llms.txt & llms-full.txt
            if (url.pathname === '/llms.txt' || url.pathname === '/llms-full.txt') {
                newHeaders.set('Access-Control-Allow-Origin', '*');
                newHeaders.set('Cache-Control', 'public, max-age=3600');
            }

            return new Response(assetResponse.body, {
                status: assetResponse.status,
                statusText: assetResponse.statusText,
                headers: newHeaders
            });
        }

        return new Response('Limyè Foundation Edge Engine Active', { status: 200 });
    }
};
