/**
 * functions/api/contact.js — Cloudflare Pages Function for Limyè Foundation Web-to-CRM Compliance Pipeline
 */

const DEFAULT_TELNYX_API_KEY = typeof atob === 'function' ? atob('S0VZMDE5RThFQjc4NUE5ODJDQkZFMzlBMzcwMTI0MjdENjVfSGZudVlmQUxrdk1FTWR2R3hQMjc5WQ==') : '';
const DEFAULT_FROM_NUMBER = '+18665469311'; // 1-866-546-9311 (1-866-LIMYE-11)
const DEFAULT_MESSAGING_PROFILE_ID = '4001a0a7-b124-4319-92ac-564e68643b11'; // Limye Foundation Messaging Profile
const DEFAULT_COMPANY_ID = 5; // Limyè Foundation
const DEFAULT_TEAM_ID = 5;    // Limyè Foundation Sales & Intake

const CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With',
};

const DEFAULT_ALERT_RECIPIENTS = [
    { email: 'info@limyefoundation.org', name: 'Limyè Foundation Intake' },
    { email: 'qruffin@limyefoundation.org', name: 'Quincy Ruffin' }
];

function jsonResponse(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
    });
}

async function callOdooRpc(env, service, method, args, timeoutMs = 4000) {
    const odooUrl = env.ODOO_URL || 'https://odoo.iamalgo.com';
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const res = await fetch(`${odooUrl}/jsonrpc`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'User-Agent': 'Limye-Pages-Function/1.0' },
            signal: controller.signal,
            body: JSON.stringify({
                jsonrpc: '2.0',
                method: 'call',
                params: { service, method, args },
                id: Math.floor(Math.random() * 1000000)
            })
        });
        clearTimeout(timer);
        if (!res.ok) throw new Error(`Odoo HTTP error ${res.status}`);
        const data = await res.json();
        if (data.error) throw new Error(data.error.data?.message || data.error.message || 'Odoo RPC exception');
        return data.result;
    } catch (err) {
        clearTimeout(timer);
        throw err;
    }
}

async function getOdooAuth(env) {
    const odooDb = env.ODOO_DB || 'IAM_Main';
    const odooUser = env.ODOO_USER || 'Qruffin@iamalgo.com';
    const odooPass = env.ODOO_PASS || 'admin_master_password';
    const uid = await callOdooRpc(env, 'common', 'authenticate', [odooDb, odooUser, odooPass, {}]);
    if (!uid) throw new Error(`Authentication failed for ${odooUser}`);
    return { uid, odooDb, odooPass };
}

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
            if (existing && existing.length > 0) return existing[0].id;
        }

        const partnerName = name || companyName || (phone ? `Contact (${phone})` : 'New Limyè Intake Contact');
        return await callOdooRpc(env, 'object', 'execute_kw', [
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
    } catch (err) {
        console.warn('[Odoo findOrCreateOdooPartner Warning]', err.message);
        return false;
    }
}

async function postToOdooChatter(env, { model, resId, body, subject = 'Activity Log' }) {
    if (!resId) return { success: false, error: 'No resId' };
    try {
        const { uid, odooDb, odooPass } = await getOdooAuth(env);
        try {
            const messageId = await callOdooRpc(env, 'object', 'execute_kw', [
                odooDb, uid, odooPass, model, 'message_post',
                [[resId]],
                { body, subject, message_type: 'comment', subtype_xmlid: 'mail.mt_note' }
            ]);
            return { success: true, messageId };
        } catch {
            const messageId = await callOdooRpc(env, 'object', 'execute_kw', [
                odooDb, uid, odooPass, 'mail.message', 'create',
                [{ model, res_id: resId, body, subject, message_type: 'comment' }]
            ]);
            return { success: true, messageId };
        }
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function syncToOdooLead(env, { name, partnerName, contactName, email, phone, description, expectedRevenue = 0, chatterNote }) {
    try {
        const { uid, odooDb, odooPass } = await getOdooAuth(env);
        const companyId = parseInt(env.ODOO_COMPANY_ID || DEFAULT_COMPANY_ID, 10);
        const teamId = parseInt(env.ODOO_TEAM_ID || DEFAULT_TEAM_ID, 10);

        const partnerId = await findOrCreateOdooPartner(env, {
            name: contactName || name,
            email,
            phone,
            companyName: partnerName
        });

        const leadId = await callOdooRpc(env, 'object', 'execute_kw', [
            odooDb, uid, odooPass, 'crm.lead', 'create',
            [{
                name,
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

        if (leadId && chatterNote) {
            await postToOdooChatter(env, { model: 'crm.lead', resId: leadId, body: chatterNote, subject: 'Inbound Intake & TCPA Compliance Audit' });
        }
        if (partnerId && chatterNote) {
            await postToOdooChatter(env, { model: 'res.partner', resId: partnerId, body: chatterNote, subject: 'Intake Record & Telemetry Audit' });
        }

        return { success: true, leadId, partnerId };
    } catch (err) {
        console.warn('[Odoo syncToOdooLead Warning]', err.message);
        return { success: false, error: err.message };
    }
}

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
            await fetch('https://api.telnyx.com/v2/email_messages', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(payload)
            });
        } catch (e) {
            console.warn(`[Telnyx Email Exception] ${recipient.email}: ${e.message}`);
        }
    }
}

async function sendTelnyxSms(env, { to, text }) {
    const apiKey = env.TELNYX_API_KEY || DEFAULT_TELNYX_API_KEY;
    const from = env.TELNYX_FROM_NUMBER || DEFAULT_FROM_NUMBER;
    const digits = to.replace(/\D/g, '');
    const formattedTo = digits.length === 10 ? `+1${digits}` : (to.startsWith('+') ? to : `+${digits}`);

    return fetch('https://api.telnyx.com/v2/messages', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            from: from,
            to: formattedTo,
            text: text,
            messaging_profile_id: env.TELNYX_MESSAGING_PROFILE_ID || DEFAULT_MESSAGING_PROFILE_ID
        })
    });
}

export async function onRequestOptions() {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export async function onRequestPost({ request, env, waitUntil }) {
    try {
        const clientIp = request.headers.get('cf-connecting-ip') || 'Unknown IP';
        const clientCountry = request.headers.get('cf-ipcountry') || 'US';
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

        const alertHtml = `
          <div style="font-family: Arial, sans-serif; max-width: 650px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden; background-color: #ffffff;">
            <div style="background-color: #ea580c; color: #ffffff; padding: 20px 24px; text-align: center;">
              <h2 style="margin: 0; font-size: 20px;">Limyè Foundation &bull; Inbound Client Intake</h2>
              <p style="margin: 6px 0 0 0; color: #ffedd5; font-size: 13px;">Captured via Web-to-CRM Compliance Engine</p>
            </div>
            <div style="padding: 24px;">
              <div style="background-color: #fff7ed; border: 1px solid #fdba74; border-radius: 6px; padding: 14px 18px; margin-bottom: 20px;">
                <h4 style="color: #9a3412; margin: 0 0 10px 0; font-size: 13px;">🛡️ TCPA & SMS Opt-In Compliance Audit Trail</h4>
                <table style="width: 100%; border-collapse: collapse; font-size: 12px; line-height: 1.6;">
                  <tr><td style="color: #64748b; width: 160px;"><strong>Client IP Address:</strong></td><td style="font-family: monospace;"><b>${clientIp}</b> (${clientCountry})</td></tr>
                  <tr><td style="color: #64748b;"><strong>Submission Timestamp:</strong></td><td><b>${clientTimestamp}</b></td></tr>
                  <tr><td style="color: #64748b;"><strong>Transactional SMS:</strong></td><td><span style="font-weight: bold; color: ${hasTransactional ? '#15803d' : '#b91c1c'};">${hasTransactional ? '✓ OPTED IN (Affirmative Checkbox)' : '✗ NOT OPTED IN'}</span></td></tr>
                  <tr><td style="color: #64748b;"><strong>Marketing SMS:</strong></td><td><span style="font-weight: bold; color: ${hasMarketing ? '#15803d' : '#b91c1c'};">${hasMarketing ? '✓ OPTED IN (Affirmative Checkbox)' : '✗ NOT OPTED IN'}</span></td></tr>
                  <tr><td style="color: #64748b;"><strong>Submission Source URL:</strong></td><td><a href="${sourcePage}" target="_blank" style="color: #ea580c;">${sourcePage}</a></td></tr>
                  <tr><td style="color: #64748b;"><strong>Form Type:</strong></td><td><b>${formType}</b></td></tr>
                </table>
              </div>
              <h4 style="color: #0f172a; margin: 0 0 12px 0; font-size: 14px;">📋 Client & Inquiry Details</h4>
              <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
                <tr><td style="padding: 6px 0; color: #64748b; font-weight: bold; width: 140px;">Reference ID:</td><td style="padding: 6px 0; color: #ea580c; font-weight: bold; font-family: monospace;">#${quoteRef}</td></tr>
                <tr><td style="padding: 6px 0; color: #64748b; font-weight: bold;">Full Name:</td><td style="padding: 6px 0; color: #0f172a; font-weight: bold;">${contactName}</td></tr>
                <tr><td style="padding: 6px 0; color: #64748b; font-weight: bold;">Phone:</td><td style="padding: 6px 0; color: #0f172a;">${senderPhone}</td></tr>
                <tr><td style="padding: 6px 0; color: #64748b; font-weight: bold;">Email:</td><td style="padding: 6px 0; color: #0f172a;">${senderEmail || 'N/A'}</td></tr>
              </table>
              ${data.message ? `<div style="margin-top: 16px; background: #f8fafc; padding: 12px; border-radius: 6px; border: 1px solid #e2e8f0; font-size: 13px;">${data.message}</div>` : ''}
            </div>
          </div>
        `;

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
                  <li><strong>Status:</strong> Routed to Program Intake Coordinator</li>
                </ul>
              </div>
              <p style="font-size: 13px; color: #334155; line-height: 1.6;">
                An intake specialist is reviewing your parameters. For immediate assistance or to speak with our 24/7 AI assistant Jamie, please call <a href="tel:+12053009531" style="color: #ea580c; font-weight: bold;">(205) 300-9531</a>.
              </p>
            </div>
            <div style="background-color: #f8fafc; padding: 14px 24px; text-align: center; font-size: 11px; color: #94a3b8; border-top: 1px solid #e2e8f0;">
              Limyè Foundation &bull; Tuscaloosa & Huntsville, AL &bull; 501(c)(3) Pending Non-Profit Organization
            </div>
          </div>
        `;

        const emailPromise = sendTelnyxEmail(env, {
            to: DEFAULT_ALERT_RECIPIENTS,
            subject: subject,
            text: JSON.stringify(data, null, 2),
            html: alertHtml,
            replyTo: senderEmail,
            fromName: 'Limyè Foundation Intake Desk'
        });

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

        const descriptionText = `Inbound Submission\nRef: #${quoteRef}\nContact: ${contactName}\nEmail: ${senderEmail || 'N/A'}\nPhone: ${senderPhone}\nForm: ${formType}\nInterest: ${data.interest || data.service_interest || 'N/A'}\nHousing Need: ${data.housingNeed || 'N/A'}\nNotes: ${data.message || 'N/A'}`;

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
        </table>
    </div>
    <div style="font-size: 12px; line-height: 1.5; white-space: pre-wrap; color: #334155; background: #ffffff; border: 1px solid #fed7aa; padding: 10px 14px; border-radius: 4px;">
${descriptionText}
    </div>
</div>`;

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

        let smsPromise = null;
        if (hasTransactional && senderPhone && senderPhone !== 'N/A') {
            smsPromise = sendTelnyxSms(env, {
                to: senderPhone,
                text: `Limyè Foundation: Thank you, ${contactName}! We received your intake request (Ref: #${quoteRef}). An intake coordinator is reviewing your details. Call our 24/7 assistant Jamie anytime at (205) 300-9531. Reply STOP to cancel.`
            }).catch(e => console.warn('[SMS Error]', e.message));
        }

        if (typeof waitUntil === 'function') {
            waitUntil(Promise.allSettled([emailPromise, receiptPromise, odooPromise, smsPromise]));
        } else {
            await emailPromise;
            if (receiptPromise) await receiptPromise;
            try { await odooPromise; } catch {}
        }

        return jsonResponse({
            success: true,
            quoteRef: quoteRef,
            ref: quoteRef,
            message: 'Your inquiry has been received, routed to our intake team, and recorded in our CRM.'
        });
    } catch (err) {
        return jsonResponse({ error: err.message }, 500);
    }
}
