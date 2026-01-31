const { chromium } = require("playwright-extra");
const stealth = require("puppeteer-extra-plugin-stealth")();
chromium.use(stealth);
const cron = require("node-cron");
const path = require("path");
const fs = require("fs").promises;

// Profile file (no PDF parsing): notice, DOB, experience, skills, skillsWithYears. Fast to load.
const CV_PROFILE_PATH = path.join(__dirname, "cv-profile.json");

let browser = null;
let page = null;
let isRunning = false;
let appliedJobs = [];
let cycleInProgress = false;
let automationTasks = [];

// Login credentials (consider using process.env for production)
const LOGIN_EMAIL = "rituraj1949@gmail.com";
const LOGIN_PASSWORD = "Ritu778@%,.&";

// Job search configuration
const JOB_KEYWORD = "AI full Stack Developer";
const LOCATIONS = [
  "Noida",
  "Gurugram",
  "Mumbai",
  "New Delhi",
  "Bengaluru",
  "Delhi/NCR",
];
const SALARY_RANGES = ["15-25 Lakhs", "25-50 Lakhs"];
const FRESHNESS = "Last 1 Day";
const SORT_BY = "date"; // Sort by date

// Pre-filtered search URL: job title, experience=5, ctc 15–25 & 25–50 Lakhs, jobAge=1 (last 1 day)
// Edit this URL to change keywords/filters; no need to use the search bar or apply filters in the UI.
const PRE_FILTERED_SEARCH_URL =
  "https://www.naukri.com/full-stack-developer-gen-ai-chatbot-natural-language-processing-artificial-intelligence-jobs?k=full%20stack%20developer%2C%20gen%20ai%2C%20chatbot%2C%20natural%20language%20processing%2C%20artificial%20intelligence&nignbevent_src=jobsearchDeskGNB&experience=5&ctcFilter=15to25&ctcFilter=25to50&jobAge=1";

// LinkedIn Leads API (always-save): POST /api/linkedin-leads
// Base: https://backend-emails-elxz.onrender.com
// Required: companyName (we send "Unknown" when empty). Optional: jobTitle, city, jobUrl, emails, skills, source, applied.
// If the server sets LEADS_API_KEY, send it: X-API-Key or Authorization: Bearer. Suggested: LEADS_API_KEY=naukri-leads
const LEADS_API_URL =
  "https://backend-emails-elxz.onrender.com/api/linkedin-leads";
const LEADS_API_KEY = process.env.LEADS_API_KEY || "";
const LEADS_API_AUTH = (
  process.env.LEADS_API_AUTH || "X-API-Key"
).toLowerCase(); // "X-API-Key" or "bearer"
// Optional: PATCH/PUT endpoint to set applied. Uses /api/linkedin-leads/applied endpoint.
const LEADS_UPDATE_API_URL = process.env.LEADS_UPDATE_API_URL || "https://backend-emails-elxz.onrender.com/api/linkedin-leads/applied";

// --- Profile (cv-profile.json): skills and form-fill. No PDF parsing. ---
const NOTICE_OPTS = [
  "15 Days or less",
  "1 Month",
  "2 Months",
  "3 Months",
  "More than 3 Months",
  "Serving Notice Period",
  "Skip this question",
];

// --- Verified Naukri selectors (from live DOM). Update if site changes. ---
// Apply (JD page): #apply-button, button.apply-button, [class*="apply-button"]
// Type message (apply modal): data-placeholder="Type message here..." on contenteditable div.textArea; fallback placeholder, contenteditable
// Save in modal: use :not([class*="save-job"]) to avoid header "Save job" (styles_save-job-button__*)
// Radios: getByRole("radio",{name}) or getByText(option) for notice/Yes|No|Skip
const TYPE_MESSAGE_SELECTOR =
  '[data-placeholder*="Type message"], [placeholder*="Type message"], [contenteditable="true"]';

// --- Excluded Jobs Configuration ---
const EXCLUDED_SKILLS = [".net", "java", "php"];
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
  "Oracle",
  "Accenture",
  "Genpact",
  "Optum",
  "PwC",
  "NTT Data",
  "ITC Infotech",
  "Nagarro",
  "EY",
  "Ernst & Young",
];

// Check if a job should be skipped based on title, company, or description
function shouldSkipJob(jobTitle, companyName, jdText = "") {
  const title = (jobTitle || "").toLowerCase();
  const company = (companyName || "").toLowerCase();
  const description = (jdText || "").toLowerCase();

  // Check excluded companies
  for (const excludedCompany of EXCLUDED_COMPANIES) {
    if (company.includes(excludedCompany.toLowerCase())) {
      return { skip: true, reason: `Excluded Company: ${excludedCompany}` };
    }
  }

  // Check excluded skills in title or description
  for (const skill of EXCLUDED_SKILLS) {
    if (
      title.includes(skill.toLowerCase()) ||
      description.includes(skill.toLowerCase())
    ) {
      // Special case for ".net" to avoid partial matches if needed, but simple includes is often enough
      // For ".net", maybe check word boundaries if it causes false positives
      if (skill === ".net") {
        const netRegex = /(^|[\s,.\/\-])\.net($|[\s,.\/\-])/i;
        if (netRegex.test(title) || netRegex.test(description)) {
          return { skip: true, reason: `Excluded Skill: ${skill}` };
        }
      } else {
        return { skip: true, reason: `Excluded Skill: ${skill}` };
      }
    }
  }

  return { skip: false };
}

async function loadProfile() {
  const def = {
    noticePeriod: "15 Days or less",
    dateOfBirth: "05-01-1998",
    experienceYears: 5,
    currentCTC: "16",
    expectedCTC: "18-20 LPA",
    currentLocation: "Noida",
    skills: [],
    skillsWithYears: {
      node: 3,
      react: 3,
      python: 3,
      javascript: 3,
      "next js": 3,
      nextjs: 3,
      redis: 3,
      docker: 3,
      kafka: 3,
      aws: 3,
      rag: 3,
      "vector db": 3,
      langchain: 3,
      langraph: 3,
      llm: 3,
      huggingface: 3,
      tensorflow: 3,
      "artificial intelligence": 3,
      ai: 3,
    },
  };
  try {
    const raw = await fs.readFile(CV_PROFILE_PATH, "utf8");
    const p = JSON.parse(raw);
    return { ...def, ...p };
  } catch (e) {
    console.warn("loadProfile:", e.message, "| using defaults");
    return def;
  }
}

async function loadCVSkills() {
  const p = await loadProfile();
  const s = (p.skills || []).map((x) => String(x).toLowerCase().trim());
  if (s.length) return s;
  return [
    "node",
    "node.js",
    "react",
    "mongodb",
    "express",
    "mern",
    "gen ai",
    "javascript",
    "typescript",
    "full stack",
    "nlp",
    "chatbot",
    "python",
    "langchain",
    "langgraph",
    "ai",
    "machine learning",
  ];
}

// Next 15th or 30th (or given day) as DD/MM/YYYY for "Last working day" / "When can you join?"
// dayOfMonth 30 in Feb uses 28/29 (last day of that month).
function getNextLastWorkingDate(dayOfMonth) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const cap = (y, m) => Math.min(dayOfMonth, new Date(y, m + 1, 0).getDate());
  let d = new Date(
    today.getFullYear(),
    today.getMonth(),
    cap(today.getFullYear(), today.getMonth())
  );
  if (d <= today)
    d = new Date(
      today.getFullYear(),
      today.getMonth() + 1,
      cap(today.getFullYear(), today.getMonth() + 1)
    );
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}/${d.getFullYear()}`;
}

async function loadCVDetails() {
  const p = await loadProfile();
  const raw = p.expectedCTC || "18-20 LPA";
  const rangeMatch = String(raw).match(/(\d+)\s*-\s*(\d+)/);
  const expectedCTCLacs = rangeMatch
    ? `${rangeMatch[1]}-${rangeMatch[2]}`
    : String(raw).match(/(\d+)/)?.[1] || "18";
  return {
    noticePeriod: p.noticePeriod || "15 Days or less",
    dateOfBirth: p.dateOfBirth || "05-01-1998",
    experienceYears: p.experienceYears != null ? p.experienceYears : 5,
    preferredCity: p.preferredCity || "Skip this question",
    currentLocation: p.currentLocation || "Noida",
    currentCTC: p.currentCTC || "16", // 16 LPA
    expectedCTC: p.expectedCTC || "18-20 LPA",
    expectedCTCLacs: expectedCTCLacs || "18-20",
    lastWorkingDayOfMonth:
      p.lastWorkingDayOfMonth != null ? p.lastWorkingDayOfMonth : 15,
    skillsWithYears: p.skillsWithYears || {},
    willingToRelocate: p.willingToRelocate || "Yes", // for "residing in X or willing to relocate" Yes/No/Skip
  };
}

// --- Relevance: Check job title and skills against our skill set, exclude Java/.NET/PHP/Flutter ---
function isRelevantJob(job, cvSkills, cvDetails = {}) {
  // Combine job title and skills array for matching
  const jobText = (
    (job.jobTitle || "") +
    " " +
    (Array.isArray(job.skills) ? job.skills.join(" ") : "")
  ).toLowerCase();

  console.log(`[Job Relevance] Checking job: "${job.jobTitle}"`);
  console.log(`[Job Relevance] Job text: "${jobText}"`);

  // Exclude jobs with unwanted technologies - STRICT CHECKING
  const excludedPatterns =
    /\b(java|\.net|dotnet|net core|php|flutter|dart|angular)\b/i;
  if (excludedPatterns.test(jobText)) {
    console.log(
      `[Job Relevance] ❌ EXCLUDED - Contains unwanted technology: ${excludedPatterns.exec(jobText)[0]
      }`
    );
    return false;
  }

  // Get all skills from cv-profile.json (both skills array and skillsWithYears keys)
  const allCvSkills = new Set();

  // Add skills from skills array
  if (Array.isArray(cvSkills)) {
    cvSkills.forEach((skill) => {
      if (skill) allCvSkills.add(String(skill).toLowerCase().trim());
    });
  }

  // Add skills from skillsWithYears (all keys)
  const skillsWithYears = cvDetails?.skillsWithYears || {};
  Object.keys(skillsWithYears).forEach((skill) => {
    if (skill) {
      allCvSkills.add(skill.toLowerCase().trim());
      // Also add variations (e.g., "node.js" -> "node", "nodejs")
      const normalized = skill.toLowerCase().replace(/[.\s-]/g, "");
      if (normalized !== skill.toLowerCase()) {
        allCvSkills.add(normalized);
      }
    }
  });

  // Comprehensive skill keywords to match (all our skills)
  const skillKeywords = [
    // AI & Machine Learning
    "pytorch",
    "tensorflow",
    "machine learning",
    "ml",
    "deep learning",
    "artificial intelligence",
    "ai",
    "aws bedrock",
    "bedrock",
    "aws nova",
    "nova",
    "vertex ai",
    "vertex",
    "agentic ai",
    "agentic",
    "generative ai",
    "gen ai",
    "genai",
    "llm",
    "large language model",
    "rag",
    "retrieval augmented generation",
    "nlp",
    "natural language processing",
    "computer vision",
    "cv",
    "opencv",
    "keras",
    "scikit-learn",
    "sklearn",
    "neural networks",
    "transformers",
    "hugging face",
    "huggingface",
    "langchain",
    "langraph",
    "llama",
    "openai",
    "chatgpt",
    "gpt",
    "anthropic",
    "claude",
    "stable diffusion",
    "mlops",
    "model deployment",
    "sagemaker",
    "azure ml",
    "google ai",
    "prompt engineering",
    "fine-tuning",
    "embedding",
    "vector database",
    "vector db",
    "pinecone",
    "weaviate",
    "chroma",

    // Software Development
    "react",
    "reactjs",
    "react.js",
    "nextjs",
    "next.js",
    "next js",
    "node",
    "nodejs",
    "node.js",
    "express",
    "expressjs",
    "express.js",
    "nestjs",
    "nest.js",
    "typescript",
    "ts",
    "javascript",
    "js",
    "python",
    "django",
    "flask",
    "fastapi",
    "fast-api",
    "mongodb",
    "mongo",
    "postgresql",
    "postgres",
    "mysql",
    "redis",
    "elasticsearch",
    "docker",
    "kubernetes",
    "k8s",
    "kube",
    "aws",
    "amazon web services",
    "azure",
    "gcp",
    "google cloud",
    "terraform",
    "jenkins",
    "github actions",
    "ci/cd",
    "ci cd",
    "microservices",
    "rest api",
    "rest-api",
    "restful",
    "graphql",
    "websocket",
    "rabbitmq",
    "kafka",
    "grpc",
    "nginx",
    "linux",
    "git",
    "tailwind",
    "tailwindcss",
    "sass",
    "scss",
    "webpack",
    "vite",

    // Full Stack & MERN
    "mern",
    "full stack",
    "fullstack",
    "chatbot",
  ];

  // Check if job text contains any of our skills
  let matchCount = 0;

  for (const keyword of skillKeywords) {
    // Check if keyword appears in job text (case-insensitive, word boundary)
    const keywordLower = keyword.toLowerCase();
    const keywordRegex = new RegExp(
      `\\b${keywordLower.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`,
      "i"
    );

    if (keywordRegex.test(jobText)) {
      // Check if this keyword matches any of our CV skills
      const normalizedKeyword = keywordLower.replace(/[.\s-]/g, "");

      // Check if keyword is in our CV skills
      const isInCvSkills = Array.from(allCvSkills).some((cvSkill) => {
        const cvSkillLower = cvSkill.toLowerCase();
        const normalizedCvSkill = cvSkillLower.replace(/[.\s-]/g, "");

        // Multiple matching strategies
        return (
          cvSkillLower === keywordLower || // Exact match
          cvSkillLower.includes(keywordLower) || // CV skill contains keyword
          keywordLower.includes(cvSkillLower) || // Keyword contains CV skill
          normalizedCvSkill === normalizedKeyword || // Normalized match
          normalizedCvSkill.includes(normalizedKeyword) || // Normalized contains
          normalizedKeyword.includes(normalizedCvSkill)
        ); // Keyword normalized contains
      });

      if (isInCvSkills) {
        matchCount++;
      }
    }
  }

  // Require at least 2 skill matches to apply
  return matchCount >= 2;
}

// Perform login on Naukri.com
async function performLogin(page) {
  try {
    console.log("Attempting to log in to Naukri.com...");

    // 1. Click the Login button/link to open the login form
    const loginButtonSelectors = [
      'a[title="Jobseeker Login"]',
      'a:has-text("Login")',
      'a:has-text("Log in")',
      'button:has-text("Login")',
      'button:has-text("Log in")',
      "[class*='login']",
      "text=Login",
      "text=Log in",
    ];

    let loginClicked = false;
    for (const selector of loginButtonSelectors) {
      try {
        const btn = await page.$(selector);
        if (btn && (await btn.isVisible())) {
          await btn.click();
          loginClicked = true;
          await page.waitForTimeout(3000); // Wait for login form/modal
          break;
        }
      } catch (e) {
        continue;
      }
    }

    if (!loginClicked) {
      // Try navigating directly to login page if Login button not found
      await page.goto("https://www.naukri.com/nlogin/login", {
        waitUntil: "domcontentloaded",
        timeout: 15000,
      });
      await page.waitForTimeout(2000);
    }

    // 2. Fill email/username – nlogin uses "Enter Email ID / Username", legacy uses #usernameField etc.
    const emailSelectors = [
      'input[placeholder*="Enter Email ID"]',
      'input[placeholder*="Email ID / Username"]',
      'input[placeholder*="Email"]',
      "#usernameField",
      'input[name="USERNAME"]',
      'input[name="username"]',
      'input[type="email"]',
      "#emailTxt",
    ];

    for (const sel of emailSelectors) {
      try {
        const el = await page.$(sel);
        if (el && (await el.isVisible())) {
          await el.fill(LOGIN_EMAIL);
          await page.waitForTimeout(500);
          break;
        }
      } catch (e) {
        continue;
      }
    }

    // 3. Fill password – nlogin uses "Enter Password"
    const passwordSelectors = [
      'input[placeholder*="Enter Password"]',
      'input[placeholder*="Password"]',
      "#passwordField",
      'input[name="PASSWORD"]',
      'input[name="password"]',
      'input[type="password"]',
      "#pwd1",
    ];

    for (const sel of passwordSelectors) {
      try {
        const el = await page.$(sel);
        if (el && (await el.isVisible())) {
          await el.fill(LOGIN_PASSWORD);
          await page.waitForTimeout(500);
          break;
        }
      } catch (e) {
        continue;
      }
    }

    // 4. Click the Login submit button
    const submitSelectors = [
      "#sbtLog",
      'button[name="Login"]',
      'button:has-text("Login")',
      'button:has-text("Log in")',
      'input[type="submit"]',
      'button[type="submit"]',
      "text=Login",
      "text=Log in",
      "[class*='submit']",
    ];

    for (const sel of submitSelectors) {
      try {
        const btn = await page.$(sel);
        if (btn && (await btn.isVisible())) {
          await btn.click();
          console.log("Waiting 5 sec for redirect after login...");
          await page.waitForTimeout(5000);
          console.log("Login form submitted.");
          return true;
        }
      } catch (e) {
        continue;
      }
    }

    // Fallback: press Enter in password field
    const pwd = await page.$('input[type="password"]');
    if (pwd) {
      await pwd.press("Enter");
      console.log("Waiting 5 sec for redirect after login...");
      await page.waitForTimeout(5000);
      console.log("Login submitted (Enter).");
      return true;
    }

    console.log(
      "Could not find Login submit button; you may need to log in manually."
    );
    return false;
  } catch (err) {
    console.error("Error during login:", err.message);
    return false;
  }
}

// Initialize browser and navigate to Naukri.com
async function initializeBrowser() {
  try {
    const isProduction = process.env.NODE_ENV === 'production' || process.env.RENDER === 'true';

    // Set Playwright path for Render
    if (isProduction) {
      process.env.PLAYWRIGHT_BROWSERS_PATH = '0';
    }

    console.log("Launching browser...");
    browser = await chromium.launch({
      headless: isProduction ? true : false,
      slowMo: isProduction ? 0 : 500,
      args: isProduction
        ? [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-blink-features=AutomationControlled',
          '--window-size=1920,1080',
          '--disable-http2', // Fix for net::ERR_HTTP2_PROTOCOL_ERROR (Akamai block)
        ]
        : ['--disable-blink-features=AutomationControlled']
    });

    // Load saved auth state if exists
    const fs = require('fs');
    let contextOptions = {
      viewport: { width: 1920, height: 1080 },
      // Switch to Mobile User Agent to bypass tight desktop security
      userAgent: 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Mobile Safari/537.36',
      locale: 'en-US',
      timezoneId: 'Asia/Kolkata',
      geolocation: { longitude: 77.2090, latitude: 28.6139 }, // Delhi
      permissions: ['geolocation'],
      extraHTTPHeaders: {
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Upgrade-Insecure-Requests': '1',
      }
    };

    if (fs.existsSync('auth.json')) {
      console.log("✅ Loading saved authentication state from auth.json...");
      contextOptions.storageState = 'auth.json';
    } else {
      console.log("⚠️ No auth.json found, starting fresh session.");
    }

    const context = await browser.newContext(contextOptions);

    page = await context.newPage();

    // Start screenshot streaming for live view on frontend
    try {
      const { startScreenshotStream } = require('./screenshot-service');
      await startScreenshotStream(page, 'naukri', 1000);
      console.log("📸 Screenshot streaming started - check frontend for live view!");
    } catch (err) {
      console.warn("Screenshot streaming not available:", err.message);
    }

    // STRATEGY: "Legacy Side-Door"
    // The legacy PHP login page (login.naukri.com) is often less secure than the main React app.
    console.log("🛡️ Attempting Side-Door Entry (Legacy Login Portal)...");

    try {
      // Go to legacy page - Disable timeout to prevent panic
      await page.goto("https://login.naukri.com/nLogin/Login.php", {
        timeout: 0,
        waitUntil: "commit"
      });
      console.log("✅ Side-Door Entered! (Legacy Login Page Loaded)");

      await page.waitForTimeout(3000);

      // Now "Jump" to the main dashboard
      console.log("🚀 Jumping to Dashboard...");
      await page.goto("https://www.naukri.com/mnjuser/homepage", { timeout: 0, waitUntil: "commit" });
      await page.waitForTimeout(5000);

    } catch (e) {
      console.log(`Side-Door failed: ${e.message}`);
      // Last ditch effort: Try generic google redirect
      await page.goto("https://www.google.com/url?q=https://www.naukri.com", { timeout: 60000 });
    }

    // Wait for page to load
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(4000);

    // Scroll to simulate human behavior
    console.log("scrolling page...");
    await page.mouse.wheel(0, 500);
    await page.waitForTimeout(1000);
    await page.mouse.wheel(0, -500);
    await page.waitForTimeout(1000);

    // Handle any popups/modals
    try {
      const popupSelectors = [
        'button:has-text("Skip")',
        'button:has-text("Close")',
        '[aria-label="Close"]',
        ".close",
        "button.close",
      ];

      for (const selector of popupSelectors) {
        try {
          const popup = await page.$(selector);
          if (popup) {
            await popup.click();
            await page.waitForTimeout(1000);
          }
        } catch (e) {
          continue;
        }
      }
    } catch (e) {
      // Ignore popup errors
    }

    // Auto-login with credentials
    await performLogin(page);

    console.log("Browser initialized successfully");
    return true;
  } catch (error) {
    console.error("Error initializing browser:", error);
    throw error;
  }
}

// Apply location filters
async function applyLocationFilters() {
  try {
    console.log("Applying location filters...");

    // Look for location filter section
    const locationSelectors = [
      'input[placeholder*="Location"]',
      'input[placeholder*="location"]',
      'input[id*="location"]',
      'input[name*="location"]',
      ".location",
      '[class*="location"]',
    ];

    let locationInput = null;
    for (const selector of locationSelectors) {
      try {
        locationInput = await page.$(selector);
        if (locationInput) {
          const isVisible = await locationInput.isVisible();
          if (isVisible) {
            console.log(`Found location input with selector: ${selector}`);
            break;
          }
        }
      } catch (e) {
        continue;
      }
    }

    if (locationInput) {
      await locationInput.click();
      await page.waitForTimeout(500);
      await locationInput.fill("");
      await page.waitForTimeout(500);

      // Type first location and select from dropdown
      await locationInput.type(LOCATIONS[0], { delay: 50 });
      await page.waitForTimeout(1000);

      // Try to select from dropdown suggestions
      const suggestionSelectors = [
        `text=${LOCATIONS[0]}`,
        `[title*="${LOCATIONS[0]}"]`,
        ".suggestor-main li",
        ".suggestor li",
      ];

      for (const selector of suggestionSelectors) {
        try {
          const suggestion = await page.$(selector);
          if (suggestion) {
            await suggestion.click();
            await page.waitForTimeout(1000);
            break;
          }
        } catch (e) {
          continue;
        }
      }

      // Add additional locations
      for (let i = 1; i < LOCATIONS.length; i++) {
        await locationInput.click();
        await page.waitForTimeout(500);
        await locationInput.type(LOCATIONS[i], { delay: 50 });
        await page.waitForTimeout(1000);

        // Select from dropdown
        for (const selector of suggestionSelectors) {
          try {
            const suggestion = await page.$(selector);
            if (suggestion) {
              await suggestion.click();
              await page.waitForTimeout(1000);
              break;
            }
          } catch (e) {
            continue;
          }
        }
      }
    } else {
      // Try clicking on location filter chips/buttons on results page (filter sidebar)
      console.log(
        "Trying alternative location filter method (filter sidebar)..."
      );
      await page.waitForTimeout(1000);

      // Scroll to filter section
      await page.evaluate(() => {
        const filterSection = document.querySelector(
          '.filter-container, .filters, [class*="filter"]'
        );
        if (filterSection) {
          filterSection.scrollIntoView({ behavior: "smooth", block: "start" });
        }
      });
      await page.waitForTimeout(1000);

      // Try to expand location filter section
      const expandSelectors = [
        ".locationFilter",
        '[class*="location"] [class*="filter"]',
        "text=Location",
        'button:has-text("Location")',
        '.filter-title:has-text("Location")',
      ];

      for (const selector of expandSelectors) {
        try {
          const expandBtn = await page.$(selector);
          if (expandBtn && (await expandBtn.isVisible())) {
            await expandBtn.click();
            await page.waitForTimeout(1000);
            break;
          }
        } catch (e) {
          continue;
        }
      }

      // Apply each location filter from sidebar
      for (const location of LOCATIONS) {
        try {
          const locationSelectors = [
            `label:has-text("${location}")`,
            `input[value*="${location}"]`,
            `text=${location}`,
            `span:has-text("${location}")`,
            `li:has-text("${location}")`,
            `.filterOption:has-text("${location}")`,
          ];

          let locationSelected = false;
          for (const selector of locationSelectors) {
            try {
              const locationElement = await page.$(selector);
              if (locationElement && (await locationElement.isVisible())) {
                const tagName = await locationElement.evaluate((el) =>
                  el.tagName.toLowerCase()
                );
                if (tagName === "input") {
                  const isChecked = await locationElement.isChecked();
                  if (!isChecked) {
                    await locationElement.click();
                    locationSelected = true;
                    console.log(`✓ Selected location: ${location}`);
                    await page.waitForTimeout(800);
                    break;
                  }
                } else {
                  await locationElement.click();
                  locationSelected = true;
                  console.log(`✓ Selected location: ${location}`);
                  await page.waitForTimeout(800);
                  break;
                }
              }
            } catch (e) {
              continue;
            }
          }

          if (!locationSelected) {
            console.log(`⚠ Could not find location filter for: ${location}`);
          }
        } catch (e) {
          console.log(`Error selecting location ${location}:`, e.message);
          continue;
        }
      }
    }

    console.log("Location filters applied");
  } catch (error) {
    console.error("Error applying location filters:", error);
    // Continue even if location filter fails
  }
}

// Apply salary filters
async function applySalaryFilters() {
  try {
    console.log("Applying salary filters...");
    await page.waitForTimeout(1000);

    // Try to expand salary filter if it's collapsed
    const salaryExpandSelectors = [
      ".salaryFilter",
      '[class*="salary"] [class*="filter"]',
      "text=Salary",
      'button:has-text("Salary")',
      '.filter-title:has-text("Salary")',
    ];

    for (const selector of salaryExpandSelectors) {
      try {
        const expandBtn = await page.$(selector);
        if (expandBtn) {
          const isVisible = await expandBtn.isVisible();
          if (isVisible) {
            await expandBtn.click();
            await page.waitForTimeout(1000);
            break;
          }
        }
      } catch (e) {
        continue;
      }
    }

    for (const salaryRange of SALARY_RANGES) {
      try {
        // Try multiple selectors for salary filter
        const salarySelectors = [
          `label:has-text("${salaryRange}")`,
          `input[value*="${salaryRange}"]`,
          `text=${salaryRange}`,
          `button:has-text("${salaryRange}")`,
          `[title*="${salaryRange}"]`,
          `span:has-text("${salaryRange}")`,
          `li:has-text("${salaryRange}")`,
          `.filterOption:has-text("${salaryRange}")`,
          // Try partial matches
          `label:has-text("15-25")`,
          `label:has-text("25-50")`,
          `text=15-25`,
          `text=25-50`,
        ];

        let salarySelected = false;
        for (const selector of salarySelectors) {
          try {
            const salaryElement = await page.$(selector);
            if (salaryElement) {
              const isVisible = await salaryElement.isVisible();
              if (isVisible) {
                // Check if it's a checkbox input
                const tagName = await salaryElement.evaluate((el) =>
                  el.tagName.toLowerCase()
                );
                if (tagName === "input") {
                  const isChecked = await salaryElement.isChecked();
                  if (!isChecked) {
                    await salaryElement.click();
                    salarySelected = true;
                    console.log(`✓ Selected salary: ${salaryRange}`);
                    await page.waitForTimeout(800);
                    break;
                  }
                } else {
                  // Click on label or text element
                  await salaryElement.click();
                  salarySelected = true;
                  console.log(`✓ Selected salary: ${salaryRange}`);
                  await page.waitForTimeout(800);
                  break;
                }
              }
            }
          } catch (e) {
            continue;
          }
        }

        if (!salarySelected) {
          console.log(`⚠ Could not find salary filter for: ${salaryRange}`);
        }
      } catch (e) {
        console.log(`Error selecting salary ${salaryRange}:`, e.message);
        continue;
      }
    }

    // Wait for filters to apply
    await page.waitForTimeout(2000);
    console.log("Salary filters applied");
  } catch (error) {
    console.error("Error applying salary filters:", error);
    // Continue even if salary filter fails
  }
}

// Apply freshness filter (Last 1 Day)
async function applyFreshnessFilter() {
  try {
    console.log("Applying freshness filter...");
    await page.waitForTimeout(1000);

    // Try to expand freshness/date posted filter if it's collapsed
    const freshnessExpandSelectors = [
      ".freshnessFilter",
      '[class*="freshness"]',
      '[class*="datePosted"]',
      "text=Date Posted",
      'button:has-text("Date Posted")',
      '.filter-title:has-text("Date")',
    ];

    for (const selector of freshnessExpandSelectors) {
      try {
        const expandBtn = await page.$(selector);
        if (expandBtn) {
          const isVisible = await expandBtn.isVisible();
          if (isVisible) {
            await expandBtn.click();
            await page.waitForTimeout(1000);
            break;
          }
        }
      } catch (e) {
        continue;
      }
    }

    const freshnessSelectors = [
      `label:has-text("${FRESHNESS}")`,
      `label:has-text("Last 1 Day")`,
      `input[value*="1"]`,
      `text=${FRESHNESS}`,
      `text=Last 1 Day`,
      `button:has-text("${FRESHNESS}")`,
      `button:has-text("Last 1 Day")`,
      `span:has-text("Last 1 Day")`,
      `li:has-text("Last 1 Day")`,
      `.filterOption:has-text("Last 1 Day")`,
      `[title*="Last 1 Day"]`,
    ];

    let freshnessSelected = false;
    for (const selector of freshnessSelectors) {
      try {
        const freshnessElement = await page.$(selector);
        if (freshnessElement) {
          const isVisible = await freshnessElement.isVisible();
          if (isVisible) {
            const tagName = await freshnessElement.evaluate((el) =>
              el.tagName.toLowerCase()
            );
            if (tagName === "input") {
              const isChecked = await freshnessElement.isChecked();
              if (!isChecked) {
                await freshnessElement.click();
                freshnessSelected = true;
                console.log(`✓ Selected freshness: ${FRESHNESS}`);
                await page.waitForTimeout(1000);
                break;
              }
            } else {
              await freshnessElement.click();
              freshnessSelected = true;
              console.log(`✓ Selected freshness: ${FRESHNESS}`);
              await page.waitForTimeout(1000);
              break;
            }
          }
        }
      } catch (e) {
        continue;
      }
    }

    if (!freshnessSelected) {
      console.log(`⚠ Could not find freshness filter for: ${FRESHNESS}`);
    } else {
      console.log("Freshness filter applied");
    }
  } catch (error) {
    console.error("Error applying freshness filter:", error);
    // Continue even if freshness filter fails
  }
}

// Sort by date — run on every page. Naukri: button#filter-sort opens ul[data-filter-id="sort"], then a[data-id="filter-sort-f"] (Date)
async function sortByDate() {
  try {
    console.log("Sorting by date...");
    await page.waitForTimeout(1500);

    // --- Naukri job list: button#filter-sort + a[data-id="filter-sort-f"] or li[title="Date"]
    try {
      const btn = page.locator("button#filter-sort").first();
      if (await btn.isVisible({ timeout: 2000 })) {
        await btn.click();
        await page.waitForTimeout(1000);
        const dateOpt = page
          .locator(
            'a[data-id="filter-sort-f"], li[title="Date"] a, ul[data-filter-id="sort"] li[title="Date"] a'
          )
          .first();
        if (await dateOpt.isVisible({ timeout: 1500 })) {
          await dateOpt.click();
          await page.waitForTimeout(2000);
          console.log("✓ Sorted by date (Naukri #filter-sort → Date)");
          return;
        }
        await page.keyboard.press("Escape");
      }
    } catch (_) {
      /* fall through */
    }

    // Generic: sort button/dropdown
    const sortSelectors = [
      '[class*="sortBy"]',
      '[class*="sort-by"]',
      'select[name*="sort"]',
      'select[id*="sort"]',
      '[class*="sort"] select',
      ".sortBy select",
      'button[class*="sort"]',
      'button:has-text("Sort")',
      'span:has-text("Sort by")',
      ".sort-dropdown",
      '[aria-label*="Sort"]',
    ];

    let sortElement = null;
    for (const selector of sortSelectors) {
      try {
        sortElement = await page.$(selector);
        if (sortElement) {
          const isVisible = await sortElement.isVisible();
          if (isVisible) {
            console.log(`Found sort element: ${selector}`);
            break;
          }
        }
      } catch (e) {
        continue;
      }
    }

    if (sortElement) {
      const tagName = await sortElement.evaluate((el) =>
        el.tagName.toLowerCase()
      );

      if (tagName === "select") {
        await sortElement.selectOption({ label: /Date|Most Recent|Recent/i });
        await page.waitForTimeout(2000);
        console.log("✓ Sorted by date (dropdown)");
      } else {
        await sortElement.click();
        await page.waitForTimeout(1500);

        const dateOptionSelectors = [
          'a[data-id="filter-sort-f"]',
          'li[title="Date"] a',
          "li:has-text('Date')",
          "text=Date",
          "text=Most Recent",
          'a:has-text("Date")',
          'a:has-text("Most Recent")',
          'li:has-text("Date")',
          'li:has-text("Most Recent")',
        ];

        for (const optionSelector of dateOptionSelectors) {
          try {
            const dateOption = await page.$(optionSelector);
            if (dateOption) {
              const isVisible = await dateOption.isVisible();
              if (isVisible) {
                await dateOption.click();
                await page.waitForTimeout(2000);
                console.log("✓ Sorted by date (button)");
                return;
              }
            }
          } catch (e) {
            continue;
          }
        }
      }
    } else {
      const directSortSelectors = [
        'button:has-text("Date")',
        'a:has-text("Date")',
        "text=Most Recent",
      ];

      for (const selector of directSortSelectors) {
        try {
          const sortBtn = await page.$(selector);
          if (sortBtn) {
            const isVisible = await sortBtn.isVisible();
            if (isVisible) {
              await sortBtn.click();
              await page.waitForTimeout(2000);
              console.log("✓ Sorted by date (direct)");
              return;
            }
          }
        } catch (e) {
          continue;
        }
      }
    }

    console.log("Sort by date applied (or no sort control found)");
  } catch (error) {
    console.error("Error sorting by date:", error);
  }
}

// Open pre-filtered search URL after login (job title, experience, salary, freshness are in the URL)
async function searchJobs() {
  try {
    console.log("Opening pre-filtered search URL...");

    await page.goto(PRE_FILTERED_SEARCH_URL, {
      waitUntil: "load",
      timeout: 60000,
    });
    await page.waitForTimeout(3000);

    // Dismiss cookie / overlay on results page if present
    for (const sel of [
      'button:has-text("Got it")',
      '[aria-label="Close"]',
      'button:has-text("Close")',
      ".cookie-close",
    ]) {
      try {
        const el = await page.$(sel);
        if (el && (await el.isVisible())) {
          await el.click();
          await page.waitForTimeout(800);
          break;
        }
      } catch (e) {
        /* ignore */
      }
    }

    await page.waitForLoadState("domcontentloaded");
    console.log("Waiting 10 sec for results to load...");
    await page.waitForTimeout(10000);
    await page.waitForTimeout(2000);

    console.log("Pre-filtered search loaded (filters are in the URL).");
    return true;
  } catch (error) {
    console.error("Error opening search URL:", error);
    throw error;
  }
}

// Extract job cards from current results page
// Naukri uses: div.cust-job-tuple, [class*="sjw__tuple"], .jobTuple, .jobCard, article, etc.
async function extractJobsFromPage() {
  return page.evaluate(() => {
    const getText = (el, sel) => {
      const n = el.querySelector(sel);
      return n ? n.textContent.trim() : "";
    };
    const getHref = (el, sel) => {
      const n = el.querySelector(sel);
      return n ? n.href || "" : "";
    };
    // Try Naukri's current and legacy card selectors (cust-job-tuple, sjw__tuple are used on list view)
    let cards = document.querySelectorAll(
      'div.cust-job-tuple, [class*="cust-job-tuple"], [class*="sjw__tuple"], ' +
      '.jobTuple, .jobCard, article.jobTuple, [class*="jobTuple"], [class*="jobCard"], ' +
      'article[class*="tuple"]'
    );
    // Fallback: find job links and use their card parent (article, [class*="tuple"], etc.)
    if (cards.length === 0) {
      const links = document.querySelectorAll(
        'a.title[href*="job-listings"], a[href*="job-listings"][class*="title"], a[href*="/job-listings/"]'
      );
      const seen = new Set();
      cards = Array.from(links)
        .map(
          (a) =>
            a.closest("article") ||
            a.closest("[class*='tuple']") ||
            a.closest("[class*='cust-job']") ||
            a.closest("[class*='job']") ||
            a.parentElement?.parentElement ||
            a.parentElement
        )
        .filter((c) => c && !seen.has(c) && (seen.add(c), true));
    }
    return Array.from(cards).map((card) => {
      const jobUrl =
        getHref(card, "a.title") ||
        getHref(card, 'a[href*="job-listings"]') ||
        getHref(card, 'a[href*="/job-listings/"]') ||
        getHref(card, ".jobTitle") ||
        "";
      const jobTitle =
        getText(card, "a.title") ||
        getText(card, ".jobTitle") ||
        getText(card, 'a[class*="title"]') ||
        "";
      const companyName =
        getText(card, ".comp-name") ||
        getText(card, '[class*="comp-name"]') ||
        getText(card, '[class*="company"]') ||
        "";
      const location =
        getText(card, "span.loc") ||
        getText(card, '[class*="location"]') ||
        getText(card, '[class*="loc"]') ||
        "";
      const experience =
        getText(card, "span.exp") ||
        getText(card, '[class*="experience"]') ||
        getText(card, '[class*="exp"]') ||
        "";
      const salary =
        getText(card, "span.sal") ||
        getText(card, '[class*="salary"]') ||
        getText(card, '[class*="sal"]') ||
        "";
      let skills = [];
      const tagEl = card.querySelector(
        ".tags, .tag-list, [class*='tag'], [class*='key-skill']"
      );
      if (tagEl) {
        const raw = tagEl.textContent.trim();
        if (raw)
          skills = raw
            .split(/[,|•]/)
            .map((s) => s.trim())
            .filter(Boolean);
      }
      const tagItems = card.querySelectorAll(
        "ul.tags li, ul.tag-list li, .tags span"
      );
      if (tagItems.length)
        skills = Array.from(tagItems)
          .map((e) => e.textContent.trim())
          .filter(Boolean);
      const posted =
        getText(card, "span.posted") ||
        getText(card, '[class*="posted"]') ||
        getText(card, '[class*="jobAge"]') ||
        getText(card, '[class*="date"]') ||
        "";
      const applied = card.innerText.includes("Applied");
      return {
        jobUrl,
        jobTitle,
        companyName,
        city: location,
        experience,
        salary,
        skills,
        posted,
        applied,
      };
    });
  });
}

// Extract emails from job description on the job detail page. Only posts emails when found in JD.
const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
async function extractEmailsFromJobDetail(page, jobUrl) {
  if (!jobUrl || !page) return [];
  const currentUrl = page.url();
  try {
    await page.goto(jobUrl, { waitUntil: "domcontentloaded", timeout: 8000 });
    await page.waitForTimeout(1500);
    const jdText = await page.evaluate(() => {
      const sel = [
        ".job-description",
        ".jd-desc",
        "[class*='jobDescription']",
        "[class*='job-desc']",
        "[class*='description']",
        ".job-details",
        ".detail-section",
        "article",
        ".jobDesc",
      ];
      for (const s of sel) {
        try {
          const el = document.querySelector(s);
          if (el) {
            const t = (el.textContent || "").trim();
            if (t.length > 100) return t;
          }
        } catch (_) { }
      }
      return document.body && document.body.innerText
        ? document.body.innerText.substring(0, 15000)
        : "";
    });
    const matches = (jdText || "").match(EMAIL_REGEX);
    const unique = matches
      ? [...new Set(matches.map((e) => e.trim().toLowerCase()))]
      : [];
    return unique;
  } catch (e) {
    return [];
  } finally {
    try {
      await page.goto(currentUrl, {
        waitUntil: "domcontentloaded",
        timeout: 10000,
      });
    } catch (_) {
      try {
        await page.goBack();
      } catch (_) { }
    }
  }
}

// Build API payload from extracted job (linkedin-leads format). emails only when found in job desc. companyName never empty so API always saves.
function buildLeadsPayload(extracted) {
  return {
    companyName:
      extracted.companyName && String(extracted.companyName).trim()
        ? String(extracted.companyName).trim()
        : "Unknown",
    jobTitle: extracted.jobTitle || "",
    city: extracted.city || "",
    HrName: "",
    emails:
      Array.isArray(extracted.emails) && extracted.emails.length
        ? extracted.emails
        : [],
    jobUrl: extracted.jobUrl || "",
    salary: extracted.salary || "",
    experience: extracted.experience || "",
    companyWebsite: "",
    skills: Array.isArray(extracted.skills) ? extracted.skills : [],
    source: "Naukri",
    applied: !!extracted.applied,
    timestamp: new Date().toISOString(),
  };
}

// POST one job to the leads API. When LEADS_API_KEY is set: X-API-Key (default) or Authorization: Bearer (LEADS_API_AUTH=bearer).
async function postJobToLeadsApi(payload) {
  try {
    const headers = { "Content-Type": "application/json" };
    if (LEADS_API_KEY) {
      if (LEADS_API_AUTH === "bearer")
        headers["Authorization"] = `Bearer ${LEADS_API_KEY}`;
      else headers["X-API-Key"] = LEADS_API_KEY;
    }
    const res = await fetch(LEADS_API_URL, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });
    let body = "";
    try {
      body = await res.text();
    } catch (_) {
      /* ignore */
    }
    if (!res.ok) {
      console.warn(`API POST failed: ${res.status} ${res.statusText}`);
      console.warn(`  URL: ${LEADS_API_URL}`);
      console.warn(`  Job: ${payload.jobTitle} @ ${payload.companyName}`);
      console.warn(`  Server response: ${body || "(empty)"}`);
      return false;
    }
    if (body)
      console.log(
        `API 200 response: ${body.substring(0, 200)}${body.length > 200 ? "..." : ""
        }`
      );
    console.log(`Posted: ${payload.jobTitle} @ ${payload.companyName}`);
    return true;
  } catch (e) {
    console.warn(`API POST error for ${payload.jobTitle}:`, e.message);
    if (e.cause) console.warn(`  cause:`, e.cause);
    return false;
  }
}

let _updateLeadSkippedLogged = false;
// PATCH/PUT to update lead's applied flag. Uses LEADS_UPDATE_API_URL if set, otherwise falls back to LEADS_API_URL.
async function updateLeadApplied(job, applied) {
  // Use the update URL if set, otherwise fallback to main API URL
  const apiUrl = LEADS_UPDATE_API_URL || LEADS_API_URL;

  if (!apiUrl) {
    if (!_updateLeadSkippedLogged) {
      _updateLeadSkippedLogged = true;
      console.log(
        "[updateLeadApplied] No API URL configured; skipping applied status update."
      );
    }
    return false;
  }

  try {
    const headers = { "Content-Type": "application/json" };
    if (LEADS_API_KEY) {
      if (LEADS_API_AUTH === "bearer")
        headers["Authorization"] = `Bearer ${LEADS_API_KEY}`;
      else headers["X-API-Key"] = LEADS_API_KEY;
    }

    // Payload with only jobUrl
    const payload = {
      jobUrl: job.jobUrl || "",
    };

    const body = JSON.stringify(payload);

    // Use PATCH for update URL, POST for main API URL
    const method = LEADS_UPDATE_API_URL ? "PATCH" : "POST";

    console.log(`[updateLeadApplied] Sending ${method} to ${apiUrl.substring(0, 50)}...`);
    console.log(`  Payload: jobUrl=${payload.jobUrl}`);

    const res = await fetch(apiUrl, {
      method,
      headers,
      body,
    });

    let responseBody = "";
    try {
      responseBody = await res.text();
    } catch (_) { }

    if (!res.ok) {
      console.warn(`[updateLeadApplied] ${method} failed: ${res.status} for ${job.jobTitle}`);
      console.warn(`  Response: ${responseBody.substring(0, 200)}`);
      return false;
    }

    console.log(`✅ [updateLeadApplied] Successfully sent jobUrl for ${job.jobTitle} @ ${job.companyName}`);
    if (responseBody) {
      console.log(`  Server response: ${responseBody.substring(0, 150)}${responseBody.length > 150 ? "..." : ""}`);
    }
    return true;
  } catch (e) {
    console.warn("[updateLeadApplied] Error:", e.message);
    return false;
  }
}

// Find and click the "Next" pagination button; returns true if clicked, false if no next page.
// currentPage: 1-based; we go to currentPage+1. searchUrl: use this for URL-based pagination (avoids using job-detail URL when still on a JD).
// Tries URL-based first (pageNo, page, -jobs-N), then clicking Next / page number.
async function clickNextPage(currentPage, searchUrl) {
  const nextPage = (currentPage || 1) + 1;
  // Prefer searchUrl so we never paginate from a job-detail URL (e.g. /job-listings-...)
  const url =
    searchUrl && typeof searchUrl === "string" && searchUrl.length > 0
      ? searchUrl
      : page.url();
  console.log(
    `Pagination: going to page ${nextPage} (url: ${url.substring(0, 80)}...)`
  );

  // --- 1) URL-based first. Naukri: -jobs-N in path, or pageNo/page in query.
  // Handle Naukri URL pattern: -jobs or -jobs-N (with or without query string)
  try {
    // Pattern 1: URL with query string (e.g., /node-js-jobs?k=node or /node-js-jobs-2?k=node)
    if (/-jobs-?\d*\?/.test(url)) {
      const nextUrl = url.replace(/-jobs-?\d*\?/, `-jobs-${nextPage}?`);
      if (nextUrl !== url) {
        await page.goto(nextUrl, { waitUntil: "load", timeout: 25000 });
        await page.waitForTimeout(3000);
        console.log(
          `Navigated to page ${nextPage} via URL (-jobs-${nextPage})`
        );
        return true;
      }
    }
    // Pattern 2: URL without query string, ends with -jobs or -jobs-N (e.g., /node-js-jobs or /node-js-jobs-2)
    else if (/-jobs(-\d+)?$/.test(url)) {
      // Replace -jobs or -jobs-N with -jobs-nextPage
      const nextUrl = url.replace(/-jobs(-\d+)?$/, `-jobs-${nextPage}`);
      if (nextUrl !== url) {
        await page.goto(nextUrl, { waitUntil: "load", timeout: 25000 });
        await page.waitForTimeout(3000);
        console.log(
          `Navigated to page ${nextPage} via URL (-jobs-${nextPage}, no query)`
        );
        return true;
      }
    }
    // Pattern 3: URL with location suffix like /node-jobs-in-bangalore or /node-jobs-in-bangalore-2
    else if (/-jobs-in-[a-z]+-?\d*(\?|$)/i.test(url)) {
      let nextUrl;
      if (url.includes('?')) {
        nextUrl = url.replace(/(-jobs-in-[a-z]+)-?\d*\?/i, `$1-${nextPage}?`);
      } else {
        nextUrl = url.replace(/(-jobs-in-[a-z]+)-?\d*$/i, `$1-${nextPage}`);
      }
      if (nextUrl !== url) {
        await page.goto(nextUrl, { waitUntil: "load", timeout: 25000 });
        await page.waitForTimeout(3000);
        console.log(
          `Navigated to page ${nextPage} via URL (location pattern)`
        );
        return true;
      }
    }
  } catch (e) {
    console.warn("-jobs-N URL failed:", e.message);
  }

  try {
    if (/[?&]pageNo=\d+/.test(url)) {
      const nextUrl = url.replace(/([?&])pageNo=\d+/, `$1pageNo=${nextPage}`);
      await page.goto(nextUrl, { waitUntil: "load", timeout: 25000 });
      await page.waitForTimeout(3000);
      console.log(`Navigated to page ${nextPage} via URL (pageNo=${nextPage})`);
      return true;
    }
    if (url.includes("?")) {
      await page.goto(`${url}&pageNo=${nextPage}`, {
        waitUntil: "load",
        timeout: 25000,
      });
    } else {
      await page.goto(`${url}?pageNo=${nextPage}`, {
        waitUntil: "load",
        timeout: 25000,
      });
    }
    await page.waitForTimeout(3000);
    console.log(`Navigated to page ${nextPage} via URL (pageNo=${nextPage})`);
    return true;
  } catch (e) {
    console.warn("pageNo URL failed:", e.message);
  }

  try {
    let nextUrl = "";
    if (/[?&]page=\d+/.test(url)) {
      nextUrl = url.replace(/([?&])page=\d+/, `$1page=${nextPage}`);
    } else if (url.includes("?")) {
      nextUrl = `${url}&page=${nextPage}`;
    } else {
      nextUrl = `${url}?page=${nextPage}`;
    }
    if (nextUrl && nextUrl !== url) {
      await page.goto(nextUrl, { waitUntil: "load", timeout: 25000 });
      await page.waitForTimeout(3000);
      console.log(`Navigated to page ${nextPage} via URL (page=${nextPage})`);
      return true;
    }
  } catch (e) {
    console.warn("page= URL failed:", e.message);
  }

  // --- 2) Scroll to bottom, then try clicking
  try {
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(800);
  } catch (_) { }

  // Try page number link first (e.g. "3" when on page 2)
  try {
    const pag = page.locator(
      '[class*="pagination"], #lastCompMark, nav[class*="Page"]'
    );
    const numLink = pag.locator(`a:has-text("${nextPage}")`).first();
    if (await numLink.isVisible({ timeout: 500 })) {
      await numLink.scrollIntoViewIfNeeded().catch(() => { });
      await numLink.click();
      await page.waitForTimeout(3000);
      console.log(`Clicked page number ${nextPage}`);
      return true;
    }
  } catch {
    /* ignore */
  }

  const nextSelectors = [
    "#lastCompMark > a:nth-child(4)",
    "#lastCompMark a",
    'a[rel="next"]',
    'a[title="Next"]',
    'nav[class*="pagination"] a:has-text("Next")',
    '[class*="pagination"] a:has-text("Next")',
    'a:has-text("Next")',
    'a:has-text("»")',
    'a:has-text(">")',
    'button:has-text("Next")',
  ];
  for (const sel of nextSelectors) {
    try {
      const btn = page.locator(sel).first();
      if (await btn.isVisible({ timeout: 500 })) {
        const isDisabled = await btn
          .getAttribute("aria-disabled")
          .then((a) => a === "true")
          .catch(() => false);
        if (isDisabled) continue;
        const tag = await btn.evaluate((e) => e.tagName).catch(() => "");
        if (tag === "SPAN") continue;
        await btn.scrollIntoViewIfNeeded().catch(() => { });
        await btn.click();
        await page.waitForTimeout(3000);
        console.log(
          `Clicked Next (selector: ${sel}); going to page ${nextPage}`
        );
        return true;
      }
    } catch {
      continue;
    }
  }

  // JS: find Next link in pagination and click
  try {
    const clicked = await page.evaluate((n) => {
      const p =
        document.querySelector('[class*="pagination"]') ||
        document.querySelector("#lastCompMark");
      if (!p) return false;
      for (const a of p.querySelectorAll("a[href]")) {
        const t = (a.textContent || "").trim();
        if (
          /^Next$|^»$|^>$/i.test(t) ||
          a.getAttribute("rel") === "next" ||
          t === String(n)
        ) {
          a.click();
          return true;
        }
      }
      return false;
    }, nextPage);
    if (clicked) {
      await page.waitForTimeout(3000);
      console.log(`Clicked Next via JS (page ${nextPage})`);
      return true;
    }
  } catch (_) { }

  console.log("No Next page found; finished pagination.");
  return false;
}

// Smart question-answering function that matches question text to appropriate answers
// Now accepts hasInput and hasRadio parameters to determine answer type
function getAnswerForQuestion(
  questionText,
  bodyText,
  cvDetails,
  hasInput = false,
  hasRadio = false
) {
  const q = questionText.toLowerCase();
  const body = bodyText.toLowerCase();
  const prof = cvDetails || {};

  // Experience years mapping
  const skillsWithYears = prof.skillsWithYears || {};
  const overallExp = prof.experienceYears || 5;
  const aiExp = 3; // AI skills experience (fallback for AI skills)

  // Helper function to get years for a skill (case-insensitive lookup with fallbacks)
  const getSkillYears = (skillKey, fallback = null) => {
    // Try exact match (case-insensitive)
    const keys = Object.keys(skillsWithYears);
    const matchedKey = keys.find(
      (k) => k.toLowerCase() === skillKey.toLowerCase()
    );
    if (matchedKey) return skillsWithYears[matchedKey];

    // Try partial match
    const partialMatch = keys.find(
      (k) =>
        skillKey.toLowerCase().includes(k.toLowerCase()) ||
        k.toLowerCase().includes(skillKey.toLowerCase())
    );
    if (partialMatch) return skillsWithYears[partialMatch];

    return fallback;
  };

  // 1. Experience questions - check for specific technologies first
  // Comprehensive list of all AI/ML and Software Development skills
  const techPatterns = [
    // ========== AI & Machine Learning Skills (30+ skills) ==========
    {
      pattern: /pytorch|py-torch/i,
      years: getSkillYears("pytorch") || getSkillYears("PyTorch") || aiExp,
    },
    {
      pattern: /tensorflow|tensor-flow/i,
      years:
        getSkillYears("tensorflow") || getSkillYears("TensorFlow") || aiExp,
    },
    {
      pattern: /machine learning|ml\b(?!\w)/i,
      years:
        getSkillYears("machine learning") ||
        getSkillYears("ml") ||
        getSkillYears("Machine Learning") ||
        aiExp,
    },
    {
      pattern: /deep learning/i,
      years:
        getSkillYears("deep learning") ||
        getSkillYears("Deep Learning") ||
        aiExp,
    },
    {
      pattern: /artificial intelligence|ai\b(?!\w)/i,
      years:
        getSkillYears("artificial intelligence") ||
        getSkillYears("ai") ||
        getSkillYears("Artificial Intelligence") ||
        aiExp,
    },
    {
      pattern: /aws bedrock|bedrock/i,
      years:
        getSkillYears("aws bedrock") ||
        getSkillYears("bedrock") ||
        getSkillYears("AWS Bedrock") ||
        aiExp,
    },
    {
      pattern: /aws nova|nova/i,
      years: getSkillYears("aws nova") || getSkillYears("AWS Nova") || aiExp,
    },
    {
      pattern: /vertex ai|vertex/i,
      years: getSkillYears("vertex ai") || getSkillYears("Vertex AI") || aiExp,
    },
    {
      pattern: /agentic ai|agentic/i,
      years:
        getSkillYears("agentic ai") || getSkillYears("Agentic AI") || aiExp,
    },
    {
      pattern: /generative ai|gen ai|genai/i,
      years:
        getSkillYears("generative ai") ||
        getSkillYears("gen ai") ||
        getSkillYears("Generative AI") ||
        aiExp,
    },
    {
      pattern: /llm|large language model/i,
      years:
        getSkillYears("llm") ||
        getSkillYears("LLM") ||
        getSkillYears("large language model") ||
        aiExp,
    },
    {
      pattern: /rag|retrieval augmented generation/i,
      years:
        getSkillYears("rag") ||
        getSkillYears("RAG") ||
        getSkillYears("retrieval augmented generation") ||
        aiExp,
    },
    {
      pattern: /nlp|natural language processing/i,
      years:
        getSkillYears("nlp") ||
        getSkillYears("NLP") ||
        getSkillYears("natural language processing") ||
        aiExp,
    },
    {
      pattern: /computer vision|cv\b(?!\w)/i,
      years:
        getSkillYears("computer vision") ||
        getSkillYears("Computer Vision") ||
        aiExp,
    },
    {
      pattern: /opencv|open-cv/i,
      years: getSkillYears("opencv") || getSkillYears("OpenCV") || aiExp,
    },
    {
      pattern: /keras/i,
      years: getSkillYears("keras") || getSkillYears("Keras") || aiExp,
    },
    {
      pattern: /scikit-learn|sklearn|scikit learn/i,
      years:
        getSkillYears("scikit-learn") ||
        getSkillYears("sklearn") ||
        getSkillYears("scikit learn") ||
        aiExp,
    },
    {
      pattern: /neural networks|neural network/i,
      years:
        getSkillYears("neural networks") ||
        getSkillYears("Neural Networks") ||
        aiExp,
    },
    {
      pattern: /transformers\b(?!\w)/i,
      years:
        getSkillYears("transformers") || getSkillYears("Transformers") || aiExp,
    },
    {
      pattern: /hugging face|huggingface/i,
      years:
        getSkillYears("hugging face") ||
        getSkillYears("huggingface") ||
        getSkillYears("Huggingface") ||
        aiExp,
    },
    {
      pattern: /langchain|lang-chain/i,
      years:
        getSkillYears("langchain") ||
        getSkillYears("LangChain") ||
        getSkillYears("langchain") ||
        aiExp,
    },
    {
      pattern: /langraph|lang-graph/i,
      years:
        getSkillYears("langraph") ||
        getSkillYears("LangGraph") ||
        getSkillYears("langraph") ||
        aiExp,
    },
    {
      pattern: /llama/i,
      years: getSkillYears("llama") || getSkillYears("Llama") || aiExp,
    },
    {
      pattern: /openai|open-ai/i,
      years: getSkillYears("openai") || getSkillYears("OpenAI") || aiExp,
    },
    {
      pattern: /chatgpt|chat-gpt/i,
      years: getSkillYears("chatgpt") || getSkillYears("ChatGPT") || aiExp,
    },
    {
      pattern: /gpt\b(?!\w)/i,
      years: getSkillYears("gpt") || getSkillYears("GPT") || aiExp,
    },
    {
      pattern: /anthropic/i,
      years: getSkillYears("anthropic") || getSkillYears("Anthropic") || aiExp,
    },
    {
      pattern: /claude/i,
      years: getSkillYears("claude") || getSkillYears("Claude") || aiExp,
    },
    {
      pattern: /stable diffusion|stable-diffusion/i,
      years:
        getSkillYears("stable diffusion") ||
        getSkillYears("Stable Diffusion") ||
        aiExp,
    },
    {
      pattern: /diffusion models|diffusion model/i,
      years:
        getSkillYears("diffusion models") ||
        getSkillYears("Diffusion Models") ||
        aiExp,
    },
    {
      pattern: /mlops|ml ops/i,
      years: getSkillYears("mlops") || getSkillYears("MLOps") || aiExp,
    },
    {
      pattern: /model deployment/i,
      years:
        getSkillYears("model deployment") ||
        getSkillYears("Model Deployment") ||
        aiExp,
    },
    {
      pattern: /sagemaker|sage-maker/i,
      years: getSkillYears("sagemaker") || getSkillYears("SageMaker") || aiExp,
    },
    {
      pattern: /azure ml|azureml|azure machine learning/i,
      years: getSkillYears("azure ml") || getSkillYears("Azure ML") || aiExp,
    },
    {
      pattern: /google ai|google-ai/i,
      years: getSkillYears("google ai") || getSkillYears("Google AI") || aiExp,
    },
    {
      pattern: /ai agents|ai-agents/i,
      years: getSkillYears("ai agents") || getSkillYears("AI Agents") || aiExp,
    },
    {
      pattern: /prompt engineering|prompt-engineering/i,
      years:
        getSkillYears("prompt engineering") ||
        getSkillYears("Prompt Engineering") ||
        aiExp,
    },
    {
      pattern: /fine-tuning|fine tuning/i,
      years:
        getSkillYears("fine-tuning") ||
        getSkillYears("fine tuning") ||
        getSkillYears("Fine-tuning") ||
        aiExp,
    },
    {
      pattern: /embedding/i,
      years: getSkillYears("embedding") || getSkillYears("Embedding") || aiExp,
    },
    {
      pattern: /vector database|vector db|vectordb/i,
      years:
        getSkillYears("vector database") ||
        getSkillYears("vector db") ||
        getSkillYears("Vector Database") ||
        aiExp,
    },
    {
      pattern: /pinecone/i,
      years: getSkillYears("pinecone") || getSkillYears("Pinecone") || aiExp,
    },
    {
      pattern: /weaviate/i,
      years: getSkillYears("weaviate") || getSkillYears("Weaviate") || aiExp,
    },
    {
      pattern: /chroma/i,
      years: getSkillYears("chroma") || getSkillYears("Chroma") || aiExp,
    },

    // ========== Software Development Skills (30+ skills) ==========
    {
      pattern: /react\b(?!\w)|reactjs|react\.js/i,
      years:
        getSkillYears("react") ||
        getSkillYears("reactjs") ||
        getSkillYears("react.js") ||
        getSkillYears("javascript") ||
        overallExp,
    },
    {
      pattern: /nextjs|next\.js|next js/i,
      years:
        getSkillYears("nextjs") ||
        getSkillYears("next.js") ||
        getSkillYears("next js") ||
        getSkillYears("react") ||
        overallExp,
    },
    {
      pattern: /node\b(?!\w)|nodejs|node\.js/i,
      years:
        getSkillYears("node") ||
        getSkillYears("nodejs") ||
        getSkillYears("node.js") ||
        getSkillYears("javascript") ||
        overallExp,
    },
    {
      pattern: /express\b(?!\w)|expressjs|express\.js/i,
      years:
        getSkillYears("express") ||
        getSkillYears("expressjs") ||
        getSkillYears("express.js") ||
        getSkillYears("node") ||
        overallExp,
    },
    {
      pattern: /nestjs|nest\.js|nest js/i,
      years:
        getSkillYears("nestjs") ||
        getSkillYears("nest.js") ||
        getSkillYears("NestJS") ||
        overallExp,
    },
    {
      pattern: /typescript|ts\b(?!\w)/i,
      years:
        getSkillYears("typescript") ||
        getSkillYears("ts") ||
        getSkillYears("TypeScript") ||
        overallExp,
    },
    {
      pattern: /javascript|js\b(?!\w)/i,
      years:
        getSkillYears("javascript") ||
        getSkillYears("js") ||
        getSkillYears("JavaScript") ||
        overallExp,
    },
    {
      pattern: /python\b(?!\w)/i,
      years: getSkillYears("python") || getSkillYears("Python") || overallExp,
    },
    {
      pattern: /django/i,
      years: getSkillYears("django") || getSkillYears("Django") || overallExp,
    },
    {
      pattern: /flask\b(?!\w)/i,
      years: getSkillYears("flask") || getSkillYears("Flask") || overallExp,
    },
    {
      pattern: /fastapi|fast-api/i,
      years: getSkillYears("fastapi") || getSkillYears("FastAPI") || overallExp,
    },
    {
      pattern: /mongodb|mongo-db|mongo/i,
      years:
        getSkillYears("mongodb") ||
        getSkillYears("mongo") ||
        getSkillYears("MongoDB") ||
        overallExp,
    },
    {
      pattern: /postgresql|postgres|postgres-sql/i,
      years:
        getSkillYears("postgresql") ||
        getSkillYears("postgres") ||
        getSkillYears("PostgreSQL") ||
        overallExp,
    },
    {
      pattern: /mysql|my-sql/i,
      years: getSkillYears("mysql") || getSkillYears("MySQL") || overallExp,
    },
    {
      pattern: /redis\b(?!\w)/i,
      years: getSkillYears("redis") || getSkillYears("Redis") || overallExp,
    },
    {
      pattern: /elasticsearch|elastic-search/i,
      years:
        getSkillYears("elasticsearch") ||
        getSkillYears("Elasticsearch") ||
        overallExp,
    },
    {
      pattern: /docker\b(?!\w)/i,
      years: getSkillYears("docker") || getSkillYears("Docker") || overallExp,
    },
    {
      pattern: /kubernetes|k8s|kube/i,
      years:
        getSkillYears("kubernetes") ||
        getSkillYears("k8s") ||
        getSkillYears("Kubernetes") ||
        overallExp,
    },
    {
      pattern: /aws\b(?!\w)|amazon web services/i,
      years:
        getSkillYears("aws") ||
        getSkillYears("amazon web services") ||
        getSkillYears("AWS") ||
        overallExp,
    },
    {
      pattern: /azure\b(?!\w)/i,
      years: getSkillYears("azure") || getSkillYears("Azure") || overallExp,
    },
    {
      pattern: /gcp\b(?!\w)|google cloud|google-cloud/i,
      years:
        getSkillYears("gcp") ||
        getSkillYears("google cloud") ||
        getSkillYears("Google Cloud") ||
        overallExp,
    },
    {
      pattern: /terraform/i,
      years:
        getSkillYears("terraform") || getSkillYears("Terraform") || overallExp,
    },
    {
      pattern: /jenkins\b(?!\w)/i,
      years: getSkillYears("jenkins") || getSkillYears("Jenkins") || overallExp,
    },
    {
      pattern: /github actions|github-actions/i,
      years:
        getSkillYears("github actions") ||
        getSkillYears("GitHub Actions") ||
        overallExp,
    },
    {
      pattern: /ci\/cd|ci cd|continuous integration/i,
      years: getSkillYears("ci/cd") || getSkillYears("CI/CD") || overallExp,
    },
    {
      pattern: /microservices|micro-services/i,
      years:
        getSkillYears("microservices") ||
        getSkillYears("Microservices") ||
        overallExp,
    },
    {
      pattern: /rest api|rest-api|restful/i,
      years:
        getSkillYears("rest api") ||
        getSkillYears("rest") ||
        getSkillYears("REST API") ||
        overallExp,
    },
    {
      pattern: /graphql|graph-ql/i,
      years: getSkillYears("graphql") || getSkillYears("GraphQL") || overallExp,
    },
    {
      pattern: /websocket|web-socket/i,
      years:
        getSkillYears("websocket") || getSkillYears("WebSocket") || overallExp,
    },
    {
      pattern: /rabbitmq|rabbit-mq/i,
      years:
        getSkillYears("rabbitmq") || getSkillYears("RabbitMQ") || overallExp,
    },
    {
      pattern: /kafka\b(?!\w)/i,
      years: getSkillYears("kafka") || getSkillYears("Kafka") || overallExp,
    },
    {
      pattern: /grpc|g-rpc/i,
      years: getSkillYears("grpc") || getSkillYears("gRPC") || overallExp,
    },
    {
      pattern: /nginx/i,
      years: getSkillYears("nginx") || getSkillYears("Nginx") || overallExp,
    },
    {
      pattern: /linux\b(?!\w)/i,
      years: getSkillYears("linux") || getSkillYears("Linux") || overallExp,
    },
    {
      pattern: /git\b(?!\w)/i,
      years: getSkillYears("git") || getSkillYears("Git") || overallExp,
    },
    {
      pattern: /tailwind|tailwindcss|tailwind-css/i,
      years:
        getSkillYears("tailwind") ||
        getSkillYears("tailwindcss") ||
        getSkillYears("Tailwind") ||
        overallExp,
    },
    {
      pattern: /sass\b(?!\w)|scss/i,
      years:
        getSkillYears("sass") ||
        getSkillYears("scss") ||
        getSkillYears("SASS") ||
        overallExp,
    },
    {
      pattern: /webpack\b(?!\w)/i,
      years: getSkillYears("webpack") || getSkillYears("Webpack") || overallExp,
    },
    {
      pattern: /vite\b(?!\w)/i,
      years: getSkillYears("vite") || getSkillYears("Vite") || overallExp,
    },

    // ========== Not Applicable Skills (return 0) ==========
    { pattern: /flutter\b(?!\w)/i, years: 0 }, // Not applicable
    { pattern: /\.net\b(?!\w)|dotnet|net core/i, years: 0 }, // Not applicable
    { pattern: /angular\b(?!\w)/i, years: 0 }, // Not applicable
  ];

  for (const tech of techPatterns) {
    if (
      tech.pattern.test(q) &&
      /years? of experience|experience do you have|years? of exp/i.test(q)
    ) {
      return { type: "text", value: String(tech.years) };
    }
  }

  // Total/overall experience
  if (
    /total.*years?.*exp|total experience|overall experience|years? exp\s*[:)]/i.test(
      q
    )
  ) {
    return { type: "text", value: String(overallExp) };
  }

  // FALLBACK: Generic experience questions that contain any skill/technology name
  // For questions like "How many years of experience do you have in [SKILL]?"
  if (/years? of experience|experience do you have|how many years/i.test(q)) {
    // Extract the skill/technology from the question
    const skillExtractPatterns = [
      /experience (?:do you have )?in (.+?)\?/i,
      /experience (?:do you have )?with (.+?)\?/i,
      /experience (?:do you have )?as (?:a )?(.+?)\?/i,
      /years? (?:of )?(?:experience )?in (.+?)\?/i,
    ];

    for (const pattern of skillExtractPatterns) {
      const match = q.match(pattern);
      if (match && match[1]) {
        const extractedSkill = match[1].trim().toLowerCase();

        // Check if extracted skill matches any known tech pattern
        for (const tech of techPatterns) {
          if (tech.pattern.test(extractedSkill)) {
            return { type: "text", value: String(tech.years) };
          }
        }

        // If skill not found in patterns, check skillsWithYears directly
        const skillYears = getSkillYears(extractedSkill);
        if (skillYears !== null) {
          return { type: "text", value: String(skillYears) };
        }
      }
    }

    // If no specific skill detected, return overall experience
    return { type: "text", value: String(overallExp) };
  }

  // 2. CTC questions - Handle CCTC (Current CTC) and ECTC (Expected CTC) abbreviations
  // CCTC = Current CTC → 13.5 LPA
  if (
    /\bcctc\b|current ctc|current salary|current annual salary|what is your cctc/i.test(
      q
    )
  ) {
    if (/range|which range/i.test(q)) {
      // Radio button: find the range that contains 13.5 LPA
      return { type: "radio", value: "10,00,000 - 15,00,000 INR" };
    }
    // Text input: return "13.5 LPA" for current CTC
    return { type: "text", value: prof.currentCTC || "13.5 LPA" };
  }

  // ECTC = Expected CTC → 18-20 LPA
  if (
    /\bectc\b|expected ctc|expected salary|expected annual salary|what is your ectc/i.test(
      q
    )
  ) {
    if (/range|which range/i.test(q)) {
      // Radio button: find the range that contains 18-20 LPA
      return { type: "radio", value: "15,00,000 - 20,00,000 INR" };
    }
    // Text input: return "18-20 LPA" for expected CTC range
    return { type: "text", value: prof.expectedCTCLacs || "18-20 LPA" };
  }

  // 3. Notice period - SMART HANDLING: can be radio OR text input
  if (/notice period/i.test(q)) {
    const notice = prof.noticePeriod || "15 Days or less";

    // PRIORITY: If radio buttons are available, ALWAYS use radio format
    if (hasRadio) {
      // Map to various radio formats
      const radioOptions = [
        "15 Days or less",
        "0-15 days",
        "15 days or less",
        "1 Month",
        "2 Months",
        "3 Months",
        "More than 3 Months",
        "Serving Notice Period",
      ];

      // Find the best match
      for (const option of radioOptions) {
        if (
          option.toLowerCase().includes(notice.toLowerCase()) ||
          notice.toLowerCase().includes(option.toLowerCase())
        ) {
          return { type: "radio", value: option };
        }
      }
      // Default to "15 Days or less" for radio
      return { type: "radio", value: "15 Days or less" };
    }

    // Only use text format if NO radio buttons are visible
    if (hasInput) {
      // Convert notice period to text format
      if (/15.*days?/i.test(notice)) {
        return { type: "text", value: "15 days" };
      } else if (/1.*month/i.test(notice)) {
        return { type: "text", value: "1 month" };
      } else if (/2.*months?/i.test(notice)) {
        return { type: "text", value: "2 months" };
      } else if (/3.*months?/i.test(notice)) {
        return { type: "text", value: "3 months" };
      }
      return { type: "text", value: "15 days" };
    }

    return { type: "radio", value: "15 Days or less" };
  }

  // 4. Location - Handle various location questions, ALWAYS answer "Noida"
  if (
    /current location|your location|where.*located|location.*city|preferred location|which city|which location|where do you|where are you/i.test(
      q
    )
  ) {
    // For radio buttons with cities, select based on priority: Noida > Gurugram > Mumbai
    if (hasRadio) {
      // These will be handled by the radio button click logic with city priority
      return { type: "radio", value: "Noida" };
    }
    // For text input, always return "Noida"
    return { type: "text", value: prof.currentLocation || "Noida" };
  }

  // 5. Date of Birth
  if (/date of birth|dob/i.test(q)) {
    return { type: "text", value: prof.dateOfBirth || "05-01-1998" };
  }

  // 6. Age range (based on DOB 05-01-1998 = 26 years old)
  if (/age range|select your age/i.test(q)) {
    return { type: "radio", value: "21 - 30" };
  }

  // 7. Work experience relevant to role
  if (
    /work experience.*relevant|relevant.*experience|experience.*relevant.*role/i.test(
      q
    )
  ) {
    // If radio buttons are available, use range
    if (hasRadio) {
      return { type: "radio", value: "2-6 years" };
    }
    // If only text input, use numeric value
    return { type: "text", value: String(overallExp) };
  }

  // 8. Eligible to work
  if (/eligible to work|eligible.*country/i.test(q)) {
    return { type: "radio", value: "Yes" };
  }

  // 9. Previously employed by [Company] - default to "No" unless specific
  if (/previously employed/i.test(q)) {
    // Most cases: No, but user said "most radio buttons select Yes"
    // However, for "Previously Employed by Cognizant" specifically, use "No"
    if (/cognizant/i.test(q)) {
      return { type: "radio", value: "No" };
    }
    return { type: "radio", value: "Yes" };
  }

  // 10. Relocate questions - ALWAYS answer Yes for any relocation/residing questions
  if (
    /willing to relocate|can relocate|relocate to|residing in|currently residing|willing to move/i.test(
      q
    )
  ) {
    // Always return "Yes" for relocation questions
    return { type: "radio", value: "Yes" };
  }

  // 10b. Questions about living/working in a specific location - answer Yes if has radio buttons
  if (
    /are you.*residing|are you.*located|are you.*based|do you.*live|can you.*work.*from/i.test(
      q
    ) &&
    hasRadio
  ) {
    return { type: "radio", value: "Yes" };
  }

  // 11. Last working day / joining date
  if (
    /last working day|when can you join|date of joining|when will you be able to join|expected date of joining/i.test(
      q
    )
  ) {
    const lastWorkingDate = getNextLastWorkingDate(
      prof.lastWorkingDayOfMonth || 15
    );
    return { type: "text", value: lastWorkingDate };
  }

  // 12. IMPORTANT: Check experience questions BEFORE generic Yes/No questions!
  // This prevents "How many years of experience do you have" from matching "do you"
  if (/experience|years?/i.test(q) && /how many|years?/i.test(q)) {
    return { type: "text", value: String(overallExp) };
  }

  // 13. Generic Yes/No questions - default to Yes (e.g., "Are you a Java Full stack Developer")
  // Check if question contains "Are you", "Do you", "Have you", "Can you", "Is your" and body has Yes/No options
  // BUT exclude experience questions (already handled above)
  if (
    /are you|do you|have you|can you|is your|are you a|are you an/i.test(q) &&
    /yes|no|radio-button|singleselect/i.test(body) &&
    !/how many.*years|years? of experience|experience.*years/i.test(q) // Exclude experience questions!
  ) {
    return { type: "radio", value: "Yes" };
  }

  // 13b. Catch questions like "Are you a [Technology] Developer" - always Yes
  // BUT exclude experience questions
  if (/are you a|are you an/i.test(q) && !/experience|years?/i.test(q)) {
    return { type: "radio", value: "Yes" };
  }

  // 14. Qualification questions
  if (/qualification/i.test(q)) {
    return { type: "text", value: "MCA, masters of computer applications" };
  }

  // 15. Location questions
  if (/location/i.test(q)) {
    return { type: "text", value: "Noida" };
  }

  // 15b. City selection for radio buttons with priority (Noida > Gurugram/Gurgaon > Mumbai)
  if (hasRadio && /city|location|residing/i.test(q)) {
    const cityPriority = ["Noida", "Gurugram", "Gurgaon", "Mumbai"];
    for (const city of cityPriority) {
      // Check if this city is present in the radio button options (body text)
      if (new RegExp(city, "i").test(body)) {
        return { type: "radio", value: city };
      }
    }
  }

  // 16. "Are you" questions (if not already handled)
  if (/are you/i.test(q)) {
    if (hasRadio) return { type: "radio", value: "Yes" };
    if (hasInput) return { type: "text", value: "Yes" };
  }

  // 17. Default fallback for any remaining experience questions
  if (/experience|years?/i.test(q)) {
    return { type: "text", value: String(overallExp) };
  }

  return null;
}

// Apply to a job. Call when on job detail page. Step-by-step with logging.
// Handles: job-alert overlay, chatbot, Apply, recruiter questions (notice, city, current/expected CTC, DOB, exp), loop until Save completes.
async function applyToJob(pg, job, cvDetails) {
  const jobTitle = job.jobTitle || "Unknown";
  const companyName = job.companyName || "Unknown";
  const prof = cvDetails || {};
  const notice = prof.noticePeriod || "15 Days or less";
  const cityChoice = prof.preferredCity || "Skip this question";
  const dob = prof.dateOfBirth || "05/01/1998";
  const expY = prof.experienceYears != null ? prof.experienceYears : 5;
  const curCtc =
    prof.currentCTC && /^\d+(\.\d+)?$/.test(String(prof.currentCTC).trim())
      ? String(prof.currentCTC).trim()
      : "Not Disclosed";
  const expCtc = prof.expectedCTCLacs || "25";
  const lastWorkingDayOfMonth =
    prof.lastWorkingDayOfMonth != null ? prof.lastWorkingDayOfMonth : 15;
  const lastWorkingDate = getNextLastWorkingDate(lastWorkingDayOfMonth);
  const willingToRelocate = ["Yes", "No", "Skip this question"].includes(
    prof.willingToRelocate
  )
    ? prof.willingToRelocate
    : "Yes";

  const log = (msg) => {
    console.log(`[Apply] ${msg}`);
  };
  let tryAgainAttempted = false;

  // Fill apply-modal text box (contenteditable or input).
  // Based on live testing: .pressSequentially() works perfectly for contenteditable divs!
  const fillTypeMessage = async (inp, value) => {
    const v = String(value).trim();
    try {
      log(`  -> [fillTypeMessage] Preparing to fill: "${v}" (Slow Mode)`);

      // Step 1: Click to focus
      log(`  -> [fillTypeMessage] Clicking center of input...`);
      const box = await inp.boundingBox();
      if (box) {
        await pg.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await pg.waitForTimeout(500);
        await pg.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      } else {
        await inp.click().catch(() => { });
      }
      await pg.waitForTimeout(1000);

      // Focus
      await inp.focus().catch(() => { });
      await pg.waitForTimeout(500);

      // Step 2: Clear field first
      log(`  -> [fillTypeMessage] Clearing existing content gently...`);
      const isContentEditable = await inp.evaluate(
        (el) =>
          el.isContentEditable || el.getAttribute("contenteditable") === "true"
      );

      await pg.keyboard.down("Control");
      await pg.waitForTimeout(300);
      await pg.keyboard.press("a");
      await pg.waitForTimeout(300);
      await pg.keyboard.up("Control");
      await pg.waitForTimeout(500);
      await pg.keyboard.press("Backspace");
      await pg.waitForTimeout(1000);

      // Step 3: Use pressSequentially() - slow typing
      log(`  -> [fillTypeMessage] Typing value character-by-character...`);
      await inp.pressSequentially(v, { delay: 150 });
      await pg.waitForTimeout(1500);

      // Step 4: Verify the value was set
      const actualValue = await inp
        .evaluate((el) => {
          if (
            el.isContentEditable ||
            el.getAttribute?.("contenteditable") === "true"
          ) {
            return (el.textContent || el.innerText || "").trim();
          }
          return (el.value || "").trim();
        })
        .catch(() => "");

      if (actualValue === v || actualValue.includes(v)) {
        log(
          `  -> [fillTypeMessage] ✅ SUCCESS! Value verified: "${actualValue}"`
        );
        return true;
      } else {
        log(
          `  -> [fillTypeMessage] ⚠️ WARNING: Expected "${v}", got "${actualValue}". Using direct evaluate set...`
        );
        await inp.evaluate((el, val) => {
          if (el.isContentEditable) el.innerText = val;
          else el.value = val;
          el.dispatchEvent(new Event("input", { bubbles: true }));
          el.dispatchEvent(new Event("change", { bubbles: true }));
        }, v);
        await pg.waitForTimeout(1000);
        return true;
      }
    } catch (e) {
      log(`  -> [fillTypeMessage] ❌ Error: ${e.message}`);
      return false;
    }
  };

  // Prefer modal Save; avoid header "Save job" (class*="save-job"). Verified: modal Save structure:
  // div.sendMsgbtn_container > div.send (removes "disabled" class when enabled) > div.sendMsg (clickable)
  // Wait for Save to become enabled after answering (poll until .send.disabled becomes .send).
  const clickSave = async () => {
    log(`  -> [Save Button] Waiting for Save button to become enabled...`);

    // Wait for Save button to become enabled (poll up to 5 seconds - increased from 3)
    let saveEnabled = false;
    for (let i = 0; i < 10; i++) {
      await pg.waitForTimeout(500);
      const enabled = await pg.evaluate(() => {
        const sendDiv = document.querySelector(
          ".sendMsgbtn_container .send:not(.disabled)"
        );
        return sendDiv !== null;
      });
      if (enabled) {
        saveEnabled = true;
        log(`  -> [Save Button] Enabled after ${(i + 1) * 500}ms`);
        break;
      }
    }
    if (!saveEnabled) {
      log(
        `  -> [Save Button] Not confirmed enabled after 5s, will try to click anyway...`
      );
      await pg.waitForTimeout(500);
    }

    // Try selectors in order: prefer modal Save (sendMsg) over header Save
    log(
      `  -> [Save Button] Looking for Save button with multiple selectors...`
    );
    const saveSelectors = [
      ".chatbot_DrawerContentWrapper div.sendMsgbtn_container .send:not(.disabled) .sendMsg",
      ".chatbot_DrawerContentWrapper div.sendMsgbtn_container .sendMsg:not(.disabled)",
      ".chatbot_DrawerContentWrapper div.send:not(.disabled) .sendMsg",
      '.chatbot_DrawerContentWrapper div.sendMsg:has-text("Save")',
      "div.sendMsgbtn_container .send:not(.disabled) .sendMsg",
      "div.sendMsgbtn_container .sendMsg:not(.disabled)",
      "div.send:not(.disabled) .sendMsg",
      'div.sendMsg:has-text("Save")',
      'div.sendMsgbtn_container:has-text("Save") .sendMsg',
      'button:has-text("Save"):not([class*="save-job"]):not([disabled])',
      '[role="button"]:has-text("Save"):not([class*="save-job"]):not([disabled])',
      'div.send:has-text("Save"):not(.disabled)',
      'div:has-text("Save"):not([class*="save-job"])',
      'span:has-text("Save")',
      'button:has-text("Save"):not([disabled])',
      'generic:has-text("Save")', // Added from live testing - contenteditable saves use generic elements
    ];

    for (const sel of saveSelectors) {
      try {
        const b = pg.locator(sel).first();
        if (await b.isVisible({ timeout: 1500 }).catch(() => false)) {
          // Check if disabled (for elements that might have disabled state)
          const isDisabled = await b
            .evaluate((el) => {
              return (
                el.getAttribute("disabled") !== null ||
                el.getAttribute("aria-disabled") === "true" ||
                el.classList.contains("disabled") ||
                (el.closest(".send") &&
                  el.closest(".send").classList.contains("disabled"))
              );
            })
            .catch(() => false);
          if (!isDisabled) {
            log(`  -> [Save Button] Found using selector: ${sel}`);
            await b.scrollIntoViewIfNeeded().catch(() => { });

            // DELIBERATE CLICK
            log(`  -> [Save Button] Clicking in 2 seconds (Slow Mode)...`);
            await pg.waitForTimeout(2000);

            // Hover before click to ensure it's "ready"
            const saveBox = await b.boundingBox();
            if (saveBox) {
              await pg.mouse.move(
                saveBox.x + saveBox.width / 2,
                saveBox.y + saveBox.height / 2
              );
              await pg.waitForTimeout(500);
              await pg.mouse.click(
                saveBox.x + saveBox.width / 2,
                saveBox.y + saveBox.height / 2
              );
            } else {
              await b.click({ force: true });
            }

            log(`  -> ✅ [Save Button] Clicked successfully!`);
            log(
              `  -> [Save] Waiting 5 seconds for save to process and next question to load (Slow Mode)...`
            );
            await pg.waitForTimeout(5000); // Increased wait
            return true;
          }
        }
      } catch (_) { }
    }

    // Final fallback: find Save text and click its parent if it's in the modal
    log(
      `  -> [Save Button] Trying fallback: clicking any "Save" text element...`
    );
    try {
      const saveText = pg
        .getByText("Save", { exact: true })
        .filter({ hasNot: pg.locator('[class*="save-job"]') })
        .first();
      if (await saveText.isVisible({ timeout: 800 }).catch(() => false)) {
        const isDisabled = await saveText
          .evaluate((el) => {
            return el.closest(".send")?.classList.contains("disabled") || false;
          })
          .catch(() => false);
        if (!isDisabled) {
          log(`  -> [Save Button] Found via text search`);
          await saveText.scrollIntoViewIfNeeded().catch(() => { });
          await saveText.click();
          log(`  -> ✅ [Save Button] Clicked successfully!`);
          log(
            `  -> [Save] Waiting 3 seconds for save to process and next question to load...`
          );
          await pg.waitForTimeout(3000); // Increased from 1s to 3s for multi-question jobs
          return true;
        }
      }
    } catch (_) { }

    log(
      `  -> ❌ [Save Button] Could not find enabled Save button with any selector`
    );
    return false;
  };

  try {
    log(`Start: ${jobTitle} @ ${companyName}`);
    log(`[INFO] ULTRA SLOW & STABLE MODE ACTIVE`);

    // Skip if already applied (button text or nearby)
    const bodyText = await pg
      .evaluate(() => document.body.innerText)
      .catch(() => "");
    if (
      /Applied\s*$/m.test(bodyText) ||
      (await pg
        .locator('button:has-text("Applied")')
        .isVisible()
        .catch(() => false))
    ) {
      log("Already applied, skip.");
      return true;
    }

    // Step 0: Dismiss "Enter your Email ID to get job alerts" overlay (can block Apply)
    log("Step 0: dismiss job-alert overlay if present");
    try {
      if (
        (await pg
          .locator("text=Enter your Email ID to get job alerts")
          .isVisible({ timeout: 600 })
          .catch(() => false)) ||
        (await pg
          .locator("text=Create job alert")
          .isVisible({ timeout: 400 })
          .catch(() => false))
      ) {
        await pg
          .locator('button:has-text("Cancel")')
          .first()
          .click({ timeout: 800 })
          .catch(() => { });
        await pg.waitForTimeout(500);
      }
    } catch (_) { }

    // Step 1: Hide Naukri chatbot overlay (blocks Apply click)
    log("Step 1: hide chatbot overlay (carefully)");
    await pg
      .evaluate(() => {
        [
          ".chatbot_Overlay",
          "[class*='chatbot_Overlay']",
          "[id*='ChatbotContainer']",
          // Removed broad "[class*='chatbot']" as it might hit the actual application modal
        ].forEach((sel) => {
          document.querySelectorAll(sel).forEach((el) => {
            // Only remove if it's NOT the drawer/modal we want
            if (
              !el.classList.contains("chatbot_DrawerContentWrapper") &&
              !el.closest(".chatbot_DrawerContentWrapper")
            ) {
              el.style.display = "none";
              el.remove?.();
            }
          });
        });
      })
      .catch(() => { });

    // Step 2: Click Apply, wait 3s for modal (scroll into view; job-alert can block)
    log("Step 2: Looking for Apply button...");
    // Verified on Naukri: #apply-button, .apply-button on JD page. Some jobs use "I am interested" instead of "Apply".
    const applySelectors = [
      "#apply-button",
      "button.apply-button",
      "#walkin-button",
      '[class*="apply-button"]',
      'button:has-text("Apply")',
      'button:has-text("I am interested")',
      'a:has-text("Apply")',
      'main button:has-text("Apply")',
    ];
    let clicked = false;
    let usedSelector = "";
    for (const sel of applySelectors) {
      try {
        const btn = pg.locator(sel).first();
        if (await btn.isVisible({ timeout: 600 }).catch(() => false)) {
          log(`  -> [Apply Button] Found using selector: ${sel}`);
          await btn.scrollIntoViewIfNeeded().catch(() => { });
          log(`  -> [Apply Button] Clicking in 2 seconds (Slow Mode)...`);
          await pg.waitForTimeout(2000);
          await btn.click();
          clicked = true;
          usedSelector = sel;
          log(`  -> [Apply Button] ✅ Clicked successfully!`);
          break;
        }
      } catch (_) { }
    }
    if (!clicked) {
      log("❌ Apply button not found with any selector.");
      return false;
    }
    log(
      "  -> [Apply Modal] Waiting 8 seconds for modal to appear (Slow Mode)..."
    );
    await pg.waitForTimeout(8000);
    log("  -> [Apply Modal] Wait complete. Checking for modal...");

    // Step 3: Loop over recruiter questions (notice, city, current/expected CTC, DOB, exp). Each: answer then Save. Max 30.
    log("Step 3: Starting question-answering loop (max 30 iterations)");
    log(
      "  -> [Loop Info] Will answer questions until 'thank you for your response' appears"
    );
    let iter = 0;
    const maxIter = 30; // Increased for Slow Mode stability
    let failedToAnswerCount = 0; // Track how many questions we failed to answer
    let questionsAnsweredCount = 0; // Track how many questions we successfully answered
    let thankYouReceived = false; // CRITICAL: Track if "thank you for your response" was received
    let redirectedToSaveApply = false; // Track if redirected to success page

    // CRITICAL: Prevent any "Close" or "Cancel" button clicks that might close the modal
    // We override the click function for these buttons if they are inside the modal
    const disableCloseButtons = async () => {
      await pg
        .evaluate(() => {
          const modalSelectors = [
            ".chatbot_DrawerContentWrapper",
            "[class*='chatbot_DrawerContentWrapper']",
            "[class*='DrawerContentWrapper']",
            "[class*='chatbot']",
            "[class*='drawer']",
            "[class*='modal']",
            "[role='dialog']",
          ];

          // Find the modal
          let modal = null;
          for (const sel of modalSelectors) {
            modal = document.querySelector(sel);
            if (modal) break;
          }

          if (modal) {
            // Target specific button-like elements that are likely close buttons
            // Avoid targeting large structural elements like DIVs unless necessary
            const elements = modal.querySelectorAll(
              'button, [role="button"], .SSRC__close, [class*="close"], [class*="cancel"]'
            );
            elements.forEach((btn) => {
              const text = (btn.textContent || btn.innerText || "")
                .toLowerCase()
                .trim();
              const ariaLabel = (
                btn.getAttribute("aria-label") || ""
              ).toLowerCase();

              const isCloseText =
                text === "x" || text === "close" || text === "cancel";
              const isCloseAria =
                ariaLabel.includes("close") || ariaLabel.includes("cancel");

              if (isCloseText || isCloseAria) {
                // Only disable if it's NOT a Save or Apply button
                if (!text.includes("save") && !text.includes("apply")) {
                  btn.style.opacity = "0.3"; // Visual indicator it's disabled
                  btn.style.pointerEvents = "none"; // Make them non-clickable
                  btn.onclick = (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    return false;
                  };
                }
              }
            });
          }
        })
        .catch(() => { });
    };

    await disableCloseButtons();

    while (iter < maxIter) {
      log(
        `  -> [Iteration ${iter + 1
        }/${maxIter}] Checking for questions or completion...`
      );

      // Re-disable close buttons in each iteration to catch any new ones
      await disableCloseButtons();

      // Check if redirected to success page
      if (pg.url().includes("/myapply/saveApply")) {
        log(
          "  -> ✅ [Success] Redirected to saveApply page - application complete!"
        );
        redirectedToSaveApply = true;
        break;
      }

      // Wait a bit longer for next question to load (important for 4-5+ question jobs)
      log(
        `  -> [Wait] Waiting 5 seconds before checking next question (Slow Mode)...`
      );
      await pg.waitForTimeout(5000);

      const body = await pg
        .evaluate(() => document.body.innerText)
        .catch(() => "");

      // CRITICAL: Check for "thank you for your response" - THIS IS THE ONLY TRUE SUCCESS INDICATOR
      // When this message appears, it means ALL questions have been answered successfully
      if (
        /thank you for your response|thank you for response|thanks for your response/i.test(
          body
        )
      ) {
        log(
          "  -> ✅ [SUCCESS CONFIRMED] 'Thank you for your response' detected!"
        );
        log("  -> [Info] All questions answered. Application is SUCCESSFUL!");
        thankYouReceived = true; // SET THE SUCCESS FLAG

        log("  -> [Info] Waiting for modal to auto-close and redirect...");
        await pg.waitForTimeout(4000); // Wait for modal to close and redirect

        // Check if redirected after thank you message
        if (pg.url().includes("/myapply/saveApply")) {
          log("  -> ✅ [Success] Redirected to saveApply page!");
          redirectedToSaveApply = true;
        }
        break;
      }

      // Check if modal/questions are visible - ENHANCED with multiple selectors
      const modalInfo = await pg
        .evaluate(() => {
          // Try multiple modal selectors (Naukri changes their class names)
          const modalSelectors = [
            ".chatbot_DrawerContentWrapper",
            "[class*='chatbot_DrawerContentWrapper']",
            "[class*='DrawerContentWrapper']",
            "[class*='chatbot']",
            "[class*='drawer']",
            "[class*='modal']",
            "[class*='Modal']",
            ".drawer",
            "[role='dialog']",
            "[role='alertdialog']",
            // Sometimes the modal is just a div with inputs
            "div:has(input[type='radio'])",
            "div:has([contenteditable='true'])",
          ];

          let modal = null;
          let foundSelector = "";
          for (const selector of modalSelectors) {
            try {
              const el = document.querySelector(selector);
              if (el) {
                modal = el;
                foundSelector = selector;
                break;
              }
            } catch (e) {
              continue;
            }
          }

          // If modal wrapper not found, check if inputs/radios/checkboxes exist anywhere on page
          if (!modal) {
            // Check for inputs/radios/checkboxes directly
            const hasInputDirect =
              document.querySelectorAll(
                '[contenteditable="true"], input[type="text"], input[type="number"]'
              ).length > 0;
            const hasRadioDirect =
              document.querySelectorAll('input[type="radio"]').length > 0;
            // More comprehensive checkbox detection for Naukri
            const hasCheckboxDirect =
              document.querySelectorAll('input[type="checkbox"], .mcc__checkbox, input[data-val="multiselect"]').length > 0;

            // If inputs, radios, or checkboxes found, consider modal "visible"
            if (hasInputDirect || hasRadioDirect || hasCheckboxDirect) {
              return {
                visible: true,
                hasInput: hasInputDirect,
                hasRadio: hasRadioDirect,
                hasCheckbox: hasCheckboxDirect,
                foundVia:
                  "direct input/radio/checkbox search (no modal wrapper found)",
              };
            }

            return {
              visible: false,
              hasInput: false,
              hasRadio: false,
              hasCheckbox: false,
              foundVia: "not found",
            };
          }

          // Modal found via selector - check if visible
          const style = window.getComputedStyle(modal);
          const isVisible =
            style.display !== "none" &&
            style.visibility !== "hidden" &&
            modal.offsetParent !== null;

          if (!isVisible) {
            // Even if modal wrapper is hidden, check for inputs
            const hasInputDirect =
              document.querySelectorAll(
                '[contenteditable="true"], input[type="text"], input[type="number"]'
              ).length > 0;
            const hasRadioDirect =
              document.querySelectorAll('input[type="radio"]').length > 0;
            // More comprehensive checkbox detection for Naukri
            const hasCheckboxDirect =
              document.querySelectorAll('input[type="checkbox"], .mcc__checkbox, input[data-val="multiselect"]').length > 0;

            if (hasInputDirect || hasRadioDirect || hasCheckboxDirect) {
              return {
                visible: true,
                hasInput: hasInputDirect,
                hasRadio: hasRadioDirect,
                hasCheckbox: hasCheckboxDirect,
                foundVia: "inputs found despite modal hidden",
              };
            }

            return {
              visible: false,
              hasInput: false,
              hasRadio: false,
              hasCheckbox: false,
              foundVia: `modal found (${foundSelector}) but hidden`,
            };
          }

          // Check for inputs/radios/checkboxes in modal - ONLY VISIBLE ONES
          const allInputs = Array.from(
            modal.querySelectorAll(
              '[contenteditable="true"], input[type="text"], input[type="number"]'
            )
          );
          const hasInput = allInputs.some((el) => {
            const style = window.getComputedStyle(el);
            return (
              style.display !== "none" &&
              style.visibility !== "hidden" &&
              el.offsetParent !== null
            );
          });

          const allRadios = Array.from(
            modal.querySelectorAll('input[type="radio"]')
          );
          const hasRadio = allRadios.some((el) => {
            const style = window.getComputedStyle(el);
            return (
              style.display !== "none" &&
              style.visibility !== "hidden" &&
              el.offsetParent !== null
            );
          });

          // Check for checkboxes (multi-select) - More lenient detection for Naukri's custom styled checkboxes
          // Naukri uses custom checkbox styling where the actual input might be visually hidden
          const checkboxSelectors = [
            'input[type="checkbox"]',
            '.mcc__checkbox',
            'input[data-val="multiselect"]',
            '.multicheckboxes-container input',
            '.multiselectcheckboxes input',
          ];

          let hasCheckbox = false;
          for (const selector of checkboxSelectors) {
            const checkboxes = modal.querySelectorAll(selector);
            if (checkboxes.length > 0) {
              // Check if the container is visible (not the individual checkbox)
              for (const cb of checkboxes) {
                const container = cb.closest('.multicheckboxes-container') ||
                  cb.closest('.multiselectcheckboxes') ||
                  cb.parentElement;
                if (container) {
                  const containerStyle = window.getComputedStyle(container);
                  if (containerStyle.display !== 'none' && containerStyle.visibility !== 'hidden') {
                    hasCheckbox = true;
                    break;
                  }
                }
                // Fallback: if checkbox itself exists and is not display:none
                const cbStyle = window.getComputedStyle(cb);
                if (cbStyle.display !== 'none') {
                  hasCheckbox = true;
                  break;
                }
              }
              if (hasCheckbox) break;
            }
          }

          return {
            visible: true,
            hasInput,
            hasRadio,
            hasCheckbox,
            foundVia: foundSelector,
          };
        })
        .catch(() => ({
          visible: false,
          hasInput: false,
          hasRadio: false,
          hasCheckbox: false,
          foundVia: "error",
        }));

      log(
        `  -> [Modal Check] Visible: ${modalInfo.visible}, Has Input: ${modalInfo.hasInput
        }, Has Radio: ${modalInfo.hasRadio}, Has Checkbox: ${modalInfo.hasCheckbox || false
        }`
      );
      log(`  -> [Modal Detection] Method: ${modalInfo.foundVia || "unknown"}`);

      // If modal is not visible AND no inputs/radios found
      if (!modalInfo.visible && !modalInfo.hasInput && !modalInfo.hasRadio) {
        // Double-check with text patterns (modal might be in transition)
        const hasQuestionText =
          /Kindly answer|Type message here|recruiter's questions|What is your|Please select|relocate|How many years of experience|years of exp|residing|willing to relocate|Something went wrong|Try again|Are you|Do you|radio-button|Yes.*No|No.*Yes/i.test(
            body
          );

        if (!hasQuestionText) {
          // CRITICAL: NEVER CLOSE THE MODAL MANUALLY.
          // We wait for "Thank you for your response" or a redirect.
          log(
            "  -> [Wait] Modal/Inputs not detected. Waiting 15s for 'Thank you' or Next Question (Slow Mode)..."
          );
          await pg.waitForTimeout(15000); // Increased wait to 15s

          const bodyRetry = await pg
            .evaluate(() => document.body.innerText)
            .catch(() => "");
          const isSuccess =
            /thank you for your response|thanks for your response|successfully applied/i.test(
              bodyRetry
            );
          const hasQuestionTextRetry =
            /Kindly answer|Type message here|recruiter's questions|What is your|Please select|relocate|How many years of experience|years of exp|residing|willing to relocate|Something went wrong|Try again|Are you|Do you|radio-button|Yes.*No|No.*Yes/i.test(
              bodyRetry
            );

          if (isSuccess) {
            log(
              "  -> ✅ [SUCCESS] 'Thank you for your response' detected! Modal will auto-close."
            );
            thankYouReceived = true;
            break;
          } else if (hasQuestionTextRetry) {
            log("  -> [Action] Question text reappeared, continuing loop...");
            iter++;
            continue;
          } else {
            // Final check for redirect before giving up
            if (pg.url().includes("/myapply/saveApply")) {
              log("  -> ✅ [SUCCESS] Redirected to success page!");
              redirectedToSaveApply = true;
              break;
            }

            // NEW: Check if we are still on the job page and the apply button is gone
            // This might mean it's processing in the background
            const stillOnJobPage =
              pg.url().includes("/job-listings/") ||
              pg.url().includes("/viewjob/");
            const applyButtonVisible = await pg
              .locator('button:has-text("Apply"), button:has-text("Applied")')
              .first()
              .isVisible()
              .catch(() => false);

            if (stillOnJobPage && !applyButtonVisible) {
              log(
                "  -> [Wait] Still on job page but Apply button is gone. Waiting 10s for background process (Slow Mode)..."
              );
              await pg.waitForTimeout(10000);
              iter++;
              continue;
            }

            log(
              "  -> ⚠️ [Warning] Still no modal or success message. Retrying loop (Iteration " +
              (iter + 1) +
              ")..."
            );
            iter++;
            continue; // Keep looping, NEVER break unless success or max iterations
          }
        } else {
          log(
            "  -> ⚠️ [Warning] Question text found but no inputs/radios detected!"
          );
          log("  -> [Debug] Logging page state for debugging...");

          // Log what's actually on the page to help debug
          const debugInfo = await pg
            .evaluate(() => {
              const allInputs = Array.from(
                document.querySelectorAll('input, [contenteditable="true"]')
              );
              const allRadios = Array.from(
                document.querySelectorAll('input[type="radio"]')
              );
              const modals = Array.from(
                document.querySelectorAll(
                  '[class*="modal"], [class*="Modal"], [class*="drawer"], [class*="Drawer"], [class*="chatbot"]'
                )
              );

              return {
                totalInputs: allInputs.length,
                totalRadios: allRadios.length,
                totalModals: modals.length,
                modalClasses: modals.map((m) => m.className).join(", "),
                inputTypes: allInputs.slice(0, 5).map((i) => ({
                  type: i.type || "contenteditable",
                  visible: i.offsetParent !== null,
                  placeholder:
                    i.placeholder || i.getAttribute("data-placeholder") || "",
                })),
              };
            })
            .catch(() => ({}));

          log(
            `  -> [Debug] Page has ${debugInfo.totalInputs || 0} inputs, ${debugInfo.totalRadios || 0
            } radios, ${debugInfo.totalModals || 0} modal-like elements`
          );
          log(
            `  -> [Debug] Modal classes found: ${debugInfo.modalClasses || "none"
            }`
          );

          // Wait longer and try again (modal might be loading)
          log(
            "  -> [Action] Waiting 3 more seconds for modal to fully load..."
          );
          await pg.waitForTimeout(3000);
          iter++;
          continue;
        }
      }

      log(
        `  -> [Question Detection] Modal/questions present (via ${modalInfo.foundVia}), proceeding to answer...`
      );

      // Handle "Something went wrong. Please Try again later" — click Try again once, else fail
      if (/Something went wrong|Please Try again later/i.test(body)) {
        if (!tryAgainAttempted) {
          log("  -> Something went wrong; clicking Try again once.");
          try {
            const tryBtn = pg.getByText("Try again").first();
            if (await tryBtn.isVisible({ timeout: 800 }).catch(() => false)) {
              await tryBtn.click();
              tryAgainAttempted = true;
              await pg.waitForTimeout(3000); // Increased wait
              iter++;
              continue;
            }
          } catch (_) { }
        }
        log(
          "  -> Something went wrong persisted after Try again; waiting 5s before retrying loop..."
        );
        await pg.waitForTimeout(5000);
        iter++;
        continue; // Don't return false, try the loop again
      }

      // Extract current question text from modal - ENHANCED to search entire document if modal not found
      const questionInfo = await pg
        .evaluate(() => {
          // Try to find modal with multiple selectors
          const modalSelectors = [
            ".chatbot_DrawerContentWrapper",
            '[class*="chatbot_DrawerContentWrapper"]',
            '[class*="DrawerContentWrapper"]',
            '[class*="chatbot"]',
            '[class*="drawer"]',
            '[class*="modal"]',
            '[role="dialog"]',
            '[role="alertdialog"]',
          ];

          let modal = null;
          for (const selector of modalSelectors) {
            try {
              modal = document.querySelector(selector);
              if (modal) break;
            } catch (e) {
              continue;
            }
          }

          // If no modal found, search entire document
          const searchContext = modal || document.body;
          const contextName = modal ? "modal" : "entire document";

          // Get all bot messages/questions
          const botMsgSelectors = [
            '.botMsg, .botItem, [class*="botMsg"], [class*="botItem"]',
            '[class*="message"]',
            '[class*="question"]',
            'div[class*="text"]',
          ];

          let botMsgs = [];
          for (const selector of botMsgSelectors) {
            botMsgs = Array.from(searchContext.querySelectorAll(selector));
            if (botMsgs.length > 0) break;
          }

          // Get the last bot message (current question) - skip greeting messages
          let currentQuestion = "";
          for (let i = botMsgs.length - 1; i >= 0; i--) {
            const msg = botMsgs[i];
            const text = msg.textContent.trim();
            // Skip greeting messages
            if (
              text &&
              text.length > 3 && // Reduced from 10 to catch short skill names like "node.js", "MySQL"
              !text.includes("Hi ") &&
              !text.includes("thank you for showing interest") &&
              !text.includes("thank you for your response") &&
              !text.includes("Kindly answer") &&
              !text.includes("recruiter's questions") &&
              !text.includes("Type message here")
            ) {
              currentQuestion = text;
              break;
            }
          }

          // NEW: Also check for skill-based questions (short text before radio buttons)
          // These appear as just the skill name like "reacts.js", "node.js", "MySQL", "Python", "JSON"
          if (!currentQuestion) {
            const radios = document.querySelectorAll('input[type="radio"]');
            if (radios.length > 0) {
              // Find text elements near the radio buttons
              const radioContainer = radios[0].closest("div, li, span, label");
              if (radioContainer) {
                const parent = radioContainer.parentElement;
                if (parent) {
                  // Look for preceding text elements (skill name)
                  const siblings = Array.from(
                    parent.parentElement?.children || []
                  );
                  for (let i = siblings.length - 1; i >= 0; i--) {
                    const sibling = siblings[i];
                    const text = sibling.textContent?.trim() || "";
                    // Check if it looks like a skill name (short, no "Yes"/"No")
                    if (
                      text &&
                      text.length > 2 &&
                      text.length < 50 &&
                      !text.includes("Yes") &&
                      !text.includes("No") &&
                      !text.includes("Skip") &&
                      !text.includes("Kindly") &&
                      !text.includes("thank you") &&
                      !text.includes("Type message")
                    ) {
                      currentQuestion = text;
                      break;
                    }
                  }
                }
              }
            }
          }

          // If still no question, try to find it from visible text
          if (!currentQuestion) {
            // Look for common question patterns in visible text
            const bodyText = searchContext.innerText || "";
            const questionPatterns = [
              /What(?:'s| is) your (current|expected) (?:salary|CTC)\?/i,
              /What(?:'s| is) your notice period\?/i,
              /How many years of experience do you have(?: in| as a)? (.+?)\?/i,
              /Are you (.+?)\?/i,
              /Do you (.+?)\?/i,
              /What is your (.+?)\?/i,
            ];

            for (const pattern of questionPatterns) {
              const match = bodyText.match(pattern);
              if (match) {
                currentQuestion = match[0];
                break;
              }
            }
          }

          // Check for input fields (search entire document, not just modal) - ONLY VISIBLE ONES
          const inputs = Array.from(
            document.querySelectorAll(
              '[contenteditable="true"], input[type="text"], input[type="number"], input[placeholder*="date"], input[name*="dob"]'
            )
          ).filter((el) => {
            const style = window.getComputedStyle(el);
            return (
              style.display !== "none" &&
              style.visibility !== "hidden" &&
              el.offsetParent !== null
            );
          });
          const hasInput = inputs.length > 0;
          let inputValue = "";
          if (hasInput && inputs[0]) {
            if (
              inputs[0].isContentEditable ||
              inputs[0].getAttribute?.("contenteditable") === "true"
            ) {
              inputValue = inputs[0].textContent.trim();
            } else {
              inputValue = inputs[0].value || "";
            }
          }

          // Check for radio buttons (search entire document) - ONLY VISIBLE ONES
          const radios = Array.from(
            document.querySelectorAll('input[type="radio"]')
          ).filter((el) => {
            const style = window.getComputedStyle(el);
            return (
              style.display !== "none" &&
              style.visibility !== "hidden" &&
              el.offsetParent !== null
            );
          });
          const hasRadio = radios.length > 0;

          return {
            question: currentQuestion,
            hasInput,
            hasRadio,
            inputValue,
            searchedIn: contextName,
          };
        })
        .catch(() => ({
          question: "",
          hasInput: false,
          hasRadio: false,
          inputValue: "",
          searchedIn: "error",
        }));

      const currentQuestion = questionInfo.question || "";
      const hasRadioButtons = modalInfo.hasRadio; // PRIORITY: Only visible radios in modal
      const hasInputField = modalInfo.hasInput; // PRIORITY: Only visible inputs in modal
      const hasCheckboxes = modalInfo.hasCheckbox || false; // Check for checkboxes (multi-select)

      // Log the question being asked and available input types
      log(
        `  -> [Question Extraction] Searched in: ${questionInfo.searchedIn || "unknown"
        }`
      );

      if (currentQuestion) {
        log(
          `  -> [Question ${questionsAnsweredCount + 1}] "${currentQuestion}"`
        );
        log(
          `  -> [Input Type (Modal)] Radio buttons: ${hasRadioButtons ? "YES" : "NO"
          }, Text input: ${hasInputField ? "YES" : "NO"}`
        );
      } else {
        log(
          `  -> [Question ${questionsAnsweredCount + 1
          }] Could not extract question text clearly, using body text`
        );
      }

      // Use smart question matching to get the answer (pass hasInput and hasRadio for smart detection)
      log(`  -> [Answer Matching] Looking for answer in cv-profile...`);

      // CRITICAL: Determine the type of answer needed based on available inputs
      let answerTypeNeeded = "unknown";
      if (hasRadioButtons) answerTypeNeeded = "radio";
      else if (hasCheckboxes) answerTypeNeeded = "checkbox";
      else if (hasInputField) answerTypeNeeded = "text";

      log(
        `  -> [Action] Answer type needed: ${answerTypeNeeded.toUpperCase()}`
      );

      let answer = getAnswerForQuestion(
        currentQuestion || body,
        body,
        prof,
        hasInputField,
        hasRadioButtons
      );

      if (answer) {
        log(
          `  -> [Answer Found] Type: ${answer.type}, Value: "${answer.value}"`
        );
      } else {
        log(`  -> [Answer] No match found in cv-profile`);
      }

      // CRITICAL FALLBACK: Handle CCTC/ECTC/Location questions that might have been missed
      const qLower = (currentQuestion || "").toLowerCase();

      // CCTC question with text input but got radio answer or wrong answer
      if (
        /\bcctc\b|what is your cctc|current ctc|current salary/i.test(qLower) &&
        hasInputField
      ) {
        log(
          `  -> [Fallback] CCTC question detected, forcing text answer "13.5 LPA"`
        );
        answer = { type: "text", value: "13.5 LPA" };
      }

      // ECTC question with text input but got radio answer or wrong answer
      if (
        /\bectc\b|what is your ectc|expected ctc|expected salary/i.test(
          qLower
        ) &&
        hasInputField
      ) {
        log(
          `  -> [Fallback] ECTC question detected, forcing text answer "18-20 LPA"`
        );
        answer = { type: "text", value: "18-20 LPA" };
      }

      // Location question with text input
      if (
        /location|which city|where.*located|where.*based|your city/i.test(
          qLower
        ) &&
        hasInputField &&
        !hasRadioButtons
      ) {
        log(
          `  -> [Fallback] Location question detected, forcing text answer "Noida"`
        );
        answer = { type: "text", value: "Noida" };
      }

      // Generic "What is your" question with text input but no specific answer
      if (
        (!answer || answer.type === "radio") &&
        hasInputField &&
        !hasRadioButtons &&
        /what is your/i.test(qLower)
      ) {
        // If no radio buttons available and answer is radio type, convert common questions to text
        if (/ctc|salary|package|compensation/i.test(qLower)) {
          log(
            `  -> [Fallback] CTC-related question with text input, converting to "13.5 LPA"`
          );
          answer = { type: "text", value: "13.5 LPA" };
        } else if (/location|city/i.test(qLower)) {
          log(
            `  -> [Fallback] Location question with text input, converting to "Noida"`
          );
          answer = { type: "text", value: "Noida" };
        }
      }

      // If question starts with "Are you" and has radio buttons, force Yes
      if (
        !answer &&
        hasRadioButtons &&
        /^are you/i.test(currentQuestion || "")
      ) {
        answer = { type: "radio", value: "Yes" };
        log(
          `  -> Detected "Are you" question with radio buttons, selecting Yes`
        );
      }

      // SKILL-BASED RADIO QUESTIONS: If question is a skill name (like "reacts.js", "node.js", "MySQL", etc.)
      // These appear as just the skill name with Yes/No/Skip radio buttons - ALWAYS select Yes
      if (!answer && hasRadioButtons) {
        const skillPatterns = [
          /^react/i,
          /^node/i,
          /^javascript/i,
          /^python/i,
          /^java\b/i,
          /^sql/i,
          /^mysql/i,
          /^mongodb/i,
          /^postgresql/i,
          /^graphql/i,
          /^rest/i,
          /^api/i,
          /^html/i,
          /^css/i,
          /^typescript/i,
          /^angular/i,
          /^vue/i,
          /^express/i,
          /^django/i,
          /^flask/i,
          /^spring/i,
          /^docker/i,
          /^kubernetes/i,
          /^aws/i,
          /^azure/i,
          /^gcp/i,
          /^git/i,
          /^linux/i,
          /^json/i,
          /^xml/i,
          /^redis/i,
          /^kafka/i,
          /^elasticsearch/i,
          /^nginx/i,
          /^php/i,
          /^ruby/i,
          /^go\b/i,
          /^rust/i,
          /^scala/i,
          /^kotlin/i,
          /^swift/i,
          /^react\.?js/i,
          /^node\.?js/i,
          /^next\.?js/i,
          /^nest\.?js/i,
          /^express\.?js/i,
          /\.js$/i,
          /\.py$/i,
          /full.?stack/i,
          /front.?end/i,
          /back.?end/i,
          /dev.?ops/i,
          /ci.?cd/i,
          /agile/i,
          /scrum/i,
          /jira/i,
          /confluence/i,
          /selenium/i,
          /cypress/i,
          /playwright/i,
          /jest/i,
          /mocha/i,
          /pytest/i,
          /junit/i,
          /terraform/i,
          /ansible/i,
          /jenkins/i,
          /github/i,
          /gitlab/i,
          /bitbucket/i,
          /machine.?learning/i,
          /deep.?learning/i,
          /artificial.?intelligence/i,
          /nlp/i,
          /computer.?vision/i,
          /pytorch/i,
          /tensorflow/i,
          /keras/i,
          /pandas/i,
          /numpy/i,
          /scikit/i,
          /hadoop/i,
          /spark/i,
          /hive/i,
          /tableau/i,
          /power.?bi/i,
          /excel/i,
          /data.?science/i,
          /data.?analysis/i,
        ];

        const q = (currentQuestion || "").toLowerCase().trim();
        const isSkillQuestion = skillPatterns.some((pattern) =>
          pattern.test(q)
        );

        if (isSkillQuestion) {
          answer = { type: "radio", value: "Yes" };
          log(
            `  -> Detected skill-based question "${currentQuestion}" with radio buttons, selecting Yes`
          );
        }
      }

      // If no answer found but has radio buttons, default to Yes (for any remaining radio questions)
      if (!answer && hasRadioButtons) {
        answer = { type: "radio", value: "Yes" };
        log(`  -> No answer found, defaulting to Yes for radio question`);
      }

      // CRITICAL FALLBACK: If no answer found but has text input
      // This handles any unknown/random questions
      if (!answer && hasInputField) {
        const qText = (currentQuestion || "").toLowerCase();
        // If question contains "experience" or "years", use overall experience
        if (/experience|years/i.test(qText)) {
          answer = { type: "text", value: String(prof.experienceYears || 5) };
          log(
            `  -> ⚠️ [FALLBACK] Unknown experience question, typing "${answer.value}"`
          );
        } else {
          // Otherwise type "Yes" as requested
          answer = { type: "text", value: "Yes" };
          log(
            `  -> ⚠️ [FALLBACK] Unknown question with text input, typing "Yes" to continue`
          );
        }
        log(`  -> [Question was]: "${currentQuestion || "Unknown"}"`);
      }

      // BUG FIX: If we have a radio answer but only an input box is visible,
      // convert the answer to "text" so it can be typed.
      if (
        answer &&
        answer.type === "radio" &&
        hasInputField &&
        !hasRadioButtons
      ) {
        log(
          `  -> ⚠️ [TYPE MISMATCH] Radio answer found but only input box visible. Converting to text...`
        );
        answer = { type: "text", value: answer.value };
      }

      let didAnswer = false;

      if (answer) {
        log(
          `  -> Question: "${(currentQuestion || body).substring(0, 80)}..."`
        );
        log(`  -> Answer: ${answer.type} = "${answer.value}"`);

        if (answer.type === "text") {
          // CRITICAL: Verify modal is still open before attempting to fill text
          const isModalOpen = await pg
            .evaluate(() => {
              const modalSelectors = [
                ".chatbot_DrawerContentWrapper",
                "[class*='chatbot_DrawerContentWrapper']",
                "[class*='DrawerContentWrapper']",
                "[class*='chatbot']",
                "[class*='drawer']",
                "[class*='modal']",
                "[class*='Modal']",
                "[role='dialog']",
              ];
              for (const sel of modalSelectors) {
                const el = document.querySelector(sel);
                if (el && window.getComputedStyle(el).display !== "none")
                  return true;
              }
              return false;
            })
            .catch(() => false);

          if (!isModalOpen) {
            log(
              `  -> ⚠️ [ABORT] Modal closed unexpectedly before text input. Skipping...`
            );
            didAnswer = false;
          } else {
            // Only proceed if text input is available
            if (!hasInputField) {
              log(
                `  -> Text answer provided but no text input available. Skipping...`
              );
              didAnswer = false;
            } else {
              // Text input answer - use multiple strategies to ensure it fills
              log(`  -> Attempting to fill text input with: "${answer.value}"`);

              // Try to find the input field with STRICTLY SCOPED modal selectors
              let inp = null;
              const inputSelectors = [
                // Strictly within modal wrappers
                ".chatbot_DrawerContentWrapper [contenteditable='true']",
                ".chatbot_DrawerContentWrapper input[type='text']",
                ".chatbot_DrawerContentWrapper input[type='number']",
                "[class*='chatbot'] [contenteditable='true']",
                "[class*='Modal'] [contenteditable='true']",
                "[role='dialog'] [contenteditable='true']",
                "[role='dialog'] input[type='text']",

                // If those fail, use specific ID/placeholder but ONLY if inside a dialog/drawer
                "div[role='dialog'] #userInput__nagd9bu2lInputBox",
                "div[role='dialog'] [data-placeholder*='Type message']",
                "div[role='dialog'] .textArea[contenteditable='true']",
              ];

              for (const selector of inputSelectors) {
                try {
                  const candidate = pg.locator(selector).first();
                  if (
                    await candidate
                      .isVisible({ timeout: 500 })
                      .catch(() => false)
                  ) {
                    inp = candidate;
                    const elInfo = await candidate
                      .evaluate((el) => ({
                        tag: el.tagName,
                        id: el.id,
                        className: el.className,
                        placeholder:
                          el.placeholder ||
                          el.getAttribute("data-placeholder") ||
                          "",
                      }))
                      .catch(() => ({}));
                    log(`  -> Found input with selector: ${selector}`);
                    log(
                      `  -> Element Info: <${elInfo.tag} id="${elInfo.id}" class="${elInfo.className}">`
                    );
                    break;
                  }
                } catch (_) { }
              }

              if (!inp) {
                log(
                  `  -> ❌ [Error] Input field not found WITHIN MODAL. Preventing background typing.`
                );
                didAnswer = false;
              } else {
                // Try multiple filling strategies based on live testing
                let filled = false;
                const valueToFill = String(answer.value).trim();
                log(
                  `  -> [Text Input] Preparing to fill with value: "${valueToFill}"`
                );

                // Strategy 1: Deliberate and slow typing based on element type
                try {
                  log(
                    `  -> [Strategy 1] Starting deliberate typing process (Slow Mode)...`
                  );
                  await inp.scrollIntoViewIfNeeded().catch(() => { });
                  log(`  -> [Input] Scrolled into view`);

                  // CRITICAL: Ensure we are clicking the center of the input
                  const box = await inp.boundingBox();
                  if (box) {
                    // Slow down the click
                    await pg.mouse.move(
                      box.x + box.width / 2,
                      box.y + box.height / 2
                    );
                    await pg.waitForTimeout(800);
                    await pg.mouse.click(
                      box.x + box.width / 2,
                      box.y + box.height / 2
                    );
                    log(`  -> [Input] Clicked center of input box (Slow Mode)`);
                  } else {
                    await inp.click({ force: true });
                    log(`  -> [Input] Clicked to focus (force)`);
                  }
                  await pg.waitForTimeout(1500);

                  // Focus the input
                  await inp.focus().catch(() => { });
                  await pg.waitForTimeout(800);

                  // Detect type
                  const isContentEditable = await inp.evaluate(
                    (el) =>
                      el.isContentEditable ||
                      el.getAttribute("contenteditable") === "true"
                  );
                  log(
                    `  -> [Input Type] isContentEditable: ${isContentEditable}`
                  );

                  // Clear field - GENTLE AND TYPE-SPECIFIC
                  log(`  -> [Input] Clearing field gently...`);
                  if (isContentEditable) {
                    // Use more deliberate Select All + Backspace for contenteditable
                    await pg.keyboard.down("Control");
                    await pg.waitForTimeout(300);
                    await pg.keyboard.press("a");
                    await pg.waitForTimeout(300);
                    await pg.keyboard.up("Control");
                    await pg.waitForTimeout(500);
                    await pg.keyboard.press("Backspace");
                  } else {
                    // For standard inputs, fill("") is usually safe, but let's try Select All + Backspace first too
                    await pg.keyboard.down("Control");
                    await pg.waitForTimeout(300);
                    await pg.keyboard.press("a");
                    await pg.waitForTimeout(300);
                    await pg.keyboard.up("Control");
                    await pg.waitForTimeout(500);
                    await pg.keyboard.press("Backspace");
                    // Fallback if needed
                    const valAfterClear = await inp.evaluate((el) => el.value);
                    if (valAfterClear) await inp.fill("");
                  }
                  await pg.waitForTimeout(1500);

                  // Use pressSequentially with human-like delays
                  log(`  -> [Input] Typing value: "${valueToFill}"`);
                  await inp.pressSequentially(valueToFill, { delay: 150 });
                  await pg.waitForTimeout(2000);
                  log(`  -> [Input] Typing complete, verifying...`);

                  // Verify the value was set
                  const check1 = await inp
                    .evaluate((el, val) => {
                      if (
                        el.isContentEditable ||
                        el.getAttribute?.("contenteditable") === "true"
                      ) {
                        const content = (
                          el.textContent ||
                          el.innerText ||
                          ""
                        ).trim();
                        return content === val || content.includes(val);
                      }
                      return (el.value || "").trim() === val;
                    }, valueToFill)
                    .catch(() => false);

                  if (check1) {
                    filled = true;
                    log(`  -> ✅ [Success] Input filled and verified.`);
                  } else {
                    log(
                      `  -> ⚠️ [Verification] Initial verify failed, trying direct evaluate fill...`
                    );
                    await inp.evaluate((el, val) => {
                      if (el.isContentEditable) el.innerText = val;
                      else el.value = val;
                      el.dispatchEvent(new Event("input", { bubbles: true }));
                      el.dispatchEvent(new Event("change", { bubbles: true }));
                    }, valueToFill);
                    await pg.waitForTimeout(1000);
                    filled = true; // Consider filled after direct set
                  }
                } catch (e) {
                  log(`  -> ❌ [Strategy 1 Failed] ${e.message}`);
                }

                // Strategy 2: Use fill() + trigger events if pressSequentially didn't work
                if (!filled) {
                  try {
                    log(
                      `  -> [Strategy 2] Trying traditional .fill() method with event triggers...`
                    );
                    await inp.scrollIntoViewIfNeeded().catch(() => { });
                    await inp.click({ force: true });
                    await pg.waitForTimeout(300);
                    await inp.focus().catch(() => { });
                    await pg.waitForTimeout(100);

                    // Clear first
                    await inp.fill("").catch(() => { });
                    await pg.waitForTimeout(150);

                    // Fill the value
                    await inp.fill(valueToFill, { force: true });
                    await pg.waitForTimeout(600);

                    // Trigger events to ensure React sees the change
                    await inp.evaluate((el) => {
                      el.dispatchEvent(
                        new Event("input", { bubbles: true, cancelable: true })
                      );
                      el.dispatchEvent(
                        new Event("change", { bubbles: true, cancelable: true })
                      );
                    });
                    await pg.waitForTimeout(300);

                    // Verify
                    const check2 = await inp
                      .evaluate((el, val) => {
                        if (
                          el.isContentEditable ||
                          el.getAttribute?.("contenteditable") === "true"
                        ) {
                          const content = (
                            el.textContent ||
                            el.innerText ||
                            ""
                          ).trim();
                          return content === val || content.includes(val);
                        }
                        return (el.value || "").trim() === val;
                      }, valueToFill)
                      .catch(() => false);

                    if (check2) {
                      filled = true;
                      log(
                        `  -> ✅ [Success] Input filled using .fill() method`
                      );
                    } else {
                      log(
                        `  -> [Verification] fill() method completed but value not verified`
                      );
                    }
                  } catch (e) {
                    log(`  -> ❌ [Strategy 2 Failed] ${e.message}`);
                  }
                }

                // Strategy 3: Use evaluate (DOM manipulation) as last resort
                if (!filled) {
                  try {
                    await inp.scrollIntoViewIfNeeded().catch(() => { });
                    await inp.click({ force: true });
                    await pg.waitForTimeout(200);
                    await inp.focus().catch(() => { });
                    await pg.waitForTimeout(100);
                    // Use custom fill function
                    await fillTypeMessage(inp, answer.value);
                    await pg.waitForTimeout(500);

                    // Trigger multiple events to ensure React sees it
                    await inp.evaluate((el) => {
                      el.dispatchEvent(
                        new Event("input", { bubbles: true, cancelable: true })
                      );
                      el.dispatchEvent(
                        new Event("change", { bubbles: true, cancelable: true })
                      );
                      el.dispatchEvent(
                        new KeyboardEvent("keyup", { bubbles: true })
                      );
                      el.dispatchEvent(
                        new KeyboardEvent("keydown", { bubbles: true })
                      );
                      el.dispatchEvent(new Event("blur", { bubbles: true }));
                      el.dispatchEvent(new Event("focus", { bubbles: true }));
                    });
                    await pg.waitForTimeout(300);

                    // Verify
                    const check3 = await inp
                      .evaluate((el, val) => {
                        if (
                          el.isContentEditable ||
                          el.getAttribute?.("contenteditable") === "true"
                        ) {
                          const content = (
                            el.textContent ||
                            el.innerText ||
                            ""
                          ).trim();
                          return content === val || content.includes(val);
                        }
                        return (el.value || "").trim() === val;
                      }, valueToFill)
                      .catch(() => false);

                    if (check3) {
                      filled = true;
                      log(
                        `  -> ✓ Input filled successfully using evaluate() method`
                      );
                    } else {
                      // Final verification - get actual value
                      const actualValue = await inp
                        .evaluate((el) => {
                          if (
                            el.isContentEditable ||
                            el.getAttribute?.("contenteditable") === "true"
                          ) {
                            return (
                              el.textContent ||
                              el.innerText ||
                              ""
                            ).trim();
                          }
                          return (el.value || "").trim();
                        })
                        .catch(() => "");
                      log(
                        `  -> ✗ Input fill failed. Expected: "${valueToFill}", Got: "${actualValue}"`
                      );
                    }
                  } catch (e) {
                    log(`  -> evaluate() method failed: ${e.message}`);
                  }
                }

                if (filled) {
                  didAnswer = true;
                  // Final event trigger to ensure React sees it
                  await inp.evaluate((el) => {
                    el.dispatchEvent(
                      new Event("input", { bubbles: true, cancelable: true })
                    );
                    el.dispatchEvent(
                      new Event("change", { bubbles: true, cancelable: true })
                    );
                  });
                  await pg.waitForTimeout(300);
                } else {
                  log(`  -> ✗ All input filling strategies failed`);
                }
              }
            } // Close the else block for hasInputField
          } // Close the isModalOpen else block
        } // Close the if (answer.type === "text") block
        else if (answer.type === "radio") {
          // Only proceed if radio buttons are available
          if (!hasRadioButtons) {
            log(
              `  -> ⚠️ [Radio Mismatch] Answer is radio type but no radio buttons found.`
            );

            // FALLBACK: If there's a text input available, try to type the answer value
            if (hasInputField) {
              log(`  -> [Fallback] Converting radio answer to text input...`);

              // Convert the radio value to text - use the value directly or "Yes" as fallback
              let textValue = answer.value;

              // If the question contains specific keywords, use appropriate text
              const questionLower = (currentQuestion || "").toLowerCase();
              if (/cctc|current ctc|current salary/i.test(questionLower)) {
                textValue = "13.5 LPA";
              } else if (
                /ectc|expected ctc|expected salary/i.test(questionLower)
              ) {
                textValue = "18-20 LPA";
              } else if (
                /location|city|where|residing|relocate/i.test(questionLower)
              ) {
                textValue = "Noida";
              } else if (/qualification/i.test(questionLower)) {
                textValue = "MCA, Masters of Computer Applications";
              } else if (
                /experience.*years|years.*experience|relevant experience/i.test(
                  questionLower
                )
              ) {
                textValue = "5";
              }

              log(
                `  -> [Fallback] Will try to fill text input with: "${textValue}"`
              );

              // Try to fill the text input directly
              try {
                // Find the input field within the modal
                const modalInputSelectors = [
                  ".chatbot_DrawerContentWrapper [contenteditable='true']",
                  ".chatbot_DrawerContentWrapper input[type='text']",
                  ".chatbot_DrawerContentWrapper textarea",
                  "[class*='chatbot'] [contenteditable='true']",
                  "[class*='chatbot'] input[type='text']",
                  "[role='dialog'] [contenteditable='true']",
                ];

                let inputFilled = false;
                for (const selector of modalInputSelectors) {
                  const inputEl = pg.locator(selector).first();
                  if (
                    await inputEl.isVisible({ timeout: 500 }).catch(() => false)
                  ) {
                    log(
                      `  -> [Fallback] Found input with selector: ${selector}`
                    );
                    await inputEl.scrollIntoViewIfNeeded().catch(() => { });
                    await pg.waitForTimeout(300);
                    await inputEl.click({ force: true });
                    await pg.waitForTimeout(300);

                    // Clear and type
                    await inputEl.evaluate((el) => {
                      if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") {
                        el.value = "";
                      } else {
                        el.textContent = "";
                      }
                    });
                    await pg.waitForTimeout(200);

                    await inputEl.pressSequentially(textValue, { delay: 50 });
                    await pg.waitForTimeout(500);

                    inputFilled = true;
                    didAnswer = true;
                    log(
                      `  -> ✅ [Fallback] Successfully filled text input with: "${textValue}"`
                    );
                    break;
                  }
                }

                if (!inputFilled) {
                  log(
                    `  -> ❌ [Fallback] Could not find any text input to fill`
                  );
                  didAnswer = false;
                }
              } catch (fallbackError) {
                log(
                  `  -> ❌ [Fallback] Error filling text input: ${fallbackError.message}`
                );
                didAnswer = false;
              }
            } else {
              // FALLBACK: Try to find and click checkboxes as last resort
              log(`  -> [Fallback] No text input found. Trying checkbox fallback...`);

              try {
                const checkboxFallbackResult = await pg.evaluate((answerValue) => {
                  // Look for checkboxes directly with multiple selectors
                  const checkboxSelectors = [
                    'input[type="checkbox"]',
                    '.mcc__checkbox',
                    'input[data-val="multiselect"]',
                    '.multicheckboxes-container input',
                    '.multiselectcheckboxes input',
                  ];

                  let checkboxes = [];
                  for (const selector of checkboxSelectors) {
                    const found = document.querySelectorAll(selector);
                    if (found.length > 0) {
                      checkboxes = Array.from(found);
                      break;
                    }
                  }

                  if (checkboxes.length === 0) {
                    return { success: false, message: "No checkboxes found in fallback" };
                  }

                  // Try to find "yes" checkbox first
                  let targetCheckbox = null;
                  const answerLower = (answerValue || "yes").toLowerCase();

                  for (const cb of checkboxes) {
                    const id = (cb.id || "").toLowerCase();
                    const value = (cb.value || "").toLowerCase();
                    const label = cb.closest("label") || document.querySelector(`label[for="${cb.id}"]`);
                    const labelText = label ? label.textContent.trim().toLowerCase() : "";

                    if (id === "yes" || value === "yes" || labelText === "yes" ||
                      id === answerLower || value === answerLower || labelText.includes(answerLower)) {
                      targetCheckbox = cb;
                      break;
                    }
                  }

                  // If no matching checkbox, use the first one
                  if (!targetCheckbox) {
                    targetCheckbox = checkboxes[0];
                  }

                  if (targetCheckbox) {
                    targetCheckbox.checked = true;
                    targetCheckbox.dispatchEvent(new Event("change", { bubbles: true, cancelable: true }));
                    targetCheckbox.dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));
                    targetCheckbox.dispatchEvent(new Event("input", { bubbles: true, cancelable: true }));

                    const label = targetCheckbox.closest("label") || document.querySelector(`label[for="${targetCheckbox.id}"]`);
                    const selectedText = label ? label.textContent.trim() : targetCheckbox.value || targetCheckbox.id;
                    return { success: true, message: "Selected checkbox in fallback", selected: selectedText };
                  }

                  return { success: false, message: "Could not select checkbox" };
                }, answer.value);

                if (checkboxFallbackResult.success) {
                  didAnswer = true;
                  log(`  -> ✅ [Checkbox Fallback] ${checkboxFallbackResult.message}: "${checkboxFallbackResult.selected}"`);
                  await pg.waitForTimeout(500);
                } else {
                  log(`  -> ❌ [Checkbox Fallback] ${checkboxFallbackResult.message}`);
                  didAnswer = false;
                }
              } catch (checkboxFallbackError) {
                log(`  -> ❌ [Checkbox Fallback] Error: ${checkboxFallbackError.message}`);
                didAnswer = false;
              }
            }
          } else {
            // Radio button answer - improved handling for Naukri structure
            let targetValue = answer.value;
            log(`  -> [Radio Selection] Target value: "${targetValue}"`);
            log(
              `  -> [Radio Selection] Trying multiple strategies to select radio button...`
            );

            // Try multiple strategies to select the radio
            let radioFound = false;

            // Helper function to verify radio is selected
            const verifyRadioSelected = async (selector) => {
              try {
                const isChecked = await pg
                  .evaluate((sel) => {
                    const radio = document.querySelector(sel);
                    return radio ? radio.checked === true : false;
                  }, selector)
                  .catch(() => false);
                return isChecked;
              } catch (_) {
                return false;
              }
            };

            // SPECIAL HANDLING: City/Location questions - select with priority: Noida > Gurugram > Mumbai
            const isLocationQuestion =
              /location|city|residing|relocate|where.*live|where.*work|based in/i.test(
                currentQuestion || ""
              );
            if (isLocationQuestion && !radioFound) {
              log(
                `  -> [City Selection] Detected location question, using city priority selection...`
              );
              const cityPriority = [
                "Noida",
                "Gurgaon",
                "Gurugram",
                "Mumbai",
                "Delhi",
                "Bangalore",
                "Bengaluru",
                "Hyderabad",
                "Chennai",
                "Pune",
              ];

              const selectedCity = await pg.evaluate((priorities) => {
                // Find all radio buttons in the modal
                const modalSelectors = [
                  ".chatbot_DrawerContentWrapper",
                  '[class*="chatbot_DrawerContentWrapper"]',
                  '[class*="chatbot"]',
                  '[role="dialog"]',
                ];

                let modal = null;
                for (const selector of modalSelectors) {
                  modal = document.querySelector(selector);
                  if (modal) break;
                }

                const searchContext = modal || document.body;
                const radios = Array.from(
                  searchContext.querySelectorAll('input[type="radio"]')
                );

                // Collect all available cities from radio labels
                const availableCities = [];
                for (const r of radios) {
                  const label =
                    r.closest("label") ||
                    document.querySelector(`label[for="${r.id}"]`);
                  if (label && label.textContent) {
                    availableCities.push({
                      radio: r,
                      label: label.textContent.trim(),
                      id: r.id,
                      value: r.value,
                    });
                  }
                }

                // Find the highest priority city available
                for (const city of priorities) {
                  const match = availableCities.find(
                    (c) =>
                      c.label.toLowerCase().includes(city.toLowerCase()) ||
                      c.id.toLowerCase().includes(city.toLowerCase()) ||
                      c.value.toLowerCase().includes(city.toLowerCase())
                  );
                  if (match) {
                    match.radio.checked = true;
                    match.radio.dispatchEvent(
                      new Event("change", { bubbles: true, cancelable: true })
                    );
                    match.radio.dispatchEvent(
                      new Event("click", { bubbles: true, cancelable: true })
                    );
                    match.radio.dispatchEvent(
                      new Event("input", { bubbles: true, cancelable: true })
                    );
                    return match.label;
                  }
                }
                return null;
              }, cityPriority);

              if (selectedCity) {
                radioFound = true;
                didAnswer = true;
                targetValue = selectedCity; // Update for logging
                log(
                  `  -> ✅ [City Selected] Selected city with priority: "${selectedCity}"`
                );
                await pg.waitForTimeout(500);
              } else {
                log(
                  `  -> [City Selection] No matching city found in options, falling back to regular strategies...`
                );
              }
            }

            // Strategy 1: Find radio by ID and use Playwright's check() method (most reliable)
            if (!radioFound) {
              try {
                log(`  -> [Radio Strategy 1] Trying radio input by ID...`);
                const radioById = pg
                  .locator(`input[type="radio"][id="${targetValue}"]`)
                  .first();
                if (
                  await radioById.isVisible({ timeout: 500 }).catch(() => false)
                ) {
                  log(`  -> [Radio] Found radio input[id="${targetValue}"]`);
                  await radioById.scrollIntoViewIfNeeded().catch(() => { });
                  await pg.waitForTimeout(200);

                  // Use Playwright's check() method first (triggers React properly)
                  log(`  -> [Radio] Checking radio button...`);
                  await radioById.check({ force: true }).catch(async () => {
                    // Fallback to click if check fails
                    log(`  -> [Radio] .check() failed, trying .click()...`);
                    await radioById.click({ force: true });
                  });
                  await pg.waitForTimeout(300);

                  // Also set via DOM to ensure it's checked
                  await radioById.evaluate((el) => {
                    el.checked = true;
                    el.dispatchEvent(
                      new Event("change", { bubbles: true, cancelable: true })
                    );
                    el.dispatchEvent(
                      new Event("click", { bubbles: true, cancelable: true })
                    );
                    el.dispatchEvent(
                      new Event("input", { bubbles: true, cancelable: true })
                    );
                  });
                  await pg.waitForTimeout(200);

                  // Verify it's actually checked
                  const verified = await verifyRadioSelected(
                    `input[type="radio"][id="${targetValue}"]`
                  );
                  if (verified) {
                    radioFound = true;
                    didAnswer = true;
                    log(
                      `  -> ✅ [Success] Radio selected by ID: ${targetValue} [checked=true]`
                    );
                  } else {
                    log(`  -> ⚠️ [Radio] Clicked but verification failed`);
                  }
                }
              } catch (e) {
                log(`  -> ❌ [Strategy 1] Failed: ${e.message}`);
              }
            }

            // Strategy 2: Find radio by value attribute
            if (!radioFound) {
              try {
                const radioByValue = pg
                  .locator(`input[type="radio"][value="${targetValue}"]`)
                  .first();
                if (
                  await radioByValue
                    .isVisible({ timeout: 400 })
                    .catch(() => false)
                ) {
                  await radioByValue.scrollIntoViewIfNeeded().catch(() => { });
                  await pg.waitForTimeout(200);
                  await radioByValue.check({ force: true }).catch(async () => {
                    await radioByValue.click({ force: true });
                  });
                  await pg.waitForTimeout(300);
                  await radioByValue.evaluate((el) => {
                    el.checked = true;
                    el.dispatchEvent(new Event("change", { bubbles: true }));
                    el.dispatchEvent(new Event("click", { bubbles: true }));
                  });
                  await pg.waitForTimeout(200);
                  const verified = await verifyRadioSelected(
                    `input[type="radio"][value="${targetValue}"]`
                  );
                  if (verified) {
                    radioFound = true;
                    didAnswer = true;
                    log(`  -> ✓ Selected radio by value: ${targetValue}`);
                  }
                }
              } catch (e) {
                log(`  -> Strategy 2 (value) failed: ${e.message}`);
              }
            }

            // Strategy 3: Find label and click it (Naukri structure: label[for="Yes"])
            if (!radioFound) {
              try {
                const label = pg
                  .locator(
                    `label[for="${targetValue}"], label.ssrc__label:has-text("${targetValue}")`
                  )
                  .first();
                if (
                  await label.isVisible({ timeout: 400 }).catch(() => false)
                ) {
                  await label.scrollIntoViewIfNeeded().catch(() => { });
                  await pg.waitForTimeout(200);
                  await label.click({ force: true });
                  await pg.waitForTimeout(300);
                  // Ensure the associated radio is checked via DOM
                  await pg.evaluate((val) => {
                    const radio = document.querySelector(
                      `input[type="radio"][id="${val}"], input[type="radio"][value="${val}"]`
                    );
                    if (radio) {
                      radio.checked = true;
                      radio.dispatchEvent(
                        new Event("change", { bubbles: true })
                      );
                      radio.dispatchEvent(
                        new Event("click", { bubbles: true })
                      );
                      radio.dispatchEvent(
                        new Event("input", { bubbles: true })
                      );
                    }
                  }, targetValue);
                  await pg.waitForTimeout(200);
                  const verified = await verifyRadioSelected(
                    `input[type="radio"][id="${targetValue}"], input[type="radio"][value="${targetValue}"]`
                  );
                  if (verified) {
                    radioFound = true;
                    didAnswer = true;
                    log(
                      `  -> ✓ Selected radio by clicking label: ${targetValue}`
                    );
                  }
                }
              } catch (e) {
                log(`  -> Strategy 3 (label) failed: ${e.message}`);
              }
            }

            // Strategy 4: Find by role and name (Playwright's getByRole)
            if (!radioFound) {
              try {
                const r = pg
                  .getByRole("radio", {
                    name: new RegExp(targetValue.replace(/\s+/g, "\\s*"), "i"),
                  })
                  .first();
                if (await r.isVisible({ timeout: 400 }).catch(() => false)) {
                  await r.scrollIntoViewIfNeeded().catch(() => { });
                  await pg.waitForTimeout(200);
                  await r.check({ force: true }).catch(async () => {
                    await r.click({ force: true });
                  });
                  await pg.waitForTimeout(300);
                  await r.evaluate((el) => {
                    el.checked = true;
                    el.dispatchEvent(new Event("change", { bubbles: true }));
                    el.dispatchEvent(new Event("click", { bubbles: true }));
                  });
                  await pg.waitForTimeout(200);
                  const verified = await r.isChecked().catch(() => false);
                  if (verified) {
                    radioFound = true;
                    didAnswer = true;
                    log(`  -> ✓ Selected radio by role: ${targetValue}`);
                  }
                }
              } catch (e) {
                log(`  -> Strategy 4 (role) failed: ${e.message}`);
              }
            }

            // Strategy 5: Find text and click its parent/label
            if (!radioFound) {
              try {
                const textEl = pg
                  .getByText(targetValue, { exact: false })
                  .first();
                if (
                  await textEl.isVisible({ timeout: 400 }).catch(() => false)
                ) {
                  // Check if it's inside a label or radio container
                  const isInLabel = await textEl
                    .evaluate((el) => {
                      return (
                        el.closest("label") !== null ||
                        el.closest(".ssrc__label") !== null
                      );
                    })
                    .catch(() => false);

                  if (isInLabel) {
                    await textEl.scrollIntoViewIfNeeded().catch(() => { });
                    await pg.waitForTimeout(200);
                    await textEl.click({ force: true });
                    await pg.waitForTimeout(300);
                    // Ensure radio is checked
                    await pg.evaluate((val) => {
                      const radios = Array.from(
                        document.querySelectorAll('input[type="radio"]')
                      );
                      for (const r of radios) {
                        const label =
                          r.closest("label") || r.nextElementSibling;
                        if (
                          label &&
                          label.textContent &&
                          label.textContent.trim().includes(val)
                        ) {
                          r.checked = true;
                          r.dispatchEvent(
                            new Event("change", { bubbles: true })
                          );
                          r.dispatchEvent(
                            new Event("click", { bubbles: true })
                          );
                          r.dispatchEvent(
                            new Event("input", { bubbles: true })
                          );
                        }
                      }
                    }, targetValue);
                    await pg.waitForTimeout(200);
                    // Verify by checking if any radio is now checked
                    const verified = await pg
                      .evaluate((val) => {
                        const radios = Array.from(
                          document.querySelectorAll('input[type="radio"]')
                        );
                        for (const r of radios) {
                          const label =
                            r.closest("label") || r.nextElementSibling;
                          if (
                            label &&
                            label.textContent &&
                            label.textContent.trim().includes(val)
                          ) {
                            return r.checked === true;
                          }
                        }
                        return false;
                      }, targetValue)
                      .catch(() => false);
                    if (verified) {
                      radioFound = true;
                      didAnswer = true;
                      log(
                        `  -> ✓ Selected radio by clicking text: ${targetValue}`
                      );
                    }
                  }
                }
              } catch (e) {
                log(`  -> Strategy 5 (text) failed: ${e.message}`);
              }
            }

            // Strategy 6: Direct DOM manipulation - find all radios and match by text/ID/value
            if (!radioFound) {
              try {
                const selected = await pg.evaluate((val) => {
                  // Find all radios - try modal first, then entire document
                  const modalSelectors = [
                    ".chatbot_DrawerContentWrapper",
                    '[class*="chatbot_DrawerContentWrapper"]',
                    '[class*="DrawerContentWrapper"]',
                    '[class*="chatbot"]',
                    '[class*="drawer"]',
                    '[role="dialog"]',
                  ];

                  let modal = null;
                  for (const selector of modalSelectors) {
                    modal = document.querySelector(selector);
                    if (modal) break;
                  }

                  // Search in modal if found, otherwise entire document
                  const searchContext = modal || document.body;

                  const radios = Array.from(
                    searchContext.querySelectorAll('input[type="radio"]')
                  );
                  for (const r of radios) {
                    // Check if this radio matches the target value by ID or value
                    if (r.id === val || r.value === val) {
                      r.checked = true;
                      r.dispatchEvent(
                        new Event("change", { bubbles: true, cancelable: true })
                      );
                      r.dispatchEvent(
                        new Event("click", { bubbles: true, cancelable: true })
                      );
                      r.dispatchEvent(
                        new Event("input", { bubbles: true, cancelable: true })
                      );
                      return true;
                    }
                    // Check label text
                    const label =
                      r.closest("label") ||
                      document.querySelector(`label[for="${r.id}"]`);
                    if (label && label.textContent) {
                      const labelText = label.textContent.trim().toLowerCase();
                      const valLower = val.toLowerCase();
                      if (
                        labelText.includes(valLower) ||
                        valLower.includes(labelText)
                      ) {
                        r.checked = true;
                        r.dispatchEvent(
                          new Event("change", {
                            bubbles: true,
                            cancelable: true,
                          })
                        );
                        r.dispatchEvent(
                          new Event("click", {
                            bubbles: true,
                            cancelable: true,
                          })
                        );
                        r.dispatchEvent(
                          new Event("input", {
                            bubbles: true,
                            cancelable: true,
                          })
                        );
                        return true;
                      }
                    }
                  }
                  return false;
                }, targetValue);

                if (selected) {
                  await pg.waitForTimeout(500);
                  // Verify it's actually checked
                  const verified = await pg
                    .evaluate((val) => {
                      // Try to find modal, fallback to entire document
                      const modalSelectors = [
                        ".chatbot_DrawerContentWrapper",
                        '[class*="chatbot_DrawerContentWrapper"]',
                        '[class*="chatbot"]',
                        '[class*="drawer"]',
                        '[role="dialog"]',
                      ];

                      let modal = null;
                      for (const selector of modalSelectors) {
                        modal = document.querySelector(selector);
                        if (modal) break;
                      }

                      const searchContext = modal || document.body;
                      const radios = Array.from(
                        searchContext.querySelectorAll('input[type="radio"]')
                      );
                      for (const r of radios) {
                        if (r.checked) {
                          const label =
                            r.closest("label") ||
                            document.querySelector(`label[for="${r.id}"]`);
                          if (label && label.textContent) {
                            const labelText = label.textContent
                              .trim()
                              .toLowerCase();
                            const valLower = val.toLowerCase();
                            if (
                              r.id === val ||
                              r.value === val ||
                              labelText.includes(valLower) ||
                              valLower.includes(labelText)
                            ) {
                              return true;
                            }
                          }
                        }
                      }
                      return false;
                    }, targetValue)
                    .catch(() => false);

                  if (verified) {
                    radioFound = true;
                    didAnswer = true;
                    log(
                      `  -> ✓ Selected radio via DOM manipulation: ${targetValue}`
                    );
                  } else {
                    log(
                      `  -> DOM manipulation set checked but verification failed`
                    );
                  }
                }
              } catch (e) {
                log(`  -> Strategy 6 (DOM) failed: ${e.message}`);
              }
            }

            if (!radioFound) {
              log(
                `  -> ✗ Could not find/select radio button for: ${targetValue}`
              );
              // Log available radio options for debugging
              try {
                const availableRadios = await pg
                  .evaluate(() => {
                    // Try to find modal, fallback to entire document
                    const modalSelectors = [
                      ".chatbot_DrawerContentWrapper",
                      '[class*="chatbot_DrawerContentWrapper"]',
                      '[class*="chatbot"]',
                      '[class*="drawer"]',
                      '[role="dialog"]',
                    ];

                    let modal = null;
                    for (const selector of modalSelectors) {
                      modal = document.querySelector(selector);
                      if (modal) break;
                    }

                    const searchContext = modal || document.body;
                    const radios = Array.from(
                      searchContext.querySelectorAll('input[type="radio"]')
                    );
                    return radios.map((r) => {
                      const label =
                        r.closest("label") ||
                        document.querySelector(`label[for="${r.id}"]`);
                      return {
                        id: r.id,
                        value: r.value,
                        labelText: label ? label.textContent.trim() : "",
                        checked: r.checked,
                      };
                    });
                  })
                  .catch(() => []);
                log(
                  `  -> Available radio options: ${JSON.stringify(
                    availableRadios
                  )}`
                );
              } catch (_) { }
            }
          } // End of hasRadioButtons check
        } // End of else if (answer.type === "radio")

        // CHECKBOX HANDLING: Select "yes" or first checkbox when checkboxes are present
        if (hasCheckboxes && !didAnswer) {
          log(
            `  -> [Checkbox] Detected checkboxes, attempting to select "yes" or first option...`
          );

          try {
            const checkboxResult = await pg.evaluate(() => {
              // Find all checkboxes in the modal
              const modalSelectors = [
                ".chatbot_DrawerContentWrapper",
                "[class*='chatbot_DrawerContentWrapper']",
                "[class*='chatbot']",
                "[role='dialog']",
                ".multicheckboxes-container",
                "[class*='multicheckbox']",
              ];

              let modal = null;
              for (const selector of modalSelectors) {
                modal = document.querySelector(selector);
                if (modal) break;
              }

              const searchContext = modal || document.body;
              const checkboxes = Array.from(
                searchContext.querySelectorAll('input[type="checkbox"]')
              );

              if (checkboxes.length === 0) {
                return { success: false, message: "No checkboxes found" };
              }

              // Try to find and check the "yes" checkbox first
              let yesCheckbox = null;
              for (const cb of checkboxes) {
                const id = (cb.id || "").toLowerCase();
                const value = (cb.value || "").toLowerCase();
                const label =
                  cb.closest("label") ||
                  document.querySelector(`label[for="${cb.id}"]`);
                const labelText = label
                  ? label.textContent.trim().toLowerCase()
                  : "";

                if (id === "yes" || value === "yes" || labelText === "yes") {
                  yesCheckbox = cb;
                  break;
                }
              }

              // If "yes" checkbox found, check it
              if (yesCheckbox) {
                yesCheckbox.checked = true;
                yesCheckbox.dispatchEvent(
                  new Event("change", { bubbles: true, cancelable: true })
                );
                yesCheckbox.dispatchEvent(
                  new Event("click", { bubbles: true, cancelable: true })
                );
                yesCheckbox.dispatchEvent(
                  new Event("input", { bubbles: true, cancelable: true })
                );
                return {
                  success: true,
                  message: "Selected 'yes' checkbox",
                  selected: "yes",
                };
              }

              // If no "yes" checkbox, check the first one
              const firstCheckbox = checkboxes[0];
              if (firstCheckbox) {
                firstCheckbox.checked = true;
                firstCheckbox.dispatchEvent(
                  new Event("change", { bubbles: true, cancelable: true })
                );
                firstCheckbox.dispatchEvent(
                  new Event("click", { bubbles: true, cancelable: true })
                );
                firstCheckbox.dispatchEvent(
                  new Event("input", { bubbles: true, cancelable: true })
                );
                const label =
                  firstCheckbox.closest("label") ||
                  document.querySelector(`label[for="${firstCheckbox.id}"]`);
                const labelText = label
                  ? label.textContent.trim()
                  : firstCheckbox.value || firstCheckbox.id;
                return {
                  success: true,
                  message: "Selected first checkbox",
                  selected: labelText,
                };
              }

              return {
                success: false,
                message: "Could not select any checkbox",
              };
            });

            if (checkboxResult.success) {
              didAnswer = true;
              log(
                `  -> ✅ [Checkbox] ${checkboxResult.message}: "${checkboxResult.selected}"`
              );
              await pg.waitForTimeout(500);
            } else {
              log(`  -> ❌ [Checkbox] ${checkboxResult.message}`);
            }
          } catch (checkboxError) {
            log(`  -> ❌ [Checkbox] Error: ${checkboxError.message}`);
          }
        }
      } else {
        // Fallback: try to answer based on common patterns
        log(`  -> No smart match found, using fallback logic`);

        // Fallback 1: Notice period - handle both radio and text input
        if (
          !didAnswer &&
          (await pg
            .locator("text=/notice period/i")
            .first()
            .isVisible({ timeout: 500 })
            .catch(() => false))
        ) {
          const toSelect = prof.noticePeriod || "15 Days or less";
          log(`  -> notice (fallback): "${toSelect}"`);

          // Try radio first if available
          if (hasRadioButtons) {
            try {
              const r = pg
                .getByRole("radio", {
                  name: new RegExp(toSelect.replace(/\s+/g, "\\s*"), "i"),
                })
                .first();
              if (await r.isVisible({ timeout: 400 }).catch(() => false)) {
                await r.scrollIntoViewIfNeeded().catch(() => { });
                await r.check().catch(() => r.click());
                didAnswer = true;
                log(`  -> Notice period filled via radio: "${toSelect}"`);
              } else {
                // Try common radio options
                const radioOptions = [
                  "15 Days or less",
                  "0-15 days",
                  "15 days or less",
                ];
                for (const opt of radioOptions) {
                  try {
                    const radio = pg.getByText(opt, { exact: false }).first();
                    if (
                      await radio.isVisible({ timeout: 300 }).catch(() => false)
                    ) {
                      await radio.click();
                      didAnswer = true;
                      log(
                        `  -> Notice period filled via radio (fallback): "${opt}"`
                      );
                      break;
                    }
                  } catch (_) { }
                }
              }
            } catch (_) { }
          }

          // If radio didn't work or text input is available, try text input
          if (!didAnswer && hasInputField) {
            try {
              const inp = pg
                .locator('[contenteditable="true"], input[type="text"]')
                .first();
              if (await inp.isVisible({ timeout: 400 }).catch(() => false)) {
                await inp.fill("15 days");
                await pg.waitForTimeout(300);
                didAnswer = true;
                log(`  -> Notice period filled via text input: "15 days"`);
              }
            } catch (_) { }
          }
        }

        // Fallback 2: Experience questions
        if (!didAnswer && /experience|years?/i.test(body)) {
          const inp = pg
            .locator(
              `${TYPE_MESSAGE_SELECTOR}, input[type="text"], input[type="number"]`
            )
            .first();
          if (await inp.isVisible({ timeout: 500 }).catch(() => false)) {
            log(`  -> experience (fallback): filling "${expY}"`);
            await fillTypeMessage(inp, String(expY));
            didAnswer = true;
          }
        }

        // Fallback 3: Yes/No questions - default to Yes
        if (
          !didAnswer &&
          (await pg
            .locator(
              'input[type="radio"][id="Yes"], input[type="radio"][value="Yes"]'
            )
            .first()
            .isVisible({ timeout: 400 })
            .catch(() => false)) &&
          (await pg
            .locator(
              'input[type="radio"][id="No"], input[type="radio"][value="No"]'
            )
            .first()
            .isVisible({ timeout: 300 })
            .catch(() => false))
        ) {
          log(`  -> Yes/No (fallback): selecting "Yes"`);
          try {
            const yesRadio = pg
              .locator(
                'input[type="radio"][id="Yes"], input[type="radio"][value="Yes"]'
              )
              .first();
            if (await yesRadio.isVisible({ timeout: 400 }).catch(() => false)) {
              await yesRadio.scrollIntoViewIfNeeded().catch(() => { });
              await yesRadio.check().catch(() => yesRadio.click());
              didAnswer = true;
            }
          } catch (_) { }
        }
      }

      // Only proceed to Save if we actually answered
      if (didAnswer) {
        // Wait a bit after filling before looking for Save (React needs time to enable Save)
        log(
          `  -> [Wait] Waiting 3 seconds for React to enable Save button (Slow Mode)...`
        );
        await pg.waitForTimeout(3000);

        // Verify one final time that the answer is still there (for text inputs)
        if (answer && answer.type === "text") {
          const verificationResult = await pg
            .evaluate((val) => {
              // Try to find modal, but search entire document if not found
              const modalSelectors = [
                ".chatbot_DrawerContentWrapper",
                '[class*="chatbot_DrawerContentWrapper"]',
                '[class*="DrawerContentWrapper"]',
                '[class*="chatbot"]',
                '[class*="drawer"]',
                '[role="dialog"]',
              ];

              let modal = null;
              for (const selector of modalSelectors) {
                modal = document.querySelector(selector);
                if (modal) break;
              }

              const searchContext = modal || document.body;
              const inputs = searchContext.querySelectorAll(
                '[contenteditable="true"], input[type="text"], input[type="number"]'
              );
              const values = [];
              for (const inp of inputs) {
                let currentValue = "";
                if (
                  inp.isContentEditable ||
                  inp.getAttribute?.("contenteditable") === "true"
                ) {
                  currentValue = inp.textContent.trim() || inp.innerText.trim();
                } else {
                  currentValue = inp.value.trim();
                }
                values.push(currentValue);
                // Check for exact match OR if values contain each other (more lenient)
                const valLower = val.toLowerCase();
                const currentLower = currentValue.toLowerCase();
                if (
                  currentValue === val ||
                  currentLower === valLower ||
                  currentLower.includes(valLower) ||
                  valLower.includes(currentLower)
                ) {
                  return { found: true, values, match: currentValue };
                }
              }
              return { found: false, values, reason: "no match" };
            }, String(answer.value).trim())
            .catch(() => ({ found: false, values: [], reason: "error" }));

          if (!verificationResult.found) {
            log(
              `  -> WARNING: Final verification uncertain. Expected: "${answer.value
              }", Found: ${JSON.stringify(
                verificationResult.values
              )}. Proceeding anyway...`
            );
            // Don't set didAnswer=false here; let it proceed since applications are succeeding
            // didAnswer = false; // REMOVED - let it try to Save anyway
          } else {
            log(
              `  -> ✓ Final verification passed: "${verificationResult.match}"`
            );
          }
        }

        // Only click Save if we verified the answer
        if (didAnswer) {
          const saved = await clickSave();
          if (!saved) {
            log(
              "  -> Save button not found or disabled, checking page state..."
            );

            // Check for "thank you for your response" FIRST - this is success!
            const thankYouCheck = await pg
              .evaluate(() => document.body.innerText)
              .catch(() => "");

            if (
              /thank you for your response|thanks for your response/i.test(
                thankYouCheck
              )
            ) {
              log(
                "  -> ✅ [SUCCESS] 'Thank you for your response' detected after Save attempt!"
              );
              thankYouReceived = true;
              await pg.waitForTimeout(3000); // Wait for redirect
              if (pg.url().includes("/myapply/saveApply")) {
                redirectedToSaveApply = true;
              }
              break;
            }

            // Check if modal closed (DON'T break immediately - check for thank you first)
            const modalStillOpen = await pg
              .evaluate(() => {
                const modal = document.querySelector(
                  ".chatbot_DrawerContentWrapper, [class*='chatbot'], [class*='Modal'], [role='dialog']"
                );
                return (
                  modal && window.getComputedStyle(modal).display !== "none"
                );
              })
              .catch(() => true);

            if (!modalStillOpen) {
              log(
                "  -> Modal closed, waiting 10s to see if it's a slow transition or success..."
              );
              await pg.waitForTimeout(10000); // 10 second wait!

              const finalCheck = await pg
                .evaluate(() => document.body.innerText)
                .catch(() => "");

              if (
                /thank you for your response|thanks for your response|successfully applied/i.test(
                  finalCheck
                )
              ) {
                log(
                  "  -> ✅ [SUCCESS] 'Thank you for your response' detected after modal closed!"
                );
                thankYouReceived = true;
                break;
              }

              // Check for new questions that might have appeared after a delay
              const hasNewQuestions =
                /Kindly answer|Type message here|recruiter's questions|What is your|Please select|relocate|How many years of experience|years of exp|residing|willing to relocate|Are you|Do you|radio-button|Yes.*No|No.*Yes/i.test(
                  finalCheck
                );

              if (hasNewQuestions) {
                log(
                  "  -> [Action] New questions detected after modal closed, continuing loop..."
                );
                iter++;
                continue;
              }

              if (
                pg.url().includes("/myapply/saveApply") ||
                /Applied\s*$/m.test(finalCheck)
              ) {
                log("  -> ✅ [SUCCESS] Background status shows 'Applied'!");
                thankYouReceived = true;
                break;
              }

              log(
                "  -> [Wait] Modal still not found, assuming something went wrong or slow transition. Retrying loop..."
              );
              iter++;
              continue; // Keep looping instead of breaking
            }

            // If modal still open and Save not found, might be stuck
            if (iter >= maxIter - 1) {
              log("  -> Max iterations reached, exiting loop");
              break;
            }
            // Continue to next iteration - maybe more questions
            log("  -> Save not found but modal still open, continuing...");
            await pg.waitForTimeout(2000);
          }
          await pg.waitForTimeout(2000);
        } else {
          log(`  -> Answer verification failed, skipping Save button click`);
          failedToAnswerCount++;
        }
      } else {
        // If we didn't answer, log why and don't click Save
        if (!answer) {
          log(
            `  -> No answer found for question: "${currentQuestion || "unknown"
            }"`
          );
        } else {
          log(
            `  -> Answer found but could not fill: ${answer.type} = "${answer.value}"`
          );
        }
        log(`  -> Skipping Save button click - no answer provided`);
        failedToAnswerCount++;
      }

      // Track successful answers
      if (didAnswer) {
        questionsAnsweredCount++;
      }

      iter++;
    }

    // Log summary of question answering
    log(``);
    log(`  -> ========================================`);
    log(`  -> [Summary] Questions Loop Complete`);
    log(`  -> [Summary] Total Iterations: ${iter}`);
    log(`  -> [Summary] Questions Answered: ${questionsAnsweredCount}`);
    log(`  -> [Summary] Questions Failed: ${failedToAnswerCount}`);
    log(
      `  -> [Summary] Thank You Received: ${thankYouReceived ? "✅ YES" : "❌ NO"
      }`
    );
    log(
      `  -> [Summary] Redirected to SaveApply: ${redirectedToSaveApply ? "✅ YES" : "❌ NO"
      }`
    );
    log(`  -> ========================================`);
    log(``);

    // CRITICAL: Primary success determination based on "thank you for your response"
    // This is the ONLY reliable way to know application was successful
    if (thankYouReceived || redirectedToSaveApply) {
      log(
        `  -> ✅ APPLICATION SUCCESSFUL! (Thank You: ${thankYouReceived}, Redirect: ${redirectedToSaveApply})`
      );

      // Add to appliedJobs array
      appliedJobs.push({
        timestamp: new Date().toISOString(),
        jobTitle,
        company: companyName,
        status: "Applied",
      });

      // Immediately send applied status to API after successful application
      log(`[API] Sending applied status to collection...`);
      try {
        await updateLeadApplied(job, true);
        log(`[API] ✅ Applied status sent successfully for ${jobTitle}`);
      } catch (apiErr) {
        log(`[API] ⚠ Failed to send applied status: ${apiErr.message}`);
      }

      return true;
    }

    // Step 4: Verify application success/failure - Enhanced robust detection
    log("Step 4: Verifying application status (fallback check)...");
    log("  -> [Verification] Waiting 3 seconds for page to settle...");
    await pg.waitForTimeout(3000);

    // Get current URL and page content
    const currentUrl = pg.url();
    const pageText = await pg
      .evaluate(() => document.body.innerText)
      .catch(() => "");

    // Check multiple indicators of success/failure
    const applicationStatus = await pg
      .evaluate(() => {
        const result = {
          success: false,
          reason: "",
          indicators: {
            redirectedToSaveApply: false,
            modalClosed: false,
            appliedButtonFound: false,
            appliedTextFound: false,
            errorMessagesFound: false,
            stillOnJobPage: false,
            successMessageFound: false,
          },
        };

        // Indicator 1: Check if redirected to success page
        if (window.location.href.includes("/myapply/saveApply")) {
          result.indicators.redirectedToSaveApply = true;
          result.success = true;
          result.reason = "redirected to saveApply page";
          return result;
        }

        // Indicator 2: Check if still on job detail page
        const isOnJobPage =
          window.location.href.includes("/job-listings/") ||
          window.location.href.includes("/viewjob/") ||
          window.location.href.includes("/job-details/");
        result.indicators.stillOnJobPage = isOnJobPage;

        // Indicator 3: Check if modal is closed (application completed)
        const modal = document.querySelector(
          '.chatbot_DrawerContentWrapper, [class*="chatbot"], [class*="DrawerContentWrapper"]'
        );
        const modalVisible =
          modal &&
          window.getComputedStyle(modal).display !== "none" &&
          window.getComputedStyle(modal).visibility !== "hidden";
        result.indicators.modalClosed = !modalVisible;

        // Indicator 4: Check for "Applied" button (more specific selectors)
        const appliedButtonSelectors = [
          'button:has-text("Applied")',
          'button[class*="applied"]',
          'button[class*="Applied"]',
          '[class*="applied-button"]',
          'a:has-text("Applied")',
        ];
        let appliedButton = null;
        for (const selector of appliedButtonSelectors) {
          try {
            const btn = document.querySelector(selector);
            if (btn && btn.offsetParent !== null) {
              // Check if visible
              appliedButton = btn;
              break;
            }
          } catch (_) { }
        }
        result.indicators.appliedButtonFound = !!appliedButton;

        // Indicator 5: Check for "Applied" text or "thank you for your response" (but make sure it's not just "Apply")
        const bodyText = document.body.innerText || "";
        const hasAppliedText =
          /Applied\s*$/m.test(bodyText) ||
          /Successfully\s+Applied/i.test(bodyText) ||
          /Your\s+application\s+has\s+been\s+submitted/i.test(bodyText) ||
          /Application\s+submitted/i.test(bodyText) ||
          /thank you for your response/i.test(bodyText) ||
          /thanks for your response/i.test(bodyText);
        const hasApplyText =
          /Apply\s*$/m.test(bodyText) || /Click\s+to\s+Apply/i.test(bodyText);
        result.indicators.appliedTextFound = hasAppliedText && !hasApplyText;

        // NEW: Check specifically for "thank you for your response" - definite success
        if (/thank you for your response/i.test(bodyText)) {
          result.indicators.successMessageFound = true;
          result.success = true;
          result.reason = "thank you for your response detected";
          return result;
        }

        // Indicator 6: Check for error messages (comprehensive list)
        const errorPatterns = [
          /something\s+went\s+wrong/i,
          /error/i,
          /failed/i,
          /try\s+again/i,
          /please\s+try\s+again/i,
          /unable\s+to\s+process/i,
          /application\s+failed/i,
          /could\s+not\s+apply/i,
          /unable\s+to\s+submit/i,
        ];
        const foundErrors = errorPatterns.some((pattern) =>
          pattern.test(bodyText)
        );
        result.indicators.errorMessagesFound = foundErrors;

        // Indicator 7: Check for success messages
        const successPatterns = [
          /successfully\s+applied/i,
          /application\s+submitted/i,
          /your\s+application\s+has\s+been/i,
          /applied\s+successfully/i,
        ];
        result.indicators.successMessageFound = successPatterns.some(
          (pattern) => pattern.test(bodyText)
        );

        // Decision logic: Only mark as success if multiple positive indicators
        if (result.indicators.errorMessagesFound) {
          result.success = false;
          result.reason = "error messages found on page";
          return result;
        }

        // Success conditions (need at least 2 positive indicators):
        const positiveIndicators = [
          result.indicators.redirectedToSaveApply,
          result.indicators.appliedButtonFound,
          result.indicators.appliedTextFound,
          result.indicators.successMessageFound,
        ].filter(Boolean).length;

        // If modal is closed AND we have positive indicators, it's likely success
        if (result.indicators.modalClosed && positiveIndicators >= 1) {
          result.success = true;
          result.reason = `modal closed with ${positiveIndicators} positive indicator(s)`;
          return result;
        }

        // If we have multiple positive indicators, it's success
        if (positiveIndicators >= 2) {
          result.success = true;
          result.reason = `${positiveIndicators} positive indicators found`;
          return result;
        }

        // If modal is still open, it's definitely not success
        if (result.indicators.modalClosed === false) {
          result.success = false;
          result.reason = "modal still open - application incomplete";
          return result;
        }

        // If we're still on job page but no clear indicators, check for "Applied" status more carefully
        if (isOnJobPage) {
          // Check if Apply button is replaced with Applied button
          const applyButtons = document.querySelectorAll("button, a");
          let hasAppliedButton = false;
          let hasApplyButton = false;
          for (const btn of applyButtons) {
            const text = btn.textContent.trim();
            if (/^Applied$/i.test(text)) {
              hasAppliedButton = true;
            }
            if (/^Apply$/i.test(text) || /I am interested/i.test(text)) {
              hasApplyButton = true;
            }
          }

          if (hasAppliedButton && !hasApplyButton) {
            result.success = true;
            result.reason = "Apply button replaced with Applied button";
            return result;
          }
        }

        // Default: unknown/failed
        result.success = false;
        result.reason = "insufficient positive indicators";
        return result;
      })
      .catch((e) => {
        log(`  -> Error evaluating application status: ${e.message}`);
        return {
          success: false,
          reason: "evaluation error: " + e.message,
          indicators: {},
        };
      });

    // Log detailed status
    log(`  -> ========================================`);
    log(`  -> [Verification] Application Status Check`);
    log(`  -> ========================================`);
    log(`  -> [Current URL] ${currentUrl}`);
    log(
      `  -> [Questions] Answered: ${questionsAnsweredCount}, Failed: ${failedToAnswerCount}`
    );
    log(
      `  -> [Indicators] ${JSON.stringify(
        applicationStatus.indicators || {},
        null,
        2
      )}`
    );
    log(`  -> [Reason] ${applicationStatus.reason}`);
    log(`  -> ========================================`);

    // Final decision with additional URL check and failed answer tracking
    let isSuccess = false;

    // If we failed to answer multiple questions, be more strict about success
    const hasManyFailedAnswers = failedToAnswerCount >= 2;
    const hasAnsweredQuestions = questionsAnsweredCount > 0;

    // Log summary for debugging
    log(``);
    log(`  -> [Decision Summary]`);
    log(`  -> Questions Answered: ${questionsAnsweredCount}`);
    log(`  -> Questions Failed: ${failedToAnswerCount}`);
    log(`  -> Thank You Received: ${thankYouReceived ? "YES" : "NO"}`);
    log(`  -> Current URL: ${currentUrl.substring(0, 100)}...`);
    log(``);

    // CRITICAL: Primary success check - "thank you for your response" or redirect to saveApply
    // These are the ONLY definitive success indicators

    // Also check page text one more time for "thank you for your response"
    const finalThankYouCheck =
      /thank you for your response|thanks for your response|successfully applied/i.test(
        pageText
      );
    if (finalThankYouCheck && !thankYouReceived) {
      thankYouReceived = true;
      log(`  -> [Final Check] Found confirmation in page text!`);
    }

    // SUCCESS: "thank you for your response" received OR redirected to saveApply
    if (thankYouReceived) {
      isSuccess = true;
      log(`  -> ✓ SUCCESS: Confirmation message was received!`);
    }
    // SUCCESS: Redirected to saveApply page (always success)
    else if (currentUrl.includes("/myapply/saveApply")) {
      isSuccess = true;
      log(`  -> ✓ SUCCESS: Redirected to saveApply page`);
    }
    // SUCCESS: If we are on the job page and the Apply button is now "Applied"
    else if (pageText.includes("Applied") && !pageText.includes("Apply to")) {
      isSuccess = true;
      log(`  -> ✓ SUCCESS: 'Applied' status detected on job page`);
    }
    // FAILURE: Error messages found
    else if (applicationStatus.indicators?.errorMessagesFound) {
      isSuccess = false;
      log(`  -> ✗ FAILED: Error messages found on page`);
    }
    // FAILURE: Modal still open - application incomplete
    else if (applicationStatus.indicators?.modalClosed === false) {
      isSuccess = false;
      log(`  -> ✗ FAILED: Modal still open - application incomplete`);
    }
    // FAILURE: No "thank you for your response" received - this is the CRITICAL check
    else if (!thankYouReceived && hasAnsweredQuestions) {
      // One last check for "Applied" button
      const appliedBtn = await pg
        .locator('button:has-text("Applied")')
        .first()
        .isVisible()
        .catch(() => false);
      if (appliedBtn) {
        isSuccess = true;
        log(
          `  -> ✓ SUCCESS: 'Applied' button visible despite no thank you message`
        );
      } else {
        isSuccess = false;
        log(
          `  -> ✗ FAILED: Answered ${questionsAnsweredCount} questions but NO confirmation received!`
        );
        log(
          `  -> [Info] Without confirmation, application is considered FAILED`
        );
      }
    }
    // FAILURE: No questions answered and no redirect
    else if (
      !hasAnsweredQuestions &&
      !currentUrl.includes("/myapply/saveApply")
    ) {
      isSuccess = false;
      log(
        `  -> ✗ FAILED: No questions answered - modal closed prematurely or application didn't start`
      );
    }
    // FAILURE: Default - no definitive success indicator
    else {
      isSuccess = false;
      log(
        `  -> ✗ FAILED: No definitive success indicator (no "thank you for your response")`
      );
    }

    log(``);
    if (isSuccess) {
      appliedJobs.push({
        timestamp: new Date().toISOString(),
        jobTitle,
        company: companyName,
        status: "Applied",
      });
      log(`╔════════════════════════════════════════════════════════════╗`);
      log(`║  ✅ APPLICATION SUCCESSFUL!                                 ║`);
      log(`╠════════════════════════════════════════════════════════════╣`);
      log(`║  Job: ${jobTitle.padEnd(52)}║`);
      log(`║  Company: ${companyName.padEnd(48)}║`);
      log(
        `║  Questions Answered: ${String(questionsAnsweredCount).padEnd(39)}║`
      );
      log(`╚════════════════════════════════════════════════════════════╝`);
      log(``);

      // Immediately send applied status to API after successful application
      log(`[API] Sending applied status to collection...`);
      try {
        await updateLeadApplied(job, true);
        log(`[API] ✅ Applied status sent successfully for ${jobTitle}`);
      } catch (apiErr) {
        log(`[API] ⚠ Failed to send applied status: ${apiErr.message}`);
      }

      return true;
    } else {
      log(`╔════════════════════════════════════════════════════════════╗`);
      log(`║  ❌ APPLICATION FAILED                                      ║`);
      log(`╠════════════════════════════════════════════════════════════╣`);
      log(`║  Job: ${jobTitle.padEnd(52)}║`);
      log(`║  Company: ${companyName.padEnd(48)}║`);
      log(`║  Reason: ${applicationStatus.reason.padEnd(49)}║`);
      log(`║  Failed Questions: ${String(failedToAnswerCount).padEnd(39)}║`);
      log(`╚════════════════════════════════════════════════════════════╝`);
      log(``);
      return false;
    }
  } catch (e) {
    console.warn("[Apply] error:", e.message);
    log(`╔════════════════════════════════════════════════════════════╗`);
    log(`║  ❌ APPLICATION ERROR                                       ║`);
    log(`╠════════════════════════════════════════════════════════════╣`);
    log(`║  Job: ${jobTitle.padEnd(52)}║`);
    log(`║  Error: ${e.message.padEnd(50)}║`);
    log(`╚════════════════════════════════════════════════════════════╝`);
    log(``);
    return false;
  }
}

// Detect "Target page, context or browser has been closed" so we exit the cycle without crashing
function isBrowserClosedError(err) {
  if (!err || !err.message) return false;
  const m = String(err.message);
  return (
    /Target page, context or browser has been closed/i.test(m) ||
    /browser has been closed/i.test(m)
  );
}

// Main automation: open search URL, per page: (1) extract+POST all jobs, (2) apply to relevant only, (3) update API applied, (4) next page.
// opts.runNow = true: run immediately (e.g. POST /run-now), bypasses isRunning check.
async function runAutomationCycle(opts) {
  if (!isRunning && !(opts && opts.runNow)) return;
  if (cycleInProgress) {
    console.log("Cycle already in progress, skipping this scheduled run.");
    return;
  }
  cycleInProgress = true;
  try {
    if (!browser || !page) await initializeBrowser();
    await searchJobs();

    const cardSelectors =
      'div.cust-job-tuple, [class*="sjw__tuple"], .jobTuple, .jobCard, a.title[href*="job-listings"]';
    try {
      await page.waitForSelector(cardSelectors, {
        state: "visible",
        timeout: 15000,
      });
      await page.waitForTimeout(1500);
    } catch (e) {
      if (isBrowserClosedError(e)) throw e;
      console.warn(
        "No job cards found after 15s; proceeding with extraction anyway."
      );
    }

    let cvSkills = [];
    let cvDetails = {};
    try {
      cvSkills = await loadCVSkills();
      cvDetails = await loadCVDetails();
      console.log(
        "CV: skills=" +
        cvSkills.length +
        ", notice=" +
        (cvDetails.noticePeriod || "2 Months")
      );
    } catch (e) {
      console.warn("CV load failed, using fallbacks:", e.message);
      cvSkills = [
        "node",
        "react",
        "mern",
        "gen ai",
        "javascript",
        "python",
        "langchain",
        "langgraph",
        "full stack",
        "nlp",
        "chatbot",
        "ai",
      ];
      cvDetails = {
        noticePeriod: "15 Days or less",
        experienceYears: 5,
        dateOfBirth: "05/01/1998",
      };
    }

    let pageNum = 1;
    let totalPosted = 0;

    // Sort by date ONCE at the beginning - don't sort inside the loop as it resets pagination to page 1
    console.log("Sorting by date (one time at start)...");
    await sortByDate();
    await page.waitForTimeout(3000);

    while (true) {
      await page.waitForTimeout(2000);
      // NOTE: sortByDate removed from here - calling it resets Naukri pagination to page 1

      const jobs = await extractJobsFromPage();
      if (!jobs || jobs.length === 0) {
        console.log(`Page ${pageNum}: no job cards found, stopping.`);
        break;
      }
      const searchUrl = page.url();
      console.log(
        `Page ${pageNum}: extracted ${jobs.length} jobs. Phase 1: extract+POST...`
      );

      // --- Phase 1: extract emails, POST each job (applied: false) ---
      for (const j of jobs) {
        try {
          j.emails = await extractEmailsFromJobDetail(page, j.jobUrl);
          await page.waitForTimeout(1000);
          // NOTE: sortByDate removed - it resets pagination to page 1
          const payload = buildLeadsPayload({ ...j, applied: false });
          const ok = await postJobToLeadsApi(payload);
          if (ok) totalPosted++;
          await page.waitForTimeout(10000);
        } catch (e) {
          if (isBrowserClosedError(e)) {
            console.log("Browser or page was closed; stopping job loop.");
            break;
          }
          throw e;
        }
      }

      // --- Phase 2: apply only to relevant jobs (2+ skill match, prefer Node/Gen AI/MERN/Full stack, avoid Java/.NET/PHP/Flutter) ---
      for (let i = 0; i < jobs.length; i++) {
        const j = jobs[i];
        if (!isRelevantJob(j, cvSkills, cvDetails)) {
          j.applied = false;
          continue;
        }
        if (j.applied) {
          continue; // already applied (from card "Applied" or we just applied)
        }
        try {
          // Navigate to job and apply (removed sortByDate calls - they reset pagination)
          await page.goto(j.jobUrl, {
            waitUntil: "domcontentloaded",
            timeout: 15000,
          });
          await page.waitForTimeout(2000);
          const ok = await applyToJob(page, j, cvDetails);
          j.applied = !!ok;

          // Wait 5 seconds after applying before going back
          await page.waitForTimeout(5000);

          // After apply, page may be on /myapply/saveApply; goto search list to stay in sync
          await page
            .goto(searchUrl, { waitUntil: "domcontentloaded", timeout: 15000 })
            .catch(() => { });
          await page.waitForTimeout(2000);
          // NOTE: sortByDate removed - it resets pagination to page 1
        } catch (e) {
          if (isBrowserClosedError(e)) break;
          j.applied = false;
          try {
            await page
              .goto(searchUrl, {
                waitUntil: "domcontentloaded",
                timeout: 15000,
              })
              .catch(() => { });
            await page.waitForTimeout(1000);
            // NOTE: sortByDate removed - it resets pagination to page 1
          } catch (_) { }
        }
      }

      // --- Phase 3: update API with applied for each job ---
      for (const j of jobs) {
        try {
          await updateLeadApplied(j, !!j.applied);
          await page.waitForTimeout(500);
        } catch (_) { }
      }

      // --- Phase 4: next page ---
      try {
        // Make sure we're on the search page before navigating to next page
        await page
          .goto(searchUrl, { waitUntil: "domcontentloaded", timeout: 15000 })
          .catch(() => { });
        await page.waitForTimeout(1000);
        // NOTE: sortByDate removed - it resets pagination to page 1

        const hasNext = await clickNextPage(pageNum, searchUrl);
        if (!hasNext) break;
        pageNum++;
        await page.waitForTimeout(4000);
        // searchUrl will be recaptured at the start of the next loop iteration
      } catch (e) {
        if (isBrowserClosedError(e)) break;
        throw e;
      }
    }

    console.log(`Cycle done. Posted ${totalPosted} jobs to API.`);
  } catch (error) {
    if (isBrowserClosedError(error)) {
      console.log(
        "Browser or page was closed; exiting automation cycle. Use POST /stop then POST /start to restart."
      );
      stopNaukriAutomation();
      return;
    }
    console.error("Error in automation cycle:", error);
  } finally {
    cycleInProgress = false;
    try {
      await closeBrowser();
    } catch (_) { }
  }
}

// Schedule: 6:00 AM, 9:00 AM, 12:00 PM, 2:15 PM (server local time). Set TZ env if you need another timezone.
const CRON_SCHEDULES = [
  { cron: "0 6 * * *", label: "6:00 AM" },
  { cron: "0 9 * * *", label: "9:00 AM" },
  { cron: "0 12 * * *", label: "12:00 PM" },
  { cron: "15 14 * * *", label: "2:15 PM" },
];

// Schedule for extract-only job posting: 10:00 AM and 5:00 PM
const EXTRACT_ONLY_SCHEDULES = [
  { cron: "0 10 * * *", label: "10:00 AM" },
  { cron: "0 17 * * *", label: "5:00 PM" },
];

let extractOnlyTasks = [];

// Build next page URL for Naukri pagination
// Naukri uses: /xxx-jobs (page 1) -> /xxx-jobs-2 (page 2) -> /xxx-jobs-3, etc.
function buildNaukriPageUrl(baseUrl, pageNum) {
  if (pageNum <= 1) return baseUrl;

  // Remove existing page number suffix if present (e.g., -jobs-2 -> -jobs)
  let cleanUrl = baseUrl.replace(/-(\d+)(\?|$)/, '$2');

  // Also handle case where URL ends with -jobs-N
  cleanUrl = cleanUrl.replace(/-jobs-\d+/, '-jobs');

  // Split URL and query string
  const [path, query] = cleanUrl.split('?');

  // Add page number suffix before query string
  const newPath = path.endsWith('-jobs') ? `${path}-${pageNum}` : `${path}-${pageNum}`;

  return query ? `${newPath}?${query}` : newPath;
}

// Extract jobs and POST to API only (no applying). Runs through all pages.
async function extractAndPostJobsOnly(opts = {}) {
  const isManualTrigger = opts.runNow === true;

  if (cycleInProgress) {
    console.log("[Extract-Only] Cycle already in progress, skipping.");
    return { success: false, message: "Cycle already in progress", posted: 0 };
  }

  cycleInProgress = true;
  let totalPosted = 0;
  let totalExtracted = 0;
  let pageNum = 1;

  try {
    console.log("[Extract-Only] Starting job extraction and API posting...");

    if (!browser || !page) await initializeBrowser();
    await searchJobs();

    const cardSelectors =
      'div.cust-job-tuple, [class*="sjw__tuple"], .jobTuple, .jobCard, a.title[href*="job-listings"]';
    try {
      await page.waitForSelector(cardSelectors, {
        state: "visible",
        timeout: 15000,
      });
      await page.waitForTimeout(1500);
    } catch (e) {
      if (isBrowserClosedError(e)) throw e;
      console.warn("[Extract-Only] No job cards found after 15s; proceeding anyway.");
    }

    // Sort by date ONCE at the beginning (not in the loop)
    console.log("[Extract-Only] Sorting by date (one time)...");
    await sortByDate();
    await page.waitForTimeout(3000);

    while (true) {
      console.log(`[Extract-Only] === Processing Page ${pageNum} ===`);
      const currentUrl = page.url();
      console.log(`[Extract-Only] Current URL: ${currentUrl}`);

      await page.waitForTimeout(2000);

      const jobs = await extractJobsFromPage();
      if (!jobs || jobs.length === 0) {
        console.log(`[Extract-Only] Page ${pageNum}: no job cards found, stopping.`);
        break;
      }

      totalExtracted += jobs.length;
      console.log(`[Extract-Only] Page ${pageNum}: extracted ${jobs.length} jobs. Posting to API...`);

      // POST each job to API (without navigating to job detail pages)
      for (let i = 0; i < jobs.length; i++) {
        const j = jobs[i];
        try {
          console.log(`[Extract-Only] Posting job ${i + 1}/${jobs.length}: ${j.jobTitle} @ ${j.companyName}`);

          const payload = buildLeadsPayload({ ...j, emails: [], applied: false });
          const ok = await postJobToLeadsApi(payload);
          if (ok) totalPosted++;

          await page.waitForTimeout(500); // Small delay between API calls
        } catch (e) {
          if (isBrowserClosedError(e)) {
            console.log("[Extract-Only] Browser closed; stopping.");
            break;
          }
          console.error(`[Extract-Only] Error posting job: ${e.message}`);
        }
      }

      console.log(`[Extract-Only] Page ${pageNum} done. Posted ${totalPosted} jobs so far.`);

      // Click on the next page link directly (not URL navigation)
      const nextPageNum = pageNum + 1;
      console.log(`[Extract-Only] Looking for page ${nextPageNum} link...`);

      // Scroll to pagination first
      await page.evaluate(() => {
        const pagination = document.querySelector('[class*="pagination"], #lastCompMark');
        if (pagination) pagination.scrollIntoView({ behavior: 'smooth', block: 'center' });
      });
      await page.waitForTimeout(1000);

      // Try to click the next page number or "Next" button
      const clickedNext = await page.evaluate((nextNum) => {
        const pagination = document.querySelector('[class*="pagination"], #lastCompMark');
        if (!pagination) {
          console.log('No pagination found');
          return { success: false, reason: 'no pagination' };
        }

        // First try: click on the page number link
        const allLinks = pagination.querySelectorAll('a[href]');
        for (const link of allLinks) {
          const text = link.textContent.trim();
          // Check if this link is for the next page number
          if (text === String(nextNum)) {
            const isDisabled = link.hasAttribute('disabled');
            if (!isDisabled) {
              console.log(`Found page ${nextNum} link, clicking...`);
              link.click();
              return { success: true, method: 'page number' };
            }
          }
        }

        // Second try: click "Next" button
        for (const link of allLinks) {
          const text = (link.textContent || '').trim().toLowerCase();
          const isDisabled = link.hasAttribute('disabled');
          if (!isDisabled && text.includes('next')) {
            console.log('Found Next button, clicking...');
            link.click();
            return { success: true, method: 'next button' };
          }
        }

        return { success: false, reason: 'no next link found' };
      }, nextPageNum);

      console.log(`[Extract-Only] Click result:`, clickedNext);

      if (!clickedNext.success) {
        console.log(`[Extract-Only] No more pages (${clickedNext.reason}). Stopping.`);
        break;
      }

      // Wait for navigation and new content
      console.log(`[Extract-Only] Waiting for page ${nextPageNum} to load...`);
      await page.waitForTimeout(4000);

      // Verify we moved to the next page
      const newUrl = page.url();
      console.log(`[Extract-Only] After click, URL is: ${newUrl}`);

      // Check if the page number in pagination is now selected
      const currentSelectedPage = await page.evaluate(() => {
        const pagination = document.querySelector('[class*="pagination"], #lastCompMark');
        if (!pagination) return null;
        const selected = pagination.querySelector('[class*="selected"], .active, a[aria-current="page"]');
        return selected ? selected.textContent.trim() : null;
      });
      console.log(`[Extract-Only] Currently selected page in pagination: ${currentSelectedPage}`);

      // Wait for job cards to appear
      try {
        await page.waitForSelector(cardSelectors, { state: "visible", timeout: 10000 });
        console.log(`[Extract-Only] Job cards loaded on page ${nextPageNum}`);
      } catch (e) {
        console.warn(`[Extract-Only] Job cards not visible on page ${nextPageNum}`);
      }

      pageNum = nextPageNum;
    }

    console.log(`[Extract-Only] Complete. Extracted ${totalExtracted} jobs from ${pageNum} pages, posted ${totalPosted} to API.`);
    return {
      success: true,
      message: `Extracted ${totalExtracted} jobs, posted ${totalPosted} to API`,
      extracted: totalExtracted,
      posted: totalPosted,
      pages: pageNum,
    };
  } catch (error) {
    if (isBrowserClosedError(error)) {
      console.log("[Extract-Only] Browser closed; exiting.");
      return { success: false, message: "Browser closed", posted: totalPosted };
    }
    console.error("[Extract-Only] Error:", error);
    return { success: false, message: error.message, posted: totalPosted };
  } finally {
    cycleInProgress = false;
    try {
      await closeBrowser();
    } catch (_) { }
  }
}

// Start the extract-only scheduler (10 AM and 5 PM)
function startExtractOnlyScheduler() {
  for (const { cron: c, label } of EXTRACT_ONLY_SCHEDULES) {
    const t = cron.schedule(c, async () => {
      console.log(`[Scheduled Extract-Only ${label}] Starting job extraction...`);
      await extractAndPostJobsOnly();
    });
    extractOnlyTasks.push(t);
  }
  console.log("Extract-only scheduler started at 10:00 AM and 5:00 PM (server local time).");
}

// Stop the extract-only scheduler
function stopExtractOnlyScheduler() {
  for (const t of extractOnlyTasks) {
    try {
      t.stop?.();
    } catch (_) { }
  }
  extractOnlyTasks = [];
  console.log("Extract-only scheduler stopped.");
}

// Start the automation (sets up scheduled runs only; no run on /start)
async function startNaukriAutomation() {
  if (isRunning) {
    console.log("Scheduler is already running");
    return;
  }

  try {
    isRunning = true;
    for (const { cron: c, label } of CRON_SCHEDULES) {
      const t = cron.schedule(c, async () => {
        console.log(`[Scheduled ${label}] Starting Naukri job fetch...`);
        await runAutomationCycle();
      });
      automationTasks.push(t);
    }
    console.log(
      "Naukri.com automation scheduled at 6:00 AM, 9:00 AM, 12:00 PM, 2:15 PM (server local time)."
    );

    // Also start the extract-only scheduler (10 AM and 5 PM)
    startExtractOnlyScheduler();
  } catch (error) {
    console.error("Error starting automation:", error);
    isRunning = false;
    for (const t of automationTasks) t.stop?.();
    automationTasks = [];
    stopExtractOnlyScheduler();
    throw error;
  }
}

// Stop the automation
function stopNaukriAutomation() {
  for (const t of automationTasks) {
    try {
      t.stop?.();
    } catch (_) { }
  }
  automationTasks = [];
  isRunning = false;

  // Also stop the extract-only scheduler
  stopExtractOnlyScheduler();

  console.log("Naukri.com automation stopped (schedules cleared)");
}

// Close browser
async function closeBrowser() {
  if (browser) {
    await browser.close();
    browser = null;
    page = null;
  }
}

// Get applied jobs
function getAppliedJobs() {
  return appliedJobs;
}

// Cleanup on process exit
process.on("SIGINT", async () => {
  console.log("\nShutting down...");
  stopNaukriAutomation();
  await closeBrowser();
  process.exit(0);
});

// Apply to all jobs starting from job 1 - simplified flow without API posting
async function applyToAllJobs(opts) {
  if (cycleInProgress) {
    console.log("Cycle already in progress, skipping this run.");
    return { success: false, message: "Cycle already in progress" };
  }
  cycleInProgress = true;
  let appliedCount = 0;
  let skippedCount = 0;
  let errorCount = 0;

  try {
    if (!browser || !page) await initializeBrowser();
    await searchJobs();

    const cardSelectors =
      'div.cust-job-tuple, [class*="sjw__tuple"], .jobTuple, .jobCard, a.title[href*="job-listings"]';
    try {
      await page.waitForSelector(cardSelectors, {
        state: "visible",
        timeout: 15000,
      });
      await page.waitForTimeout(1500);
    } catch (e) {
      if (isBrowserClosedError(e)) throw e;
      console.warn("No job cards found after 15s; proceeding anyway.");
    }

    let cvSkills = [];
    let cvDetails = {};
    try {
      cvSkills = await loadCVSkills();
      cvDetails = await loadCVDetails();
      console.log(
        "CV: skills=" +
        cvSkills.length +
        ", notice=" +
        (cvDetails.noticePeriod || "2 Months")
      );
    } catch (e) {
      console.warn("CV load failed, using fallbacks:", e.message);
      cvSkills = [
        "node",
        "react",
        "mern",
        "gen ai",
        "javascript",
        "python",
        "langchain",
        "langgraph",
        "full stack",
        "nlp",
        "chatbot",
        "ai",
      ];
      cvDetails = {
        noticePeriod: "15 Days or less",
        experienceYears: 5,
        dateOfBirth: "05/01/1998",
      };
    }

    let pageNum = 1;

    // Sort by date ONCE at the beginning - don't sort inside the loop as it resets pagination to page 1
    console.log("Sorting by date (one time at start)...");
    await sortByDate();
    await page.waitForTimeout(3000);

    while (true) {
      await page.waitForTimeout(2000);
      // NOTE: sortByDate removed from here - calling it resets Naukri pagination to page 1

      const jobs = await extractJobsFromPage();
      if (!jobs || jobs.length === 0) {
        console.log(`Page ${pageNum}: no job cards found, stopping.`);
        break;
      }

      console.log(``);
      console.log(
        `╔════════════════════════════════════════════════════════════════════════╗`
      );
      console.log(`║  JOBS FOUND ON PAGE ${String(pageNum).padEnd(51)}║`);
      console.log(
        `╠════════════════════════════════════════════════════════════════════════╣`
      );
      jobs.forEach((job, idx) => {
        const title = (job.jobTitle || "Unknown").substring(0, 35);
        const company = (job.companyName || "Unknown").substring(0, 30);
        console.log(
          `║ ${String(idx + 1).padStart(2)}. ${title.padEnd(
            35
          )} | ${company.padEnd(30)} ║`
        );
      });
      console.log(
        `╚════════════════════════════════════════════════════════════════════════╝`
      );
      console.log(``);

      const searchUrl = page.url();
      console.log(
        `Page ${pageNum}: extracted ${jobs.length} jobs. Starting to apply from job 1...`
      );

      // Apply to all jobs starting from job 1 (index 0)
      for (let i = 0; i < jobs.length; i++) {
        const j = jobs[i];
        console.log(``);
        console.log(
          `╔════════════════════════════════════════════════════════════════════════╗`
        );
        console.log(
          `║  PROCESSING JOB ${String(i + 1).padStart(2)}/${String(
            jobs.length
          ).padStart(2)}                                                      ║`
        );
        console.log(
          `╠════════════════════════════════════════════════════════════════════════╣`
        );
        console.log(
          `║  Title: ${(j.jobTitle || "Unknown").substring(0, 60).padEnd(60)}║`
        );
        console.log(
          `║  Company: ${(j.companyName || "Unknown")
            .substring(0, 58)
            .padEnd(58)}║`
        );
        console.log(`║  URL: ${(j.jobUrl || "").substring(0, 61).padEnd(61)}║`);
        console.log(
          `╚════════════════════════════════════════════════════════════════════════╝`
        );
        console.log(``);

        // PRE-NAVIGATION SKIP CHECK (Title and Company)
        const preSkipCheck = shouldSkipJob(j.jobTitle, j.companyName);
        if (preSkipCheck.skip) {
          console.log(
            `[Skip] ⏭️ Skipping job pre-navigation: ${preSkipCheck.reason}`
          );
          skippedCount++;
          continue;
        }

        try {
          // Use the SAME tab for navigation
          console.log(`[Navigation] Going to job details page...`);
          console.log(`[Navigation] URL: ${j.jobUrl}`);
          await page.goto(j.jobUrl, {
            waitUntil: "domcontentloaded",
            timeout: 25000,
          });
          await page.waitForTimeout(2000);
          console.log(
            `[Navigation] ✅ Job page loaded, starting application process...`
          );
          console.log(``);

          // EXTRACT JD TEXT FOR FILTERING
          const jdText = await page
            .evaluate(() => {
              const selectors = [
                ".job-description",
                ".jd-desc",
                "[class*='jobDescription']",
                "#jobDescription",
                "main",
                "body",
              ];
              for (const sel of selectors) {
                const el = document.querySelector(sel);
                if (el) return el.innerText;
              }
              return "";
            })
            .catch(() => "");

          // CHECK IF JOB SHOULD BE SKIPPED
          const skipCheck = shouldSkipJob(j.jobTitle, j.companyName, jdText);
          if (skipCheck.skip) {
            console.log(`[Skip] ⏭️ Skipping job: ${skipCheck.reason}`);
            skippedCount++;

            // Return to search results
            console.log(`[Post-Apply] Returning to job list page...`);
            if (
              !page.url().includes("/jobs") ||
              page.url().includes("saveApply")
            ) {
              await page
                .goto(searchUrl, {
                  waitUntil: "domcontentloaded",
                  timeout: 25000,
                })
                .catch(() => { });
            }
            await page
              .waitForSelector(cardSelectors, {
                state: "visible",
                timeout: 15000,
              })
              .catch(() => { });
            continue;
          }

          const ok = await applyToJob(page, j, cvDetails);

          console.log(``);
          if (ok) {
            appliedCount++;
            console.log(
              `[Job ${i + 1}/${jobs.length}] ✅ APPLIED SUCCESSFULLY`
            );
          } else {
            skippedCount++;
            console.log(
              `[Job ${i + 1}/${jobs.length}] ❌ APPLICATION FAILED OR SKIPPED`
            );
          }

          // AFTER APPLY: RETURN TO JOB LIST PAGE
          console.log(`[Post-Apply] Returning to job list page...`);

          // Use direct search URL navigation - this is the most reliable way to "return"
          // We only do this if we are not already there
          if (
            !page.url().includes("/jobs") ||
            page.url().includes("saveApply")
          ) {
            await page
              .goto(searchUrl, {
                waitUntil: "domcontentloaded",
                timeout: 25000,
              })
              .catch(() => { });
          }

          // Wait for the search list to be visible again
          console.log(`[Post-Apply] Waiting for job list to be ready...`);
          await page
            .waitForSelector(cardSelectors, {
              state: "visible",
              timeout: 15000,
            })
            .catch(() => { });

          await page.waitForTimeout(2000); // Small pause so user can see it's back
          console.log(`[Post-Apply] ✅ Ready to pick the next job.`);
          console.log(``);
        } catch (e) {
          if (isBrowserClosedError(e)) {
            console.log("Browser or page was closed; stopping job loop.");
            break;
          }
          errorCount++;
          console.error(`[Job ${i + 1}/${jobs.length}] Error:`, e.message);

          // Ensure we are back on the search page if an error occurred
          try {
            if (!page.url().includes(searchUrl)) {
              await page.goto(searchUrl, {
                waitUntil: "domcontentloaded",
                timeout: 20000,
              });
            }
          } catch (_) { }
        }
      }

      // --- Next page ---
      try {
        // We should already be on the search page from the last job's Post-Apply
        const hasNext = await clickNextPage(pageNum, searchUrl);
        if (!hasNext) break;
        pageNum++;
        await page.waitForTimeout(4000);
      } catch (e) {
        if (isBrowserClosedError(e)) break;
        throw e;
      }
    }

    console.log(
      `Apply cycle done. Applied: ${appliedCount}, Skipped: ${skippedCount}, Errors: ${errorCount}`
    );
    return {
      success: true,
      applied: appliedCount,
      skipped: skippedCount,
      errors: errorCount,
      message: `Applied to ${appliedCount} jobs, skipped ${skippedCount}, errors: ${errorCount}`,
    };
  } catch (error) {
    if (isBrowserClosedError(error)) {
      console.log("Browser or page was closed; exiting apply cycle.");
      stopNaukriAutomation();
      return { success: false, message: "Browser was closed" };
    }
    console.error("Error in apply cycle:", error);
    return {
      success: false,
      message: error.message,
      applied: appliedCount,
      skipped: skippedCount,
      errors: errorCount,
    };
  } finally {
    cycleInProgress = false;
    try {
      await closeBrowser();
    } catch (_) { }
  }
}

module.exports = {
  startNaukriAutomation,
  stopNaukriAutomation,
  runAutomationCycle,
  applyToAllJobs,
  getAppliedJobs,
  closeBrowser,
  extractAndPostJobsOnly,
};
