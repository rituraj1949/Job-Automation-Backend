const { chromium } = require('playwright');

async function openShine() {
  console.log('Launching browser...');
  const browser = await chromium.launch({ 
    headless: false,
    slowMo: 500
  });
  
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  });
  
  const page = await context.newPage();
  
  console.log('Opening Shine.com...');
  await page.goto('https://www.shine.com', {
    waitUntil: 'domcontentloaded',
    timeout: 60000
  });
  
  // Wait for page to load
  await page.waitForTimeout(5000);
  
  // Handle any popups/modals
  try {
    const popupSelectors = [
      'button:has-text("Skip")',
      'button:has-text("Close")',
      '[aria-label="Close"]',
      '.close',
      'button.close',
      'button:has-text("Got it")',
      'button:has-text("Accept")'
    ];
    
    for (const selector of popupSelectors) {
      try {
        const popup = await page.$(selector);
        if (popup) {
          const isVisible = await popup.isVisible();
          if (isVisible) {
            await popup.click();
            await page.waitForTimeout(1000);
            console.log('Closed popup');
          }
        }
      } catch (e) {
        continue;
      }
    }
  } catch (e) {
    // Ignore popup errors
  }
  
  console.log('Shine.com opened successfully!');
  console.log('Browser will stay open. Press Ctrl+C to close.');
  
  // Keep the browser open
  process.on('SIGINT', async () => {
    console.log('\nClosing browser...');
    await browser.close();
    process.exit(0);
  });
}

openShine().catch(console.error);
