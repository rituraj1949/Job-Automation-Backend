const { chromium } = require("playwright-extra");
const stealth = require("puppeteer-extra-plugin-stealth")();
chromium.use(stealth);
const axios = require("axios");
const path = require("path");
const fs = require("fs");
const net = require("net");
const { spawn } = require("child_process");
const { startScreenshotStream, stopScreenshotStream, emitAutomationStatus, emitLog } = require('../utils/screenshot-service');

const FETCH_COMPANIES_URL = "https://backend-emails-elxz.onrender.com/api/companies";
const POST_COMPANY_URL = "https://backend-emails-elxz.onrender.com/api/companies";

const KEYWORDS = ["Generative AI", "Gen AI", "Node Js", "Next Js", "LLM", "RAG", "LangChain", "LangGraph"];
const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

const EXCLUDED_COMPANIES = [
    "TCS",
    "Tata Consultancy Services",
    "Capgemini",
    "Wipro",
    "Tech Mahindra",
    "Infosys",
    "HCL",
    "HCLTech",
    "Cognizant",
    "IBM",
    "Tata Technologies",
    "Google",
    "Microsoft",
    "Amazon",
    "Facebook",
    "Meta",
    "Apple",
    "Oracle",
    "Accenture",
    "Mastercard",
    "Cisco",
    "Wells Fargo",
    "Tiger Analytics",
    "Pepsico",
    "Dell",
    "LTI",
    "Larsen & Toubro Infotech",
    "Mphasis",
    "UST",
    "Virtusa",
    "Hexaware",
    "Birlasoft",
    "Sonata Software",
    "Deloitte Consulting",
    "KPMG",
    "Mindtree",
    "Persistent Systems",
    "Syntel",
    "Sutherland",
    "NIIT Technologies",
    "Genpact",
    "Optum",
    "PwC",
    "NTT Data",
    "ITC Infotech",
    "Nagarro",
    "EY",
    "Ernst & Young",
];

function normalizeCompanyName(value) {
    return String(value || "")
        .replace(/\u00a0/g, " ")
        .toLowerCase()
        .replace(/&/g, " and ")
        .replace(/[^a-z0-9\s]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function isBlacklistedCompany(companyName) {
    if (!companyName) return false;
    const name = normalizeCompanyName(companyName);
    if (!name) return false;
    return EXCLUDED_COMPANIES.some(excluded => {
        const norm = normalizeCompanyName(excluded);
        return norm && name.includes(norm);
    });
}

let isRunning = false;
let isPaused = false;
const CAREER_PROGRESS_PATH = path.join(__dirname, 'career-progress.json');
let careerProgress = {
    lastIndex: -1,
    lastCompanyName: "",
    total: 0,
    status: "idle",
    startIndex: 0,
    updatedAt: null
};

function loadCareerProgress() {
    try {
        if (fs.existsSync(CAREER_PROGRESS_PATH)) {
            const raw = fs.readFileSync(CAREER_PROGRESS_PATH, 'utf8');
            const parsed = JSON.parse(raw);
            careerProgress = { ...careerProgress, ...parsed };
        }
    } catch (e) {
        // Ignore corrupted progress file
    }
}

function saveCareerProgress() {
    try {
        fs.writeFileSync(CAREER_PROGRESS_PATH, JSON.stringify(careerProgress, null, 2));
    } catch (e) {
        // Ignore write errors
    }
}

function updateCareerProgress(partial) {
    careerProgress = {
        ...careerProgress,
        ...partial,
        updatedAt: new Date().toISOString()
    };
    saveCareerProgress();
}

function getCareerProgress() {
    return { ...careerProgress };
}

loadCareerProgress();

async function isPortOpen(port, host = "127.0.0.1", timeoutMs = 800) {
    return new Promise((resolve) => {
        const socket = new net.Socket();
        const onError = () => {
            socket.destroy();
            resolve(false);
        };
        socket.setTimeout(timeoutMs);
        socket.once("error", onError);
        socket.once("timeout", onError);
        socket.connect(port, host, () => {
            socket.end();
            resolve(true);
        });
    });
}

async function ensureCdpChromeReady() {
    const port = Number(process.env.CDP_PORT || 9222);
    const host = process.env.CDP_HOST || "127.0.0.1";
    const autoLaunch = process.env.CDP_AUTO_LAUNCH !== '0';

    if (await isPortOpen(port, host)) {
        return { ready: true, autoLaunched: false, port };
    }

    if (!autoLaunch) {
        return { ready: false, autoLaunched: false, port };
    }

    const chromePath = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
    const userDataDir = process.env.CDP_USER_DATA_DIR || 'C:\\Users\\ritur\\Desktop\\Chrome-CDP';
    const profileDir = process.env.CDP_PROFILE || 'Profile 19';

    emitLog(`CDP not detected. Launching Chrome with remote debugging on port ${port}...`, "info");

    try {
        const args = [
            `--remote-debugging-port=${port}`,
            `--user-data-dir=${userDataDir}`,
            `--profile-directory=${profileDir}`,
            '--remote-allow-origins=*'
        ];
        const child = spawn(chromePath, args, {
            detached: true,
            stdio: 'ignore'
        });
        child.unref();
    } catch (err) {
        emitLog(`Failed to launch Chrome for CDP: ${err.message}`, "warning");
        return { ready: false, autoLaunched: false, port };
    }

    // Wait a moment for Chrome to start
    for (let i = 0; i < 10; i++) {
        await new Promise(r => setTimeout(r, 500));
        if (await isPortOpen(port, host)) {
            return { ready: true, autoLaunched: true, port };
        }
    }

    return { ready: false, autoLaunched: true, port };
}

async function blockLinkedInMedia(page) {
    try {
        await page.route('**/*', (route) => {
            const type = route.request().resourceType();
            const url = route.request().url();
            if (type === 'image' || type === 'media') {
                return route.abort();
            }
            // Also block common image/video extensions even if misclassified
            if (/\.(png|jpe?g|gif|webp|svg|mp4|webm|m4s|m3u8|mpd)(\?|$)/i.test(url)) {
                return route.abort();
            }
            return route.continue();
        });
        emitLog('LinkedIn media blocking enabled (images/videos)', 'info');
    } catch (e) {
        emitLog(`LinkedIn media blocking warning: ${e.message}`, 'warning');
    }
}

async function ensureHealthyLinkedInPage(page) {
    try {
        if (!page || page.isClosed()) {
            throw new Error('LinkedIn page is closed');
        }
        await page.title();
        return page;
    } catch (e) {
        const context = page ? page.context() : null;
        if (!context) throw e;
        emitLog('LinkedIn tab crashed. Recreating tab...', 'warning');
        const newPage = await context.newPage();
        await blockLinkedInMedia(newPage);
        // Screenshot stream disabled to avoid LinkedIn target crashes
        if (page && !page.isClosed()) {
            await page.close().catch(() => { });
        }
        return newPage;
    }
}

async function handleGoogleConsent(page) {
    try {
        const url = page.url() || "";
        if (!url.includes('consent.google.com')) {
            return;
        }

        const candidates = [
            'button:has-text("I agree")',
            'button:has-text("Accept all")',
            'button:has-text("Accept")',
            'button:has-text("Agree")',
            '#introAgreeButton',
            'form[action*="consent"] button'
        ];

        for (const selector of candidates) {
            const btn = page.locator(selector).first();
            if (await btn.count().catch(() => 0)) {
                await btn.click({ timeout: 5000 }).catch(() => { });
                await page.waitForTimeout(1500);
                return;
            }
        }
    } catch (e) {
        // Ignore consent handling errors
    }
}

function getLinkedInCompanyBase(url) {
    try {
        const u = new URL(url);
        const parts = u.pathname.split('/').filter(Boolean);
        const idx = parts.indexOf('company');
        if (idx >= 0 && parts[idx + 1]) {
            return `https://www.linkedin.com/company/${parts[idx + 1]}`;
        }
    } catch (e) {
        // ignore
    }
    return null;
}

function getLinkedInProfileBase(url) {
    try {
        const u = new URL(url);
        const parts = u.pathname.split('/').filter(Boolean);
        const idx = parts.indexOf('in');
        if (idx >= 0 && parts[idx + 1]) {
            return `https://www.linkedin.com/in/${parts[idx + 1]}`;
        }
    } catch (e) {
        // ignore
    }
    return null;
}

function normalizeLinkedInTargetUrl(url) {
    const baseCompany = getLinkedInCompanyBase(url);
    if (baseCompany) return `${baseCompany}/posts/?feedView=all`;
    const baseProfile = getLinkedInProfileBase(url);
    if (baseProfile) return `${baseProfile}/recent-activity/all/`;
    return url ? url.split('?')[0] : "";
}

function parseRelativeAgeToDays(text) {
    if (!text) return null;
    const t = text.toLowerCase().trim();

    if (t.includes('just now')) return 0;
    if (t.includes('yesterday')) return 1;

    const dayMatch = t.match(/(\d+)\s*d/);
    if (dayMatch) return Number(dayMatch[1]);
    const dayWordMatch = t.match(/(\d+)\s*day/);
    if (dayWordMatch) return Number(dayWordMatch[1]);

    const hourMatch = t.match(/(\d+)\s*h/);
    if (hourMatch) return 0;
    const hourWordMatch = t.match(/(\d+)\s*hour/);
    if (hourWordMatch) return 0;

    const weekMatch = t.match(/(\d+)\s*w/);
    if (weekMatch) return Number(weekMatch[1]) * 7;
    const weekWordMatch = t.match(/(\d+)\s*week/);
    if (weekWordMatch) return Number(weekWordMatch[1]) * 7;

    const monthMatch = t.match(/(\d+)\s*mo/);
    if (monthMatch) return Number(monthMatch[1]) * 30;
    const monthWordMatch = t.match(/(\d+)\s*month/);
    if (monthWordMatch) return Number(monthWordMatch[1]) * 30;

    const yearMatch = t.match(/(\d+)\s*y/);
    if (yearMatch) return Number(yearMatch[1]) * 365;
    const yearWordMatch = t.match(/(\d+)\s*year/);
    if (yearWordMatch) return Number(yearWordMatch[1]) * 365;

    return null;
}

function isTargetCrashedError(error) {
    if (!error || !error.message) return false;
    const msg = error.message;
    return (
        msg.includes('Target crashed') ||
        msg.includes('Target page, context or browser has been closed') ||
        msg.includes('has been closed')
    );
}

async function collectCompanyPosts(page, maxPosts, searchKeywords) {
    const hiringKeywords = ['hiring', 'join', 'team', 'opportunity', 'job alert', 'we are hiring', 'looking for'];
    let posts = [];

    const collect = async () => {
        const data = await page.$$eval(
            'div[data-urn^="urn:li:activity"], div.feed-shared-update-v2[role="article"]',
            (nodes) => nodes.map((n) => {
                const textEl = n.querySelector('.update-components-text, .feed-shared-inline-show-more-text, .feed-shared-update-v2__description');
                const text = (textEl ? textEl.innerText : n.innerText || "").trim();
                const urn = n.getAttribute('data-urn') || "";
                return { urn, text };
            })
        ).catch(() => []);

        for (const item of data) {
            if (!item.text) continue;
            posts.push(item);
        }
    };

    let lastCount = 0;
    for (let i = 0; i < 10 && posts.length < maxPosts; i++) {
        await collect();
        const uniqueMap = new Map();
        for (const p of posts) {
            const key = p.urn || p.text.slice(0, 120);
            if (!uniqueMap.has(key)) uniqueMap.set(key, p);
        }
        posts = Array.from(uniqueMap.values());

        if (posts.length >= maxPosts || posts.length === lastCount) {
            break;
        }
        lastCount = posts.length;
        await page.evaluate(() => window.scrollBy(0, window.innerHeight * 1.2));
        await page.waitForTimeout(2000);
    }

    const emails = [];
    const skills = [];
    const jobTitles = [];

    for (const post of posts.slice(0, maxPosts)) {
        const text = post.text;
        const lower = text.toLowerCase();
        const foundEmails = text.match(EMAIL_REGEX) || [];
        emails.push(...foundEmails);

        const matchedSkills = searchKeywords.filter(kw =>
            new RegExp(`\\b${kw.replace(/\s+/g, '\\s+')}\\b`, 'gi').test(text)
        );
        skills.push(...matchedSkills);

        const hasHiring = hiringKeywords.some(kw => lower.includes(kw));
        if (hasHiring) {
            const titleMatch = text.match(/(?:hiring|looking for|seeking|join us as|apply for|position|role)\s+(?:for\s+)?(?:a\s+)?([^\n]{5,60}(?:engineer|developer|architect|lead|manager|specialist|designer|intern))/gi);
            if (titleMatch) {
                jobTitles.push(titleMatch[0].trim());
            }
        }
    }

    return {
        postsScanned: Math.min(posts.length, maxPosts),
        emails: [...new Set(emails.map(e => e.toLowerCase()))],
        skills: [...new Set(skills)],
        jobTitles
    };
}

async function scanCompanyJobs(page, jobsUrl, searchKeywords) {
    try {
        await page.goto(jobsUrl, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => { });
        await page.waitForTimeout(3000);

        const bodyText = await page.innerText('body').catch(() => "");
        if (bodyText.toLowerCase().includes('there are no jobs right now')) {
            return { hasJobs: false, jobTitles: [], skills: [], emails: [] };
        }

        const jobTexts = await page.$$eval(
            '.org-jobs-container .job-card-container, .org-jobs-container .job-card-list__title, .org-jobs-container [data-job-id]',
            (nodes) => nodes.map((n) => (n.innerText || "").trim()).filter(Boolean)
        ).catch(() => []);

        const texts = jobTexts.length > 0 ? jobTexts : [bodyText];
        const jobTitles = [];
        const skills = [];
        const emails = [];

        for (const t of texts) {
            const lines = t.split('\n').map(l => l.trim()).filter(Boolean);
            if (lines.length > 0) {
                jobTitles.push(lines[0]);
            }
            const foundEmails = t.match(EMAIL_REGEX) || [];
            emails.push(...foundEmails);
            const matchedSkills = searchKeywords.filter(kw =>
                new RegExp(`\\b${kw.replace(/\s+/g, '\\s+')}\\b`, 'gi').test(t)
            );
            skills.push(...matchedSkills);
        }

        return {
            hasJobs: true,
            jobTitles: [...new Set(jobTitles)],
            skills: [...new Set(skills)],
            emails: [...new Set(emails.map(e => e.toLowerCase()))]
        };
    } catch (e) {
        return { hasJobs: false, jobTitles: [], skills: [], emails: [] };
    }
}

async function scanLinkedInCompany(linkedinPage, companyBaseUrl, searchKeywords) {
    const postsUrl = `${companyBaseUrl}/posts/?feedView=all`;
    const jobsUrl = `${companyBaseUrl}/jobs/`;

    try {
        console.log(`[LINKEDIN] Company detected: ${companyBaseUrl}`);
        const currentUrl = linkedinPage.url();
        const alreadyOnPosts = currentUrl.startsWith(`${companyBaseUrl}/posts`);
        if (!alreadyOnPosts) {
            console.log(`[LINKEDIN] Opening posts: ${postsUrl}`);
            await linkedinPage.goto(postsUrl, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => { });
            await linkedinPage.waitForTimeout(3000);
        }

        const postsData = await collectCompanyPosts(linkedinPage, 15, searchKeywords);
        console.log(`[LINKEDIN] Posts scanned: ${postsData.postsScanned}`);

        console.log(`[LINKEDIN] Opening jobs: ${jobsUrl}`);
        const jobsData = await scanCompanyJobs(linkedinPage, jobsUrl, searchKeywords);
        if (!jobsData.hasJobs) {
            console.log(`[LINKEDIN] No jobs found for company`);
        }

        return {
            emails: [...new Set([...postsData.emails, ...jobsData.emails])],
            skills: [...new Set([...postsData.skills, ...jobsData.skills])],
            jobTitles: [...new Set([...postsData.jobTitles, ...jobsData.jobTitles])],
            postsScanned: postsData.postsScanned,
            companyUrl: companyBaseUrl
        };
    } catch (error) {
        if (isTargetCrashedError(error)) {
            return { crashed: true, emails: [], skills: [], jobTitles: [], postsScanned: 0, companyUrl: companyBaseUrl };
        }
        return { emails: [], skills: [], jobTitles: [], postsScanned: 0, companyUrl: companyBaseUrl };
    }
}


async function runCareerAutomation(options = {}) {
    if (isRunning) {
        console.log("Career automation is already running.");
        return;
    }

    isRunning = true;
    let browser = null;
    let context = null;
    let page = null;
    let linkedinPage = null;

    try {
        console.log("Fetching companies list...");
        emitAutomationStatus("Fetching companies list...");
        const response = await axios.get(FETCH_COMPANIES_URL);

        const companies = response.data.companies || response.data;

        if (!Array.isArray(companies) || companies.length === 0) {
            emitLog("No companies found to process", "warning");
            emitAutomationStatus("No companies found");
            isRunning = false;
            return;
        }

        emitLog(`Found ${companies.length} companies. Starting dual-tab automation...`, "success");
        const parsedStartIndex = Number(options.startIndex);
        const requestedStartIndex = Number.isFinite(parsedStartIndex)
            ? Math.max(0, Math.floor(parsedStartIndex))
            : 0;
        updateCareerProgress({
            total: companies.length,
            status: "running",
            startIndex: requestedStartIndex
        });
        if (requestedStartIndex >= companies.length) {
            emitLog(`Start index ${requestedStartIndex} exceeds total companies (${companies.length}).`, "warning");
            updateCareerProgress({ status: "idle" });
            isRunning = false;
            return;
        }

        // Set up persistent session directory
        // HEADS UP: For local use, we can connect to your already-running Chrome (real profile)
        const isProduction = process.env.NODE_ENV === 'production' || process.env.RENDER === 'true';
        const useCdp = !isProduction && process.env.USE_CDP !== '0';

        let userDataDir;
        let launchOptions = {
            headless: isProduction,
            viewport: null, // Allow full window size
            args: ["--disable-blink-features=AutomationControlled", "--start-maximized"]
        };

        if (isProduction) {
            userDataDir = path.join(__dirname, 'linkedin_session');
            if (!fs.existsSync(userDataDir)) {
                fs.mkdirSync(userDataDir, { recursive: true });
            }
            launchOptions.viewport = { width: 1280, height: 720 };
        } else if (!useCdp) {
            // Local: use a NON-default user data directory to satisfy Chrome DevTools
            // This prevents the "DevTools remote debugging requires a non-default data directory" error.
            const realProfileDirName = 'Profile 19';

            userDataDir = path.join(__dirname, 'linkedin_session');
            if (!fs.existsSync(userDataDir)) {
                fs.mkdirSync(userDataDir, { recursive: true });
            }

            launchOptions.executablePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

            // Clean up args for real Chrome
            // Note: This will create/use "Profile 19" inside the custom userDataDir above
            launchOptions.args = [
                `--profile-directory=${realProfileDirName}`,
                '--no-first-run',
                '--no-default-browser-check',
                '--start-maximized',
                '--disable-blink-features=AutomationControlled'
            ];

            // REMOVE the flags that cause the warning and the "Test" banner
            launchOptions.ignoreDefaultArgs = ['--enable-automation', '--no-sandbox'];
        }

        // Increase timeout to 90s - real Chrome can be slow to start
        launchOptions.timeout = 90000;

        if (isProduction || !useCdp) {
            // Use LaunchPersistentContext to store session (cookies, login, etc)
            context = await chromium.launchPersistentContext(userDataDir, launchOptions);
        } else {
            // Connect to existing Chrome (real profile) via CDP
            const cdpUrl = process.env.CDP_URL || 'http://127.0.0.1:9222';
            const cdpReady = await ensureCdpChromeReady();
            if (!cdpReady.ready) {
                throw new Error(`CDP is not available on port ${cdpReady.port}. Start Chrome with --remote-debugging-port or allow auto-launch.`);
            }
            emitLog(`Connecting to Chrome over CDP: ${cdpUrl}`, "info");
            browser = await chromium.connectOverCDP(cdpUrl);
            const contexts = browser.contexts();
            context = contexts[0] || await browser.newContext({ viewport: null });
        }

        // Give real Chrome profile time to initialize extensions/session
        await new Promise(resolve => setTimeout(resolve, 10000));

        // Get existing pages (launchPersistentContext usually opens one by default)
        const isUiPage = (p) => {
            const url = (p.url && p.url()) || "";
            return !url.startsWith('chrome-extension://') && !url.startsWith('chrome://');
        };

        const allPages = context.pages();
        let pages = allPages.filter(isUiPage);
        emitLog(`Detected ${allPages.length} pages (${pages.length} visible tabs)`, "info");

        try {
            if (pages.length >= 1) {
                linkedinPage = pages[0];
                emitLog('Using Browser Tab: LinkedIn Scanner', "success");
            } else {
                linkedinPage = await context.newPage();
                emitLog('Created Browser Tab: LinkedIn Scanner', "success");
            }

            await blockLinkedInMedia(linkedinPage);

            await linkedinPage.bringToFront().catch(() => { });
        } catch (pageError) {
            console.error('❌ Failed to prepare tabs:', pageError.message);
            throw new Error('Could not prepare browser tabs. Profile might be slow to load.');
        }

        // Start screenshot stream for LinkedIn tab only
        // Screenshot stream disabled to avoid LinkedIn target crashes
        emitAutomationStatus("LinkedIn Automation Active (Session Loaded)");

        const SEARCH_BASE = "https://www.google.com/search?q=";

        const visitedUrls = new Set();

        for (let idx = requestedStartIndex; idx < companies.length; idx++) {
            if (!isRunning) break;

            // Check if paused - wait until resumed
            while (isPaused) {
                emitAutomationStatus("⏸️ Paused");
                await new Promise(resolve => setTimeout(resolve, 1000)); // Check every second
                if (!isRunning) break; // Allow stopping while paused
            }

            if (!isRunning) break;

            const company = companies[idx];
            const companyName = company.companyName;
            if (!companyName) {
                emitLog(`Skipping company: No company name found`, "warning");
                continue;
            }
            if (isBlacklistedCompany(companyName)) {
                emitLog(`Skipping blacklisted company: ${companyName}`, "warning");
                updateCareerProgress({
                    lastIndex: idx,
                    lastCompanyName: companyName
                });
                continue;
            }

            emitLog(`════════════════════════════════════════════════════`, "info");
            emitLog(`Processing: ${companyName}`, "processing");
            emitLog(`════════════════════════════════════════════════════`, "info");
            emitAutomationStatus(`LinkedIn Scanning: ${companyName}`);
            updateCareerProgress({
                lastIndex: idx,
                lastCompanyName: companyName
            });

            try {

                // ============================================
                // PARALLEL EXECUTION: Tab 1 (Website) + Tab 2 (LinkedIn)
                // ============================================

                const linkedinData = await scanLinkedInResults(linkedinPage, companyName, SEARCH_BASE, visitedUrls);

                // ============================================
                // LINKEDIN ONLY RESULTS
                // ============================================

                // Convert all emails to lowercase for case-insensitive deduplication
                const allEmails = [...new Set([
                    ...linkedinData.linkedinEmails.map(e => e.toLowerCase())
                ])];
                const allSkills = [...new Set([...linkedinData.linkedinSkills])];
                const allJobTitles = [
                    ...linkedinData.linkedinJobTitles
                ];

                console.log(`\n${"*".repeat(60)}`);
                console.log(`MERGED RESULTS for ${companyName}`);
                console.log(`${"*".repeat(60)}`);
                console.log(`Total Skills Matched: ${allSkills.length}`);
                if (allSkills.length > 0) {
                    console.log(`  🔴 Skills: ${allSkills.join(', ')}`);
                } else {
                    console.log(`  └─ Skills: None`);
                }

                console.log(`\nTotal Emails Found: ${allEmails.length}`);
                if (allEmails.length > 0) {
                    console.log(`  🔵🔵🔵 Emails detected (${allEmails.length})`);
                    console.log(`  └─ LinkedIn: ${linkedinData.linkedinEmails.length} emails`);
                    for (const email of allEmails) {
                        console.log(`  🟢 ${email}`);
                    }
                } else {
                    console.log(`  └─ LinkedIn: 0 emails`);
                    console.log(`  └─ All Unique Emails: None`);
                }
                console.log(`\nJob Titles: ${allJobTitles.length > 0 ? allJobTitles[0] : 'None'}`);
                console.log(`LinkedIn Pages Scanned: ${linkedinData.linkedinPosts}`);

                // Build note
                let noteDetails = [];
                if (allSkills.length > 0) noteDetails.push(`Found ${allSkills.length} matching skills`);
                if (allEmails.length > 0) noteDetails.push(`${allEmails.length} contact email(s)`);
                if (linkedinData.linkedinPosts > 0) noteDetails.push(`${linkedinData.linkedinPosts} LinkedIn pages scanned`);
                if (linkedinData.linkedinJobTitles && linkedinData.linkedinJobTitles.length > 0) {
                    noteDetails.push(`LinkedIn roles: ${linkedinData.linkedinJobTitles.slice(0, 2).join('; ')}`);
                }
                const note = noteDetails.length > 0 ? noteDetails.join('. ') : 'Scanned LinkedIn pages';

                // Post to API if we found relevant data (skip blacklisted)
                if (isBlacklistedCompany(companyName)) {
                    emitLog(`Skipping API post for blacklisted company: ${companyName}`, "warning");
                } else if (allSkills.length > 0 || allEmails.length > 0) {
                    emitLog(`Posting data to API for ${companyName}...`, "api");

                    const payload = {
                        companyName: company.companyName,
                        companySize: company.companySize || "N/A",
                        location: company.location || "N/A",
                        industry: company.industry || "N/A",
                        bio: company.bio || "",
                        isHiring: allSkills.length > 0 ? "yes" : "unknown",
                        officialWebsite: company.officialWebsite || "",
                        careerWebsite: "",
                        linkedinCompanyUrl: linkedinData.linkedinUrl || company.linkedinCompanyUrl || "",
                        emails: allEmails,
                        JobsCount: company.JobsCount || "0",
                        JobsCountTime: new Date().toISOString().replace('T', ' ').substring(0, 16),
                        applied: "yes",
                        totalSkillsMatched: allSkills.length.toString(),
                        skillsFoundInJob: allSkills,
                        note: note
                    };

                    if (allSkills.length >= 2 && allJobTitles.length > 0) {
                        payload.appliedJobTitle = allJobTitles[0];
                        payload.matchedJobTitle = allJobTitles[0];
                    }

                    try {
                        await axios.post(POST_COMPANY_URL, payload);
                        emitLog(`Successfully posted update for ${companyName}`, "success");
                    } catch (postErr) {
                        emitLog(`Error posting to API for ${companyName}: ${postErr.message}`, "error");
                    }
                } else {
                    emitLog(`No relevant data found for ${companyName} - skipping API post`, "warning");
                }

            } catch (err) {
                emitLog(`Error processing ${companyName}: ${err.message}`, "error");
            }

            // Wait 20 seconds before next company
            emitLog(`Completed processing ${companyName}. Waiting 20 seconds...`, "info");
            await new Promise(resolve => setTimeout(resolve, 20000));
        }

        if (!isRunning) {
            emitLog("Career automation stopped.", "warning");
            emitAutomationStatus("Stopped");
            updateCareerProgress({ status: "stopped" });
        } else {
            emitLog("Career automation completed successfully!", "success");
            emitAutomationStatus("Idle");
            updateCareerProgress({ status: "idle" });
        }

    } catch (error) {
        console.error("Critical error in career automation:", error);
        updateCareerProgress({ status: "error" });
    } finally {
        isRunning = false;
        stopScreenshotStream();
        if (linkedinPage) await linkedinPage.close().catch(() => { });
        if (page) await page.close().catch(() => { });
        if (context) await context.close().catch(() => { });
        if (browser) await browser.close().catch(() => { });
    }
}

// ============================================
// TAB 1: Company Website Scanner
// ============================================
async function scanCompanyWebsite(page, companyName, company, SEARCH_BASE) {
    try {
        emitLog(`[Website Tab] Starting career page scan for: ${companyName}`, "website");

        const searchQuery = encodeURIComponent(`${companyName} careers`);
        const searchUrl = `${SEARCH_BASE}${searchQuery}`;

        emitLog(`[Website Tab] Searching Google: "${companyName} careers"`, "website");
        await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
        await handleGoogleConsent(page);
        await page.waitForTimeout(5000);

        // Extract first organic result from Google
        const googleLinks = await page.evaluate(() => {
            const normalize = (href) => {
                if (!href) return null;
                if (href.startsWith('/url?')) {
                    try {
                        const u = new URL('https://www.google.com' + href);
                        return u.searchParams.get('q');
                    } catch (e) {
                        return null;
                    }
                }
                return href;
            };

            const isValid = (href) => {
                if (!href) return false;
                if (!href.startsWith('http')) return false;
                const badHosts = new Set([
                    'www.google.com',
                    'google.com',
                    'accounts.google.com',
                    'policies.google.com',
                    'support.google.com',
                    'consent.google.com'
                ]);
                try {
                    const host = new URL(href).hostname;
                    if (badHosts.has(host)) return false;
                } catch (e) {
                    return false;
                }
                if (href.includes('/search?')) return false;
                if (href.includes('webcache.googleusercontent.com')) return false;
                return true;
            };

            const anchors = Array.from(document.querySelectorAll('a'));
            const urls = [];
            for (const a of anchors) {
                const href = normalize(a.getAttribute('href'));
                if (isValid(href)) {
                    urls.push(href);
                }
            }
            return urls;
        });

        const resultUrl = googleLinks[0];
        if (!resultUrl) {
            console.log(`[WEBSITE] No search results found`);
            return { emails: [], keywords: [], dates: [] };
        }

        emitLog(`[Website Tab] Opening career page...`, "website");
        console.log(`[WEBSITE] Navigating to: ${resultUrl.substring(0, 60)}...`);
        await page.goto(resultUrl, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => { });

        console.log("[WEBSITE] Waiting 20 seconds...");
        await page.waitForTimeout(20000);

        const bodyText = await page.innerText('body').catch(() => "");
        const pageHtml = await page.content().catch(() => "");

        const searchKeywords = [...KEYWORDS, "MERN", "MERN Stack"];
        const matchedKeywords = searchKeywords.filter(kw =>
            new RegExp(`\\b${kw.replace(/\s+/g, '\\s+')}\\b`, 'gi').test(bodyText)
        );

        const foundEmails = bodyText.match(EMAIL_REGEX) || [];
        let allEmails = [...new Set(foundEmails)];

        emitLog(`[Website Tab] Found ${matchedKeywords.length} skills: ${matchedKeywords.join(', ') || 'None'}`, matchedKeywords.length > 0 ? "success" : "info");

        // Look for Contact/About pages
        console.log("[WEBSITE] Looking for Contact/About pages...");
        const contactLinks = await page.$$('a').catch(() => []);

        for (const link of contactLinks.slice(0, 20)) {
            const linkText = await link.innerText().catch(() => "");
            const lowerLinkText = linkText.toLowerCase();

            if ((lowerLinkText.includes('contact') || lowerLinkText.includes('about')) &&
                !lowerLinkText.includes('career') && linkText.length < 30) {

                console.log(`[WEBSITE] Clicking: "${linkText}"`);

                try {
                    await link.click();
                    await page.waitForLoadState('domcontentloaded', { timeout: 30000 }).catch(() => { });
                    await page.waitForTimeout(3000);

                    const contactBodyText = await page.innerText('body').catch(() => "");
                    const contactEmails = contactBodyText.match(EMAIL_REGEX) || [];

                    if (contactEmails.length > 0) {
                        console.log(`[WEBSITE] Found ${contactEmails.length} additional emails`);
                        allEmails = [...allEmails, ...contactEmails];
                    }
                    break;
                } catch (navErr) {
                    continue;
                }
            }
        }

        const uniqueEmails = [...new Set(allEmails)];

        // Extract job title
        const jobTitlePatterns = [
            /<h1[^>]*>([^<]+(?:engineer|developer|architect|lead|manager|specialist)[^<]*)<\/h1>/gi,
            /<title>([^<]+(?:engineer|developer|architect|lead|manager|specialist)[^<]*)<\/title>/gi,
        ];

        let jobTitles = [];
        for (const pattern of jobTitlePatterns) {
            const matches = pageHtml.match(pattern);
            if (matches && matches.length > 0) {
                jobTitles = jobTitles.concat(matches.slice(0, 2));
            }
        }

        const extractedJobTitle = jobTitles.length > 0 ? jobTitles[0].replace(/<[^>]*>/g, '').trim() : null;

        // Extract dates
        const datePatterns = [
            /posted\s+(?:on\s+)?(\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4})/gi,
            /(\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{2,4})/gi,
        ];

        let jobDates = [];
        for (const pattern of datePatterns) {
            const matches = bodyText.match(pattern);
            if (matches && matches.length > 0) {
                jobDates = jobDates.concat(matches.slice(0, 3));
            }
        }
        const uniqueDates = [...new Set(jobDates)].slice(0, 3);

        console.log(`[WEBSITE] ✅ Complete: ${matchedKeywords.length} skills, ${uniqueEmails.length} emails, ${uniqueDates.length} dates`);

        return {
            emails: uniqueEmails,
            keywords: matchedKeywords,
            jobTitle: extractedJobTitle,
            dates: uniqueDates,
            careerUrl: page.url()
        };
    } catch (err) {
        console.error(`[WEBSITE] Error: ${err.message}`);
        return { emails: [], keywords: [], dates: [] };
    }
}

// ============================================
// TAB 2: LinkedIn Scanner - Click Through Multiple Results
// ============================================
async function scanLinkedInResults(linkedinPage, companyName, SEARCH_BASE, visitedUrls) {
    try {
        console.log(`[LINKEDIN] Starting scan for ${companyName}`);

        const linkedinSearchQuery = encodeURIComponent(`${companyName} hiring manager linkedin`);
        const linkedinSearchUrl = `${SEARCH_BASE}${linkedinSearchQuery}`;

        console.log(`[LINKEDIN] Searching: ${linkedinSearchQuery}`);
        await linkedinPage.goto(linkedinSearchUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
        await handleGoogleConsent(linkedinPage);
        await linkedinPage.waitForTimeout(5000);

        // Find ALL LinkedIn links in search results (Google)
        console.log(`[LINKEDIN] Collecting all LinkedIn links from search results...`);

        const linkedinLinks = await linkedinPage.evaluate(() => {
            const normalize = (href) => {
                if (!href) return null;
                if (href.startsWith('/url?')) {
                    try {
                        const u = new URL('https://www.google.com' + href);
                        return u.searchParams.get('q');
                    } catch (e) {
                        return null;
                    }
                }
                return href;
            };

            const anchors = Array.from(document.querySelectorAll('a'));
            const links = [];
            for (const a of anchors) {
                const rawHref = a.getAttribute('href');
                const href = normalize(rawHref);
                if (!href || !href.startsWith('http')) continue;
                if (!href.includes('linkedin.com')) continue;
                if (!href.includes('/in/') && !href.includes('/company/') && !href.includes('/posts/')) continue;
                if (href.includes('/jobs/') || href.includes('/job/')) continue;
                if (href.includes('signin') || href.includes('login')) continue;
                links.push({ href: href.split('?')[0], text: (a.innerText || '').trim() });
            }
            // Deduplicate by href
            const seen = new Set();
            return links.filter(l => {
                if (seen.has(l.href)) return false;
                seen.add(l.href);
                return true;
            });
        });

        console.log(`[LINKEDIN] Found ${linkedinLinks.length} LinkedIn links to scan`);

        if (linkedinLinks.length === 0) {
            console.log(`[LINKEDIN] No LinkedIn links found in search results`);
            return { linkedinEmails: [], linkedinSkills: [], linkedinJobTitles: [], linkedinPosts: 0 };
        }

        // Temporary storage for collected data
        let allLinkedInEmails = [];
        let allLinkedInSkills = [];
        let allLinkedInJobTitles = [];
        let processedPages = 0;
        let postsScanned = 0;
        let primaryCompanyUrl = "";
        let companyScanned = false;

        const searchKeywords = [...KEYWORDS, "MERN", "MERN Stack"];
        const hiringKeywords = ['we are hiring', 'join our team', 'urgent hiring', 'now hiring', 'looking for', 'hiring'];

        // Process ALL LinkedIn links found (increased from 5 to 10 for more coverage)
        // User Request: "open all urls on linkedin tab, if all urls are of linkedin"
        const linksToProcess = linkedinLinks
            .map(link => ({ ...link, targetUrl: normalizeLinkedInTargetUrl(link.href) }))
            .filter(link => link.targetUrl && !visitedUrls.has(link.targetUrl))
            .slice(0, 10); // Process up to 10 LinkedIn pages

        console.log(`[LINKEDIN] Processing ${linksToProcess.length} LinkedIn URLs...`);
        console.log(`[LINKEDIN] Filtering: ✅ Company pages, Profiles, Posts | ❌ Job URLs, Non-LinkedIn sites`);

        for (let i = 0; i < linksToProcess.length; i++) {
            linkedinPage = await ensureHealthyLinkedInPage(linkedinPage);
            // Check if paused before processing each LinkedIn URL
            while (isPaused) {
                emitAutomationStatus("⏸️ Paused (LinkedIn scan)");
                await new Promise(resolve => setTimeout(resolve, 1000));
                if (!isRunning) break;
            }

            if (!isRunning) break;

            const linkObj = linksToProcess[i];

            try {
                const targetUrl = linkObj.targetUrl || linkObj.href;
                if (visitedUrls.has(targetUrl)) {
                    console.log(`[LINKEDIN] Skipping already visited: ${targetUrl.substring(0, 80)}...`);
                    continue;
                }
                visitedUrls.add(targetUrl);

                console.log(`\n[LINKEDIN] [${i + 1}/${linksToProcess.length}] Opening: ${targetUrl.substring(0, 90)}...`);

                // Navigate to the LinkedIn page
                await linkedinPage.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch((err) => {
                    if (isTargetCrashedError(err)) {
                        console.log(`[LINKEDIN] Page crashed while loading, recreating tab...`);
                    } else {
                        console.log(`[LINKEDIN] Page load timeout, skipping...`);
                    }
                });

                try {
                    await linkedinPage.waitForTimeout(3000);
                } catch (err) {
                    if (isTargetCrashedError(err)) {
                        linkedinPage = await ensureHealthyLinkedInPage(linkedinPage);
                        continue;
                    }
                }

                // Check if we actually landed on a LinkedIn page
                const currentUrl = linkedinPage.url();
                if (!currentUrl.includes('linkedin.com')) {
                    console.log(`[LINKEDIN] Not a LinkedIn page (${currentUrl.substring(0, 50)}...), skipping`);

                    // Go back to search results
                    if (i < linksToProcess.length - 1) {
                        await linkedinPage.goto(linkedinSearchUrl, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => { });
                        await linkedinPage.waitForTimeout(3000);
                    }
                    continue;
                }

                // Check if it's a jobs page (skip those)
                if (currentUrl.includes('/jobs/') || currentUrl.includes('/job/')) {
                    console.log(`[LINKEDIN] Skipping LinkedIn jobs page`);

                    // Go back to search results
                    if (i < linksToProcess.length - 1) {
                        await linkedinPage.goto(linkedinSearchUrl, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => { });
                        await linkedinPage.waitForTimeout(3000);
                    }
                    continue;
                }

                // Dismiss LinkedIn sign-in modal if it appears (enhanced version)
                try {
                    // Wait a bit for modal to fully render
                    await linkedinPage.waitForTimeout(2000);

                    // Try multiple selectors for the dismiss button
                    const modalSelectors = [
                        'button.modal__dismiss',
                        'button[aria-label="Dismiss"]',
                        'button.contextual-sign-in-modal__modal-dismiss',
                        '.modal__dismiss',
                        '[data-tracking-control-name*="modal_dismiss"]'
                    ];

                    let modalDismissed = false;

                    for (const selector of modalSelectors) {
                        const dismissButton = await linkedinPage.$(selector).catch(() => null);
                        if (dismissButton) {
                            // Check if button is visible
                            const isVisible = await dismissButton.isVisible().catch(() => false);
                            if (isVisible) {
                                console.log(`[LINKEDIN] 🚫 Dismissing sign-in modal (selector: ${selector})...`);
                                await dismissButton.click({ force: true });
                                await linkedinPage.waitForTimeout(1500);
                                modalDismissed = true;
                                break;
                            }
                        }
                    }

                    // Fallback: Press ESC key to close modal
                    if (!modalDismissed) {
                        const modal = await linkedinPage.$('section[role="dialog"], .modal__wrapper').catch(() => null);
                        if (modal) {
                            console.log(`[LINKEDIN] 🚫 Pressing ESC to dismiss modal...`);
                            await linkedinPage.keyboard.press('Escape');
                            await linkedinPage.waitForTimeout(1000);
                        }
                    }
                } catch (modalErr) {
                    // Modal dismiss failed, continue anyway
                    console.log(`[LINKEDIN] Modal dismiss error: ${modalErr.message} (continuing anyway)`);
                }

                console.log(`[LINKEDIN] ✅ On LinkedIn page: ${currentUrl.substring(0, 70)}...`);

                // Check if this is a profile page and scan Activity section
                let pageEmails = [];
                let pageSkills = [];
                let pageJobTitles = [];

                const companyBaseUrl = getLinkedInCompanyBase(currentUrl);

                if (companyBaseUrl && !companyScanned) {
                    companyScanned = true;
                    primaryCompanyUrl = companyBaseUrl;
                    const companyResult = await scanLinkedInCompany(linkedinPage, companyBaseUrl, searchKeywords);
                    if (companyResult.crashed) {
                        linkedinPage = await ensureHealthyLinkedInPage(linkedinPage);
                        continue;
                    }
                    pageEmails = companyResult.emails;
                    pageSkills = companyResult.skills;
                    pageJobTitles = companyResult.jobTitles;
                    postsScanned += companyResult.postsScanned;
                } else if (currentUrl.includes('/in/')) {
                    // This is a LinkedIn profile - scan Activity section
                    console.log(`[LINKEDIN] 📋 Profile detected - scanning Activity section...`);

                    const activityResult = await scanProfileActivity(linkedinPage, searchKeywords);
                    if (activityResult.crashed) {
                        linkedinPage = await ensureHealthyLinkedInPage(linkedinPage);
                        continue;
                    }
                    pageEmails = activityResult.emails;
                    pageSkills = activityResult.skills;
                    pageJobTitles = activityResult.jobTitles;
                    postsScanned += activityResult.postsScanned || 0;
                } else {
                    // Regular page scanning (company pages, posts, etc.)
                    let pageText = "";

                    // Check if this is a post page - extract only post content (not comments)
                    const isPostPage = currentUrl.includes('/posts/');

                    if (isPostPage) {
                        // Extract ONLY post content (exclude comments)
                        const postArticle = await linkedinPage.$('article.main-feed-activity-card').catch(() => null);

                        if (postArticle) {
                            const postCommentary = await postArticle.$('[data-test-id="main-feed-activity-card__commentary"]').catch(() => null);

                            if (postCommentary) {
                                pageText = await postCommentary.innerText().catch(() => "");
                            } else {
                                // Fallback: get article but cut at comments
                                pageText = await postArticle.innerText().catch(() => "");
                                const commentSectionStart = pageText.indexOf('Like\nComment\nShare');
                                if (commentSectionStart > -1) {
                                    pageText = pageText.substring(0, commentSectionStart);
                                }
                            }
                        } else {
                            // Absolute fallback
                            pageText = await linkedinPage.innerText('body').catch(() => "");
                        }
                    } else {
                        // Company page or other - get full body text
                        pageText = await linkedinPage.innerText('body').catch(() => "");
                    }

                    const lowerPageText = pageText.toLowerCase();

                    // Check if page has hiring-related content
                    const hasHiringContent = hiringKeywords.some(kw => lowerPageText.includes(kw));

                    if (hasHiringContent) {
                        console.log(`[LINKEDIN] ✅ Hiring content detected on this page`);

                        // Extract emails
                        pageEmails = pageText.match(EMAIL_REGEX) || [];
                        if (pageEmails.length > 0) {
                            console.log(`[LINKEDIN]   └─ Emails found: ${pageEmails.join(', ')}`);
                        }

                        // Match skills
                        pageSkills = searchKeywords.filter(kw =>
                            new RegExp(`\\b${kw.replace(/\s+/g, '\\s+')}\\b`, 'gi').test(pageText)
                        );

                        if (pageSkills.length > 0) {
                            console.log(`[LINKEDIN]   └─ Skills matched: ${pageSkills.join(', ')}`);

                            // Extract job title
                            const titleMatch = pageText.match(/(?:hiring|looking for|seeking|join us as|apply for)\s+(?:a\s+)?([^\n]{5,60}(?:engineer|developer|architect|lead|manager|specialist|designer))/gi);
                            if (titleMatch) {
                                const jobTitle = titleMatch[0].trim();
                                console.log(`[LINKEDIN]   └─ Job Title: ${jobTitle}`);
                                pageJobTitles.push(jobTitle);
                            }
                        }
                    } else {
                        console.log(`[LINKEDIN] No hiring content found on this page`);
                    }
                }

                // Add collected data to arrays
                if (pageEmails.length > 0 || pageSkills.length > 0) {
                    allLinkedInEmails = [...allLinkedInEmails, ...pageEmails];
                    allLinkedInSkills = [...allLinkedInSkills, ...pageSkills];
                    allLinkedInJobTitles = [...allLinkedInJobTitles, ...pageJobTitles];
                    processedPages++;
                }

                // Small delay before going back
                await linkedinPage.waitForTimeout(2000);

                // Go back to search results for next iteration
                if (i < linksToProcess.length - 1) {
                    console.log(`[LINKEDIN] Navigating back to search results...`);
                    await linkedinPage.goto(linkedinSearchUrl, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => { });
                    try {
                        await linkedinPage.waitForTimeout(3000);
                    } catch (err) {
                        if (isTargetCrashedError(err)) {
                            linkedinPage = await ensureHealthyLinkedInPage(linkedinPage);
                            continue;
                        }
                    }
                }

            } catch (linkErr) {
                console.error(`[LINKEDIN] Error processing link ${i + 1}: ${linkErr.message}`);

                // Try to go back to search results
                try {
                    await linkedinPage.goto(linkedinSearchUrl, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => { });
                    await linkedinPage.waitForTimeout(3000);
                } catch (backErr) {
                    console.error(`[LINKEDIN] Could not return to search results`);
                }

                continue;
            }
        }


        // Deduplicate collected data (case-insensitive for emails)
        const uniqueLinkedInEmails = [...new Set(allLinkedInEmails.map(e => e.toLowerCase()))];
        const uniqueLinkedInSkills = [...new Set(allLinkedInSkills)];

        console.log(`\n[LINKEDIN] ✅ Complete: Processed ${processedPages} pages with hiring content`);
        if (postsScanned > 0) {
            console.log(`[LINKEDIN]   └─ Company posts scanned: ${postsScanned}`);
        }
        console.log(`[LINKEDIN]   └─ Total emails: ${uniqueLinkedInEmails.length}`);
        console.log(`[LINKEDIN]   └─ Total skills matched: ${uniqueLinkedInSkills.length}`);
        console.log(`[LINKEDIN]   └─ Total job titles: ${allLinkedInJobTitles.length}`);

        return {
            linkedinEmails: uniqueLinkedInEmails,
            linkedinSkills: uniqueLinkedInSkills,
            linkedinJobTitles: allLinkedInJobTitles,
            linkedinUrl: primaryCompanyUrl || linksToProcess[0]?.href || "", // First LinkedIn URL as reference
            linkedinPosts: postsScanned || processedPages
        };
    } catch (err) {
        console.error(`[LINKEDIN] Error: ${err.message}`);
        return { linkedinEmails: [], linkedinSkills: [], linkedinJobTitles: [], linkedinPosts: 0 };
    }
}

// ============================================
// LinkedIn Profile Activity Scanner
// ============================================
async function scanProfileActivity(page, searchKeywords) {
    const hiringKeywords = ['hiring', 'join', 'team', 'opportunity', '#job', 'job alert', 'we are hiring', 'looking for', 'join our team', 'open position'];
    let allEmails = [];
    let allSkills = [];
    let allJobTitles = [];

    try {
        const currentUrl = page.url();
        const isActivityPage = currentUrl.includes('/recent-activity/all');
        const baseUrl = getLinkedInProfileBase(currentUrl) || currentUrl;
        const activityUrl = isActivityPage ? currentUrl : `${baseUrl}/recent-activity/all/`;

        if (!isActivityPage) {
            console.log(`[LINKEDIN] Opening full activity: ${activityUrl}`);
            await page.goto(activityUrl, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => { });
            await page.waitForTimeout(3000);
        }

        const maxPosts = 15;
        const posts = [];

        try {
            await page.waitForSelector('div[data-urn^="urn:li:activity"], div.feed-shared-update-v2[role="article"]', { timeout: 8000 });
        } catch (e) {
            await page.evaluate(() => window.scrollBy(0, window.innerHeight * 1.2));
            await page.waitForTimeout(2000);
        }

        const collect = async () => {
            const data = await page.$$eval(
                'div[data-urn^="urn:li:activity"], div.feed-shared-update-v2[role="article"]',
                (nodes) => nodes.map((n) => {
                    const textEl = n.querySelector('.update-components-text, .feed-shared-inline-show-more-text, .feed-shared-update-v2__description');
                    const text = (textEl ? textEl.innerText : n.innerText || '').trim();
                    const timeEl = n.querySelector('time');
                    const timeText = timeEl ? timeEl.innerText.trim() : '';
                    const urn = n.getAttribute('data-urn') || '';
                    return { urn, text, timeText };
                })
            ).catch(() => []);

            for (const item of data) {
                if (!item.text) continue;
                posts.push(item);
            }
        };

        let lastCount = 0;
        for (let i = 0; i < 10 && posts.length < maxPosts; i++) {
            await collect();
            const uniqueMap = new Map();
            for (const p of posts) {
                const key = p.urn || p.text.slice(0, 120);
                if (!uniqueMap.has(key)) uniqueMap.set(key, p);
            }
            const uniquePosts = Array.from(uniqueMap.values());
            posts.length = 0;
            posts.push(...uniquePosts);

            if (posts.length >= maxPosts || posts.length === lastCount) {
                break;
            }
            lastCount = posts.length;
            await page.evaluate(() => window.scrollBy(0, window.innerHeight * 1.2));
            await page.waitForTimeout(2000);
        }

        console.log(`[LINKEDIN] Found ${posts.length} activity posts, scanning up to ${maxPosts}...`);
        if (posts.length === 0) {
            const bodyText = await page.innerText('body').catch(() => '');
            if (bodyText.toLowerCase().includes('hasn’t posted') || bodyText.toLowerCase().includes('no activity')) {
                console.log(`[LINKEDIN] No recent activity visible on this profile`);
            }
        }

        for (const post of posts.slice(0, maxPosts)) {
            const postContent = post.text || '';
            const lower = postContent.toLowerCase();

            const postEmails = postContent.match(EMAIL_REGEX) || [];
            allEmails = [...allEmails, ...postEmails];

            const hasHiringKeyword = hiringKeywords.some(kw => lower.includes(kw));
            const ageDays = parseRelativeAgeToDays(post.timeText);

            if (hasHiringKeyword && ageDays !== null && ageDays <= 30) {
                const matchedSkills = searchKeywords.filter(kw =>
                    new RegExp(`\\b${kw.replace(/\\s+/g, '\\s+')}\\b`, 'gi').test(postContent)
                );

                if (matchedSkills.length > 0) {
                    allSkills = [...allSkills, ...matchedSkills];
                    const titleMatch = postContent.match(/(?:hiring|looking for|seeking|join our team as|join us as|apply for|position|role)\s+(?:for\s+)?(?:a\s+)?([^\n]{5,60}(?:engineer|developer|architect|lead|manager|specialist|designer|intern))/gi);
                    if (titleMatch) {
                        allJobTitles.push(titleMatch[0].trim());
                    }
                }
            }
        }

        if (allEmails.length > 0) {
            console.log(`[LINKEDIN] 🟢 Profile emails found: ${[...new Set(allEmails)].join(', ')}`);
        }

        return {
            emails: [...new Set(allEmails)],
            skills: [...new Set(allSkills)],
            jobTitles: allJobTitles,
            postsScanned: Math.min(posts.length, maxPosts)
        };

    } catch (err) {
        console.error(`[LINKEDIN] Activity scan error: ${err.message}`);
        if (isTargetCrashedError(err)) {
            return { emails: [], skills: [], jobTitles: [], postsScanned: 0, crashed: true };
        }
        return { emails: [], skills: [], jobTitles: [], postsScanned: 0 };
    }
}

function stopCareerAutomation() {
    console.log("Stopping career automation...");
    isRunning = false;
    isPaused = false;
    updateCareerProgress({ status: "stopped" });
}

function togglePauseCareerAutomation() {
    isPaused = !isPaused;
    if (isPaused) {
        console.log("⏸️ Career automation PAUSED");
        emitAutomationStatus("⏸️ Paused");
        updateCareerProgress({ status: "paused" });
    } else {
        console.log("▶️ Career automation RESUMED");
        emitAutomationStatus("▶️ Resumed");
        updateCareerProgress({ status: "running" });
    }
    return isPaused;
}

module.exports = {
    runCareerAutomation,
    stopCareerAutomation,
    togglePauseCareerAutomation,
    getCareerProgress,
    isCareerAutomationRunning: () => isRunning,
    isCareerAutomationPaused: () => isPaused
};
