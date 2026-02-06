/**
 * LinkedIn Connection Request Automation
 *
 * 1. Connects to existing Chrome (--remote-debugging-port=9222) with LinkedIn tab open & logged in
 * 2. Searches: "Hiring Gen AI" + "Full Stack Developer"
 * 3. Applies: Location = Noida, Filter = People
 * 4. Goes through 10 pages of results
 * 5. For each profile: open profile, scrape name/headline/location, get About+Skills
 * 6. If skills match >= 50%: click More > Connect, add note (300 chars), send
 * 7. Back to results, next profile
 *
 * Start Chrome with: chrome.exe --remote-debugging-port=9222
 * Have LinkedIn open and logged in in one tab.
 */

const { chromium } = require("playwright");
const { addConnectionStat } = require('./connection-stats');

// --- CONFIG ---
const SKILLS_MATCH_THRESHOLD = 50; // percent
const CDP_URL = "http://localhost:9222";

let isRunning = false;

function stopLinkedInAutomation() {
  isRunning = false;
  console.log("Stopping LinkedIn Connection Automation...");
}

function isLinkedInAutomationRunning() {
  return isRunning;
}

// Phase 1: 4 cities with "Hiring Gen AI Full Stack Developer"
// Phase 2: 2 cities with "Hiring Gen AI & Full Stack Dev remote"
const CAMPAIGNS = [
  {
    keywords: "Hiring Gen AI Full Stack Developer",
    cities: ["Noida", "Gurugram", "Mumbai", "Bangalore"],
  },
  {
    keywords: "Hiring Gen AI & Full Stack Dev remote",
    cities: ["Hyderabad", "Chennai"],
  },
];

// Our skills to match against profile (headline, about, skills). Case-insensitive.
const OUR_SKILLS = [
  "Gen AI",
  "Generative AI",
  "AI",
  "Full Stack",
  "Full-Stack",
  "JavaScript",
  "TypeScript",
  "React",
  "Node",
  "Node.js",
  "Python",
  "Machine Learning",
  "ML",
  "LLM",
  "Chatbot",
  "NLP",
  "Backend",
  "Frontend",
  "API",
  "REST",
  "AWS",
  "Cloud",
  "Hiring",
  "Tech",
  "Software",
  "Development",
  "Engineering",
];

// Connection note (LinkedIn limit: 300 chars for free; keep under 300)
const CONNECTION_NOTE = `Hi, I'm a Full Stack Developer with strong experience in Gen AI, ML, and modern web development. I came across your profile while looking for opportunities in Noida and would value connecting with someone in your role. I’d be glad to discuss how my skills in React, Node, Python, and AI/LLM can add value to your team. Thanks.`;

// 10 sec delay between all actions (slow mode)
const ACTION_DELAY_MS = 10000;

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

/** Connect to existing Chrome and find the LinkedIn tab */
async function getLinkedInPage(browserOrNull) {
  let browser = browserOrNull;
  if (!browser) {
    try {
      browser = await chromium.connectOverCDP(CDP_URL);
      console.log("Connected to existing Chrome.");
    } catch (e) {
      throw new Error(
        'Could not connect to Chrome. Start Chrome with: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" --remote-debugging-port=9222'
      );
    }
  }

  for (const ctx of browser.contexts()) {
    for (const p of ctx.pages()) {
      try {
        const u = p.url();
        if (u && u.includes("linkedin.com")) return { browser, page: p };
      } catch (_) { }
    }
  }
  throw new Error(
    "No LinkedIn tab found. Open linkedin.com and log in, then run again."
  );
}

/** Navigate to people search with keywords and apply location filter */
async function doSearchAndFilters(page, keywords, location) {
  const base = "https://www.linkedin.com/search/results/people/";
  const url = `${base}?keywords=${encodeURIComponent(keywords)}`;

  console.log('Navigating to people search: "' + keywords + '"');
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
  await delay(ACTION_DELAY_MS);

  // Ensure "People" is selected (top filter bar)
  try {
    const people = page
      .locator("button[aria-pressed], a")
      .filter({ hasText: /^People$/ })
      .first();
    if ((await people.count()) > 0) await people.click();
    await delay(ACTION_DELAY_MS);
  } catch (_) { }

  // Location — open Locations filter, type city, select
  console.log("Applying location: " + location);
  try {
    const locBtn = page
      .locator(
        'button:has-text("Locations"), button:has-text("Location"), [data-test-filter-id="locations"], [aria-label*="Location"]'
      )
      .first();
    if ((await locBtn.count()) > 0) {
      await locBtn.click();
      await delay(ACTION_DELAY_MS);
    }
  } catch (_) { }

  try {
    const locInput = page
      .locator(
        'input[placeholder*="location" i], input[placeholder*="Add" i], input[aria-label*="location" i]'
      )
      .first();
    if ((await locInput.count()) > 0) {
      await locInput.fill(location);
      await delay(ACTION_DELAY_MS);
    }
  } catch (_) { }

  try {
    const cityOption = page
      .locator('li, div, button, [role="option"]')
      .filter({ hasText: new RegExp(location, "i") })
      .first();
    if ((await cityOption.count()) > 0) await cityOption.click();
    await delay(ACTION_DELAY_MS);
  } catch (_) { }

  // Click "Show results" or outside to apply
  try {
    const show = page
      .locator(
        'button:has-text("Show"), button:has-text("Apply"), button:has-text("Done")'
      )
      .first();
    if ((await show.count()) > 0) await show.click();
    await delay(ACTION_DELAY_MS);
  } catch (_) { }

  await delay(ACTION_DELAY_MS);
}

/** Get profile cards on current search results page */
async function getProfileCards(page) {
  const selectors = [
    "li.reusable-search__entity-result",
    "div[data-chameleon-result-urn]",
    '[data-control-name="search_srp_result"]',
    "div.entity-result",
    "li.reusable-search__result-container",
  ];
  for (const sel of selectors) {
    const cards = page.locator(sel);
    const n = await cards.count();
    if (n > 0) return cards;
  }
  // Fallback: list items that contain a link to /in/
  const fallback = page
    .locator('li a[href*="/in/"]')
    .locator("..")
    .locator("..");
  const n = await fallback.count();
  return n > 0
    ? fallback
    : page.locator('a[href*="/in/"]').locator("..").locator("..").locator("..");
}

/** Open profile from card: click name or profile link */
async function openProfileFromCard(page, card) {
  const link = card.locator('a[href*="/in/"]').first();
  await link.click();
  await delay(ACTION_DELAY_MS);
}

/** Scrape name, headline, location from current profile page */
async function scrapeProfileBasics(page) {
  let name = "";
  let headline = "";
  let location = "";

  try {
    const h1 = page.locator("h1.text-heading-xlarge, h1.inline").first();
    if ((await h1.count()) > 0) name = (await h1.textContent())?.trim() || "";
  } catch (_) { }
  if (!name) {
    try {
      const n = page.locator("h1").first();
      if ((await n.count()) > 0) name = (await n.textContent())?.trim() || "";
    } catch (_) { }
  }

  try {
    const head = page.locator("div.text-body-medium, div.inline.t-14").first();
    if ((await head.count()) > 0)
      headline = (await head.textContent())?.trim() || "";
  } catch (_) { }
  if (!headline) {
    const h2 = page.locator('div[class*="headline"]').first();
    if ((await h2.count()) > 0)
      headline = (await h2.textContent())?.trim() || "";
  }

  try {
    const loc = page
      .locator(
        'span.text-body-small.inline, span[class*="location"], div[class*="location"]'
      )
      .first();
    if ((await loc.count()) > 0)
      location = (await loc.textContent())?.trim() || "";
  } catch (_) { }

  return { name, headline, location };
}

/** Get About + Skills text for matching (scroll to load) */
async function getAboutAndSkillsText(page) {
  let text = "";

  try {
    const about = page
      .locator(
        'section:has-text("About"), div:has-text("About"), [data-section="about"]'
      )
      .first();
    if ((await about.count()) > 0) {
      await about.scrollIntoViewIfNeeded();
      await delay(ACTION_DELAY_MS);
      text += (await about.textContent()) || "";
    }
  } catch (_) { }

  try {
    const skills = page
      .locator(
        'section:has-text("Skills"), div:has-text("Skills"), [data-section="skills"]'
      )
      .first();
    if ((await skills.count()) > 0) {
      await skills.scrollIntoViewIfNeeded();
      await delay(ACTION_DELAY_MS);
      text += " " + ((await skills.textContent()) || "");
    }
  } catch (_) { }

  // "See all" / "Show all" for skills
  try {
    const seeAll = page
      .locator(
        'button:has-text("See all"), button:has-text("Show all"), a:has-text("See all")'
      )
      .first();
    if ((await seeAll.count()) > 0) {
      await seeAll.click();
      await delay(ACTION_DELAY_MS);
      const skillsSection = page
        .locator('section:has-text("Skills"), [data-section="skills"]')
        .first();
      if ((await skillsSection.count()) > 0)
        text += " " + ((await skillsSection.textContent()) || "");
    }
  } catch (_) { }

  return text;
}

/** Compute skills match %: (our skills found in their text) / our skills * 100 */
function skillsMatchPercent(profileText, headline) {
  const combined = ((headline || "") + " " + (profileText || "")).toLowerCase();
  let found = 0;
  for (const s of OUR_SKILLS) {
    if (combined.includes(s.toLowerCase())) found++;
  }
  return OUR_SKILLS.length > 0
    ? Math.round((found / OUR_SKILLS.length) * 100)
    : 0;
}

/** Click Connect: try direct Connect, else More > Connect */
async function clickConnect(page) {
  const connectBtn = page
    .locator(
      'button:has-text("Connect"), span:has-text("Connect"), [aria-label*="Connect"]'
    )
    .first();
  if ((await connectBtn.count()) > 0) {
    await connectBtn.click();
    return true;
  }

  const more = page
    .locator(
      'button[aria-label="More"], button[aria-label="More actions"], [aria-label="More"]'
    )
    .first();
  if ((await more.count()) > 0) {
    await more.click();
    await delay(ACTION_DELAY_MS);
    const connectInMenu = page
      .locator('[role="menuitem"]')
      .filter({ hasText: /Connect/i })
      .first();
    if ((await connectInMenu.count()) > 0) {
      await connectInMenu.click();
      return true;
    }
    const alt = page
      .locator('div:has-text("Connect"), button:has-text("Connect")')
      .first();
    if ((await alt.count()) > 0) {
      await alt.click();
      return true;
    }
  }

  return false;
}

/** In Connect modal: add note and send. Note limited to 300 chars. */
async function addNoteAndSend(page) {
  const note = CONNECTION_NOTE.slice(0, 300);

  try {
    const addNote = page
      .locator(
        'button:has-text("Add a note"), a:has-text("Add a note"), span:has-text("Add a note")'
      )
      .first();
    if ((await addNote.count()) > 0) await addNote.click();
    await delay(ACTION_DELAY_MS);
  } catch (_) { }

  const textarea = page
    .locator(
      'textarea[placeholder*="note" i], textarea[placeholder*="message" i], textarea'
    )
    .first();
  if ((await textarea.count()) > 0) {
    await textarea.fill(note);
    await delay(ACTION_DELAY_MS);
  }

  const send = page
    .locator('button:has-text("Send"), button:has-text("Send now")')
    .first();
  if ((await send.count()) > 0) await send.click();
  else {
    const submit = page.locator('button[type="submit"]').first();
    if ((await submit.count()) > 0) await submit.click();
  }
  await delay(ACTION_DELAY_MS);
}

/** Go back to search results from a profile (keeps filters & page in history) */
async function goBackToResults(page) {
  await page.goBack({ waitUntil: "domcontentloaded", timeout: 15000 });
  await delay(ACTION_DELAY_MS);
}

/** Click "Next" in pagination to go to the next page of results */
async function clickNextPage(page) {
  const sel = page
    .locator(
      'button[aria-label="Next"], button[aria-label="Next page"], button:has-text("Next"), a:has-text("Next")'
    )
    .first();
  if ((await sel.count()) > 0) {
    await sel.click();
    await delay(ACTION_DELAY_MS);
    return true;
  }
  return false;
}

/** Process all profiles on the current search results page; returns { sent, skipped } */
async function processCurrentPageProfiles(page, totalSent, totalSkipped) {
  const cards = await getProfileCards(page);
  const count = await cards.count();
  if (count === 0) return { totalSent, totalSkipped };

  for (let i = 0; i < count; i++) {
    if (!isRunning) return { totalSent, totalSkipped };
    try {
      const cardsNow = await getProfileCards(page);
      const card = cardsNow.nth(i);
      if ((await card.count()) === 0) continue;

      await openProfileFromCard(page, card);

      const url = page.url();
      if (!url.includes("/in/")) {
        await goBackToResults(page);
        continue;
      }

      const { name, headline, location } = await scrapeProfileBasics(page);
      const aboutSkills = await getAboutAndSkillsText(page);
      const match = skillsMatchPercent(aboutSkills, headline);

      console.log(
        `  ${name || "Unknown"} | ${headline?.slice(0, 50) || "-"} | ${location || "-"
        } | match ${match}%`
      );

      if (match < SKILLS_MATCH_THRESHOLD) {
        console.log(`    Skip: match ${match}% < ${SKILLS_MATCH_THRESHOLD}%`);
        totalSkipped++;
        await goBackToResults(page);
        continue;
      }

      const connected = await clickConnect(page);
      if (!connected) {
        console.log("    Could not find Connect; skipping.");
        totalSkipped++;
        await goBackToResults(page);
        continue;
      }

      await addNoteAndSend(page);
      console.log("    Connection request sent.");
      addConnectionStat(name);
      totalSent++;
      await goBackToResults(page);
    } catch (e) {
      console.error("    Error on profile:", e.message);
      try {
        await goBackToResults(page);
      } catch (_) { }
    }

    await delay(ACTION_DELAY_MS);
  }

  return { totalSent, totalSkipped };
}

/** One full run: 2 campaigns (4 cities then 2 cities), all pages per city. Options: { browser, page } to use existing; else connects via CDP. */
async function runLinkedInAutomation(options = {}) {
  if (isRunning) {
    console.log("LinkedIn Automation is already running.");
    return;
  }
  isRunning = true;

  try {
    let browser;
    let page;

    if (options.browser && options.page) {
      browser = options.browser;
      page = options.page;
      const url = page.url();
      if (!url || !url.includes("linkedin.com")) {
        console.log("Navigating to LinkedIn...");
        await page.goto("https://www.linkedin.com", {
          waitUntil: "domcontentloaded",
          timeout: 60000,
        });
        await delay(ACTION_DELAY_MS);
      }
    } else {
      const result = await getLinkedInPage(null);
      browser = result.browser;
      page = result.page;
    }

    let totalSent = 0;
    let totalSkipped = 0;

    for (let cIdx = 0; cIdx < CAMPAIGNS.length; cIdx++) {
      if (!isRunning) break;
      const campaign = CAMPAIGNS[cIdx];
      console.log(
        `\n========== Campaign ${cIdx + 1}/${CAMPAIGNS.length}: "${campaign.keywords
        }" ==========`
      );

      for (let cityIdx = 0; cityIdx < campaign.cities.length; cityIdx++) {
        if (!isRunning) break;
        const city = campaign.cities[cityIdx];
        console.log(`\n---------- City: ${city} ----------`);

        await doSearchAndFilters(page, campaign.keywords, city);

        let pg = 1;
        while (true) {
          if (!isRunning) break;
          const cards = await getProfileCards(page);
          const count = await cards.count();
          if (count === 0) {
            console.log(`  No results on page ${pg}.`);
            break;
          }
          console.log(`\n--- Page ${pg} (${city}) ---`);
          const result = await processCurrentPageProfiles(
            page,
            totalSent,
            totalSkipped
          );
          totalSent = result.totalSent;
          totalSkipped = result.totalSkipped;

          const hasNext = await clickNextPage(page);
          if (!hasNext) {
            console.log(`  No more pages for ${city}.`);
            break;
          }
          pg++;
        }
      }
    }

    console.log(`\nDone. Sent: ${totalSent}, Skipped: ${totalSkipped}`);
    console.log("Browser left open. Close manually or use POST /stop to stop.");
  } catch (error) {
    console.error("Error in LinkedIn automation:", error);
  } finally {
    isRunning = false;
    console.log("LinkedIn Automation stopped/finished.");
  }
}

if (require.main === module) {
  runLinkedInAutomation().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

module.exports = {
  runLinkedInAutomation,
  stopLinkedInAutomation,
  isLinkedInAutomationRunning
};
