const { chromium } = require("playwright-extra");
const stealth = require("puppeteer-extra-plugin-stealth")();
chromium.use(stealth);
const { startScreenshotStream, stopScreenshotStream, emitAutomationStatus } = require('./screenshot-service');

let isRunning = false;

async function runRandomActivity() {
    if (isRunning) {
        console.log("Random activity is already running.");
        return;
    }

    isRunning = true;
    let browser = null;
    let page = null;

    try {
        console.log("Starting random website visits...");

        // Run headless in production, headed in local development
        const isProduction = process.env.NODE_ENV === 'production' || process.env.RENDER === 'true';

        browser = await chromium.launch({
            headless: isProduction,
            args: ["--disable-blink-features=AutomationControlled"]
        });

        const context = await browser.newContext({
            viewport: { width: 1280, height: 720 },
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36'
        });

        page = await context.newPage();

        // Start streaming screenshots
        await startScreenshotStream(page, 'random-sites', 1000);
        emitAutomationStatus("Random Browsing Started");

        const websites = [
            "https://www.wikipedia.org",
            "https://www.reddit.com",
            "https://www.bbc.com",
            "https://www.github.com",
            "https://www.medium.com",
            "https://www.producthunt.com",
            "https://www.theverge.com",
            "https://www.techcrunch.com",
            "https://www.nytimes.com",
            "https://www.wired.com",
            "https://www.nasa.gov",
            "https://www.imdb.com",
            "https://www.quora.com",
            "https://www.nationalgeographic.com",
            "https://www.ted.com"
        ];

        // Shuffle and pick 10
        const shuffled = websites.sort(() => 0.5 - Math.random());
        const selected = shuffled.slice(0, 10);

        console.log(`Selected 10 websites. Visiting each for 15 seconds...`);

        for (let i = 0; i < selected.length; i++) {
            if (!isRunning) break;

            const site = selected[i];
            console.log(`Visiting (${i + 1}/10): ${site}`);
            emitAutomationStatus(`Visiting: ${site}`);

            try {
                // Navigate to the site
                await page.goto(site, { waitUntil: 'domcontentloaded', timeout: 30000 });

                // Show for 15 seconds with minor interactions
                const startTime = Date.now();
                while (Date.now() - startTime < 15000 && isRunning) {
                    // Random slow scroll
                    await page.evaluate(() => {
                        window.scrollBy({
                            top: Math.random() * 300,
                            behavior: 'smooth'
                        });
                    });

                    // Wait 3-5 seconds between scrolls
                    await page.waitForTimeout(Math.random() * 2000 + 3000);
                }

            } catch (err) {
                console.warn(`Failed to visit ${site}: ${err.message}`);
                // If it fails, just move to the next one
            }
        }

        console.log("Random visits completed.");
        emitAutomationStatus("Idle");

    } catch (error) {
        console.error("Error in random activity:", error);
    } finally {
        isRunning = false;
        stopScreenshotStream();
        if (page) await page.close();
        if (browser) await browser.close();
    }
}

function stopRandomActivity() {
    console.log("Stopping random activity...");
    isRunning = false;
}

module.exports = {
    runRandomActivity,
    stopRandomActivity,
    isRandomActivityRunning: () => isRunning
};
