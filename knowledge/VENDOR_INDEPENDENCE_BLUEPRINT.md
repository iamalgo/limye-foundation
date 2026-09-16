# Vendor-Agnostic Infrastructure, Workflow & Migration Blueprint
**Scope**: Limyè Foundation, 20/59 Ventures, Algoinsu, and IAM INC
**Purpose**: Complete architectural specification for Email, Voice AI, CRM Sync, TCPA Audit, and Telephony routing to enable instant provider portability (zero vendor lock-in).

---

## 1. Portability Philosophy & Decoupled Architecture

Our operational pipeline is structured into 5 decoupled layers:

```
[1. Front-End Web / Intake]  ->  Captures leads & TCPA consent
          │
[2. Edge API Gateway]         ->  Cloudflare Edge / Vercel (orchestrates async tasks)
    ┌─────┴────────────────────────────────┐
    ▼                                      ▼
[3. Transactional Comms]      [4. Telephony & AI Voice]
  - Branded Receipts            - Anti-Spam IVR Gate
  - Team Alerts (Email/SMS)     - SIP Desk Phone Ring (15s)
                                - AI Voice Assistant (Harry/Jamie/Erica)
    │                                      │
    └──────────────────┬───────────────────┘
                       ▼
        [5. Core System of Record]
          - Odoo 18 CRM (Leads, Contacts, Chatter Transcripts)
```

If any third-party provider (Telnyx, Cloudflare, Zoho, etc.) experiences an outage or changes pricing, each component can be swapped independently in under 30 minutes without changing business logic.

---

## 2. Email Workflow & Notification Specifications

### A. Customer Confirmation Receipts
Whenever a visitor submits a contact or housing form, the system immediately dispatches a branded confirmation receipt.

* **Reference ID Format**: `{PREFIX}-2026-{RANDOM_4_DIGITS}`
  * Limyè Foundation: `LMY-2026-XXXX`
  * 20/59 Ventures: `V2059-2026-XXXX`
  * Algoinsu: `ALGO-2026-XXXX`
  * IAM INC: `IAM-2026-XXXX`
* **Subject Line**: `[Confirmation] Your Request with {Organization Name} (Ref: {REF_ID})`
* **Core Content**:
  1. Branded header with logo & organization mission.
  2. Submission summary (Name, Email, Phone, Inquiry Category).
  3. Response commitment (e.g., *"An intake coordinator will review your information within 24 business hours"*).
  4. 24/7 Helpline details (Toll-Free & Direct lines).
  5. Privacy & TCPA disclosure statement.

### B. Internal Team Alert Inboxes
* **Limyè Foundation**: `info@limyefoundation.org`, `qruffin@limyefoundation.org` *(Note: `qruffin@iamalgo.com` is excluded from transactional alerts to prevent inbox clutter).*
* **20/59 Ventures**: `housing@2059ventures.online`, `info@2059ventures.online`
* **Algoinsu**: `quotes@algoinsu.com`, `service@algoinsu.com`
* **IAM INC**: `admin@iamalgo.com`
* **Subject Format**: `[{Org Name} Alert] {Form Type} from {Client Name} ({Phone})`

### C. Provider Portability Contract
The edge email helper expects a standard JSON payload:
```json
{
  "to": [{"email": "user@example.com", "name": "User"}],
  "from": "info@domain.org",
  "fromName": "Organization Name",
  "subject": "Subject string",
  "html": "<div>HTML content</div>",
  "text": "Plain text fallback"
}
```
* **Current Vendor**: Telnyx Email API (`POST https://api.telnyx.com/v2/messages/email`).
* **Drop-In Alternatives**: Resend (`POST https://api.resend.com/emails`), SendGrid (`POST https://api.sendgrid.com/v3/mail/send`), AWS SES, or Postmark.

---

## 3. CRM & Data Synchronization Specifications (Odoo 18 JSON-RPC)

All interactions (web forms, SMS threads, AI voice transcripts, audio recordings) sync directly to our central Odoo instance.

* **Instance URL**: `https://odoo.iamalgo.com/jsonrpc`
* **Database**: `IAM_Main`
* **Service Account**: `Qruffin@iamalgo.com`
* **Timeout Protection**: Strict 4.0-second `AbortController` timeout guard so CRM delays never block user responses.

### Multi-Company Partitioning Matrix
| Company / Organization | Company ID | Sales Team ID | Primary Lead Routing |
| :--- | :--- | :--- | :--- |
| **IAM Platform / IAM INC** | `1` | `1` | Executive & SaaS Inquiries |
| **Algoinsu** | `2` | `2` | Commercial & Personal Insurance Lines |
| **20/59 Ventures** | `3` | `3` | Supportive Housing & Landlord Placements |
| **Limyè Foundation** | `5` | `5` | Community Intake, Housing, NEMT & Nutrition |

### Data Models & Payload Standards
1. **`res.partner` (Contacts)**:
   - Check if contact exists by phone or email.
   - If not found, create new partner with `name`, `email`, `phone`, `company_id`.
2. **`crm.lead` (Opportunities / Intake Leads)**:
   - `name`: `[{Source}] {Contact Name} - {Topic}`
   - `partner_id`: ID from `res.partner`
   - `email_from`: Contact email
   - `phone`: Contact phone
   - `company_id`: Company ID from matrix above
   - `team_id`: Team ID from matrix above
   - `description`: Structured submission details / form dump
3. **Chatter Notes (`mail.message`)**:
   - Uses `mail.thread` method `message_post`.
   - Post rich HTML card containing caller metadata, audio playback links, call duration, and AI transcription records.

---

## 4. Telephony & AI Voice State Machine (Vendor-Neutral)

```
[Inbound Phone Call to Toll-Free / DID Line]
                    │
                    ▼
       ┌────────────────────────┐
       │   STEP 1: ANTI-SPAM    │
       │   SCREENING IVR GATE   │
       └────────────────────────┘
                    │
   ┌────────────────┴────────────────┐
   ▼                                 ▼
[Silent Bot / Scraper]        [Human Presses Digit]
   - No DTMF received            - Option 1: Agency / Caseworker
   - Drops after 7 seconds       - Option 2: Direct Applicant / Needs
   - $0 AI Minutes Incurred      - Option 3: Property / Partner
                                 - Option 4: Administration
                                     │
                                     ▼
                        ┌────────────────────────┐
                        │    STEP 2: SIP DESK    │
                        │     PHONE BRIDGING     │
                        └────────────────────────┘
                                     │
                                     ▼
                        Rings Fanvil V67 Handset
                        Timeout: 15 seconds (~3 rings)
                        Caller ID: `[{Dept Tag}] {Caller Phone}`
                                     │
                    ┌────────────────┴────────────────┐
                    ▼                                 ▼
           [Quincy Answers]                  [No Answer / Busy (15s)]
           Live human conversation                       │
                                                         ▼
                                            ┌────────────────────────┐
                                            │    STEP 3: AI VOICE    │
                                            │   ASSISTANT FALLBACK   │
                                            └────────────────────────┘
                                                         │
                                                         ▼
                                            Harry / Jamie / Erica connects
                                            Empathetic structured intake
                                                         │
                                                         ▼
                                            ┌────────────────────────┐
                                            │    STEP 4: POST-CALL   │
                                            │      ODOO LOGGING      │
                                            └────────────────────────┘
                                            Syncs audio URL & transcript
```

### Telephony Portability Mapping
* **Current Telnyx TeXML**: `<Gather numDigits="1">` &rarr; `<Dial timeout="15"><Sip>sip:...@sip.telnyx.com</Sip></Dial>` &rarr; `<Connect><AIAssistant id="..." /></Connect>`
* **Twilio TwiML Equivalent**: `<Gather numDigits="1">` &rarr; `<Dial timeout="15"><Sip>sip:...@sip.domain.com</Sip></Dial>` &rarr; `<Connect><ConversationServiceUrl url="..." /></Connect>`
* **Vapi / Retell AI Equivalent**: Set Inbound Webhook on phone number &rarr; trigger SIP transfer URL &rarr; on `call.no-answer`, launch Assistant ID.

---

## 5. TCPA Compliance & Audit Telemetry

To ensure compliance with Federal TCPA and CTIA/10DLC regulations:
1. **Dual Affirmative Checkboxes**: Transactional consent is separate from marketing consent. Neither is pre-checked.
2. **Audit Box Data Stored with Every Lead**:
   - UTC Timestamp of submission
   - Client IP Address
   - Browser User-Agent string
   - Form Source URL & Form Identifier
   - Exact disclosure verbiage presented at the moment of submission
3. **SMS Carrier Guard**:
   - Strict 10DLC non-sharing clause: *"No mobile information will be shared with third parties/affiliates for marketing/promotional purposes."*
   - Immediate recognition of `STOP`, `UNSUBSCRIBE`, `CANCEL`, and `HELP`.

---

## 6. DNS, Domain & SPF/DKIM Authentication

* **Apex Flattening**: Apex (`domain.org`) and `www` CNAME to edge provider (`pages.dev` / `vercel.app`).
* **SPF Record Standard**:
  `v=spf1 include:zohomail.com include:spf.telnyx.com ~all`
* **Edge Security Headers**:
  - `Strict-Transport-Security: max-age=31536000; includeSubDomains; preload`
  - `X-Content-Type-Options: nosniff`
  - `X-Frame-Options: SAMEORIGIN`
  - `Referrer-Policy: strict-origin-when-cross-origin`
