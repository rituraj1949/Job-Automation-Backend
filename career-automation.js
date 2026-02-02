const { chromium } = require("playwright-extra");
const stealth = require("puppeteer-extra-plugin-stealth")();
chromium.use(stealth);
const axios = require("axios");
const { startScreenshotStream, stopScreenshotStream, emitAutomationStatus } = require('./screenshot-service');

const FETCH_COMPANIES_URL = "https://backend-emails-elxz.onrender.com/api/companies";
const POST_COMPANY_URL = "https://backend-emails-elxz.onrender.com/api/companies";

const KEYWORDS = ["Generative AI", "Gen AI", "Node Js", "Next Js", "LLM", "RAG", "LangChain", "LangGraph"];
const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

let isRunning = false;

async function runCareerAutomation() {
    if (isRunning) {
        console.log("Career automation is already running.");
        return;
    }

    isRunning = true;
    let browser = null;
    let page = null;

    try {
        console.log("Fetching companies list...");
        emitAutomationStatus("Fetching companies list...");
        const response = await axios.get(FETCH_COMPANIES_URL);

        // Handle both direct array and wrapped response structure
        const companies = response.data.companies || response.data;

        if (!Array.isArray(companies) || companies.length === 0) {
            console.log("No companies found to process.");
            emitAutomationStatus("No companies found");
            isRunning = false;
            return;
        }

        console.log(`Found ${companies.length} companies. Starting automation...`);

        browser = await chromium.launch({
            headless: false,
            args: ["--disable-blink-features=AutomationControlled"]
        });

        const context = await browser.newContext({
            viewport: { width: 1280, height: 720 },
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36'
        });

        page = await context.newPage();
        await startScreenshotStream(page, 'career-automation', 1000);
        emitAutomationStatus("Career Scanning Live");

        // User Request: Use Bing search
        const SEARCH_BASE = "https://www.bing.com/search?q=";

        // Process companies one by one with 20-second intervals
        for (const company of companies) {
            if (!isRunning) break;

            const companyName = company.companyName;
            if (!companyName) {
                console.log(`Skipping company: No company name found.`);
                continue;
            }

            console.log(`\n========================================`);
            console.log(`Processing ${companyName}`);
            console.log(`========================================`);
            emitAutomationStatus(`Scanning: ${companyName}`);

            try {
                // Step 1: Navigate to Bing and search for "company name careers"
                const searchQuery = encodeURIComponent(`${companyName} careers`);
                const searchUrl = `${SEARCH_BASE}${searchQuery}`;

                console.log(`Opening Bing search: ${searchQuery}`);
                await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });

                // Wait a bit for search results to load
                await page.waitForTimeout(5000);

                // Step 2: Get the first search result URL
                console.log(`Looking for first search result...`);
                // Bing uses different selectors
                const firstResult = await page.$('.b_algo h2 a, li.b_algo a').catch(() => null);

                if (!firstResult) {
                    console.log(`No search results found for ${companyName}`);
                    // Wait 20 seconds before next company
                    console.log("Waiting 20 seconds before next company...");
                    await page.waitForTimeout(20000);
                    continue;
                }

                // Extract the URL instead of clicking to avoid new tab issues
                const resultUrl = await firstResult.getAttribute('href').catch(() => null);

                if (!resultUrl) {
                    console.log(`Could not extract URL from search result for ${companyName}`);
                    console.log("Waiting 20 seconds before next company...");
                    await page.waitForTimeout(20000);
                    continue;
                }

                console.log(`Navigating to first result: ${resultUrl}`);
                await page.goto(resultUrl, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {
                    console.log("Page load timeout, continuing anyway...");
                });

                // User Request: "keep open 1 page for 20 sec"
                console.log("Waiting 20 seconds on the careers page...");
                await page.waitForTimeout(20000);

                // Step 3: Extract data from the careers page
                const bodyText = await page.innerText('body').catch(() => "");
                const pageHtml = await page.content().catch(() => "");

                // Enhanced keyword list including user's specific request
                const searchKeywords = [...KEYWORDS, "MERN", "MERN Stack"];

                const matchedKeywords = searchKeywords.filter(kw =>
                    new RegExp(`\\b${kw.replace(/\s+/g, '\\s+')}\\b`, 'gi').test(bodyText)
                );

                // Find emails from careers page
                const foundEmails = bodyText.match(EMAIL_REGEX) || [];
                let allEmails = [...new Set(foundEmails)];

                console.log(`Emails from careers page: ${allEmails.length > 0 ? allEmails.slice(0, 3).join(', ') : 'None'}`);

                // Step 4: User Request - "go to contact us or about us section, and find the available mail there"
                console.log("Looking for Contact Us or About Us links...");
                const contactLinks = await page.$$('a').catch(() => []);
                let contactPageFound = false;

                for (const link of contactLinks) {
                    const linkText = await link.innerText().catch(() => "");
                    const lowerLinkText = linkText.toLowerCase();

                    // Check if link is Contact Us or About Us
                    if ((lowerLinkText.includes('contact') || lowerLinkText.includes('about')) &&
                        !lowerLinkText.includes('career') && linkText.length < 30) {

                        console.log(`Found link: "${linkText}" - navigating...`);

                        try {
                            await link.click();
                            await page.waitForLoadState('domcontentloaded', { timeout: 30000 }).catch(() => { });
                            await page.waitForTimeout(3000); // Wait for page to load

                            const contactBodyText = await page.innerText('body').catch(() => "");
                            const contactEmails = contactBodyText.match(EMAIL_REGEX) || [];

                            if (contactEmails.length > 0) {
                                console.log(`Found ${contactEmails.length} emails on ${linkText} page`);
                                allEmails = [...allEmails, ...contactEmails];
                                contactPageFound = true;
                            }

                            break; // Found contact/about page, no need to check more links
                        } catch (navErr) {
                            console.log(`Failed to navigate to ${linkText}: ${navErr.message}`);
                            continue;
                        }
                    }
                }

                if (!contactPageFound) {
                    console.log("No Contact/About pages found or navigable");
                }

                // Remove duplicates from all collected emails
                const uniqueEmails = [...new Set(allEmails)];

                // Try to extract job title from the page
                const jobTitlePatterns = [
                    /<h1[^>]*>([^<]+(?:engineer|developer|architect|lead|manager|specialist)[^<]*)<\/h1>/gi,
                    /<title>([^<]+(?:engineer|developer|architect|lead|manager|specialist)[^<]*)<\/title>/gi,
                    /job title:?\s*([^\n<]{5,80})/gi,
                    /position:?\s*([^\n<]{5,80})/gi
                ];

                let jobTitles = [];
                for (const pattern of jobTitlePatterns) {
                    const matches = pageHtml.match(pattern);
                    if (matches && matches.length > 0) {
                        jobTitles = jobTitles.concat(matches.slice(0, 2));
                    }
                }

                // Also search in body text for job titles
                const titleMatch = bodyText.match(/(?:hiring|looking for|seeking)\s+(?:a\s+)?([^\n]{5,60}(?:engineer|developer|architect|lead|manager|specialist))/gi);
                if (titleMatch) {
                    jobTitles = jobTitles.concat(titleMatch.slice(0, 2));
                }

                const extractedJobTitle = jobTitles.length > 0 ? jobTitles[0].replace(/<[^>]*>/g, '').trim() : null;

                // Try to find job posting dates (various formats)
                const datePatterns = [
                    /posted\s+(?:on\s+)?(\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4})/gi,
                    /(\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{2,4})/gi,
                    /(?:posted|updated|published):\s*([^\n<]{5,30})/gi,
                    /(\d{2,4}[\/-]\d{1,2}[\/-]\d{1,2})/g
                ];

                let jobDates = [];
                for (const pattern of datePatterns) {
                    const matches = bodyText.match(pattern);
                    if (matches && matches.length > 0) {
                        jobDates = jobDates.concat(matches.slice(0, 3)); // Take first 3 matches
                    }
                }
                const uniqueDates = [...new Set(jobDates)].slice(0, 3); // Limit to 3 unique dates

                // Build simplified note
                let noteDetails = [];

                if (matchedKeywords.length > 0) {
                    noteDetails.push(`Found ${matchedKeywords.length} matching skills`);
                }

                if (uniqueEmails.length > 0) {
                    noteDetails.push(`${uniqueEmails.length} contact email(s) found`);
                }

                if (uniqueDates.length > 0) {
                    noteDetails.push(`Recent job posting detected`);
                }

                const note = noteDetails.length > 0 ? noteDetails.join('. ') : 'Career page scanned';

                // Log findings
                console.log(`\n--- Findings for ${companyName} ---`);
                console.log(`Matched Keywords: ${matchedKeywords.length > 0 ? matchedKeywords.join(', ') : 'None'}`);
                console.log(`Emails Found: ${uniqueEmails.length > 0 ? uniqueEmails.slice(0, 5).join(', ') : 'None'}`);
                console.log(`Job Dates: ${uniqueDates.length > 0 ? uniqueDates.join(', ') : 'Not found'}`);
                console.log(`Job Title: ${extractedJobTitle || 'Not found'}`);
                console.log(`Current URL: ${page.url()}`);

                // Post to API if we found relevant keywords OR emails
                if (matchedKeywords.length > 0 || uniqueEmails.length > 0) {
                    console.log(`\nPosting data for ${companyName}...`);

                    // Base payload
                    const payload = {
                        companyName: company.companyName,
                        companySize: company.companySize || "N/A",
                        location: company.location || "N/A",
                        industry: company.industry || "N/A",
                        bio: company.bio || "",
                        isHiring: matchedKeywords.length > 0 ? "yes" : "unknown",
                        officialWebsite: company.officialWebsite || page.url(),
                        careerWebsite: page.url(),
                        linkedinCompanyUrl: company.linkedinCompanyUrl || "",
                        emails: uniqueEmails.slice(0, 5), // Send as array
                        JobsCount: company.JobsCount || "0",
                        JobsCountTime: new Date().toISOString().replace('T', ' ').substring(0, 16),
                        applied: "yes",
                        totalSkillsMatched: matchedKeywords.length.toString(),
                        skillsFoundInJob: matchedKeywords, // Send as array
                        note: note
                    };

                    // User Request: "when there will be job skills matched, then only send that job title in payload, if minimum 2 skills matched"
                    if (matchedKeywords.length >= 2) {
                        if (extractedJobTitle) {
                            payload.appliedJobTitle = extractedJobTitle;
                            payload.matchedJobTitle = extractedJobTitle;
                        }
                        if (uniqueDates.length > 0) {
                            payload.jobPostTime = uniqueDates[0]; // Use first/most relevant date
                        }
                    }


                    try {
                        await axios.post(POST_COMPANY_URL, payload);
                        console.log(`✓ Successfully posted update for ${companyName}`);
                    } catch (postErr) {
                        console.error(`✗ Error posting to API for ${companyName}:`, postErr.message);
                    }
                } else {
                    console.log(`No relevant data found for ${companyName} - skipping API post`);
                }


            } catch (pageErr) {
                console.warn(`Error processing ${companyName}: ${pageErr.message}`);
                // Even if there's an error, wait 20 seconds before next company
            }

            // User Request: "if one company posted, then new company will be posted after 20 sec, no matter if the website is down, or not reachable"
            console.log(`\nCompleted processing ${companyName}`);
            console.log("Waiting 20 seconds before next company...\n");
            await page.waitForTimeout(20000);
        }

        console.log("Career automation completed.");
        emitAutomationStatus("Idle");

    } catch (error) {
        console.error("Critical error in career automation:", error);
    } finally {
        isRunning = false;
        stopScreenshotStream();
        if (page) await page.close();
        if (browser) await browser.close();
    }
}

function stopCareerAutomation() {
    console.log("Stopping career automation...");
    isRunning = false;
}

module.exports = {
    runCareerAutomation,
    stopCareerAutomation,
    isCareerAutomationRunning: () => isRunning
};
