const { chromium } = require('playwright');

const LOGIN_EMAIL = 'rituraj1949@gmail.com';
const LOGIN_PASSWORD = 'Ritu778@%,.&';

async function performLogin(page) {
  try {
    console.log('Attempting to log in to Naukri.com...');

    const loginButtonSelectors = [
      'a[title="Jobseeker Login"]',
      'a:has-text("Login")',
      'a:has-text("Log in")',
      'button:has-text("Login")',
      'button:has-text("Log in")',
      "[class*='login']",
      "text=Login",
      "text=Log in",
    ];

    let loginClicked = false;
    for (const selector of loginButtonSelectors) {
      try {
        const btn = await page.$(selector);
        if (btn && (await btn.isVisible())) {
          await btn.click();
          loginClicked = true;
          await page.waitForTimeout(3000);
          break;
        }
      } catch (e) {
        continue;
      }
    }

    if (!loginClicked) {
      await page.goto('https://www.naukri.com/nlogin/login', {
        waitUntil: 'domcontentloaded',
        timeout: 15000,
      });
      await page.waitForTimeout(2000);
    }

    const emailSelectors = [
      'input[placeholder*="Enter Email ID"]',
      'input[placeholder*="Email ID / Username"]',
      'input[placeholder*="Email"]',
      '#usernameField',
      'input[name="USERNAME"]',
      'input[name="username"]',
      'input[type="email"]',
      '#emailTxt',
    ];

    for (const sel of emailSelectors) {
      try {
        const el = await page.$(sel);
        if (el && (await el.isVisible())) {
          await el.fill(LOGIN_EMAIL);
          await page.waitForTimeout(500);
          break;
        }
      } catch (e) {
        continue;
      }
    }

    const passwordSelectors = [
      'input[placeholder*="Enter Password"]',
      'input[placeholder*="Password"]',
      '#passwordField',
      'input[name="PASSWORD"]',
      'input[name="password"]',
      'input[type="password"]',
      '#pwd1',
    ];

    for (const sel of passwordSelectors) {
      try {
        const el = await page.$(sel);
        if (el && (await el.isVisible())) {
          await el.fill(LOGIN_PASSWORD);
          await page.waitForTimeout(500);
          break;
        }
      } catch (e) {
        continue;
      }
    }

    const submitSelectors = [
      '#sbtLog',
      'button[name="Login"]',
      'button:has-text("Login")',
      'button:has-text("Log in")',
      'input[type="submit"]',
      'button[type="submit"]',
      "text=Login",
      "text=Log in",
      "[class*='submit']",
    ];

    for (const sel of submitSelectors) {
      try {
        const btn = await page.$(sel);
        if (btn && (await btn.isVisible())) {
          await btn.click();
          console.log('Waiting 5 sec for redirect after login...');
          await page.waitForTimeout(5000);
          console.log('Login form submitted.');
          return true;
        }
      } catch (e) {
        continue;
      }
    }

    const pwd = await page.$('input[type="password"]');
    if (pwd) {
      await pwd.press('Enter');
      console.log('Waiting 5 sec for redirect after login...');
      await page.waitForTimeout(5000);
      console.log('Login submitted (Enter).');
      return true;
    }

    console.log('Could not find Login submit button; you may need to log in manually.');
    return false;
  } catch (err) {
    console.error('Error during login:', err.message);
    return false;
  }
}

async function openNaukri() {
  console.log('Launching browser...');
  const browser = await chromium.launch({
    headless: false,
    slowMo: 500,
  });

  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  });

  const page = await context.newPage();

  console.log('Opening Naukri.com...');
  await page.goto('https://www.naukri.com', {
    waitUntil: 'domcontentloaded',
    timeout: 60000,
  });

  await page.waitForTimeout(5000);

  // Handle popups
  try {
    const popupSelectors = ['button:has-text("Skip")', 'button:has-text("Close")', '[aria-label="Close"]', '.close', 'button.close'];
    for (const selector of popupSelectors) {
      try {
        const popup = await page.$(selector);
        if (popup) {
          await popup.click();
          await page.waitForTimeout(1000);
        }
      } catch (e) {
        continue;
      }
    }
  } catch (e) {}

  await performLogin(page);

  console.log('Browser opened. Press Ctrl+C to close when done.');

  process.on('SIGINT', async () => {
    console.log('\nClosing browser...');
    await browser.close();
    process.exit(0);
  });
}

openNaukri().catch(console.error);
