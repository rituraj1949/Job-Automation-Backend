# Antigravity IDE – Final Proxy Instruction (Updated for Dynamic Tunnels)

This document defines the final, correct, and simplified networking setup for Antigravity, respecting the dynamic nature of Cloudflare Quick Tunnels.

---

## 1. High-Level Goal

Run Playwright on Render using a real mobile IP provided by an Android phone via a Cloudflare Quick Tunnel. The tunnel URL is dynamic and rotates on restart.

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
- The phone provides the IP.
- The tunnel URL rotates.
- The system must accept the current URL via configuration (Env Var).

---

## 3. What Is Running Where

**Android (Termux)**

*   **microsocks** (Port 1080)
*   **privoxy** (Port 8118 -> 1080)
*   **cloudflared** (Exposes privoxy via Quick Tunnel)

**⚠️ Cloudflare URL changes on every restart.**

---

## 4. CRITICAL RULES FOR THE IDE

The IDE / agent MUST obey these rules:

❌ Do NOT hardcode the proxy URL as "permanent".
❌ Do NOT fail fatally just because the URL changed.
✅ DO read `PROXY_SERVER` from environment variables.
✅ DO allow the user to update the proxy URL manually in the Env Vars.

---

## 5. The ONLY Proxy Configuration Allowed

**Playwright (Render)**

```javascript
// Dynamic Cloudflare Proxy Configuration
const proxyUrl = process.env.PROXY_SERVER || 'http://user:pass@flows-delight-herself-houston.trycloudflare.com:443';

console.log(`Launching browser with proxy: ${proxyUrl}`);

browser = await chromium.launch({
  // ... other args
  proxy: {
    server: proxyUrl
  }
});
```

---

## 6. Workflow for Rotating Tunnels

1.  User starts `cloudflared` on Android.
2.  User gets new URL (e.g., `https://cat-dog-fish.trycloudflare.com`).
3.  User updates `PROXY_SERVER` environment variable on Render (or locally).
    *   Format: `http://user:pass@cat-dog-fish.trycloudflare.com:443`
4.  Automation runs using the new URL.

---
