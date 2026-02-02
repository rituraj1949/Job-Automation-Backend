const { chromium } = require("playwright-extra");
const stealth = require("puppeteer-extra-plugin-stealth")();
chromium.use(stealth);
const axios = require("axios");
const { startScreenshotStream, stopScreenshotStream, emitAutomationStatus, emitLog } = require('./screenshot-service');

const FETCH_COMPANIES_URL = "https://backend-emails-elxz.onrender.com/api/companies";
const POST_COMPANY_URL = "https://backend-emails-elxz.onrender.com/api/companies";

const KEYWORDS = ["Generative AI", "Gen AI", "Node Js", "Next Js", "LLM", "RAG", "LangChain", "LangGraph"];
const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

let isRunning = false;
let isPaused = false;


async function runCareerAutomation() {
    if (isRunning) {
        console.log("Career automation is already running.");
        return;
    }

    isRunning = true;
    let browser = null;
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

        // Run headless in production, headed in local development
        const isProduction = process.env.NODE_ENV === 'production' || process.env.RENDER === 'true';

        browser = await chromium.launch({
            headless: isProduction,
            args: ["--disable-blink-features=AutomationControlled"]
        });

        const context = await browser.newContext({
            viewport: { width: 1280, height: 720 },
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36'
        });

        // Create TWO tabs with error handling
        try {
            page = await context.newPage(); // Tab 1: Company website
            emitLog('Browser Tab 1 created: Company Website Scanner', "success");

            linkedinPage = await context.newPage(); // Tab 2: LinkedIn
            emitLog('Browser Tab 2 created: LinkedIn Scanner', "success");
        } catch (pageError) {
            console.error('❌ Failed to create pages:', pageError.message);
            throw new Error('Could not create browser tabs. Browser may have been closed.');
        }

        // Start screenshot streams for BOTH tabs with unique stream IDs (500ms = 2 updates per second)
        await startScreenshotStream(page, 'career-website', 500, 'career-website');
        await startScreenshotStream(linkedinPage, 'career-linkedin', 500, 'career-linkedin');
        emitAutomationStatus("Dual-Tab Career Scanning Live");

        const SEARCH_BASE = "https://www.bing.com/search?q=";

        for (const company of companies) {
            if (!isRunning) break;

            // Check if paused - wait until resumed
            while (isPaused) {
                emitAutomationStatus("⏸️ Paused");
                await new Promise(resolve => setTimeout(resolve, 1000)); // Check every second
                if (!isRunning) break; // Allow stopping while paused
            }

            if (!isRunning) break;

            const companyName = company.companyName;
            if (!companyName) {
                emitLog(`Skipping company: No company name found`, "warning");
                continue;
            }

            emitLog(`════════════════════════════════════════════════════`, "info");
            emitLog(`Processing: ${companyName}`, "processing");
            emitLog(`════════════════════════════════════════════════════`, "info");
            emitAutomationStatus(`Dual-Tab Scanning: ${companyName}`);

            try {

                // ============================================
                // PARALLEL EXECUTION: Tab 1 (Website) + Tab 2 (LinkedIn)
                // ============================================

                const [websiteData, linkedinData] = await Promise.all([
                    // TAB 1: Company Website Scanning
                    scanCompanyWebsite(page, companyName, company, SEARCH_BASE),

                    // TAB 2: LinkedIn - Click Through Multiple Search Results
                    scanLinkedInResults(linkedinPage, companyName, SEARCH_BASE)
                ]);

                // ============================================
                // MERGE RESULTS FROM BOTH TABS
                // ============================================

                // Convert all emails to lowercase for case-insensitive deduplication
                const allEmails = [...new Set([
                    ...websiteData.emails.map(e => e.toLowerCase()),
                    ...linkedinData.linkedinEmails.map(e => e.toLowerCase())
                ])];
                const allSkills = [...new Set([...websiteData.keywords, ...linkedinData.linkedinSkills])];
                const allJobTitles = [
                    ...(websiteData.jobTitle ? [websiteData.jobTitle] : []),
                    ...linkedinData.linkedinJobTitles
                ];

                console.log(`\n${"*".repeat(60)}`);
                console.log(`MERGED RESULTS for ${companyName}`);
                console.log(`${"*".repeat(60)}`);
                console.log(`Total Skills Matched: ${allSkills.length}`);
                console.log(`  └─ Skills: ${allSkills.join(', ') || 'None'}`);
                console.log(`\nTotal Emails Found: ${allEmails.length}`);
                console.log(`  ├─ Career Website: ${websiteData.emails.length} emails`);
                console.log(`  ├─ LinkedIn Profiles: ${linkedinData.linkedinEmails.length} emails`);
                console.log(`  └─ All Unique Emails: ${allEmails.join(', ') || 'None'}`);
                console.log(`\nJob Titles: ${allJobTitles.length > 0 ? allJobTitles[0] : 'None'}`);
                console.log(`Job Dates: ${websiteData.dates?.length > 0 ? websiteData.dates.join(', ') : 'Not found'}`);
                console.log(`LinkedIn Pages Scanned: ${linkedinData.linkedinPosts}`);

                // Build note
                let noteDetails = [];
                if (allSkills.length > 0) noteDetails.push(`Found ${allSkills.length} matching skills`);
                if (allEmails.length > 0) noteDetails.push(`${allEmails.length} contact email(s)`);
                if (linkedinData.linkedinPosts > 0) noteDetails.push(`${linkedinData.linkedinPosts} LinkedIn pages scanned`);
                const note = noteDetails.length > 0 ? noteDetails.join('. ') : 'Scanned career and LinkedIn pages';

                // Post to API if we found relevant data
                if (allSkills.length > 0 || allEmails.length > 0) {
                    emitLog(`Posting data to API for ${companyName}...`, "api");

                    const payload = {
                        companyName: company.companyName,
                        companySize: company.companySize || "N/A",
                        location: company.location || "N/A",
                        industry: company.industry || "N/A",
                        bio: company.bio || "",
                        isHiring: allSkills.length > 0 ? "yes" : "unknown",
                        officialWebsite: company.officialWebsite || websiteData.careerUrl,
                        careerWebsite: websiteData.careerUrl || "",
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
                        if (websiteData.dates?.length > 0) {
                            payload.jobPostTime = websiteData.dates[0];
                        }
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
            await page.waitForTimeout(20000);
        }

        emitLog("Career automation completed successfully!", "success");
        emitAutomationStatus("Idle");

    } catch (error) {
        console.error("Critical error in career automation:", error);
    } finally {
        isRunning = false;
        stopScreenshotStream();
        if (linkedinPage) await linkedinPage.close();
        if (page) await page.close();
        if (browser) await browser.close();
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

        emitLog(`[Website Tab] Searching Bing: "${companyName} careers"`, "website");
        await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
        await page.waitForTimeout(5000);

        const firstResult = await page.$('.b_algo h2 a, li.b_algo a').catch(() => null);
        if (!firstResult) {
            console.log(`[WEBSITE] No search results found`);
            return { emails: [], keywords: [], dates: [] };
        }

        const resultUrl = await firstResult.getAttribute('href').catch(() => null);
        if (!resultUrl) {
            console.log(`[WEBSITE] Could not extract URL`);
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
async function scanLinkedInResults(linkedinPage, companyName, SEARCH_BASE) {
    try {
        console.log(`[LINKEDIN] Starting scan for ${companyName}`);

        const linkedinSearchQuery = encodeURIComponent(`${companyName} hiring manager linkedin`);
        const linkedinSearchUrl = `${SEARCH_BASE}${linkedinSearchQuery}`;

        console.log(`[LINKEDIN] Searching: ${linkedinSearchQuery}`);
        await linkedinPage.goto(linkedinSearchUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
        await linkedinPage.waitForTimeout(5000);

        // Find ALL LinkedIn links in search results using Bing's selectors
        console.log(`[LINKEDIN] Collecting all LinkedIn links from search results...`);

        // Use Bing's search result selectors (same as website tab)
        const bingResults = await linkedinPage.$$('.b_algo h2 a, li.b_algo a, .b_algo a').catch(() => []);

        let linkedinLinks = [];
        for (const link of bingResults) {
            const href = await link.getAttribute('href').catch(() => null);
            const linkText = await link.innerText().catch(() => "");

            if (href) {
                // Bing sometimes wraps URLs - extract the actual LinkedIn URL
                let actualUrl = href;

                // Check if it's a Bing redirect URL containing linkedin.com
                if (href.includes('bing.com/ck/a') || href.includes('bing.com')) {
                    // Try to extract from link text or skip
                    if (linkText.toLowerCase().includes('linkedin')) {
                        console.log(`[LINKEDIN] Found potential LinkedIn link via text: "${linkText}"`);
                        // We'll click this link and check if it goes to LinkedIn
                        linkedinLinks.push({ element: link, href: href, text: linkText });
                        continue;
                    }
                }

                // Direct LinkedIn URL
                if (actualUrl.includes('linkedin.com') &&
                    !actualUrl.includes('/jobs/') &&
                    !actualUrl.includes('/job/') &&
                    !actualUrl.includes('signin') &&
                    !actualUrl.includes('login')) {

                    linkedinLinks.push({ element: link, href: actualUrl.split('?')[0], text: linkText });
                }
            }
        }

        // Remove duplicates by href
        const uniqueLinks = [];
        const seenHrefs = new Set();
        for (const linkObj of linkedinLinks) {
            if (!seenHrefs.has(linkObj.href)) {
                seenHrefs.add(linkObj.href);
                uniqueLinks.push(linkObj);
            }
        }
        linkedinLinks = uniqueLinks;

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

        const searchKeywords = [...KEYWORDS, "MERN", "MERN Stack"];
        const hiringKeywords = ['we are hiring', 'join our team', 'urgent hiring', 'now hiring', 'looking for', 'hiring'];

        // Process ALL LinkedIn links found (increased from 5 to 10 for more coverage)
        // User Request: "open all urls on linkedin tab, if all urls are of linkedin"
        const linksToProcess = linkedinLinks.slice(0, 10); // Process up to 10 LinkedIn pages

        console.log(`[LINKEDIN] Processing ${linksToProcess.length} LinkedIn URLs...`);
        console.log(`[LINKEDIN] Filtering: ✅ Company pages, Profiles, Posts | ❌ Job URLs, Non-LinkedIn sites`);

        for (let i = 0; i < linksToProcess.length; i++) {
            // Check if paused before processing each LinkedIn URL
            while (isPaused) {
                emitAutomationStatus("⏸️ Paused (LinkedIn scan)");
                await new Promise(resolve => setTimeout(resolve, 1000));
                if (!isRunning) break;
            }

            if (!isRunning) break;

            const linkObj = linksToProcess[i];

            try {
                console.log(`\n[LINKEDIN] [${i + 1}/${linksToProcess.length}] Opening: ${linkObj.text || linkObj.href.substring(0, 70)}...`);

                // Navigate to the LinkedIn page
                await linkedinPage.goto(linkObj.href, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {
                    console.log(`[LINKEDIN] Page load timeout, skipping...`);
                });

                await linkedinPage.waitForTimeout(3000);

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

                if (currentUrl.includes('/in/')) {
                    // This is a LinkedIn profile - scan Activity section
                    console.log(`[LINKEDIN] 📋 Profile detected - scanning Activity section...`);

                    const activityResult = await scanProfileActivity(linkedinPage, searchKeywords);
                    pageEmails = activityResult.emails;
                    pageSkills = activityResult.skills;
                    pageJobTitles = activityResult.jobTitles;
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
                    await linkedinPage.waitForTimeout(3000);
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
        console.log(`[LINKEDIN]   └─ Total emails: ${uniqueLinkedInEmails.length}`);
        console.log(`[LINKEDIN]   └─ Total skills matched: ${uniqueLinkedInSkills.length}`);
        console.log(`[LINKEDIN]   └─ Total job titles: ${allLinkedInJobTitles.length}`);

        return {
            linkedinEmails: uniqueLinkedInEmails,
            linkedinSkills: uniqueLinkedInSkills,
            linkedinJobTitles: allLinkedInJobTitles,
            linkedinUrl: linksToProcess[0] || "", // First LinkedIn URL as reference
            linkedinPosts: processedPages
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
    const hiringKeywords = ['hiring', 'join', 'team', 'opportunity', '#job', 'job alert', 'we are hiring', 'looking for'];
    let allEmails = [];
    let allSkills = [];
    let allJobTitles = [];

    try {
        // Scroll down to find Activity section
        await page.evaluate(() => window.scrollBy(0, 500));
        await page.waitForTimeout(2000);

        // Find all activity posts
        const activityPosts = await page.$$('ul[data-test-id="activities__list"] li a.base-card__full-link').catch(() => []);

        if (activityPosts.length === 0) {
            console.log(`[LINKEDIN] No activity posts found`);
            return { emails: [], skills: [], jobTitles: [] };
        }

        console.log(`[LINKEDIN] Found ${activityPosts.length} activity posts, filtering for hiring content...`);

        // Collect post URLs with hiring keywords
        let hiringPostUrls = [];

        for (let i = 0; i < Math.min(activityPosts.length, 10); i++) {
            const post = activityPosts[i];
            const postText = await post.innerText().catch(() => "");
            const lowerPostText = postText.toLowerCase();

            const hasHiringKeyword = hiringKeywords.some(kw => lowerPostText.includes(kw));

            if (hasHiringKeyword) {
                const postUrl = await post.getAttribute('href').catch(() => null);
                if (postUrl && !postUrl.includes('/signup/')) {
                    hiringPostUrls.push(postUrl);
                    console.log(`[LINKEDIN]   📌 Found hiring post: ${postText.substring(0, 60)}...`);
                }
            }
        }

        console.log(`[LINKEDIN] Found ${hiringPostUrls.length} posts with hiring keywords`);

        // Open each hiring post and extract data
        for (let i = 0; i < hiringPostUrls.length; i++) {
            const postUrl = hiringPostUrls[i];

            try {
                console.log(`\n[LINKEDIN] [Post ${i + 1}/${hiringPostUrls.length}] Opening post...`);

                await page.goto(postUrl, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => { });
                await page.waitForTimeout(3000);

                // Dismiss modal if it appears
                try {
                    const dismissBtn = await page.$('button[aria-label="Dismiss"]').catch(() => null);
                    if (dismissBtn && await dismissBtn.isVisible().catch(() => false)) {
                        await dismissBtn.click({ force: true });
                        await page.waitForTimeout(1000);
                    }
                } catch (e) { }

                // Extract post content ONLY (exclude comments section)
                // Get the main post article element, which contains the post text but not comments
                const postArticle = await page.$('article.main-feed-activity-card').catch(() => null);

                let postContent = "";
                let postEmails = [];

                if (postArticle) {
                    // Get only the post commentary (main text)
                    const postCommentary = await postArticle.$('[data-test-id="main-feed-activity-card__commentary"]').catch(() => null);

                    if (postCommentary) {
                        postContent = await postCommentary.innerText().catch(() => "");

                        // Extract emails ONLY from post content (NOT from comments)
                        postEmails = postContent.match(EMAIL_REGEX) || [];

                        if (postEmails.length > 0) {
                            console.log(`[LINKEDIN]   └─ Emails (from post): ${postEmails.join(', ')}`);
                            allEmails = [...allEmails, ...postEmails];
                        }
                    } else {
                        // Fallback: try to get the whole article but exclude comment sections
                        postContent = await postArticle.innerText().catch(() => "");

                        // Remove comment section text by finding where comments start
                        const commentSectionStart = postContent.indexOf('Like\nComment\nShare');
                        if (commentSectionStart > -1) {
                            postContent = postContent.substring(0, commentSectionStart);
                        }

                        // Extract emails from cleaned post content
                        postEmails = postContent.match(EMAIL_REGEX) || [];

                        if (postEmails.length > 0) {
                            console.log(`[LINKEDIN]   └─ Emails (from post content): ${postEmails.join(', ')}`);
                            allEmails = [...allEmails, ...postEmails];
                        }
                    }
                } else {
                    console.log(`[LINKEDIN]   ⚠️  Could not find post article element`);
                }

                // Match skills
                const matchedSkills = searchKeywords.filter(kw =>
                    new RegExp(`\\b${kw.replace(/\s+/g, '\\s+')}\\b`, 'gi').test(postContent)
                );

                if (matchedSkills.length > 0) {
                    console.log(`[LINKEDIN]   └─ Skills: ${matchedSkills.join(', ')}`);

                    // Check post age
                    const timeElement = await page.$('time').catch(() => null);
                    let postAge = null;

                    if (timeElement) {
                        const timeText = await timeElement.innerText().catch(() => "");
                        console.log(`[LINKEDIN]   └─ Posted: ${timeText}`);

                        // Parse time (1mo, 2w, 3d, etc.)
                        const isRecent = /(\d+)d|(\d+)w|1mo/.test(timeText); // Days, weeks, or 1 month

                        // Only collect job if recent AND 2+ skills matched
                        if (isRecent && matchedSkills.length >= 2) {
                            console.log(`[LINKEDIN]   ✅ Recent post with ${matchedSkills.length} skills - collecting job`);
                            allSkills = [...allSkills, ...matchedSkills];

                            // Extract job title
                            const titleMatch = postContent.match(/(?:hiring|looking for|seeking|join us as|apply for|position|role)\s+(?:for\s+)?(?:a\s+)?([^\n]{5,60}(?:engineer|developer|architect|lead|manager|specialist|designer|intern))/gi);
                            if (titleMatch) {
                                const jobTitle = titleMatch[0].trim();
                                console.log(`[LINKEDIN]   └─ Job Title: ${jobTitle}`);
                                allJobTitles.push(jobTitle);
                            }
                        } else {
                            console.log(`[LINKEDIN]   ⚠️  Post too old or insufficient skills (${matchedSkills.length} skills) - skipping job, but email collected`);
                        }
                    }
                }

                // Small delay before next post
                await page.waitForTimeout(2000);

            } catch (postErr) {
                console.error(`[LINKEDIN] Error processing post: ${postErr.message}`);
                continue;
            }
        }

        return {
            emails: [...new Set(allEmails)],
            skills: [...new Set(allSkills)],
            jobTitles: allJobTitles
        };

    } catch (err) {
        console.error(`[LINKEDIN] Activity scan error: ${err.message}`);
        return { emails: [], skills: [], jobTitles: [] };
    }
}

function stopCareerAutomation() {
    console.log("Stopping career automation...");
    isRunning = false;
    isPaused = false;
}

function togglePauseCareerAutomation() {
    isPaused = !isPaused;
    if (isPaused) {
        console.log("⏸️ Career automation PAUSED");
        emitAutomationStatus("⏸️ Paused");
    } else {
        console.log("▶️ Career automation RESUMED");
        emitAutomationStatus("▶️ Resumed");
    }
    return isPaused;
}

module.exports = {
    runCareerAutomation,
    stopCareerAutomation,
    togglePauseCareerAutomation,
    isCareerAutomationRunning: () => isRunning,
    isCareerAutomationPaused: () => isPaused
};
