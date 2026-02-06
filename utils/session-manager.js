const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth')();
chromium.use(stealth);
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

const CHROME_PATHS = [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    process.env.CHROME_PATH
].filter(Boolean);

function getChromePath() {
    for (const p of CHROME_PATHS) {
        if (fs.existsSync(p)) return p;
    }
    return null;
}

const BASE_DIR = path.resolve(__dirname, '..'); // backend/

const SESSIONS = {
    naukri: {
        userDataDir: path.join(BASE_DIR, 'naukri', '.chrome-naukri'),
        url: 'https://www.naukri.com/nlogin/login',
        port: 9222 // Optional, can create conflicts if both open. Naukri usually uses persistent context or CDP.
    },
    linkedin: {
        userDataDir: path.join(BASE_DIR, 'linkedin-connect', '.chrome-linkedin'),
        url: 'https://www.linkedin.com/login',
        port: 9222 // Important for automation attachment
    },
    shine: {
        userDataDir: path.join(BASE_DIR, 'shine', '.chrome-shine'),
        url: 'https://www.shine.com/myshine/login/',
        port: 9222
    }
};

async function launchSession(platform) {
    const config = SESSIONS[platform];
    if (!config) throw new Error(`Unknown platform: ${platform}`);

    const chromePath = getChromePath();
    if (!chromePath) throw new Error('Chrome executable not found');

    console.log(`[SessionManager] Launching ${platform} session...`);
    console.log(`  UserData: ${config.userDataDir}`);
    console.log(`  URL: ${config.url}`);

    // Ensure dir exists
    if (!fs.existsSync(config.userDataDir)) {
        fs.mkdirSync(config.userDataDir, { recursive: true });
    }

    // Launch using spawn to detach and let it run independently of Node process if needed,
    // Or use Playwright persistent context.
    // User wants to "click a button... take me to login".
    // Best to just spawn Chrome so it stays open even if backend restarts/crashes.

    const args = [
        `--user-data-dir=${config.userDataDir}`,
        '--no-first-run',
        '--no-default-browser-check',
        '--restore-last-session',
        config.url
    ];

    if (config.port) {
        args.push(`--remote-debugging-port=${config.port}`);
    }

    console.log(`  Command: "${chromePath}" ${args.join(' ')}`);

    const child = spawn(chromePath, args, {
        detached: true,
        stdio: 'ignore'
    });
    child.unref();

    return { success: true, message: `Opened ${platform} login window`, pid: child.pid };
}

module.exports = { launchSession };
