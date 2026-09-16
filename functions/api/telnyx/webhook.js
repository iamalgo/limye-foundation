/**
 * functions/api/telnyx/webhook.js — Cloudflare Pages Function for Inbound Telnyx SMS/MMS Webhook
 */

const DEFAULT_COMPANY_ID = 5;
const DEFAULT_TEAM_ID = 5;

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
            headers: { 'Content-Type': 'application/json', 'User-Agent': 'Limye-Webhook-Pages/1.0' },
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
    return { uid, odooDb, odooPass };
}

async function syncToOdooLead(env, { name, contactName, phone, description, chatterNote }) {
    try {
        const { uid, odooDb, odooPass } = await getOdooAuth(env);
        const companyId = parseInt(env.ODOO_COMPANY_ID || DEFAULT_COMPANY_ID, 10);
        const teamId = parseInt(env.ODOO_TEAM_ID || DEFAULT_TEAM_ID, 10);

        const cleanDigits = phone ? phone.replace(/[^0-9]/g, '').slice(-10) : '';
        let partnerId = false;

        if (cleanDigits) {
            const existing = await callOdooRpc(env, 'object', 'execute_kw', [
                odooDb, uid, odooPass, 'res.partner', 'search_read',
                [[['company_id', 'in', [companyId, false]], ['phone', 'ilike', cleanDigits]]],
                { fields: ['id', 'name'], limit: 1 }
            ]);
            if (existing && existing.length > 0) partnerId = existing[0].id;
        }

        if (!partnerId) {
            partnerId = await callOdooRpc(env, 'object', 'execute_kw', [
                odooDb, uid, odooPass, 'res.partner', 'create',
                [{
                    name: contactName,
                    is_company: false,
                    company_id: companyId,
                    phone: phone,
                    comment: 'Auto-created via inbound Telnyx SMS webhook'
                }]
            ]);
        }

        const leadId = await callOdooRpc(env, 'object', 'execute_kw', [
            odooDb, uid, odooPass, 'crm.lead', 'create',
            [{
                name: name,
                partner_id: partnerId || false,
                contact_name: contactName,
                phone: phone,
                company_id: companyId,
                team_id: teamId,
                description: description,
                type: 'opportunity'
            }]
        ]);

        if (chatterNote) {
            try {
                if (leadId) {
                    await callOdooRpc(env, 'object', 'execute_kw', [
                        odooDb, uid, odooPass, 'crm.lead', 'message_post',
                        [[leadId]],
                        { body: chatterNote, subject: 'Inbound SMS/MMS', message_type: 'comment' }
                    ]);
                }
                if (partnerId) {
                    await callOdooRpc(env, 'object', 'execute_kw', [
                        odooDb, uid, odooPass, 'res.partner', 'message_post',
                        [[partnerId]],
                        { body: chatterNote, subject: 'Inbound SMS/MMS', message_type: 'comment' }
                    ]);
                }
            } catch (postErr) {
                console.warn('[Chatter Post Warning]', postErr.message);
            }
        }

        return { success: true, leadId, partnerId };
    } catch (e) {
        console.warn('[Sync Lead Warning]', e.message);
        return { success: false, error: e.message };
    }
}

async function sendTelnyxEmail(env, { to, subject, html, text }) {
    const apiKey = env.TELNYX_API_KEY || (typeof atob === 'function' ? atob('S0VZMDE5RThFQjc4NUE5ODJDQkZFMzlBMzcwMTI0MjdENjVfSGZudVlmQUxrdk1FTWR2R3hQMjc5WQ==') : '');
    const recipients = Array.isArray(to) ? to : [{ email: to }];
    for (const r of recipients) {
        try {
            await fetch('https://api.telnyx.com/v2/email_messages', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    from: 'Limyè Foundation Telephony <info@limyefoundation.org>',
                    to: r.email,
                    subject: subject,
                    text: text,
                    html: html
                })
            });
        } catch {}
    }
}

export async function onRequestOptions() {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export async function onRequestGet() {
    return jsonResponse({ status: 'ready', service: 'Limyè Foundation Telnyx Webhook' });
}

export async function onRequestPost({ request, env, waitUntil }) {
    try {
        const body = await request.json();
        const eventType = body.data?.event_type || body.event_type;

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

        let mediaHtml = '';
        if (media.length > 0) {
            mediaHtml = `
            <div style="margin-top: 10px; padding: 10px; background: #fff7ed; border-radius: 6px; border: 1px solid #fed7aa;">
                <p style="font-size: 12px; font-weight: bold; color: #9a3412; margin: 0 0 8px 0;">📎 Attached Media Documents (${media.length}):</p>
                <div style="display: flex; flex-wrap: wrap; gap: 10px;">
                    ${media.map((item, idx) => {
                        const url = typeof item === 'string' ? item : item.url;
                        const isImg = item.content_type?.startsWith('image/') || url.match(/\.(jpg|jpeg|png|gif|webp)$/i);
                        return `
                        <div style="border: 1px solid #cbd5e1; border-radius: 6px; overflow: hidden; max-width: 140px; background: #ffffff; text-align: center;">
                            ${isImg ? `<img src="${url}" style="width: 100%; height: 90px; object-fit: cover;" />` : `<div style="padding: 20px 10px; font-size: 11px;">📄 Document</div>`}
                            <a href="${url}" target="_blank" style="display: block; padding: 4px; font-size: 10px; color: #ea580c; text-decoration: none; font-weight: bold;">View</a>
                        </div>`;
                    }).join('')}
                </div>
            </div>`;
        }

        const smsChatterNote = `
        <div style="font-family: Arial, sans-serif; padding: 4px;">
            <div style="background-color: #fff7ed; border-left: 4px solid #ea580c; padding: 12px 16px; margin-bottom: 8px; border-radius: 4px;">
                <h4 style="color: #9a3412; margin: 0 0 6px 0; font-size: 13px;">📥 Inbound Telnyx ${media.length > 0 ? 'MMS' : 'SMS'} Received</h4>
                <p style="font-size: 12px; margin: 0 0 6px 0; color: #475569;"><b>From:</b> ${fromNumber} | <b>To:</b> ${toNumber} | <b>ID:</b> <code>${messageId}</code></p>
                <div style="font-size: 13px; color: #1e293b; background: #ffffff; padding: 10px 14px; border-radius: 4px; border: 1px solid #fed7aa;">${messageText}</div>
                ${mediaHtml}
            </div>
        </div>`;

        const emailPromise = sendTelnyxEmail(env, {
            to: DEFAULT_ALERT_RECIPIENTS,
            subject: `[Limyè SMS/MMS Alert] Inbound message from ${fromNumber}`,
            text: `Inbound message from ${fromNumber}:\n\n${messageText}\n\nMessage ID: ${messageId}`,
            html: `<p><b>From:</b> ${fromNumber}</p><p>${messageText}</p>${mediaHtml}`
        });

        const odooPromise = syncToOdooLead(env, {
            name: `SMS from ${fromNumber}`,
            contactName: `SMS User (${fromNumber})`,
            phone: fromNumber,
            description: `Inbound SMS received via Telnyx (+1-888-919-2059):\n\n${messageText}\nMessage ID: ${messageId}`,
            chatterNote: smsChatterNote
        });

        if (typeof waitUntil === 'function') {
            waitUntil(Promise.allSettled([emailPromise, odooPromise]));
        } else {
            await emailPromise;
            try { await odooPromise; } catch {}
        }

        return jsonResponse({ status: 'sms_logged', messageId });
    } catch (err) {
        console.error('Telnyx Webhook error:', err);
        return jsonResponse({ error: err.message }, 500);
    }
}
