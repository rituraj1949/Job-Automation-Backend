const { chromium } = require('playwright');

// Job search configuration for Shine.com
const JOB_KEYWORD = "Full Stack AI Developer";
const LOCATIONS = ["Noida", "Gurugram", "Mumbai", "New Delhi", "Bengaluru", "Delhi"];
const SALARY_RANGES = ["15-25 Lakhs", "25-50 Lakhs"];
const FRESHNESS = "Last 1 Day";

let browser = null;
let page = null;

// Initialize browser and navigate to Shine.com
async function initializeBrowser() {
  try {
    console.log('Launching browser...');
    browser = await chromium.launch({ 
      headless: false,
      slowMo: 500
    });
    
    const context = await browser.newContext({
      viewport: { width: 1920, height: 1080 },
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    });
    
    page = await context.newPage();
    
    console.log('Navigating to Shine.com...');
    await page.goto('https://www.shine.com', {
      waitUntil: 'domcontentloaded',
      timeout: 60000
    });
    
    await page.waitForTimeout(5000);
    
    // Handle popups
    try {
      const popupSelectors = [
        'button:has-text("Skip")',
        'button:has-text("Close")',
        '[aria-label="Close"]',
        '.close',
        'button.close'
      ];
      
      for (const selector of popupSelectors) {
        try {
          const popup = await page.$(selector);
          if (popup && await popup.isVisible()) {
            await popup.click();
            await page.waitForTimeout(1000);
          }
        } catch (e) {
          continue;
        }
      }
    } catch (e) {
      // Ignore
    }
    
    console.log('Browser initialized successfully');
    console.log('Please ensure you are logged into Shine.com');
    return { browser, page };
  } catch (error) {
    console.error('Error initializing browser:', error);
    throw error;
  }
}

// Search for jobs on Shine.com
async function searchJobs() {
  try {
    console.log(`Searching for jobs with keyword: ${JOB_KEYWORD}`);
    
    // Find search box
    const searchSelectors = [
      'input[placeholder*="Job Title"]',
      'input[placeholder*="job"]',
      'input[placeholder*="Skills"]',
      'input[id*="search"]',
      'input[name*="search"]',
      'input[class*="search"]',
      '#searchJob'
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
    
    if (!searchBox) {
      throw new Error('Could not find search box on Shine.com');
    }
    
    // Type keyword
    await searchBox.click();
    await page.waitForTimeout(500);
    await searchBox.fill('');
    await page.waitForTimeout(500);
    await searchBox.type(JOB_KEYWORD, { delay: 50 });
    await page.waitForTimeout(1000);
    
    // Click search button
    const searchButtonSelectors = [
      'button:has-text("Search")',
      'button[type="submit"]',
      '.search-btn',
      'button.search',
      '[aria-label*="Search"]'
    ];
    
    let searched = false;
    for (const selector of searchButtonSelectors) {
      try {
        const button = await page.$(selector);
        if (button && await button.isVisible()) {
          await button.click();
          searched = true;
          break;
        }
      } catch (e) {
        continue;
      }
    }
    
    if (!searched) {
      await searchBox.press('Enter');
    }
    
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(5000);
    
    console.log('Search completed');
    return true;
  } catch (error) {
    console.error('Error searching jobs:', error);
    throw error;
  }
}

// Apply location filters
async function applyLocationFilters() {
  try {
    console.log('Applying location filters...');
    await page.waitForTimeout(2000);
    
    // Scroll to filter section
    await page.evaluate(() => {
      const filterSection = document.querySelector('.filter-container, .filters, [class*="filter"]');
      if (filterSection) {
        filterSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
    await page.waitForTimeout(1000);
    
    // Try to expand location filter
    const expandSelectors = [
      '.locationFilter',
      '[class*="location"] [class*="filter"]',
      'text=Location',
      'button:has-text("Location")',
      '.filter-title:has-text("Location")'
    ];
    
    for (const selector of expandSelectors) {
      try {
        const expandBtn = await page.$(selector);
        if (expandBtn && await expandBtn.isVisible()) {
          await expandBtn.click();
          await page.waitForTimeout(1000);
          break;
        }
      } catch (e) {
        continue;
      }
    }
    
    // Apply each location
    for (const location of LOCATIONS) {
      try {
        const locationSelectors = [
          `label:has-text("${location}")`,
          `input[value*="${location}"]`,
          `text=${location}`,
          `span:has-text("${location}")`,
          `li:has-text("${location}")`
        ];
        
        let locationSelected = false;
        for (const selector of locationSelectors) {
          try {
            const locationElement = await page.$(selector);
            if (locationElement && await locationElement.isVisible()) {
              const tagName = await locationElement.evaluate(el => el.tagName.toLowerCase());
              if (tagName === 'input') {
                const isChecked = await locationElement.isChecked();
                if (!isChecked) {
                  await locationElement.click();
                  locationSelected = true;
                  console.log(`✓ Selected location: ${location}`);
                  await page.waitForTimeout(800);
                  break;
                }
              } else {
                await locationElement.click();
                locationSelected = true;
                console.log(`✓ Selected location: ${location}`);
                await page.waitForTimeout(800);
                break;
              }
            }
          } catch (e) {
            continue;
          }
        }
        
        if (!locationSelected) {
          console.log(`⚠ Could not find location filter for: ${location}`);
        }
      } catch (e) {
        continue;
      }
    }
    
    await page.waitForTimeout(2000);
    console.log('Location filters applied');
  } catch (error) {
    console.error('Error applying location filters:', error);
  }
}

// Apply salary filters
async function applySalaryFilters() {
  try {
    console.log('Applying salary filters...');
    await page.waitForTimeout(1000);
    
    // Expand salary filter
    const expandSelectors = [
      '.salaryFilter',
      '[class*="salary"]',
      'text=Salary',
      'button:has-text("Salary")'
    ];
    
    for (const selector of expandSelectors) {
      try {
        const expandBtn = await page.$(selector);
        if (expandBtn && await expandBtn.isVisible()) {
          await expandBtn.click();
          await page.waitForTimeout(1000);
          break;
        }
      } catch (e) {
        continue;
      }
    }
    
    for (const salaryRange of SALARY_RANGES) {
      try {
        const salarySelectors = [
          `label:has-text("${salaryRange}")`,
          `label:has-text("15-25")`,
          `label:has-text("25-50")`,
          `text=${salaryRange}`,
          `text=15-25`,
          `text=25-50`
        ];
        
        let salarySelected = false;
        for (const selector of salarySelectors) {
          try {
            const salaryElement = await page.$(selector);
            if (salaryElement && await salaryElement.isVisible()) {
              const tagName = await salaryElement.evaluate(el => el.tagName.toLowerCase());
              if (tagName === 'input') {
                const isChecked = await salaryElement.isChecked();
                if (!isChecked) {
                  await salaryElement.click();
                  salarySelected = true;
                  console.log(`✓ Selected salary: ${salaryRange}`);
                  await page.waitForTimeout(800);
                  break;
                }
              } else {
                await salaryElement.click();
                salarySelected = true;
                console.log(`✓ Selected salary: ${salaryRange}`);
                await page.waitForTimeout(800);
                break;
              }
            }
          } catch (e) {
            continue;
          }
        }
        
        if (!salarySelected) {
          console.log(`⚠ Could not find salary filter for: ${salaryRange}`);
        }
      } catch (e) {
        continue;
      }
    }
    
    await page.waitForTimeout(2000);
    console.log('Salary filters applied');
  } catch (error) {
    console.error('Error applying salary filters:', error);
  }
}

// Main function to control Shine.com
async function controlShine() {
  try {
    const { browser: b, page: p } = await initializeBrowser();
    browser = b;
    page = p;
    
    // Search for jobs
    await searchJobs();
    
    // Apply filters
    await applyLocationFilters();
    await applySalaryFilters();
    
    console.log('Shine.com automation completed!');
    console.log('Browser will stay open. Press Ctrl+C to close.');
    
    // Keep browser open
    process.on('SIGINT', async () => {
      console.log('\nClosing browser...');
      await browser.close();
      process.exit(0);
    });
  } catch (error) {
    console.error('Error controlling Shine.com:', error);
    if (browser) {
      await browser.close();
    }
  }
}

// Run if called directly
if (require.main === module) {
  controlShine();
}

module.exports = { controlShine, initializeBrowser, searchJobs, applyLocationFilters, applySalaryFilters };
