# Antigravity – What To Do Next (Node.js Roadmap)

This document defines the next concrete actions for the Antigravity Node.js application now that a stable proxy + IP is available.

Use this as a task-by-task execution checklist for the AI agent and developers.

## 1. Confirm Runtime Preconditions (Mandatory)
### 1.1 Services That MUST Be Running
*   microsocks (SOCKS5 server)
*   cloudflared tunnel
*   cloudflared access tcp (local forward)
*   **Local proxy endpoint** (ONLY one the app should use):
    *   `socks5://127.0.0.1:9090`
    *   If this endpoint is down → **stop the app**.

## 2. Enforce Proxy Usage in Node.js
### 2.1 Global Rule
*   Every outbound network request **MUST** go through the proxy.
*   **No exceptions.**

### 2.2 Playwright (Browser Automation)
```javascript
const browser = await chromium.launch({
  proxy: { server: 'socks5://127.0.0.1:9090' },
  headless: false
});
```
**Rules:**
*   One browser per job
*   One context per browser
*   Reuse context for all steps

### 2.3 HTTP / API Requests (axios)
```javascript
const { SocksProxyAgent } = require('socks-proxy-agent');
const agent = new SocksProxyAgent('socks5://127.0.0.1:9090');

axios.get(url, {
  httpAgent: agent,
  httpsAgent: agent
});
```

## 3. Antigravity – First Functional Goal
**Goal:** Given a company name or domain, reliably discover its official career / jobs page.
This is the foundation for all future features.

## 4. Decision Logic (AI Responsibility)
**Input Types:**
1.  Company name only
2.  Company domain available

**Strategy Selection:**
*   If domain exists → **direct site crawl**
*   If only name → **controlled Google search**
*   AI must decide **one strategy only** per company.

## 5. Career Page Discovery Logic
**Keywords to Search For:**
*   careers
*   jobs
*   work-with-us
*   join-us
*   opportunities
*   life-at

**Where to Look:**
*   Header navigation
*   Footer links
*   Sitemap (if available)
*   Internal links containing keywords

## 6. Human-Like Behavior Rules (Strict)
The AI must behave like a human user.
*   Random delay: 2–6 seconds
*   Scroll before clicking
*   Do not click immediately after page load
*   No more than 1–2 companies per minute
*   No parallel browsers in phase 1
*   **Violating these rules increases block risk.**

## 7. Validation Step (Before Saving)
For each discovered career page:
1.  HTTP status must be 200
2.  Page title must be relevant
3.  URL must belong to company domain
4.  If validation fails → mark as `not_found`.

## 8. Data Storage Schema (Minimum)
```json
{
  "companyName": "String",
  "domain": "String",
  "careerPageUrl": "String",
  "source": "direct | google",
  "discoveredAt": "Date",
  "status": "found | not_found | blocked"
}
```

## 9. Execution Lifecycle (One Job)
1.  Receive input
2.  Validate input
3.  Choose strategy
4.  Launch browser (with proxy)
5.  Perform discovery
6.  Validate result
7.  Save to database
8.  Exit
*(No infinite loops)*

## 10. What NOT To Do (Important)
*   ❌ Do not scrape LinkedIn first
*   ❌ Do not rotate IPs yet
*   ❌ Do not open multiple browsers
*   ❌ Do not retry aggressively
*   **Antigravity is in stability-first mode.**
