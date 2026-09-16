# Limyè Foundation — Fanvil V67 Desk Phone SIP Line Configuration

This document records the exact telephony credentials, network parameters, and IVR routing logic for the dedicated Limyè Foundation line on the Fanvil V67 desk phone.

---

## 1. Hardware Registration Parameters (Fanvil Web GUI)

Navigate to **Line** &rarr; **SIP** &rarr; select **Line 4** (or **SIP6**):

| Field | Configuration Value | Notes |
| :--- | :--- | :--- |
| **Line Status** | **Registered (Green)** | Set `Activate` checkbox to **Checked** |
| **Display Name** | `Limye Foundation` | Label shown on phone screen & softkeys |
| **Username / Register Name** | `limyefoundation` | Telnyx SIP credential username |
| **Authentication User** | `limyefoundation` | Must match username |
| **Authentication Password** | `Salesman2@` | Case-sensitive: `S` + `alesman` + `2` + `@` |
| **Server Name** | *[Leave Blank]* | Do not enter URL here to avoid header conflicts |
| **Realm** | *[Leave Blank]* | Handled automatically via Telnyx MD5 digest |
| **SIP Server 1 Address** | `sip.telnyx.com` | Primary Telnyx SIP registrar |
| **SIP Server 1 Port** | `5060` | Standard SIP UDP port (or `5061` TLS) |
| **Transport Protocol** | `UDP` | RFC 2833 DTMF standard |
| **Registration Expiration** | `300` | Recommended 300s keep-alive interval |
| **Proxy Server Address** | `sip.telnyx.com` | Required for DNS SRV outbound proxy routing |
| **Proxy Server Port** | `5060` | Standard proxy port |

---

## 2. Telnyx Infrastructure References

| Setting | Value |
| :--- | :--- |
| **Organization** | Limyè Foundation (501(c)(3)) |
| **Telnyx Credential Connection Name** | `Limye Foundation` |
| **Telnyx Connection ID** | `3049893998228407414` |
| **Inbound SIP URI** | `sip:limyefoundation@sip.telnyx.com` |
| **Outbound Caller ID (ANI Override)** | `+18665469311` (1-866-546-9311 / 1-866-LIMYE-11) |
| **SIP URI Calling Preference** | `internal` |
| **Voice AI Assistant** | `Harry - Limye Foundation Inbound Coordinator` (`assistant-daa8fc21-90e1-44f7-8702-cad5e6587128`) |
| **TeXML Application ID** | `3049886799200519693` |
| **TeXML Inbound Engine** | `https://www.limyefoundation.org/api/texml/inbound` |
| **Voice Status Callback** | `https://www.limyefoundation.org/api/telnyx/voice-webhook` |

---

## 3. Inbound Routing & Anti-Spam IVR Logic

```
📞 Caller dials +1-866-546-9311 (1-866-LIMYE-11)
        │
        ▼
[https://www.limyefoundation.org/api/texml/inbound]
  Screening IVR Greeting (Option 2 Anti-Spam Gate):
  ├─ Press 1 → Caseworker / Agency Partner ([LMY-Agency])
  ├─ Press 2 → Direct Housing, Nutrition, Community Assistance ([LMY-Intake])
  ├─ Press 3 → Landlord, Donor, Partner ([LMY-Partner])
  └─ Press 4 → General Administration / Executive Management ([LMY-Admin])
        │
        ├─ SILENCE / NO KEY (Robocallers / Web Bots) 
        │       └─ Drops after 7 seconds ($0 AI Minutes Incurred) 🚫
        │
        └─ VERIFIED HUMAN (Option Selected)
                │
                ▼
        [Fanvil V67 Handset Ring]
          Dials `sip:limyefoundation@sip.telnyx.com` for 15 seconds (~3 rings)
                │
                ├─ Fanvil ANSWERS → Live human conversation ✅
                │
                └─ Fanvil NO ANSWER / BUSY (after 15s)
                        │
                        ▼
                [Harry AI Voice Assistant]
                  Connects to `assistant-daa8fc21-90e1-44f7-8702-cad5e6587128`
                  Structured intake & empathetic conversational intake
                        │
                        ▼
                [Odoo 18 CRM Synchronization]
                  Pushes call recording audio & transcript to Odoo Chatter
                  (Company ID 5: Limyè Foundation, Team ID 5: Intake & Sales)
                  Sends team alert email to info@ and qruffin@limyefoundation.org
```
