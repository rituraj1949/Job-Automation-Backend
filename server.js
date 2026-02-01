const os = require('os');
// Set Playwright path for Render production environment
if (process.env.NODE_ENV === 'production' || process.env.RENDER === 'true') {
  process.env.PLAYWRIGHT_BROWSERS_PATH = '0';
}

if (!process.env.HOME) {
  process.env.HOME = os.homedir();
}
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const { startNaukriAutomation, runAutomationCycle, applyToAllJobs, extractAndPostJobsOnly } = require('./naukri-automation');

const app = express();
const server = http.createServer(app);

// CORS configuration - allow both local and production frontends
const allowedOrigins = [
  'http://localhost:5173',  // Local development
  'https://job-automation-frontend-woad.vercel.app',  // Production Vercel
  /https:\/\/job-automation-frontend-.*\.vercel\.app$/  // Vercel preview deployments
];

const io = new Server(server, {
  cors: {
    origin: (origin, callback) => {
      // Allow requests with no origin (like mobile apps or curl)
      if (!origin) return callback(null, true);

      // Check if origin is in allowed list or matches regex
      const isAllowed = allowedOrigins.some(allowed => {
        if (typeof allowed === 'string') return allowed === origin;
        if (allowed instanceof RegExp) return allowed.test(origin);
        return false;
      });

      if (isAllowed) {
        callback(null, true);
      } else {
        callback(new Error('Not allowed by CORS'));
      }
    },
    methods: ["GET", "POST"],
    credentials: true
  }
});

const PORT = process.env.PORT || 3000;

app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);

    const isAllowed = allowedOrigins.some(allowed => {
      if (typeof allowed === 'string') return allowed === origin;
      if (allowed instanceof RegExp) return allowed.test(origin);
      return false;
    });

    if (isAllowed) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true
}));
app.use(express.json());

// Socket.IO connection handling
io.on('connection', (socket) => {
  console.log('Frontend connected:', socket.id);

  socket.on('disconnect', () => {
    console.log('Frontend disconnected:', socket.id);
  });
});

// Export io for use in other modules
global.io = io;

// Health check endpoint
app.get('/', (req, res) => {
  res.json({
    status: 'running',
    message: 'Naukri.com Job Application Automation Server',
    schedules: {
      automation: '6:00 AM, 9:00 AM, 12:00 PM, 2:15 PM (apply + post)',
      extractOnly: '10:00 AM, 5:00 PM (extract + post only, no applying)'
    },
    endpoints: {
      health: '/health',
      start: '/start',
      stop: '/stop',
      'run-now': '/run-now (POST – run one cycle immediately for testing)',
      'apply-all': '/apply-all (POST – start applying to all jobs from job 1)',
      'extract-jobs': '/extract-jobs (POST – extract jobs and post to API without applying)',
      jobs: '/jobs'
    }
  });
});

app.get('/health', (req, res) => {
  res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

// Start automation endpoint
app.post('/start', async (req, res) => {
  try {
    await startNaukriAutomation();
    res.json({ message: 'Naukri.com job application automation started successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Stop automation endpoint
app.post('/stop', (req, res) => {
  try {
    const { stopNaukriAutomation } = require('./naukri-automation');
    stopNaukriAutomation();
    res.json({ message: 'Naukri.com automation stopped successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Run one cycle immediately (for testing). Does not require /start. Runs in background; responds when cycle has started.
app.post('/run-now', (req, res) => {
  runAutomationCycle({ runNow: true }).catch((e) => console.error('Run-now error:', e));
  res.json({ message: 'Naukri job fetch cycle started. Check server logs for progress.' });
});

// Apply to all jobs starting from job 1 - simplified flow without API posting
app.post('/apply-all', async (req, res) => {
  try {
    applyToAllJobs().then((result) => {
      console.log('Apply-all cycle completed:', result);
    }).catch((e) => {
      console.error('Apply-all error:', e);
    });
    res.json({
      message: 'Started applying to all jobs from job 1. Check server logs for progress.',
      note: 'This will apply to all jobs sequentially without API posting.'
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Extract jobs and post to API without applying (manual trigger)
app.post('/extract-jobs', async (req, res) => {
  try {
    extractAndPostJobsOnly({ runNow: true }).then((result) => {
      console.log('Extract-jobs cycle completed:', result);
    }).catch((e) => {
      console.error('Extract-jobs error:', e);
    });
    res.json({
      message: 'Started extracting jobs and posting to API. Check server logs for progress.',
      note: 'This will extract jobs from all pages and post to API without applying.',
      scheduledTimes: '10:00 AM and 5:00 PM (automatic)'
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get applied jobs endpoint
app.get('/jobs', (req, res) => {
  const { getAppliedJobs } = require('./naukri-automation');
  const jobs = getAppliedJobs();
  res.json({ appliedJobs: jobs, count: jobs.length });
});

// Test screenshot streaming endpoint
app.post('/test-screenshot', async (req, res) => {
  try {
    const { chromium } = require('playwright');
    const { startScreenshotStream, stopScreenshotStream } = require('./screenshot-service');

    res.json({
      message: 'Starting test screenshot stream. Check your frontend!',
      note: 'Browser will open Naukri.com and stream screenshots for 30 seconds'
    });

    // Run in background
    (async () => {
      let browser, page;
      try {
        console.log('Launching browser for screenshot test...');
        browser = await chromium.launch({ headless: false });
        const context = await browser.newContext();
        page = await context.newPage();

        // Start screenshot streaming
        await startScreenshotStream(page, 'naukri', 1000);
        console.log('Screenshot streaming started!');

        // Navigate to Naukri
        await page.goto('https://www.naukri.com', { waitUntil: 'domcontentloaded' });
        console.log('Navigated to Naukri.com');

        // Keep the page open for 30 seconds to demonstrate streaming
        await page.waitForTimeout(30000);

      } catch (error) {
        console.error('Test screenshot error:', error);
      } finally {
        stopScreenshotStream();
        if (page) await page.close();
        if (browser) await browser.close();
        console.log('Test screenshot stream ended');
      }
    })();

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

server.listen(PORT, async () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`Socket.IO ready for connections`);
  // Auto-start scheduler on boot (6:00, 9:00, 12:00, 2:15 PM). Set AUTO_START_SCHEDULER=0 to skip.
  if (process.env.AUTO_START_SCHEDULER !== '0') {
    try {
      await startNaukriAutomation();
      console.log('Scheduler auto-started. Use POST /stop to disable.');
    } catch (e) {
      console.warn('Scheduler auto-start failed:', e.message);
    }
  } else {
    console.log('Use POST /start to begin automation');
  }
});
