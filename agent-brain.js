const cheerio = require('cheerio');

// In-memory state: 
// Map<sessionId, { 
//    visitedUrls: Set<string>, 
//    processedPeople: Set<string>,
//    processedCompanyPosts: Set<string>,
//    processedCompanyJobs: Set<string> 
// }>
const clientStates = new Map();

/**
 * Custom logger for skills and emails
 */
function logFindings(sessionId, source, extracted) {
    if (extracted.emails.length > 0 || extracted.skills.length > 0) {
        console.log(`\n[${sessionId}] 🟢 HIT DETAILS (${source}) ------------------`);
        if (extracted.emails.length > 0) console.log(`   📧 Emails: ${extracted.emails.join(', ')}`);
        if (extracted.skills.length > 0) console.log(`   🛠️ Skills: ${extracted.skills.join(', ')}`);
        console.log(`---------------------------------------------------\n`);
    }
}

/**
 * Analyzes the DOM snapshot from Android Agent and decides next actions.
 * @param {string} domHtml - The full HTML string of the page.
 * @param {string} sessionId - A persistent identifier for the client (from payload or socket.id).
 * @returns {object} - { extracted: object, command: object | null }
 */
function processDom(domHtml, sessionId) {
    if (!domHtml || typeof domHtml !== 'string') {
        return { error: 'Invalid DOM' };
    }

    let resultLinks = []; // Function-level scope to avoid ReferenceError

    // Initialize state for new client
    if (!clientStates.has(sessionId)) {
        clientStates.set(sessionId, {
            visitedUrls: new Set(),
            processedPeople: new Set(),
            processedCompanyPosts: new Set(),
            processedCompanyJobs: new Set(),
            scrolledPages: new Map(),
            linkQueue: []
        });
    }
    const state = clientStates.get(sessionId);

    // SAFEGUARD: Ensure linkQueue exists (for existing sessions)
    if (!state.linkQueue) {
        state.linkQueue = [];
    }

    // DEBUG: Monitor Queue State
    console.log(`[${sessionId}] 📊 Current State: Queue=${state.linkQueue.length}, Visited=${state.visitedUrls.size}`);

    const $ = cheerio.load(domHtml);
    const title = $('title').text().toLowerCase();
    const bodyText = $('body').text();

    const isGoogle = title.includes('google search') || title.includes(' - google');

    const extracted = {
        emails: [],
        skills: [],
        links: [],
        isGoogleSearch: isGoogle,
        // Only mark as LinkedIn if it's NOT Google, and has LinkedIn markers
        isLinkedin: !isGoogle && (title.includes('linkedin') || domHtml.includes('linkedin.com'))
    };

    // Target Skills to Search
    const targetSkills = ['node', 'react', 'aws', 'python', 'javascript', 'java', 'sql', 'mongo', 'docker', 'kubernetes'];

    console.log(`[${sessionId}] 🔍 Analyzing Page: "${title}" (Length: ${domHtml.length})`);
    console.log(`[${sessionId}]    -> Detected: ${isGoogle ? 'GOOGLE SEARCH' : (extracted.isLinkedin ? 'LINKEDIN' : 'GENERIC')}`);

    let command = null;

    // ---------------------------------------------------------
    // 0. AUTHWALL / BLOCK DETECTION
    // ---------------------------------------------------------
    // User detected "www.linkedin.com/authwall". This usually means we are redirected.
    // We must detect this state and SKIP to the next item immediately.
    if (domHtml.includes('authwall') || title.includes('authwall') || domHtml.includes('challenges/captcha')) {
        console.log(`[${sessionId}] 🚫 AUTHWALL / CAPTCHA DETECTED! Skipping this page.`);

        // Immediate "Next in Queue" logic
        if (state.linkQueue && state.linkQueue.length > 0) {
            const nextLink = state.linkQueue.shift();
            state.visitedUrls.add(nextLink);
            console.log(`[${sessionId}] ⏭️ Recovering... Navigating to next: ${nextLink}`);
            return { extracted, command: { action: 'NAVIGATE', value: nextLink } };
        } else {
            console.log(`[${sessionId}] 🛑 Authwall hit and Queue is empty.`);
            return { extracted, command: { action: 'TASK_COMPLETED', value: 'Queue Finished (Blocked)' } };
        }
    }

    // ---------------------------------------------------------
    // 1. LINKEDIN LOGIC
    // ---------------------------------------------------------
    if (extracted.isLinkedin) {

        // A. POPUP HANDLING (Disabled: Client handles this automatically)
        /*
        const hasModal = $('.contextual-sign-in-modal__layout--stacked').length > 0 ||
            $('#base-contextual-sign-in-modal-modal-header').length > 0 ||
            $('.modal__main').length > 0;

        if (hasModal) {
            console.log(`[${socketId}] LinkedIn Modal detected! Closing...`);
            const closeSelectors = [
                'button[aria-label="Dismiss"]', 'button.contextual-sign-in-modal__modal-dismiss-btn',
                'button[data-test-modal-close-btn]', '.modal__dismiss_btn',
                'button.close-icon', 'button[aria-label="Close"]', 'svg[data-supported-dps="24x24"]'
            ];

            for (const sel of closeSelectors) {
                if ($(sel).length > 0) {
                    return { extracted, command: { action: 'CLICK', selector: sel, value: 'Close Modal' } };
                }
            }
        }
        */

        // B. DETECT PAGE TYPE
        // Inference based on DOM elements
        const isCompanyPage = $('.org-top-card').length > 0 || title.includes('company') || $('a[href*="/company/"]').length > 10;
        const isActivityPage = $('h1:contains("Activity")').length > 0 || $('.feed-shared-update-v2').length > 0 || title.includes('activity') || title.includes('posts');
        const isJobsPage = title.includes('jobs') || $('.jobs-search-results-list').length > 0;

        // Name Extraction (Generic)
        let entityName = $('h1').first().text().trim();
        if (!entityName) entityName = title.split('|')[0].trim();

        // --- COMPANY FLOW ---
        if (isCompanyPage || (extracted.isLinkedin && title.includes('company'))) {
            // Refine name for company
            entityName = $('.org-top-card__primary-content h1').text().trim() || entityName;
            console.log(`[${sessionId}] Processing Company: ${entityName}`);

            // Step 1: Scan Posts on Main Page (If not done)
            if (!state.processedCompanyPosts.has(entityName)) {
                console.log(`[${sessionId}] Scanning Company Posts (Main Page)...`);
                extractFromPosts($, extracted, targetSkills);
                logFindings(sessionId, 'Company Posts', extracted);
                state.processedCompanyPosts.add(entityName);
                // Fall through to Jobs
            }

            // Step 2: Check Jobs (If not done)
            if (!state.processedCompanyJobs.has(entityName)) {
                console.log(`[${sessionId}] Scanning Company Jobs (Main Page)...`);

                // Try to find "Recently posted jobs" or similar sections on the main page
                // This is a "best effort" scan on the main page.
                $('.job-card-list__title, .base-card__full-link, .org-jobs-recently-posted-jobs-module__job-title').each((i, el) => {
                    const jobTitle = $(el).text().toLowerCase();
                    const foundSkills = targetSkills.filter(s => jobTitle.includes(s));
                    if (foundSkills.length > 0) {
                        extracted.skills.push(...foundSkills);
                        console.log(`   💼 Relevant Job: "${$(el).text().trim()}" matches ${foundSkills.join(',')}`);
                    }
                });

                logFindings(sessionId, 'Company Jobs', extracted);
                state.processedCompanyJobs.add(entityName);
                // Fall through to Queue
            } else {
                console.log(`[${sessionId}] Company ${entityName} fully processed.`);
            }
        }

        // --- PERSONAL PROFILE FLOW ---
        else {
            // Refine name for person
            entityName = $('.top-card-layout__title').text().trim() || entityName;
            console.log(`[${sessionId}] Processing Profile: ${entityName}`);

            if (!state.processedPeople.has(entityName)) {
                console.log(`[${sessionId}] Scanning Person's Activity & Bio (Main Page)...`);

                // 1. Scan any visible posts/activity
                extractFromPosts($, extracted, targetSkills);

                // 2. Scan Bio/About info
                const bioEmails = bodyText.match(/[a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,6}/g);
                if (bioEmails) {
                    extracted.emails.push(...bioEmails);
                    // Deduplicate done at end of extractFromPosts or via Set
                    extracted.emails = [...new Set(extracted.emails)];
                }

                logFindings(sessionId, 'Person Data', extracted);
                state.processedPeople.add(entityName);
                // Fall through to Queue
            } else {
                console.log(`[${sessionId}] Person ${entityName} already processed. Returning to Search.`);
                // Fall through to Queue
            }
        }

        // --- MANDATORY SCROLL LOOP (3 Times) ---
        // User Requirement: "Just send the scroll event 3 times minimum, keep gap of 2 sec"

        // We use 'entityName' as the key to track scrolling for this specific page/company.
        const pageKey = entityName;

        // Initialize count if not present
        if (!state.scrolledPages.has(pageKey)) {
            state.scrolledPages.set(pageKey, 0);
        }

        const currentScrolls = state.scrolledPages.get(pageKey);

        if (currentScrolls < 5) {
            const visiblePosts = $('.feed-shared-update-v2, .feed-shared-update-v2__description-wrapper, .occludable-update').length;
            console.log(`[${sessionId}] 📜 LinkedIn Page: Scroll Check (${currentScrolls + 1}/5). Visible Posts: ${visiblePosts}...`);

            // Increment count
            state.scrolledPages.set(pageKey, currentScrolls + 1);

            // Send SCROLL command
            // The Client is responsible for the "2 sec gap" and sending the next snapshot.
            return { extracted, command: { action: 'SCROLL', selector: 'body', value: 'down', delay: 2000 } };
        } else {
            const visiblePosts = $('.feed-shared-update-v2, .feed-shared-update-v2__description-wrapper, .occludable-update').length;
            console.log(`[${sessionId}] ✅ LinkedIn Page: Scroll Loop Complete (5/5). Found ${visiblePosts} posts. Saving Data...`);

            // --- DATA AGGREGATION FOR DB ---
            const currentUrl = $('link[rel="canonical"]').attr('href') || $('meta[property="og:url"]').attr('content') || `https://linkedin.com/search/results/all/?keywords=${encodeURIComponent(entityName)}`;

            // Count Jobs (heuristic)
            const jobCount = $('.job-card-list__title, .base-card__full-link, .org-jobs-recently-posted-jobs-module__job-title').length;

            // Construct Data Object matching Schema
            const dbData = {
                companyName: entityName,
                linkedinCompanyUrl: currentUrl,
                emails: extracted.emails,
                skillsFoundInJob: extracted.skills,
                JobsCount: jobCount.toString(),
                JobsCountTime: new Date().toLocaleString(),
                bio: $('meta[name="description"]').attr('content') || bodyText.substring(0, 500) + '...',
                isHiring: (jobCount > 0 || extracted.skills.length > 0) ? 'yes' : 'unknown',
                totalSkillsMatched: extracted.skills.length.toString(),
                note: `Scrolled 5 times. Found ${visiblePosts} posts and ${jobCount} jobs.`
            };

            // Determine Next Action (Queue)
            let nextAction = null;
            if (state.linkQueue && state.linkQueue.length > 0) {
                const nextLink = state.linkQueue.shift();
                state.visitedUrls.add(nextLink);
                console.log(`[${sessionId}] ⏭️ (After Save) Navigating to: ${nextLink}`);
                nextAction = { action: 'NAVIGATE', value: nextLink };
            } else {
                console.log(`[${sessionId}] ✅ (After Save) Queue Empty.`);

                // --- GOOGLE PAGE 2 LOGIC ---
                // If we are on Page 1, go to Page 2.
                if (!state.googlePage) state.googlePage = 1;

                if (state.googlePage < 2 && state.lastGoogleSearchUrl) {
                    state.googlePage++;
                    // Construct Page 2 URL (offset 10)
                    // Ensure we don't duplicate 'start' param if it exists (though usually it doesn't on page 1)
                    let nextSearchUrl = state.lastGoogleSearchUrl;
                    if (nextSearchUrl.includes('start=')) {
                        nextSearchUrl = nextSearchUrl.replace(/start=\d+/, `start=${(state.googlePage - 1) * 10}`);
                    } else {
                        nextSearchUrl += (nextSearchUrl.includes('?') ? '&' : '?') + `start=${(state.googlePage - 1) * 10}`;
                    }

                    console.log(`[${sessionId}] 🔄 Moving to Google Search Page ${state.googlePage}: ${nextSearchUrl}`);
                    nextAction = { action: 'NAVIGATE', value: nextSearchUrl };
                } else {
                    // Finished Page 2 (or no search context) -> Go Home
                    console.log(`[${sessionId}] 🏁 Queue Finished (Page ${state.googlePage || 1}). Going to Google.com`);
                    // Reset state for next run?
                    state.googlePage = 1;
                    state.linkQueue = [];
                    nextAction = { action: 'NAVIGATE', value: 'https://www.google.com' };
                }
            }

            // Return SAVE command
            return {
                extracted,
                command: {
                    action: 'SAVE_DATA',
                    value: dbData,
                    nextAction: nextAction
                }
            };
        }
    }

    // ---------------------------------------------------------
    // 2. GOOGLE SEARCH (Populate Queue)
    // ---------------------------------------------------------
    if (extracted.isGoogleSearch) {
        // CAPTURE SEARCH URL for Pagination
        const canonicalUrl = $('link[rel="canonical"]').attr('href');
        if (canonicalUrl && canonicalUrl.includes('/search')) {
            state.lastGoogleSearchUrl = canonicalUrl;
            console.log(`[${sessionId}] 📍 captured Search URL: ${state.lastGoogleSearchUrl}`);
        } else {
            // Fallback: Try to construct from Input value?
            const query = $('input[name="q"]').val();
            if (query) {
                state.lastGoogleSearchUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}`;
                console.log(`[${sessionId}] 📍 Constructed Search URL: ${state.lastGoogleSearchUrl}`);
            }
        }

        // --- EXTRACT LINKS (using Cheerio) ---
        console.log(`[${sessionId}] 🔍 Google Search Results Page Detected.`);
        // resultLinks is declared at the top of processDom
        $('a').each((i, el) => {
            const hasH3 = $(el).find('h3').length > 0;
            const href = $(el).attr('href');

            // Only process valid links from search results (usually have h3 title)
            if (hasH3 && href && href.startsWith('http') && !href.includes('google.com')) {
                let finalUrl = href;

                // TRANSFORM URL
                if (href.includes('linkedin.com/company/') || href.includes('linkedin.com/showcase/') || href.includes('linkedin.com/in/')) {
                    if (href.includes('/company/') || href.includes('/showcase/')) {
                        // Company/Showcase -> Posts
                        if (!href.includes('/posts/')) {
                            finalUrl = href.replace(/\/$/, '') + '/posts/?feedView=all';
                            console.log(`[${sessionId}] 🔄 Transformed URL: ${finalUrl}`);
                        }
                    } else if (href.includes('/in/')) {
                        // Profile -> Recent Activity
                        if (!href.includes('/recent-activity/')) {
                            finalUrl = href.replace(/\/$/, '') + '/recent-activity/all/';
                            console.log(`[${sessionId}] 🔄 Transformed URL: ${finalUrl}`);
                        }
                    }
                }

                resultLinks.push({ href: finalUrl, title: $(el).text() });
            }
        });

        console.log(`[${sessionId}] Found ${resultLinks.length} links.`);

        if (resultLinks.length > 0) {
            // Updated Queue Logic
            state.linkQueue = resultLinks.map(l => l.href);
            console.log(`[${sessionId}] 📥 Queue Populated with ${state.linkQueue.length} links.`);

            // Start immediately with 1st Link
            const nextLink = state.linkQueue.shift();
            state.visitedUrls.add(nextLink);

            console.log(`[${sessionId}] 🚀 Starting Queue. Navigating to: ${nextLink}`);
            return { extracted, command: { action: 'NAVIGATE', value: nextLink } };
        } else {
            // 0 results? Scroll.
            return { extracted, command: { action: 'SCROLL', selector: 'body', value: 'down' } };
        }
    }

    // ---------------------------------------------------------
    // 3. GENERIC / CONTENT PAGE (Process & Next)
    // ---------------------------------------------------------
    // If we are here, we are NOT on Google Search.
    // We assume we are on one of the links from the queue.

    // 1. Extract Data
    if (extracted.isLinkedin && extracted.emails.length === 0) {
        // If LinkedIn and we haven't extracted yet, maybe try extracting?
        // (The generic extraction in processDom top might have missed specific LinkedIn parts if not Company/Profile flow)
        // But our previous logic handled Company/Profile specific flows (which returned generic commands).
        // We need to override those "BACK" commands with "NEXT IN QUEUE".
    }

    // Fallback Extraction (already done at top of generic block or specific blocks)
    // We just need to ensure we don't return early in the LinkedIn block with 'BACK'.

    // REFACTORING NOTE: The previous LinkedIn block returns 'BACK'. 
    // We need to change that behavior.

    // Instead of complex refactor of the block above, let's just INTERCEPT the return?
    // No, cleaner to handle queue check at the end.

    // Let's modify the Logical Flow regarding LinkedIn Block above:
    // The LinkedIn block handles internal navigation (Posts -> Jobs).
    // ONLY when it decides to go 'BACK' (meaning it's done with the entity),
    // we should instead checks the queue.

    // BUT since we can't easily change the block above without massive diff,
    // I will let the above block run. 
    // WAIT. If I use `state.linkQueue`, I should ignore the "BACK" commands from the LinkedIn block 
    // and replace them with "NAVIGATE <NextLink>".

    // Let's see...
    // The LinkedIn block returns: { extracted, command: { action: 'BACK' ... } }
    // generic fallback returns: { extracted, command: { action: 'BACK' ... } }

    // I will process the Content Page here.

    // Extract generic emails if not done
    const emailRegex = /[a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,6}/g;
    const foundEmails = bodyText.match(emailRegex);
    if (foundEmails) {
        extracted.emails.push(...foundEmails);
        extracted.emails = [...new Set(extracted.emails)];
    }
    logFindings(sessionId, isGoogle ? 'Search' : 'Page', extracted);

    // CHECK QUEUE
    if (state.linkQueue && state.linkQueue.length > 0) {
        const nextLink = state.linkQueue.shift();
        state.visitedUrls.add(nextLink);
        console.log(`[${sessionId}] ⏭️ Job Done. Queue has ${state.linkQueue.length} left. Navigating to: ${nextLink}`);
        return { extracted, command: { action: 'NAVIGATE', value: nextLink } };
    } else {
        console.log(`[${sessionId}] ✅ Queue Empty. Task for this company is COMPLETE.`);
        // Instead of just Navigating, we tell the Client "We are done".
        // The Client should then: 1. Go to Google Home, 2. Pick Next Company, 3. Search.
        return { extracted, command: { action: 'TASK_COMPLETED', value: 'Queue Finished' } };
    }
}

/**
 * Optimized logic to extract emails and skills from updates/posts
 */
function extractFromPosts($, extracted, skillsList) {
    const posts = $('.feed-shared-update-v2, .feed-shared-update-v2__description-wrapper, .occludable-update');
    const hiringKeywords = ['hiring', 'join our team', 'looking for', 'openings', 'opportunity', 'vacancy'];

    posts.each((i, el) => {
        const text = $(el).text();
        const textLower = text.toLowerCase();

        // 1. Keyword Check
        const isHiringPost = hiringKeywords.some(k => textLower.includes(k));

        if (isHiringPost) {
            // 2. Email Extraction
            const emailRegex = /[a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,6}/g;
            const foundEmails = text.match(emailRegex);
            if (foundEmails) extracted.emails.push(...foundEmails);

            // 3. Skill Matching
            const foundSkills = skillsList.filter(s => textLower.includes(s));
            if (foundSkills.length > 0) extracted.skills.push(...foundSkills);
        }
    });

    // Deduplicate
    extracted.emails = [...new Set(extracted.emails)];
    extracted.skills = [...new Set(extracted.skills)];
}

function resetClientState(sessionId) {
    clientStates.delete(sessionId);
}

// --- NEW: Helper to update state from Server ---
function updateClientState(sessionId, key, value) {
    if (!clientStates.has(sessionId)) {
        clientStates.set(sessionId, {
            visitedUrls: new Set(),
            processedPeople: new Set(),
            processedCompanyPosts: new Set(),
            processedCompanyJobs: new Set(),
            scrolledPages: new Map(),
            linkQueue: [],
            isLoggedIn: false // Default
        });
    }
    const state = clientStates.get(sessionId);
    state[key] = value;
    console.log(`[${sessionId}] 🧠 State Updated: ${key} = ${value}`);
}

module.exports = { processDom, updateClientState, resetClientState };
