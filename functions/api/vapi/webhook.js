/**
 * functions/api/vapi/webhook.js — Cloudflare Pages Function for Jamie AI / Vapi Call Sync to Odoo Chatter
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
            headers: { 'Content-Type': 'application/json', 'User-Agent': 'Limye-Vapi-Pages/1.0' },
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
                    comment: 'Auto-created via Jamie AI phone session'
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
                        { body: chatterNote, subject: 'Jamie AI Call Transcript', message_type: 'comment' }
                    ]);
                }
                if (partnerId) {
                    await callOdooRpc(env, 'object', 'execute_kw', [
                        odooDb, uid, odooPass, 'res.partner', 'message_post',
                        [[partnerId]],
                        { body: chatterNote, subject: 'Jamie AI Call Transcript', message_type: 'comment' }
                    ]);
                }
            } catch (postErr) {
                console.warn('[Vapi Chatter Warning]', postErr.message);
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
                    from: 'Jamie AI Navigator <info@limyefoundation.org>',
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
    return jsonResponse({ status: 'ready', service: 'Limyè Foundation Vapi Webhook' });
}

export async function onRequestPost({ request, env, waitUntil }) {
    try {
        const body = await request.json();
        const messageType = body.message?.type || body.type;

        if (messageType !== 'end-of-call-report' && messageType !== 'transcript') {
            return jsonResponse({ status: 'ignored_event_type', type: messageType });
        }

        const callObj = body.message?.call || body.call || {};
        const customerPhone = callObj.customer?.number || body.message?.customer?.number || 'Unknown Caller';
        const transcript = body.message?.transcript || body.transcript || 'No transcript available';
        const summary = body.message?.summary || body.summary || 'Vapi call session completed';
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

        const emailPromise = sendTelnyxEmail(env, {
            to: DEFAULT_ALERT_RECIPIENTS,
            subject: `[Jamie AI Call] Call Report from ${customerPhone}`,
            text: `Jamie AI call with ${customerPhone}:\n\nSummary:\n${summary}\n\nTranscript:\n${transcript}`,
            html: `
                <div style="font-family: Arial, sans-serif; padding: 16px;">
                    <h3 style="color: #16a34a; margin-top: 0;">Limyè Foundation &bull; Jamie AI Call Completed</h3>
                    <p><b>Caller:</b> ${customerPhone} (Duration: ${Math.round(durationSec)}s)</p>
                    ${recordingUrl ? `<p><a href="${recordingUrl}">Listen to Recording</a></p>` : ''}
                    <p><b>Summary:</b> ${summary}</p>
                    <pre style="background: #f8fafc; padding: 10px; font-size: 11px; border: 1px solid #e2e8f0; white-space: pre-wrap;">${transcript}</pre>
                </div>
            `
        });

        const odooPromise = syncToOdooLead(env, {
            name: `Jamie AI Call - ${customerPhone}`,
            contactName: `Caller (${customerPhone})`,
            phone: customerPhone,
            description: `Vapi Call Session with Jamie (205-300-9531):\nSummary: ${summary}\n\nTranscript:\n${transcript}`,
            chatterNote: vapiChatterNote
        });

        if (typeof waitUntil === 'function') {
            waitUntil(Promise.allSettled([emailPromise, odooPromise]));
        } else {
            await emailPromise;
            try { await odooPromise; } catch {}
        }

        return jsonResponse({ status: 'vapi_call_logged' });
    } catch (err) {
        console.error('Vapi Webhook error:', err);
        return jsonResponse({ error: err.message }, 500);
    }
}
