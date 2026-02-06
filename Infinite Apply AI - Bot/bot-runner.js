const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const path = require('path');
const fs = require('fs');

puppeteer.use(StealthPlugin());

let browserInstance = null;

/**
 * Launches Chrome with the Infinite Apply AI extension loaded.
 * @param {Object} config - User configuration for the bot (jobTitle, location, etc.)
 */
async function launchBot(config) {
    try {
        if (browserInstance) {
            console.log('Browser already running, closing previous instance...');
            await browserInstance.close();
        }

        // User specific paths
        const userExecutablePath = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
        // Use a dedicated profile to avoid conflicts with any already-running Chrome instance
        const userUserDataDir = path.resolve(__dirname, "..", "..", ".chrome-linkedin-bot");
        fs.mkdirSync(userUserDataDir, { recursive: true });

        console.log('Launching Bot with dedicated Chrome profile...');
        console.log(`User Data Dir: ${userUserDataDir}`);
        console.log(`Executable: ${userExecutablePath}`);

        const args = [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--start-maximized',
            '--profile-directory=Default'
        ];

        browserInstance = await puppeteer.launch({
            headless: false,
            args: args,
            userDataDir: userUserDataDir,
            executablePath: userExecutablePath,
            defaultViewport: null,
            ignoreDefaultArgs: ["--enable-automation"] // Avoid "Chrome is being controlled by..." bar if possible, though extension loading might force it
        });
        const page = await browserInstance.newPage();
        await page.setBypassCSP(true);

        // Save configuration for future use (without sensitive fields)
        saveBotConfig(config);

        const contentScript = fs.readFileSync(path.join(__dirname, 'content.js'), 'utf8');
        const injectOnJobs = createJobsInjector(page, contentScript, config);
        page.on('domcontentloaded', () => injectOnJobs().catch(err => console.error('Inject error:', err)));

        await ensureLinkedInLogin(page);

        await page.goto('https://www.linkedin.com/jobs/', { waitUntil: 'domcontentloaded' });
        await injectOnJobs();
        console.log('Bot launched and navigated to LinkedIn Jobs.');

    } catch (error) {
        console.error('Error launching bot:', error);
        throw error;
    }
}

function saveBotConfig(config) {
    try {
        const configPath = path.join(__dirname, 'config.json');
        // Filter out sensitive data if needed, or save entire config
        const { password, ...configToSave } = { ...config };
        fs.writeFileSync(configPath, JSON.stringify(configToSave, null, 2));
        console.log(`Configuration saved to: ${configPath}`);
    } catch (error) {
        console.error('Error saving bot configuration:', error);
    }
}

async function ensureLinkedInLogin(page) {
    console.log('Checking for existing LinkedIn session...');
    await page.goto('https://www.linkedin.com/login', { waitUntil: 'domcontentloaded' });

    const isLoggedIn = async () => {
        try {
            return await page.evaluate(() => {
                return Boolean(
                    document.querySelector('#global-nav') ||
                    document.querySelector('header.global-nav__nav') ||
                    document.querySelector('[data-test-global-nav-link="jobs"]') ||
                    document.querySelector('a[href*="/jobs/"]') ||
                    window.location.href.includes('/feed')
                );
            });
        } catch {
            return false;
        }
    };

    if (await isLoggedIn()) {
        console.log('Session restored! Already logged in.');
        return;
    }

    console.log('Not logged in. Please sign in manually in the opened Chrome window.');

    const timeoutMs = 5 * 60 * 1000;
    const pollIntervalMs = 1500;
    const start = Date.now();

    while (Date.now() - start < timeoutMs) {
        if (await isLoggedIn()) {
            console.log('LinkedIn login detected. Waiting 60 seconds for 2FA/session stabilization...');
            await new Promise(resolve => setTimeout(resolve, 60 * 1000));
            return;
        }
        await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
    }

    throw new Error('Login not detected within timeout. Please sign in and try again.');
}

function buildStorageSeed(config) {
    const userInfo = {
        name: config.name || "User",
        email: config.email || "bot@local.host",
        jobTitle: config.jobTitle || "",
        location: config.location || "India",
        experience: config.experience || "0",
        noticePeriod: config.noticePeriod || "0",
        currentCTC: config.currentCTC || "0",
        expectedCTC: config.expectedCTC || "0",
        datePosted: config.datePosted || "all",
        jobType: config.jobType || "remote",
        sortBy: config.sortBy || "recent",
        experienceLevels: config.experienceLevels || [],
        skills: config.skills || [],
        nonRelevantSkills: config.nonRelevantSkills || [],
        avoidCompanies: config.avoidCompanies || []
    };

    return {
        userInfo,
        accessInfo: { email: userInfo.email },
        automationActive: true
    };
}

function createJobsInjector(page, contentScript, config) {
    let injecting = false;
    const seed = buildStorageSeed(config);

    return async function injectOnJobs() {
        if (injecting || page.isClosed()) return;
        const url = page.url();
        if (!url.startsWith('https://www.linkedin.com/jobs')) return;
        injecting = true;
        try {
            await injectStorageShim(page, seed);
            const alreadyInjected = await page.evaluate(() => window.__infiniteApplyInjected === true);
            if (!alreadyInjected) {
                try {
                    await page.evaluate((source) => {
                        (0, eval)(source);
                        window.__infiniteApplyInjected = true;
                    }, contentScript);
                } catch (error) {
                    console.error('Eval injection failed, trying script tag:', error?.message || error);
                    await page.addScriptTag({ content: contentScript });
                    await page.evaluate(() => { window.__infiniteApplyInjected = true; });
                }
                console.log('Content script injected on LinkedIn Jobs page.');
            }
        } finally {
            injecting = false;
        }
    };
}

async function injectStorageShim(page, seed) {
    await page.evaluate((seed) => {
        const storageKey = '__infinite_apply_storage__';
        const readStore = () => {
            try {
                return JSON.parse(localStorage.getItem(storageKey) || '{}');
            } catch {
                return {};
            }
        };
        const writeStore = (data) => {
            localStorage.setItem(storageKey, JSON.stringify(data));
        };

        const mergeStore = (data, incoming) => {
            const merged = { ...data, ...incoming };
            merged.userInfo = { ...(data.userInfo || {}), ...(incoming.userInfo || {}) };
            merged.accessInfo = { ...(data.accessInfo || {}), ...(incoming.accessInfo || {}) };
            return merged;
        };

        let store = readStore();
        store = mergeStore(store, seed);
        writeStore(store);

        const getValues = (keys) => {
            const data = readStore();
            if (keys === null || typeof keys === 'undefined') return data;
            if (Array.isArray(keys)) {
                return keys.reduce((acc, key) => {
                    acc[key] = data[key];
                    return acc;
                }, {});
            }
            if (typeof keys === 'string') {
                return { [keys]: data[keys] };
            }
            if (typeof keys === 'object') {
                return Object.keys(keys).reduce((acc, key) => {
                    acc[key] = typeof data[key] === 'undefined' ? keys[key] : data[key];
                    return acc;
                }, {});
            }
            return {};
        };

        const setValues = (items) => {
            const data = readStore();
            const updated = { ...data, ...items };
            writeStore(updated);
        };

        const removeValues = (keys) => {
            const data = readStore();
            const list = Array.isArray(keys) ? keys : [keys];
            list.forEach((key) => delete data[key]);
            writeStore(data);
        };

        const clearValues = () => {
            writeStore({});
        };

        window.chrome = window.chrome || {};
        window.chrome.storage = window.chrome.storage || {};
        if (!window.chrome.storage.local) {
            window.chrome.storage.local = {
                get: (keys, cb) => cb && cb(getValues(keys)),
                set: (items, cb) => {
                    setValues(items);
                    cb && cb();
                },
                remove: (keys, cb) => {
                    removeValues(keys);
                    cb && cb();
                },
                clear: (cb) => {
                    clearValues();
                    cb && cb();
                }
            };
        } else {
            // If a native storage exists, still ensure seed values are present
            try {
                window.chrome.storage.local.set(seed, () => {});
            } catch {
                // ignore
            }
        }
    }, seed);
}

module.exports = { launchBot };
