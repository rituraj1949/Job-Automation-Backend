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
        // Capture screenshot as buffer (more reliable than string)
        const buffer = await page.screenshot({
            type: 'jpeg',
            quality: 50,
            scale: 'css',
            timeout: 5000,
            caret: 'hide',
            animations: 'disabled'
        });

        const base64Image = buffer.toString('base64');

        // Emit to all connected clients
        global.io.emit('screenshot', {
            image: `data:image/jpeg;base64,${base64Image}`,
            timestamp: new Date().toISOString()
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
