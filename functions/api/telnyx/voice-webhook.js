/**
 * functions/api/telnyx/voice-webhook.js — Cloudflare Pages Function for Telnyx Voice Call Transcripts
 * Captures call end events, recordings, and transcripts from Harry AI and logs to Odoo CRM & Chatter
 */

const DEFAULT_TELNYX_API_KEY = typeof atob === 'function' ? atob('S0VZMDE5RThFQjc4NUE5ODJDQkZFMzlBMzcwMTI0MjdENjVfSGZudVlmQUxrdk1FTWR2R3hQMjc5WQ==') : '';
const DEFAULT_COMPANY_ID = 5;
const DEFAULT_TEAM_ID = 5;
const DEFAULT_ALERT_RECIPIENTS = ['info@limyefoundation.org', 'qruffin@limyefoundation.org'];

const CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With',
};

export async function onRequestOptions() {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export async function onRequestPost({ request, env, waitUntil }) {
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

        // Email Alert
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

        // Odoo Sync
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

        if (typeof waitUntil === 'function') {
            waitUntil(Promise.allSettled([emailPromise, odooPromise]));
        } else {
            await emailPromise;
            try { await odooPromise; } catch (e) { console.warn('[Odoo Voice Sync Warning]', e.message); }
        }

        return new Response(JSON.stringify({ status: 'voice_call_logged' }), {
            status: 200,
            headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
        });
    } catch (err) {
        console.error('Telnyx Voice Webhook error:', err);
        return new Response(JSON.stringify({ error: err.message }), {
            status: 500,
            headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
        });
    }
}

async function sendTelnyxEmail(env, { to, subject, html, text, fromName = 'Limyè Foundation Team' }) {
    const apiKey = env.TELNYX_API_KEY || (typeof atob === 'function' ? atob('S0VZMDE5RThFQjc4NUE5ODJDQkZFMzlBMzcwMTI0MjdENjVfSGZudVlmQUxrdk1FTWR2R3hQMjc5WQ==') : '');
    const recipients = Array.isArray(to) ? to : [{ email: to }];
    for (const r of recipients) {
        try {
            const targetEmail = typeof r === 'string' ? r : r.email;
            await fetch('https://api.telnyx.com/v2/email_messages', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    to: [{ email: targetEmail }],
                    from: { email: 'support@limyefoundation.org', name: fromName },
                    subject: subject,
                    html: html,
                    text: text
                })
            });
        } catch (e) {
            console.warn('[Voice Webhook Email Notice]', e.message);
        }
    }
}

async function syncToOdooLead(env, leadData) {
    const odooUrl = (env.ODOO_URL || 'https://odoo.iamalgo.com').replace(/\/+$/, '');
    const db = env.ODOO_DB || 'IAM_Main';
    const username = env.ODOO_USER || 'Qruffin@iamalgo.com';
    const password = env.ODOO_PASS || 'admin_master_password';

    const authRes = await fetch(`${odooUrl}/jsonrpc`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            jsonrpc: '2.0', method: 'call',
            params: { service: 'common', method: 'login', args: [db, username, password] },
            id: 1
        })
    });
    const authJson = await authRes.json();
    const uid = authJson.result;
    if (!uid) throw new Error('Odoo auth failed');

    const leadRes = await fetch(`${odooUrl}/jsonrpc`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            jsonrpc: '2.0', method: 'call',
            params: {
                service: 'object', method: 'execute_kw',
                args: [db, uid, password, 'crm.lead', 'create', [{
                    name: leadData.name,
                    contact_name: leadData.contactName,
                    email_from: leadData.email,
                    phone: leadData.phone,
                    description: leadData.description,
                    type: 'opportunity',
                    team_id: DEFAULT_TEAM_ID,
                    company_id: DEFAULT_COMPANY_ID
                }]]
            },
            id: 2
        })
    });
    const leadJson = await leadRes.json();
    const leadId = leadJson.result;

    if (leadId && leadData.chatterNote) {
        await fetch(`${odooUrl}/jsonrpc`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                jsonrpc: '2.0', method: 'call',
                params: {
                    service: 'object', method: 'execute_kw',
                    args: [db, uid, password, 'crm.lead', 'message_post', [[leadId]], {
                        body: leadData.chatterNote,
                        message_type: 'comment',
                        subtype_xmlid: 'mail.mt_note'
                    }]
                },
                id: 3
            })
        });
    }
}
