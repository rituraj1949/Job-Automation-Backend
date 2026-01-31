// Wrapper to add screenshot streaming to naukri-automation
// This intercepts the page creation and adds screenshot streaming

const originalModule = require('./naukri-automation');
const { startScreenshotStream, stopScreenshotStream } = require('./screenshot-service');

// Store original functions
const originalApplyToAllJobs = originalModule.applyToAllJobs;
const originalRunAutomationCycle = originalModule.runAutomationCycle;

// Flag to track if screenshot is already streaming
let isStreaming = false;

// Monkey-patch the Playwright page creation
const { chromium } = require('playwright');
const originalLaunch = chromium.launch;

chromium.launch = async function (...args) {
    const browser = await originalLaunch.apply(this, args);
    const originalNewContext = browser.newContext.bind(browser);

    browser.newContext = async function (...contextArgs) {
        const context = await originalNewContext(...contextArgs);
        const originalNewPage = context.newPage.bind(context);

        context.newPage = async function (...pageArgs) {
            const page = await originalNewPage(...pageArgs);

            // Start screenshot streaming when page is created
            if (!isStreaming && global.io) {
                console.log('[Screenshot] Auto-starting screenshot stream for new page');
                await startScreenshotStream(page, 'naukri', 1000);
                isStreaming = true;

                // Stop streaming when page closes
                page.on('close', () => {
                    console.log('[Screenshot] Page closed, stopping screenshot stream');
                    stopScreenshotStream();
                    isStreaming = false;
                });
            }

            return page;
        };

        return context;
    };

    return browser;
};

// Export the modified module
module.exports = originalModule;
