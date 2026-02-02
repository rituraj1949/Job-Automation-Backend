const { chromium } = require('playwright');

const JOB_KEYWORD = "Full Stack AI Developer";
const LOCATIONS = ["Noida", "Gurugram", "Mumbai", "New Delhi", "Bengaluru", "Delhi/NCR"];
const SALARY_RANGES = ["15-25 Lakhs", "25-50 Lakhs"];
const FRESHNESS = "Last 1 Day";

async function applyFilters() {
  console.log('Connecting to browser...');
  
  // Try to connect to existing browser or launch new onvv
  let browser;
  try {
    // Try to connect to existing browser (if launched with --remote-debugging-port)
    browser = await chromium.connectOverCDP('http://localhost:9222');
    console.log('Connected to existing browser...');
  } catch (e) {
    // Launch new browser if connection fails
    browser = await chromium.launch({ 
      headless: false,
      slowMo: 500
    });
    console.log('Launched new browser');
  }
  
  const contexts = browser.contexts();
  const page = contexts.length > 0 ? await contexts[0].pages()[0] : await browser.newPage();
  
  // Navigate to Naukri if not already there
  const currentUrl = page.url();
  if (!currentUrl.includes('naukri.com')) {
    console.log('Navigating to Naukri.com...');
    await page.goto('https://www.naukri.com', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(3000);
  }
  
  console.log('Starting job search with filters...');
  
  // Search for the job keyword
  const searchSelectors = [
    'input[placeholder*="Skills"]',
    'input[placeholder*="skills"]',
    'input[placeholder*="Job title"]',
    'input[id*="keyword"]',
    '#qsb-keyword-sugg'
  ];
  
  let searchBox = null;
  for (const selector of searchSelectors) {
    try {
      searchBox = await page.$(selector);
      if (searchBox && await searchBox.isVisible()) {
        console.log(`Found search box: ${selector}`);
        break;
      }
    } catch (e) {
      continue;
    }
  }
  
  if (searchBox) {
    await searchBox.click();
    await page.waitForTimeout(500);
    await searchBox.fill('');
    await page.waitForTimeout(500);
    await searchBox.type(JOB_KEYWORD, { delay: 50 });
    await page.waitForTimeout(1000);
    
    // Click search
    const searchButton = await page.$('button:has-text("Search"), button[type="submit"]');
    if (searchButton) {
      await searchButton.click();
    } else {
      await searchBox.press('Enter');
    }
    
    await page.waitForTimeout(5000);
    console.log('Search completed, applying filters...');
  }
  
  // Apply location filters
  console.log('Applying location filters...');
  for (const location of LOCATIONS) {
    try {
      const locationElement = await page.$(`text=${location}, button:has-text("${location}")`);
      if (locationElement) {
        await locationElement.click();
        await page.waitForTimeout(1000);
        console.log(`Applied location: ${location}`);
      }
    } catch (e) {
      continue;
    }
  }
  
  // Apply salary filters
  console.log('Applying salary filters...');
  for (const salary of SALARY_RANGES) {
    try {
      const salaryElement = await page.$(`text=${salary}, button:has-text("${salary}")`);
      if (salaryElement) {
        await salaryElement.click();
        await page.waitForTimeout(1000);
        console.log(`Applied salary: ${salary}`);
      }
    } catch (e) {
      continue;
    }
  }
  
  // Apply freshness filter
  console.log('Applying freshness filter...');
  try {
    const freshnessElement = await page.$(`text=${FRESHNESS}, button:has-text("${FRESHNESS}")`);
    if (freshnessElement) {
      await freshnessElement.click();
      await page.waitForTimeout(1000);
      console.log(`Applied freshness: ${FRESHNESS}`);
    }
  } catch (e) {
    console.log('Could not apply freshness filter');
  }
  
  // Sort by date
  console.log('Sorting by date...');
  try {
    const sortElement = await page.$('button:has-text("Date"), text=Most Recent');
    if (sortElement) {
      await sortElement.click();
      await page.waitForTimeout(1000);
      console.log('Sorted by date');
    }
  } catch (e) {
    console.log('Could not sort by date');
  }
  
  console.log('Filters applied successfully!');
  console.log('Browser will stay open. Press Ctrl+C to exit.');
  
  // Keep script running
  process.on('SIGINT', async () => {
    console.log('\nClosing...');
    await browser.close();
    process.exit(0);
  });
}

applyFilters().catch(console.error);
