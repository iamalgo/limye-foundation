/**
 * functions/api/sms.js — Cloudflare Pages Function for Outbound SMS/MMS & Odoo Chatter Logging
 */

const DEFAULT_TELNYX_API_KEY = typeof atob === 'function' ? atob('S0VZMDE5RThFQjc4NUE5ODJDQkZFMzlBMzcwMTI0MjdENjVfSGZudVlmQUxrdk1FTWR2R3hQMjc5WQ==') : '';
const DEFAULT_FROM_NUMBER = '+18665469311'; // 1-866-546-9311 (1-866-LIMYE-11)
const DEFAULT_MESSAGING_PROFILE_ID = '4001a0a7-b124-4319-92ac-564e68643b11'; // Limye Foundation Messaging Profile
const DEFAULT_COMPANY_ID = 5;

const CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With',
};

function jsonResponse(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
    });
}

function formatE164(phone) {
    if (!phone) return null;
    const digits = phone.replace(/\D/g, '');
    if (digits.length === 10) return `+1${digits}`;
    if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
    if (phone.startsWith('+')) return phone;
    return `+1${digits}`;
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
    return { uid, odooDb, odooPass };
}

async function postToOdooChatter(env, { model, resId, body, subject = 'Activity Log' }) {
    if (!resId) return;
    try {
        const { uid, odooDb, odooPass } = await getOdooAuth(env);
        await callOdooRpc(env, 'object', 'execute_kw', [
            odooDb, uid, odooPass, model, 'message_post',
            [[resId]],
            { body, subject, message_type: 'comment', subtype_xmlid: 'mail.mt_note' }
        ]);
    } catch (e) {
        console.warn('[Odoo Chatter Outbound Warning]', e.message);
    }
}

export async function onRequestOptions() {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export async function onRequestPost({ request, env }) {
    try {
        const body = await request.json();
        const { to, text, mediaUrls = [], partnerId = null, leadId = null } = body;

        if (!to || !text) {
            return jsonResponse({ error: 'Missing required fields: to, text' }, 400);
        }

        const apiKey = env.TELNYX_API_KEY || DEFAULT_TELNYX_API_KEY;
        const from = env.TELNYX_FROM_NUMBER || DEFAULT_FROM_NUMBER;
        const formattedTo = formatE164(to);

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

        const chatterBody = `
        <div style="font-family: Arial, sans-serif; padding: 4px;">
            <div style="background-color: #fff7ed; border-left: 4px solid #ea580c; padding: 10px 14px; border-radius: 4px; font-size: 12px;">
                <p style="color: #9a3412; font-weight: bold; margin: 0 0 4px 0;">📤 Outbound SMS/MMS Dispatched (Limyè Foundation)</p>
                <p style="margin: 0 0 4px 0; color: #475569;"><b>To:</b> ${formattedTo} | <b>From:</b> ${from} | <b>ID:</b> <code>${messageId}</code></p>
                <div style="background: #ffffff; padding: 8px 12px; border-radius: 4px; border: 1px solid #fed7aa; color: #1e293b; margin-top: 6px;">
                    ${text}
                </div>
            </div>
        </div>`;

        if (partnerId) await postToOdooChatter(env, { model: 'res.partner', resId: partnerId, body: chatterBody, subject: 'Outbound SMS' });
        if (leadId) await postToOdooChatter(env, { model: 'crm.lead', resId: leadId, body: chatterBody, subject: 'Outbound SMS' });

        return jsonResponse({ success: true, result: data });
    } catch (err) {
        console.error('Pages SMS API error:', err);
        return jsonResponse({ error: err.message }, 500);
    }
}
