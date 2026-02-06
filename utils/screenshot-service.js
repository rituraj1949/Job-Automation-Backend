// Screenshot streaming service for live browser view
// Support multiple concurrent streams (e.g., website tab + LinkedIn tab)
const activeStreams = new Map(); // Map of streamId -> { interval, page, platform }

/**
 * Start streaming screenshots from a Playwright page
 * @param {Page} page - Playwright page instance
 * @param {string} platform - Platform name (e.g., 'career-website', 'career-linkedin')
 * @param {number} intervalMs - Screenshot interval in milliseconds (default: 500ms for real-time)
 * @param {string} streamId - Optional unique ID for this stream (defaults to platform)
 */
async function startScreenshotStream(page, platform = 'naukri', intervalMs = 500, streamId = null) {
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
let isCapturing = false; // Prevent concurrent captures

async function captureAndEmitScreenshot(page, platform) {
    // Skip if already capturing (frame dropping)
    if (isCapturing) {
        return;
    }

    isCapturing = true;

    try {
        // Fast screenshot with aggressive optimization for real-time streaming
        const screenshot = await page.screenshot({
            type: 'jpeg',
            quality: 40, // Lower quality for faster transmission (was 60%)
            fullPage: false, // Only visible viewport
            timeout: 3000, // 3 second timeout (was 5s)
            scale: 'css' // Use CSS pixels (faster)
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
        // If target crashed or page closed, stop this stream to avoid repeated crashes
        if (error.message.includes('Target crashed') || error.message.includes('has been closed')) {
            stopScreenshotStream(platform);
        }
        // Skip this screenshot and try again next interval
    } finally {
        isCapturing = false;
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

/**
 * Send log message to frontend
 * @param {string} message - Log message
 * @param {string} type - Log type (success, error, info, warning, processing, email, api, linkedin, website)
 */
function emitLog(message, type = 'info') {
    if (global.io) {
        global.io.emit('automation:log', {
            message,
            type,
            timestamp: new Date().toLocaleTimeString()
        });
    }
    // Also log to console
    console.log(`[${type.toUpperCase()}] ${message}`);
}

module.exports = {
    startScreenshotStream,
    stopScreenshotStream,
    emitAutomationStatus,
    emitJobApplied,
    emitExtractionProgress,
    emitLog
};
