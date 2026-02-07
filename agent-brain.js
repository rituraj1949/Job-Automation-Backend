const cheerio = require('cheerio');

// In-memory state: 
// Map<socketId, { 
//    visitedUrls: Set<string>, 
//    processedPeople: Set<string>,
//    processedCompanyPosts: Set<string>,
//    processedCompanyJobs: Set<string> 
// }>
const clientStates = new Map();

/**
 * Custom logger for skills and emails
 */
function logFindings(socketId, source, extracted) {
    if (extracted.emails.length > 0 || extracted.skills.length > 0) {
        console.log(`\n[${socketId}] 🟢 HIT DETAILS (${source}) ------------------`);
        if (extracted.emails.length > 0) console.log(`   📧 Emails: ${extracted.emails.join(', ')}`);
        if (extracted.skills.length > 0) console.log(`   🛠️ Skills: ${extracted.skills.join(', ')}`);
        console.log(`---------------------------------------------------\n`);
    }
}

/**
 * Analyzes the DOM snapshot from Android Agent and decides next actions.
 * @param {string} domHtml - The full HTML string of the page.
 * @param {string} socketId - The ID of the client sending the DOM.
 * @returns {object} - { extracted: object, command: object | null }
 */
function processDom(domHtml, socketId) {
    if (!domHtml || typeof domHtml !== 'string') {
        return { error: 'Invalid DOM' };
    }

    // Initialize state for new client
    if (!clientStates.has(socketId)) {
        clientStates.set(socketId, {
            visitedUrls: new Set(),
            processedPeople: new Set(),
            processedCompanyPosts: new Set(),
            processedCompanyJobs: new Set(),
            scrolledPages: new Set(),
            linkQueue: []
        });
    }
    const state = clientStates.get(socketId);

    // SAFEGUARD: Ensure linkQueue exists (for existing sessions)
    if (!state.linkQueue) {
        state.linkQueue = [];
    }

    // DEBUG: Monitor Queue State
    console.log(`[${socketId}] 📊 Current State: Queue=${state.linkQueue.length}, Visited=${state.visitedUrls.size}`);

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

    console.log(`[${socketId}] 🔍 Analyzing Page: "${title}" (Length: ${domHtml.length})`);
    console.log(`[${socketId}]    -> Detected: ${isGoogle ? 'GOOGLE SEARCH' : (extracted.isLinkedin ? 'LINKEDIN' : 'GENERIC')}`);

    let command = null;

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
            console.log(`[${socketId}] Processing Company: ${entityName}`);

            // Step 1: Check Posts (If not done)
            if (!state.processedCompanyPosts.has(entityName)) {
                if (isActivityPage) {
                    console.log(`[${socketId}] Scanning Company Posts...`);
                    // Extract
                    extractFromPosts($, extracted, targetSkills);
                    logFindings(socketId, 'Company Posts', extracted);

                    state.processedCompanyPosts.add(entityName);
                    // FALL THROUGH TO QUEUE (Was BACK)
                } else {
                    console.log(`[${socketId}] Navigating to Company Posts...`);
                    // Click Posts/Activity
                    // Try finding "Posts" tab or link
                    return { extracted, command: { action: 'CLICK', selector: 'a:contains("Posts"), a[href*="/posts/"]', value: 'Go to Company Posts' } };
                }
            }

            // Step 2: Check Jobs (If not done)
            else if (!state.processedCompanyJobs.has(entityName)) {
                if (isJobsPage) {
                    console.log(`[${socketId}] Scanning Company Jobs...`);
                    // Extract from job cards
                    $('.job-card-list__title, .base-card__full-link').each((i, el) => {
                        const jobTitle = $(el).text().toLowerCase();
                        // Simple skill check in title
                        const foundSkills = targetSkills.filter(s => jobTitle.includes(s));
                        if (foundSkills.length > 0) {
                            extracted.skills.push(...foundSkills);
                            console.log(`   💼 Relevant Job: "${$(el).text().trim()}" matches ${foundSkills.join(',')}`);
                        }
                    });
                    logFindings(socketId, 'Company Jobs', extracted);

                    state.processedCompanyJobs.add(entityName);
                    // FALL THROUGH TO QUEUE (Was BACK)
                } else {
                    console.log(`[${socketId}] Navigating to Company Jobs...`);
                    return { extracted, command: { action: 'CLICK', selector: 'a:contains("Jobs"), a[href*="/jobs/"]', value: 'Go to Company Jobs' } };
                }
            }

            // Step 3: All Done -> Leave
            else {
                console.log(`[${socketId}] Company ${entityName} fully processed.`);
                // FALL THROUGH TO QUEUE (Was BACK)
            }
        }

        // --- PERSONAL PROFILE FLOW ---
        else {
            // Refine name for person
            entityName = $('.top-card-layout__title').text().trim() || entityName;
            console.log(`[${socketId}] Processing Profile: ${entityName}`);

            if (!state.processedPeople.has(entityName)) {
                if (isActivityPage) {
                    console.log(`[${socketId}] Scanning Person's Activity...`);
                    extractFromPosts($, extracted, targetSkills);
                    logFindings(socketId, 'Person Activity', extracted);

                    state.processedPeople.add(entityName);
                    // FALL THROUGH TO QUEUE
                } else {
                    // Find "Show all activity"
                    const activityBtn = $('a:contains("Show all activity"), a:contains("See all activity"), #generated-id-posts-tab, a[href*="recent-activity"]');
                    if (activityBtn.length > 0) {
                        console.log(`[${socketId}] clicking 'Show activity'...`);
                        return { extracted, command: { action: 'CLICK', selector: 'a[href*="recent-activity"], a:contains("Show all activity")', value: 'Go to Activity' } };
                    } else {
                        // No activity? Scan bio and leave
                        console.log(`[${socketId}] No activity button. Scanning Bio...`);
                        const bioEmails = bodyText.match(/[a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,6}/g);
                        if (bioEmails) extracted.emails = [...new Set(bioEmails)];
                        logFindings(socketId, 'Person Bio', extracted);

                        state.processedPeople.add(entityName);
                        // FALL THROUGH TO QUEUE
                    }
                }
            } else {
                console.log(`[${socketId}] Person ${entityName} already processed. Returning to Search.`);
                // FALL THROUGH TO QUEUE
            }
        }

        // --- SCROLL FALLBACK (Human-like behavior) ---
        // If we found NO emails and NO skills, and we haven't scrolled this specific URL yet...
        // We should scroll down to trigger lazy loading or just "look" for more data.
        // This applies to both Company and Profile pages if the above logic didn't trigger a click.

        // Check if we extracted anything meaningful
        const hasData = extracted.emails.length > 0 || extracted.skills.length > 0;

        // We need the current URL (or a unique identifier for the page) to track scrolling.
        // Since we don't have the URL in 'extracted' by default (it's in the DOM/Client), 
        // we can use the 'title' or just a simple boolean flag if we assume linear processing.
        // BUT 'processDom' is stateless per call.

        // Let's use the Entity Name as a proxy or just the fact that we are in this block.
        // Actually, we can't easily track "Page URL" without the client sending it.
        // BUT we can use a "Current Page Scrolled" flag in the state if we assume sequential navigation.

        // However, the cleanest way is:
        // If (No Data) AND (Not Scrolled Yet) -> SCROLL.

        // Implementation:
        // We need to know if we just scrolled. 
        // Let's assume if we are here, and we haven't extracted data, we try scrolling ONCE.

        if (!hasData) {
            // Use a composite key or just the entity name to track scrolling
            // If we rely on entity name, it might be ambiguous. 
            // Let's rely on the fact that if we scroll, the NEXT snapshot will have more data 
            // OR we will eventually give up.

            // We need to avoid infinite scrolling.
            // Let's add 'scrolledPages' Set to state.

            // Generative simplistic unique key for this page state
            const pageKey = entityName + "-" + title.length;

            if (!state.scrolledPages.has(pageKey)) {
                console.log(`[${socketId}] 📉 No data found yet. Scrolling down (Human-like)...`);
                state.scrolledPages.add(pageKey);
                return { extracted, command: { action: 'SCROLL', selector: 'body', value: 'down' } };
            } else {
                console.log(`[${socketId}] 🛑 Already scrolled this page. Giving up and moving on.`);
            }
        }
    }

    // ---------------------------------------------------------
    // 2. GOOGLE SEARCH (Populate Queue)
    // ---------------------------------------------------------
    if (extracted.isGoogleSearch) {
        console.log(`[${socketId}] 🔍 Google Search Results Page Detected.`);

        const resultLinks = [];
        $('a').each((i, el) => {
            const hasH3 = $(el).find('h3').length > 0;
            const href = $(el).attr('href');
            if (hasH3 && href && href.startsWith('http') && !href.includes('google.com')) {
                resultLinks.push({ href: href, title: $(el).text() });
            }
        });

        console.log(`[${socketId}] Found ${resultLinks.length} links.`);

        if (resultLinks.length > 0) {
            // New Search? Reset Queue.
            // We verify if these are actually NEW links by checking if we've visited the first one?
            // Or just overwrite the queue because it's a fresh search page.

            // Filter out links we have arguably already visited in this session? 
            // The user wants strict linear processing.
            // Let's Add allow to Queue.
            state.linkQueue = resultLinks.map(l => l.href);
            console.log(`[${socketId}] 📥 Queue Populated with ${state.linkQueue.length} links.`);

            // Start immediately with 1st Link
            const nextLink = state.linkQueue.shift();
            state.visitedUrls.add(nextLink);

            console.log(`[${socketId}] 🚀 Starting Queue. Navigating to: ${nextLink}`);
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
    logFindings(socketId, isGoogle ? 'Search' : 'Page', extracted);

    // CHECK QUEUE
    if (state.linkQueue && state.linkQueue.length > 0) {
        const nextLink = state.linkQueue.shift();
        state.visitedUrls.add(nextLink);
        console.log(`[${socketId}] ⏭️ Job Done. Queue has ${state.linkQueue.length} left. Navigating to: ${nextLink}`);
        return { extracted, command: { action: 'NAVIGATE', value: nextLink } };
    } else {
        console.log(`[${socketId}] ✅ Queue Empty. Task for this company is COMPLETE.`);
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

function resetClientState(socketId) {
    clientStates.delete(socketId);
}

module.exports = { processDom, resetClientState };
