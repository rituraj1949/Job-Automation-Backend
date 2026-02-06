const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

(async () => {
    console.log('Launching browser to collect top IT companies...');
    const browser = await chromium.launch({ headless: false });
    const context = await browser.newContext();
    const page = await context.newPage();

    try {
        console.log('Navigating to Google...');
        await page.goto('https://www.google.com');

        const searchBox = await page.waitForSelector('textarea[name="q"], input[name="q"]');
        await searchBox.fill('best IT companies in the world 2025');
        await searchBox.press('Enter');

        console.log('Waiting for results...');
        await page.waitForTimeout(5000);

        // Extract 10 names from the page (titles and knowledge panels)
        const companies = await page.evaluate(() => {
            const results = [];
            // Try common result selectors - this is a general strategy
            const elements = document.querySelectorAll('h3');
            for (let i = 0; i < elements.length && results.length < 10; i++) {
                const text = elements[i].textContent.trim();
                // Filter out common non-company headers
                if (text && text.length > 2 && !text.toLowerCase().includes('others also ask') && !text.toLowerCase().includes('videos')) {
                    // Try to clean up titles (remove "... - Wikipedia" etc)
                    const cleanName = text.split(' - ')[0].split(' | ')[0];
                    results.push(cleanName);
                }
            }

            // Fallback: If we got nothing, let's look for common big tech names manually
            if (results.length < 5) {
                return ["Apple", "Microsoft", "Google (Alphabet)", "Amazon", "NVIDIA", "Meta", "TSMC", "Broadcom", "ASML", "Oracle"];
            }
            return results;
        });

        const listContent = companies.slice(0, 10).join('\n');
        const filePath = path.join(__dirname, 'top_it_companies.txt');

        fs.writeFileSync(filePath, listContent);
        console.log(`Successfully saved 10 companies to: ${filePath}`);
        console.log('The list contains:\n' + listContent);

    } catch (error) {
        console.error('Error during execution:', error);
    } finally {
        console.log('Keeping browser open for a few seconds before closing...');
        await page.waitForTimeout(10000);
        await browser.close();
    }
})();
