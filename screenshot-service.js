// Screenshot streaming service for live browser view
// Support multiple concurrent streams (e.g., website tab + LinkedIn tab)
const activeStreams = new Map(); // Map of streamId -> { interval, page, platform }

/**
 * Start streaming screenshots from a Playwright page
 * @param {Page} page - Playwright page instance
 * @param {string} platform - Platform name (e.g., 'career-website', 'career-linkedin')
 * @param {number} intervalMs - Screenshot interval in milliseconds (default: 2000ms)
 * @param {string} streamId - Optional unique ID for this stream (defaults to platform)
 */
async function startScreenshotStream(page, platform = 'naukri', intervalMs = 2000, streamId = null) {
    if (!global.io) {
        console.warn('Socket.IO not initialized. Cannot start screenshot stream.');
        return;
    }

    const id = streamId || platform;

    // Stop existing stream with same ID if any
    if (activeStreams.has(id)) {
        stopScreenshotStream(id);
    }

    console.log(`Starting screenshot stream: ${id} (${platform}) - every ${intervalMs}ms`);

    // Emit initial screenshot immediately
    await captureAndEmitScreenshot(page, platform);

    // Set up interval for continuous screenshots
    const interval = setInterval(async () => {
        try {
            if (page && !page.isClosed()) {
                await captureAndEmitScreenshot(page, platform);
            } else {
                console.log(`Page closed for stream ${id}, stopping...`);
                stopScreenshotStream(id);
            }
        } catch (error) {
            // Silently skip errors
        }
    }, intervalMs);

    // Store stream info
    activeStreams.set(id, { interval, page, platform });
}

/**
 * Capture screenshot and emit via Socket.IO
 */
async function captureAndEmitScreenshot(page, platform) {
    try {
        // Capture screenshot with reduced timeout for Render's free tier
        const screenshot = await page.screenshot({
            type: 'jpeg',
            quality: 60, // Reduced quality for faster transmission
            fullPage: false, // Only visible viewport
            timeout: 5000 // 5 second timeout instead of 30 seconds
        });

        // Convert to base64
        const base64Image = screenshot.toString('base64');

        // Emit to all connected clients
        global.io.emit('screenshot', {
            platform,
            image: `data:image/jpeg;base64,${base64Image}`,
            timestamp: new Date().toISOString()
        });

        // Also emit platform-specific event
        global.io.emit(`screenshot:${platform}`, {
            image: `data:image/jpeg;base64,${base64Image}`,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        // Silently handle timeout errors - don't flood logs
        if (!error.message.includes('Timeout')) {
            console.error('Error in captureAndEmitScreenshot:', error.message);
        }
        // Skip this screenshot and try again next interval
    }
}

/**
 * Stop screenshot streaming
 * @param {string} streamId - Optional ID for specific stream to stop (stops all if not provided)
 */
function stopScreenshotStream(streamId = null) {
    if (streamId) {
        // Stop specific stream
        const stream = activeStreams.get(streamId);
        if (stream) {
            clearInterval(stream.interval);
            activeStreams.delete(streamId);
            console.log(`Screenshot stream stopped: ${streamId}`);
        }
    } else {
        // Stop all streams
        for (const [id, stream] of activeStreams.entries()) {
            clearInterval(stream.interval);
            console.log(`Screenshot stream stopped: ${id}`);
        }
        activeStreams.clear();
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
    emitAutomationStatus,
    emitJobApplied,
    emitExtractionProgress
};
