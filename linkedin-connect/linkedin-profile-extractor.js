/**
 * LinkedIn Profile Data Extractor
 * Based on browser-automation-log.txt findings
 *
 * FLOW:
 * 1. Login to LinkedIn (https://www.linkedin.com/login)
 * 2. For each city (Noida, Gurugram, Mumbai, Bangalore):
 *    - Open pre-filled URL with keywords + geoUrn (location already filtered)
 *    - Extract all profiles on page (name, company, location, bio, skills)
 *    - Click Next → repeat for all pages until no Next button
 *    - Save all data to linkedin-extracted-profiles.txt
 * 3. Switch to next city, repeat
 * 4. After 4 cities done, process Hyderabad and Chennai with modified keywords
 *
 * PRE-FILLED URLs (no location filter popup interaction needed):
 * - Noida: geoUrn=104869687
 * - Gurugram: geoUrn=106442238
 * - Mumbai: geoUrn=106164952
 * - Bangalore: geoUrn=105214831
 *
 * Extracts: Name, Company, Location, Bio, Skills
 * Uses exact selectors and patterns from manual browser testing
 */

const { chromium } = require("playwright");

// API endpoint for saving profiles to database
const API_ENDPOINT = "https://backend-emails-elxz.onrender.com/api/linkedin-profile-extracted";

// --- CONFIG (from browser-automation-log.txt) ---

// LinkedIn geoUrn IDs (from pre-filled URLs - tested and working)
const GEO_URNS = {
  Noida: "104869687",
  Gurugram: "106442238",
  Mumbai: "106164952",
  Bangalore: "105214831",
  Hyderabad: "106487642", // Will need to verify
  Chennai: "102748797", // Will need to verify
};

// Two campaigns (from requirements)
const CAMPAIGNS = [
  {
    keywords:
      '("Recruiter" OR "Talent Acquisition" OR "Hiring Manager") AND ("Generative AI" OR "GenAI" OR "Full Stack Developer")',
    cities: ["Noida", "Gurugram", "Mumbai", "Bangalore"],
  },
  {
    keywords:
      '("Recruiter" OR "Talent Acquisition" OR "Hiring Manager") AND ("Generative AI" OR "GenAI" OR "Full Stack Dev" OR "remote")',
    cities: ["Hyderabad", "Chennai"],
  },
];

const LINKEDIN_EMAIL = "rituraj1949@gmail.com";
const LINKEDIN_PASSWORD = "Ritu778@%,.&Ritu";
const ACTION_DELAY_MS = 3000; // 3 sec between actions

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

/** POST profile data to database via API */
async function saveProfileToDB(profileData) {
  const payload = {
    profile: profileData.name || "Unknown",
    url: profileData.url || "N/A",
    headline: profileData.headline || "N/A",
    company: profileData.company || "N/A",
    location: profileData.location || "N/A",
    bio: profileData.bio || "N/A",
    request_sent: false,
    message_sent: false,
  };

  console.log(`\n    📤 Posting to DB:`);
  console.log(`       Profile: ${payload.profile}`);
  console.log(`       Company: ${payload.company}`);
  console.log(`       Location: ${payload.location}`);
  console.log(`       URL: ${payload.url}`);

  try {
    const response = await fetch(API_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (response.ok) {
      const result = await response.json();
      console.log(`    ✅ Saved to DB successfully`);
      console.log(`       Response: ${JSON.stringify(result).slice(0, 100)}...`);
      return result;
    } else {
      console.error(`    ❌ API Error: ${response.status} ${response.statusText}`);
      const errorText = await response.text();
      console.error(`       Response: ${errorText.slice(0, 200)}`);
      return null;
    }
  } catch (error) {
    console.error(`    ❌ Network Error: ${error.message}`);
    return null;
  }
}

/** Login to LinkedIn (from browser-automation-log.txt pattern) */
async function loginToLinkedIn(page) {
  console.log("Checking for login form...");

  try {
    // Wait for email field (max 10s)
    const emailInput = page
      .locator('input#username, input[name="session_key"]')
      .first();
    await emailInput.waitFor({ state: "visible", timeout: 10000 });

    console.log("Login form detected. Entering credentials...");
    await emailInput.click();
    await delay(500);
    await emailInput.fill(LINKEDIN_EMAIL);
    await delay(1000);

    const passwordInput = page
      .locator('input#password, input[name="session_password"]')
      .first();
    await passwordInput.click();
    await delay(500);
    await passwordInput.fill(LINKEDIN_PASSWORD);
    await delay(1000);

    const signInBtn = page
      .locator(
        'button[type="submit"]:has-text("Sign in"), button:has-text("Sign in")'
      )
      .first();
    await signInBtn.click();
    console.log("Login submitted. Waiting for redirect...");
    await delay(8000);

    console.log("Login complete.");
  } catch (e) {
    console.log("No login form (already logged in or error):", e.message);
  }
}

/** Extract profile URLs from search results (simplified approach) */
async function extractProfileCardsOnPage(page) {
  const profiles = [];

  // From browser-automation-log.txt: All profile links are <a href*="/in/"> within list items
  // Strategy: Get all unique /in/ links, filter out duplicates and non-profile links
  const profileLinks = await page.$$eval('a[href*="/in/"]', (links) => {
    const seen = new Set();
    const results = [];

    for (const link of links) {
      const href = link.href;
      // Only profile URLs: /in/username/ format, not overlays or other pages
      if (
        href.includes("/in/") &&
        !href.includes("/overlay/") &&
        !href.includes("#")
      ) {
        const match = href.match(/linkedin\.com\/in\/([^\/\?]+)/);
        if (match && !seen.has(match[1])) {
          seen.add(match[1]);
          results.push({
            url: href.split("?")[0], // Remove query params
            username: match[1],
          });
        }
      }
    }

    return results.slice(0, 10); // Max 10 per page (typical LinkedIn results)
  });

  console.log(`  Found ${profileLinks.length} unique profile links on page.`);

  // For search page, just return URLs; we'll get full data when visiting
  return profileLinks.map((p) => ({
    name: "",
    url: p.url,
    headline: "",
    company: "",
    location: "",
    bio: "",
    skills: "",
  }));
}

/** Visit profile and extract full data (from browser-automation-log.txt patterns) */
async function extractFullProfileData(page, profileUrl) {
  try {
    console.log(`    Opening: ${profileUrl}`);
    await page.goto(profileUrl, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    await delay(ACTION_DELAY_MS);

    let name = "";
    let headline = "";
    let bio = "";
    let skills = "";
    let company = "";
    let location = "";

    // Name: h1 or heading[level=1] (from log: heading "Rahul Singh" [level=1] [ref=e144])
    const nameEl = page.locator("h1").first();
    if ((await nameEl.count()) > 0) {
      name = await nameEl.textContent();
    }

    // HEADLINE: div.text-body-medium.break-words (verified working from company-extraction-debug)
    // Example: "Talent Acquisition Partner", "Sr. Talent Acquisition Manager"
    // CSS Class: "text-body-medium break-words"
    const headlineEl = page.locator('div.text-body-medium.break-words, div.text-body-medium').first();
    if ((await headlineEl.count()) > 0) {
      headline = await headlineEl.textContent();
      headline = headline.trim();
    }

    // LOCATION: span.text-body-small.inline (verified working from company-extraction-debug.txt)
    // Class: "text-body-small inline t-black--light break-words"
    const locEl = page.locator('span.text-body-small.inline').first();
    if ((await locEl.count()) > 0) {
      location = await locEl.textContent();
      location = location.trim();
    }

    // COMPANY: button with aria-label*="Current company" (verified working from company-extraction-debug.txt)
    // Button's textContent is just the company name (e.g., "UKG", "VDart")
    const compBtn = page.locator('button[aria-label*="Current company"]').first();
    if ((await compBtn.count()) > 0) {
      company = await compBtn.textContent();
      company = company.trim();
    }

    // If company not found via button, try from Experience section
    if (!company) {
      const expSection = page
        .locator(
          'section:has(h2:text("Experience")), div:has(h2:text("Experience"))'
        )
        .first();
      if ((await expSection.count()) > 0) {
        const firstJob = expSection
          .locator("div, span")
          .filter({ hasText: /Current:|Present/i })
          .first();
        if ((await firstJob.count()) > 0) {
          const text = await firstJob.textContent();
          const match = text.match(/at\s+([^·\n]+)/);
          if (match) company = match[1].trim();
        }
      }
    }

    // About section: heading "About" → next sibling/child with bio text
    // From log: heading "About" [level=2] [ref=e245] → generic [ref=e252] with bio
    const aboutHeading = page
      .locator('h2:has-text("About"), h2:text("About")')
      .first();
    if ((await aboutHeading.count()) > 0) {
      await aboutHeading.scrollIntoViewIfNeeded();
      await delay(1000);

      // Get parent section, then find the bio text (long text after heading)
      const section = aboutHeading.locator("..").first();
      const bioEl = section
        .locator("div, span")
        .filter({ hasText: /.{100,}/ })
        .first();
      if ((await bioEl.count()) > 0) {
        bio = await bioEl.textContent();
      }
    }

    // Top Skills: From log: "Management • Recruiting • Customer Service" format
    const skillsHeading = page
      .locator("div, span")
      .filter({ hasText: /Top skills/i })
      .first();
    if ((await skillsHeading.count()) > 0) {
      const parent = skillsHeading.locator("..").first();
      const skillsEl = parent
        .locator("div, span")
        .filter({ hasText: /•/ })
        .first();
      if ((await skillsEl.count()) > 0) {
        skills = await skillsEl.textContent();
      }
    }

    return {
      name: name?.trim() || "Unknown",
      headline: headline?.trim() || "N/A",
      bio: bio?.trim() || "N/A",
      skills: skills?.trim() || "N/A",
      company: company || "N/A",
      location: location?.trim() || "N/A",
    };
  } catch (e) {
    console.error("    Error extracting profile data:", e.message);
    return { name: "Unknown", headline: "N/A", bio: "N/A", skills: "N/A", company: "N/A", location: "N/A" };
  }
}

/** Process one city: all pages */
async function processCityProfiles(page, keywords, city) {
  const geoUrn = GEO_URNS[city];
  if (!geoUrn) {
    console.log(`  ERROR: No geoUrn found for city: ${city}`);
    return;
  }

  console.log(`\n========== City: ${city} ==========`);

  // Direct URL with geoUrn (pre-filled URL - location filter already applied in URL)
  // No need to interact with location filter popup/UI
  const baseUrl = "https://www.linkedin.com/search/results/people/";
  const url = `${baseUrl}?keywords=${encodeURIComponent(
    keywords
  )}&origin=FACETED_SEARCH&geoUrn=%5B%22${geoUrn}%22%5D`;

  console.log(`Navigating to pre-filled URL for ${city}...`);
  console.log(`  geoUrn: ${geoUrn}`);
  console.log(`  URL: ${url}`);
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
  console.log(`  ✓ Page loaded. Location filter auto-applied via URL.`);
  await delay(ACTION_DELAY_MS);

  let pageNum = 1;
  let totalExtracted = 0;

  while (true) {
    console.log(`\n  --- Page ${pageNum} (${city}) ---`);

    // Extract all profiles on current page
    const profiles = await extractProfileCardsOnPage(page);

    if (profiles.length === 0) {
      console.log("  No profiles found. Moving to next city.");
      break;
    }

    // For each profile, visit and get full data
    for (let i = 0; i < profiles.length; i++) {
      const prof = profiles[i];
      console.log(`  Profile ${i + 1}/${profiles.length}: ${prof.url}`);

      // Visit profile and extract all data
      const fullData = await extractFullProfileData(page, prof.url);

      // Save complete profile
      await saveProfileToDB(fullData);
      totalExtracted++;

      // Go back to search results
      await page.goBack({ waitUntil: "domcontentloaded", timeout: 15000 });
      await delay(ACTION_DELAY_MS);
    }

    // Check for Next button (from log: button "Next" [ref=e440])
    const nextBtn = page
      .locator('button:has-text("Next"), button[aria-label="Next"]')
      .first();
    if ((await nextBtn.count()) === 0) {
      console.log(`  No more pages for ${city}.`);
      break;
    }

    // Click Next
    try {
      await nextBtn.click({ timeout: 10000 });
      await delay(ACTION_DELAY_MS);
      pageNum++;
    } catch (e) {
      console.log("  Could not click Next. End of results.");
      break;
    }
  }

  console.log(`City ${city} complete. Extracted: ${totalExtracted} profiles.`);
}

/** Main extraction flow */
async function run() {
  console.log("Launching browser...");
  const browser = await chromium.launch({
    headless: false,
    slowMo: 500,
  });

  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  });

  const page = await context.newPage();

  console.log(`API Endpoint: ${API_ENDPOINT}`);
  console.log("Profiles will be posted to database instead of txt file.");

  // Login
  console.log("Opening LinkedIn...");
  await page.goto("https://www.linkedin.com/login", {
    waitUntil: "load",
    timeout: 60000,
  });
  await delay(3000);
  await loginToLinkedIn(page);

  let grandTotal = 0;

  // Process all campaigns and cities
  for (let cIdx = 0; cIdx < CAMPAIGNS.length; cIdx++) {
    const campaign = CAMPAIGNS[cIdx];
    console.log(
      `\n\n========== CAMPAIGN ${cIdx + 1}/${CAMPAIGNS.length} ==========`
    );
    console.log(`Keywords: ${campaign.keywords}`);
    console.log(`Cities: ${campaign.cities.join(", ")}`);

    for (const city of campaign.cities) {
      console.log(`\n>>> Processing: ${city}`);
      await processCityProfiles(page, campaign.keywords, city);
      await delay(2000);
    }
  }

  console.log("\n\n✓✓✓ ALL CAMPAIGNS COMPLETE ✓✓✓");
  console.log(
    `Total cities processed: ${CAMPAIGNS.flatMap((c) => c.cities).length}`
  );
  console.log(`Total profiles posted to DB: ${grandTotal}`);
  console.log(`API Endpoint: ${API_ENDPOINT}`);
  console.log(`Completed: ${new Date().toISOString()}`);
  console.log("Browser will remain open. Close manually or press Ctrl+C.");

  // Keep browser open
  await new Promise(() => {});
}

run().catch((e) => {
  console.error("Error:", e);
  process.exit(1);
});
