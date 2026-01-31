const { chromium } = require('playwright');
const fs = require('fs');

(async () => {
    // Launch browser in headed mode so you can see it
    const browser = await chromium.launch({ headless: false });
    const context = await browser.newContext({
        viewport: { width: 1920, height: 1080 }
    });
    const page = await context.newPage();

    console.log('🔹 Navigating directly to Naukri.com...');
    await page.goto('https://www.naukri.com');

    console.log('👉 Please LOG IN to Naukri manually now!');
    console.log('👉 Solve any CAPTCHAs.');
    console.log('⏳ You have 1.5 minutes (90 seconds) to complete login...');

    // Wait enough time for manual interaction
    await page.waitForTimeout(90000);

    // Save storage state logic
    console.log('💾 Saving authentication state to auth.json...');
    await context.storageState({ path: 'auth.json' });
    console.log('✅ auth.json created successfully!');
    console.log('👉 You will now push this file to GitHub.');

    await browser.close();
})();
