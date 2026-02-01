const { chromium } = require('playwright');
const axios = require('axios');
const { SocksProxyAgent } = require('socks-proxy-agent');

// Roadmap Step 1.1: Local proxy endpoint
const PROXY_URL = 'socks5://127.0.0.1:9090';

// Roadmap Step 8: Data Storage Schema
class DiscoveryResult {
    constructor(companyName, domain, careerPageUrl, source, status) {
        this.companyName = companyName;
        this.domain = domain;
        this.careerPageUrl = careerPageUrl;
        this.source = source;
        this.discoveredAt = new Date();
        this.status = status; // 'found' | 'not_found' | 'blocked'
    }
}

async function discoverCareerPage(companyName, knownDomain = null) {
    console.log(`\n🔍 Starting Discovery for: "${companyName}" (Domain: ${knownDomain || 'Unknown'})`);

    // Roadmap Step 2.2: Playwright with Proxy
    const browser = await chromium.launch({
        headless: false, // Visible for debugging/human-like checking
        proxy: { server: PROXY_URL },
        args: ['--disable-blink-features=AutomationControlled']
    });

    const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
        viewport: { width: 1280, height: 720 }
    });

    const page = await context.newPage();
    let result = null;

    try {
        // Roadmap Step 4: Decision Logic
        if (knownDomain) {
            console.log(`🔹 Strategy: Direct Domain Crawl (${knownDomain})`);
            result = await directCrawlStrategy(page, companyName, knownDomain);
        }

        if (!result || result.status !== 'found') {
            console.log(`🔹 Strategy: Google Search Fallback`);
            result = await googleSearchStrategy(page, companyName);
        }

    } catch (error) {
        console.error(`❌ Critical Error: ${error.message}`);
        result = new DiscoveryResult(companyName, knownDomain, null, 'error', 'blocked');
    } finally {
        await browser.close();
    }

    return result;
}

// Strategy 1: Google Search (Controlled)
async function googleSearchStrategy(page, companyName) {
    try {
        // Human-like: Random delay before starting
        await randomDelay(page, 2000, 4000);

        await page.goto('https://www.google.com', { waitUntil: 'domcontentloaded' });

        // Check for Proxy connectivity/Google Block
        const title = await page.title();
        if (title.includes('Error') || title.includes('Sorry')) {
            throw new Error('Google flagged the Proxy IP.');
        }

        // Search Query: "Company Name careers"
        const query = `${companyName} careers jobs`;
        await page.fill('textarea[name="q"], input[name="q"]', query);
        await page.keyboard.press('Enter');

        await page.waitForTimeout(3000); // Wait for results

        // Roadmap Step 5: Look for Career Page Keywords in results
        // Extract first organic result that isn't an ad
        const firstLink = await page.$('div#search a h3');
        if (firstLink) {
            await firstLink.click();
            await page.waitForLoadState('domcontentloaded');

            const url = page.url();
            console.log(`👉 Discovered URL: ${url}`);

            // Validation (Roadmap Step 7)
            if (isValidCareerPage(url, companyName)) {
                return new DiscoveryResult(companyName, new URL(url).hostname, url, 'google', 'found');
            }
        }

        return new DiscoveryResult(companyName, null, null, 'google', 'not_found');

    } catch (e) {
        console.error(`Google Strategy Failed: ${e.message}`);
        return null;
    }
}

// Helper: Random Delay (Roadmap Step 6)
async function randomDelay(page, min, max) {
    const delay = Math.floor(Math.random() * (max - min + 1) + min);
    await page.waitForTimeout(delay);
}

// Helper: Simple Validation
function isValidCareerPage(url, companyName) {
    const lowerUrl = url.toLowerCase();
    const keywords = ['career', 'job', 'join', 'work', 'about'];
    const hasKeyword = keywords.some(k => lowerUrl.includes(k));
    const isLinkedIn = lowerUrl.includes('linkedin.com'); // We want OFFICIAL sites first

    return hasKeyword && !isLinkedIn && !lowerUrl.includes('glassdoor') && !lowerUrl.includes('indeed');
}

// Export
module.exports = { discoverCareerPage };
