# Antigravity IDE – Final Proxy Instruction

This document defines the final, correct, and simplified networking setup for Antigravity. The IDE / agent must follow this exactly and must not infer or add extra steps.

---

## 1. High-Level Goal

Run Playwright on Render using a real mobile IP provided by an Android phone, so that sites like naukri.com do not block automation.

---

## 2. Architecture (Simple Mental Model)

Render (Playwright)
   ↓
HTTP Proxy (Cloudflare Quick Tunnel)
   ↓
Privoxy (HTTP → SOCKS bridge)
   ↓
Microsocks (SOCKS5)
   ↓
Android Mobile Network (Real IP)

Key idea:
- The phone provides the IP
- Render only talks to one proxy URL

---

## 3. What Is Running Where

**Android (Termux)**

These services are ALREADY running on the phone:

1.  **microsocks**
    *   Port: 1080
    *   Auth: user / pass

2.  **privoxy**
    *   Port: 8118
    *   Forwards all traffic to microsocks

3.  **cloudflared tunnel**
    *   Exposes privoxy over HTTPS
    *   Generated public hostname: `flows-delight-herself-houston.trycloudflare.com`

**⚠️ Do NOT try to start or verify these from Render.**

---

## 4. CRITICAL RULES FOR THE IDE

The IDE / agent MUST obey these rules:

❌ Do NOT use ngrok
❌ Do NOT use localhost on Render
❌ Do NOT run cloudflared on Render
❌ Do NOT perform local proxy health checks on Render
✅ Assume proxy is READY
✅ Use the Cloudflare hostname directly

---

## 5. The ONLY Proxy Configuration Allowed

**Playwright (Render)**

```javascript
const browser = await chromium.launch({
  proxy: {
    server: 'http://user:pass@flows-delight-herself-houston.trycloudflare.com:443'
  },
  headless: false
});
```

This configuration is authoritative.

---

## 6. Verification Rule

The IDE must consider the proxy working if the browser launches without error using this configuration.
