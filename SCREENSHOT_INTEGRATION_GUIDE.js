// Example integration guide for screenshot streaming
// Add this to your naukri-automation.js or any automation script

const { startScreenshotStream, stopScreenshotStream, emitJobApplied } = require('./screenshot-service');

// Example: In your automation function where you have the page object

async function applyToJobs(page) {
    try {
        // Start screenshot streaming when automation begins
        // This will capture and send screenshots every 1 second
        await startScreenshotStream(page, 'naukri', 1000);

        console.log('Screenshot streaming started - frontend will show live view');

        // Your existing automation code here
        // ... navigate, click, fill forms, etc.

        // Example: When a job is applied
        const jobTitle = await page.locator('.job-title').textContent();
        const company = await page.locator('.company-name').textContent();

        // Emit job applied event
        emitJobApplied({
            platform: 'naukri',
            position: jobTitle,
            company: company,
            timestamp: new Date().toISOString()
        });

        // Continue automation...

    } catch (error) {
        console.error('Automation error:', error);
    } finally {
        // Stop screenshot streaming when done
        stopScreenshotStream();
        console.log('Screenshot streaming stopped');
    }
}

// Example: For LinkedIn automation
async function linkedinAutomation(page) {
    await startScreenshotStream(page, 'linkedin', 1000);

    // Your LinkedIn automation code...

    stopScreenshotStream();
}

// Example: For Indeed automation
async function indeedAutomation(page) {
    await startScreenshotStream(page, 'indeed', 1000);

    // Your Indeed automation code...

    stopScreenshotStream();
}

/*
INTEGRATION STEPS:

1. Import the screenshot service at the top of your automation file:
   const { startScreenshotStream, stopScreenshotStream } = require('./screenshot-service');

2. After you create/launch your browser page, call:
   await startScreenshotStream(page, 'platform-name', 1000);
   
   Parameters:
   - page: Your Playwright page object
   - platform: 'naukri', 'linkedin', 'indeed', 'shine', 'company', or 'google'
   - interval: Screenshot interval in milliseconds (1000 = 1 second)

3. Your automation runs normally - screenshots are captured automatically

4. When automation completes or errors, call:
   stopScreenshotStream();

EXAMPLE FOR YOUR EXISTING CODE:

// In naukri-automation.js, find where you have:
const page = await context.newPage();

// Add right after:
const { startScreenshotStream, stopScreenshotStream } = require('./screenshot-service');
await startScreenshotStream(page, 'naukri', 1000);

// Then at the end of your function (in try-catch-finally):
finally {
  stopScreenshotStream();
  await page.close();
}
*/

module.exports = {
    applyToJobs,
    linkedinAutomation,
    indeedAutomation
};
