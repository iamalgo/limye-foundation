/**
 * functions/api/texml/inbound.js — TeXML Interactive Inbound IVR & SIP Bridging Engine
 * Cloudflare Pages Function for https://www.limyefoundation.org/api/texml/inbound
 */

export async function onRequest(context) {
    const { request, env } = context;

    if (request.method === 'OPTIONS') {
        return new Response(null, {
            status: 204,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With'
            }
        });
    }

    try {
        const url = new URL(request.url);
        const baseUrl = 'https://www.limyefoundation.org';
        const step = url.searchParams.get('step') || 'menu';
        let from = url.searchParams.get('from') || url.searchParams.get('From') || '';
        let to = url.searchParams.get('to') || url.searchParams.get('To') || '';
        let digits = url.searchParams.get('Digits') || url.searchParams.get('digits') || '';
        let category = url.searchParams.get('category') || '';

        if (request.method === 'POST') {
            const contentType = request.headers.get('content-type') || '';
            if (contentType.includes('application/x-www-form-urlencoded')) {
                const formData = await request.formData();
                digits = formData.get('Digits')?.toString() || digits;
                from = formData.get('From')?.toString() || from;
                to = formData.get('To')?.toString() || to;
            } else if (contentType.includes('application/json')) {
                const body = await request.json();
                digits = body.digits || body.Digits || digits;
                from = body.from || body.From || from;
                to = body.to || body.To || to;
            }
        }

        const cleanFrom = from || 'Caller';

        // --- STEP 1: SCREENING & CATEGORIZATION IVR MENU ---
        if (step === 'menu') {
            const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Gather action="${baseUrl}/api/texml/inbound?step=option_selected&amp;from=${encodeURIComponent(from)}&amp;to=${encodeURIComponent(to)}" method="POST" numDigits="1" timeout="7">
        <Say voice="Polly.Stephen-Neural">Thank you for calling the Limye Foundation, non-profit community housing, transportation, and nutrition assistance.</Say>
        <Say voice="Polly.Stephen-Neural">To best direct your call, please select from the following options:</Say>
        <Say voice="Polly.Stephen-Neural">Press 1 if you are a Case Worker, Social Worker, or Agency Partner.</Say>
        <Say voice="Polly.Stephen-Neural">Press 2 if you are in need of Direct Housing, Nutrition, or Community Assistance.</Say>
        <Say voice="Polly.Stephen-Neural">Press 3 if you are a Landlord, Donor, or Community Partner.</Say>
        <Say voice="Polly.Stephen-Neural">Press 4 or stay on the line for General Administration or Executive Management.</Say>
    </Gather>
    <Say voice="Polly.Stephen-Neural">We did not receive a selection. Goodbye.</Say>
    <Hangup />
</Response>`;
            return new Response(xml, {
                headers: {
                    'Content-Type': 'application/xml; charset=utf-8',
                    'Access-Control-Allow-Origin': '*'
                }
            });
        }

        // --- STEP 2: HANDLE OPTION SELECTION & FANVIL SIP BRIDGING ---
        if (step === 'option_selected') {
            let catName = 'Executive_Management';
            let tagPrefix = '[LMY-Admin]';

            if (digits === '1') {
                catName = 'Caseworker_Intake';
                tagPrefix = '[LMY-Agency]';
            } else if (digits === '2') {
                catName = 'Direct_Applicant_Intake';
                tagPrefix = '[LMY-Intake]';
            } else if (digits === '3') {
                catName = 'Property_Donor_Partner';
                tagPrefix = '[LMY-Partner]';
            } else if (digits === '4') {
                catName = 'Executive_Management';
                tagPrefix = '[LMY-Admin]';
            } else {
                const invalidXml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Say voice="Polly.Stephen-Neural">Invalid selection. Goodbye.</Say>
    <Hangup />
</Response>`;
                return new Response(invalidXml, {
                    headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Access-Control-Allow-Origin': '*' }
                });
            }

            const callerTag = `${tagPrefix} ${cleanFrom}`.substring(0, 30);
            const sipUri = 'sip:limyefoundation@sip.telnyx.com';

            // Ring Fanvil desk phone for 15 seconds. If no answer, fallback to Harry AI!
            const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Dial timeout="15" callerId="${callerTag}" action="${baseUrl}/api/texml/inbound?step=harry_fallback&amp;category=${encodeURIComponent(catName)}&amp;from=${encodeURIComponent(from)}&amp;to=${encodeURIComponent(to)}">
        <Sip>${sipUri}</Sip>
    </Dial>
</Response>`;
            return new Response(xml, {
                headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Access-Control-Allow-Origin': '*' }
            });
        }

        // --- STEP 3: HARRY AI ASSISTANT FALLBACK ---
        if (step === 'harry_fallback') {
            const harryAssistantId = 'assistant-daa8fc21-90e1-44f7-8702-cad5e6587128';
            const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Connect>
        <AIAssistant id="${harryAssistantId}">
        </AIAssistant>
    </Connect>
</Response>`;
            return new Response(xml, {
                headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Access-Control-Allow-Origin': '*' }
            });
        }

        // Fallback catch-all
        const defaultXml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Redirect method="POST">${baseUrl}/api/texml/inbound?step=menu&amp;from=${encodeURIComponent(from)}&amp;to=${encodeURIComponent(to)}</Redirect>
</Response>`;
        return new Response(defaultXml, {
            headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Access-Control-Allow-Origin': '*' }
        });
    } catch (err) {
        console.error('TeXML Inbound Call error:', err);
        return new Response('<?xml version="1.0" encoding="UTF-8"?><Response><Hangup /></Response>', {
            headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Access-Control-Allow-Origin': '*' }
        });
    }
}
