const { chromium } = require('playwright');
const fs = require('fs');

(async () => {
    // Launch browser in headed mode with PROXY
    const browser = await chromium.launch({
        headless: false,
        proxy: {
            server: 'http://198.105.121.200:6462',
            username: 'vywvhplw',
            password: 'uztli2ytcc6u'
        }
    });
    const context = await browser.newContext({
        viewport: { width: 1920, height: 1080 }
    });
    const page = await context.newPage();

    console.log('🔹 Navigating directly to Naukri.com...');
    await page.goto('https://www.naukri.com');

    console.log('👉 Please LOG IN to Naukri manually now!');
    console.log('👉 Solve any CAPTCHAs.');
    console.log('⏳ You have 3 minutes to complete login...');
    console.log('👉 DO NOT CLOSE THE BROWSER MANUALLY. Wait for it to close.');

    // Wait enough time for manual interaction
    await page.waitForTimeout(180000);

    // Save storage state logic
    console.log('💾 Saving authentication state to auth.json...');
    await context.storageState({ path: 'auth.json' });
    console.log('✅ auth.json created successfully!');
    console.log('👉 You will now push this file to GitHub.');

    await browser.close();
})();
