const { chromium } = require('playwright');

async function openLinkedIn() {
  console.log('Launching browser...');
  const browser = await chromium.launch({
    headless: false,
    slowMo: 300,
  });

  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  });

  const page = await context.newPage();

  try {
    // 1. Open Google
    console.log('Opening Google...');
    await page.goto('https://www.google.com', {
      waitUntil: 'domcontentloaded',
      timeout: 60000,
    });
    await page.waitForTimeout(2000);

    // Dismiss cookie/consent banner if it appears
    try {
      const consentSelectors = ['button:has-text("Accept")', 'button:has-text("Accept all")', 'button:has-text("I agree")', '[aria-label="Accept all"]'];
      for (const sel of consentSelectors) {
        const btn = await page.$(sel);
        if (btn && (await btn.isVisible())) {
          await btn.click();
          await page.waitForTimeout(1500);
          break;
        }
      }
    } catch (e) {}

    // 2. Search for "linkedin"
    console.log('Searching for linkedin...');
    const searchSelectors = ['textarea[name="q"]', 'input[name="q"]'];
    let searchBox = null;
    for (const sel of searchSelectors) {
      searchBox = await page.$(sel);
      if (searchBox) break;
    }
    if (!searchBox) {
      throw new Error('Could not find Google search box');
    }
    await searchBox.click();
    await searchBox.fill('linkedin');
    await page.waitForTimeout(500);
    await searchBox.press('Enter');

    // 3. Wait for search results and click LinkedIn
    console.log('Waiting for search results...');
    await page.waitForTimeout(3000);

    // Click the first organic result that links to linkedin.com (prefer main site)
    const organicLink = await page.$('div.g a[href*="linkedin.com"]');
    const anyLinkedInLink = await page.$('a[href*="linkedin.com"]');
    const toClick = organicLink || anyLinkedInLink;
    if (toClick && (await toClick.isVisible())) {
      console.log('Clicking LinkedIn...');
      await toClick.click();
    } else {
      // Fallback: go directly to LinkedIn
      console.log('Opening LinkedIn directly...');
      await page.goto('https://www.linkedin.com', { waitUntil: 'domcontentloaded', timeout: 60000 });
    }

    await page.waitForTimeout(3000);
    console.log('Browser opened with LinkedIn. Press Ctrl+C to close when done.');
  } catch (err) {
    console.error('Error:', err.message);
    // Fallback: go directly to LinkedIn if search flow fails
    console.log('Falling back to direct LinkedIn URL...');
    await page.goto('https://www.linkedin.com', { waitUntil: 'domcontentloaded', timeout: 60000 });
  }

  process.on('SIGINT', async () => {
    console.log('\nClosing browser...');
    await browser.close();
    process.exit(0);
  });
}

openLinkedIn().catch(console.error);
