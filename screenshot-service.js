// Screenshot streaming service for live browser view
let screenshotInterval = null;
let currentPage = null;

/**
 * Start streaming screenshots from a Playwright page
 * @param {Page} page - Playwright page instance
 * @param {string} platform - Platform name (e.g., 'naukri', 'linkedin')
 * @param {number} intervalMs - Screenshot interval in milliseconds (default: 1000ms)
 */
async function startScreenshotStream(page, platform = 'naukri', intervalMs = 1000) {
    if (!global.io) {
        console.warn('Socket.IO not initialized. Cannot start screenshot stream.');
        return;
    }

    // Stop any existing stream
    stopScreenshotStream();

    currentPage = page;
    console.log(`Starting screenshot stream for ${platform} (every ${intervalMs}ms)`);

    // Emit initial screenshot immediately
    await captureAndEmitScreenshot(page, platform);

    // Set up interval for continuous screenshots
    screenshotInterval = setInterval(async () => {
        try {
            if (currentPage && !currentPage.isClosed()) {
                await captureAndEmitScreenshot(currentPage, platform);
            } else {
                console.log('Page closed, stopping screenshot stream');
                stopScreenshotStream();
            }
        } catch (error) {
            console.error('Error capturing screenshot:', error.message);
            // Don't stop on error, just log it
        }
    }, intervalMs);
}

/**
 * Capture screenshot and emit via Socket.IO
 */
async function captureAndEmitScreenshot(page, platform) {
    try {
        // Use CDP (Chrome DevTools Protocol) for instant screenshots
        // This bypasses Playwright's "wait for fonts" logic which is causing timeouts
        const client = await page.context().newCDPSession(page);
        const { data } = await client.send('Page.captureScreenshot', {
            format: 'jpeg',
            quality: 50,
            fromSurface: true
        });

        // data is already a base64 string
        const base64Image = data;

        // Emit to all connected clients
        global.io.emit('screenshot', {
            platform,
            image: `data:image/jpeg;base64,${base64Image}`,
            timestamp: Date.now()
        });
    } catch (error) {
        console.error('Error in captureAndEmitScreenshot:', error.message);
    }
}

/**
 * Stop screenshot streaming
 */
function stopScreenshotStream() {
    if (screenshotInterval) {
        clearInterval(screenshotInterval);
        screenshotInterval = null;
        console.log('Screenshot stream stopped');
    }
    currentPage = null;
}

/**
 * Update screenshot interval
 */
function updateScreenshotInterval(intervalMs) {
    if (screenshotInterval && currentPage) {
        const platform = 'naukri'; // You can track this if needed
        stopScreenshotStream();
        startScreenshotStream(currentPage, platform, intervalMs);
    }
}

/**
 * Send automation status update
 */
function emitAutomationStatus(status) {
    if (global.io) {
        global.io.emit('automation:status', status);
    }
}

/**
 * Send job application event
 */
function emitJobApplied(jobData) {
    if (global.io) {
        global.io.emit('job:applied', jobData);
    }
}

/**
 * Send extraction progress
 */
function emitExtractionProgress(data) {
    if (global.io) {
        global.io.emit('extraction:progress', data);
    }
}

module.exports = {
    startScreenshotStream,
    stopScreenshotStream,
    updateScreenshotInterval,
    emitAutomationStatus,
    emitJobApplied,
    emitExtractionProgress
};
