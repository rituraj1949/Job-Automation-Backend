const { chromium } = require('playwright');

(async () => {
    console.log('Launching browser on your machine...');
    const browser = await chromium.launch({
        headless: false,
        slowMo: 1000 // Slowed down so you can see the actions
    });
    const context = await browser.newContext();
    const page = await context.newPage();

    console.log('Navigating to Google...');
    await page.goto('https://www.google.com');

    console.log('Performing search...');
    const searchBox = await page.waitForSelector('textarea[name="q"], input[name="q"]');
    await searchBox.fill('google');
    await searchBox.press('Enter');

    console.log('Search complete. Keeping browser open for 60 seconds...');
    await page.waitForTimeout(6000000);

    await browser.close();
})();
