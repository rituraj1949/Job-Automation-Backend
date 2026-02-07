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
            processedCompanyJobs: new Set()
        });
    }
    const state = clientStates.get(socketId);

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

        // A. POPUP HANDLING (Highest Priority)
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
                    return { extracted, command: { action: 'BACK', value: 'Posts Done -> Back' } };
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
                    return { extracted, command: { action: 'BACK', value: 'Jobs Done -> Back' } };
                } else {
                    console.log(`[${socketId}] Navigating to Company Jobs...`);
                    return { extracted, command: { action: 'CLICK', selector: 'a:contains("Jobs"), a[href*="/jobs/"]', value: 'Go to Company Jobs' } };
                }
            }

            // Step 3: All Done -> Leave
            else {
                console.log(`[${socketId}] Company ${entityName} fully processed. Returning to Search.`);
                return { extracted, command: { action: 'BACK', value: 'Company Done -> Back' } };
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
                    return { extracted, command: { action: 'BACK', value: 'Person Done -> Back' } };
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
                        return { extracted, command: { action: 'BACK', value: 'Bio Done -> Back' } };
                    }
                }
            } else {
                console.log(`[${socketId}] Person ${entityName} already processed. Returning to Search.`);
                return { extracted, command: { action: 'BACK', value: 'Person Already Done -> Back' } };
            }
        }
    }

    // ---------------------------------------------------------
    // 2. GOOGLE SEARCH NAVIGATION (The Loop)
    // ---------------------------------------------------------
    console.log(`[${socketId}] 🔍 Analyzing Page: "${title}" (Length: ${domHtml.length})`);
    console.log(`[${socketId}]    -> Detected: ${isGoogle ? 'GOOGLE SEARCH' : (extracted.isLinkedin ? 'LINKEDIN' : 'GENERIC')}`);
    if (extracted.isGoogleSearch) {
        const resultLinks = [];
        $('a').each((i, el) => {
            const hasH3 = $(el).find('h3').length > 0;
            const href = $(el).attr('href');
            if (hasH3 && href && href.startsWith('http') && !href.includes('google.com')) {
                resultLinks.push({ href: href, title: $(el).text() });
            }
        });

        extracted.googleResultsCount = resultLinks.length;
        console.log(`[${socketId}] Google Results: ${resultLinks.length} found.`);

        // Log all candidates
        resultLinks.forEach((link, idx) => {
            const isVisited = state.visitedUrls.has(link.href);
            console.log(`[${socketId}]    [${idx}] ${isVisited ? '❌ (Visited)' : '✅ (New)'} - ${link.title.substring(0, 30)}... (${link.href.substring(0, 40)}...)`);
        });

        for (const link of resultLinks) {
            if (!state.visitedUrls.has(link.href)) {
                console.log(`[${socketId}] 👉 Clicking Result: ${link.title}`);
                state.visitedUrls.add(link.href);
                return {
                    extracted,
                    command: {
                        action: 'CLICK',
                        selector: `a[href="${link.href}"]`,
                        value: `Visiting: ${link.title}`
                    }
                };
            }
        }

        // All results visited? 
        // Heuristic: If we haven't scrolled yet, scroll down and try again next tick.
        // This handles lazy loading or "More results" buttons.
        // We can track scroll state, but for now let's just Random Scroll if > 0 results but all visited.

        console.log(`[${socketId}] All ${resultLinks.length} results on this page are marked as visited.`);

        // If we found very few links (e.g. < 3), maybe we are blocked or need to scroll?
        // But if we found 10 and all 10 are visited, then we are legitimately done with this page.

        if (resultLinks.length > 0) {
            console.log(`[${socketId}] Page finished. Returning to Google Home to reset.`);
            return { extracted, command: { action: 'NAVIGATE', value: 'https://www.google.com/' } };
        } else {
            // 0 results? Maybe captcha or weird page? Scroll.
            return { extracted, command: { action: 'SCROLL', selector: 'body', value: 'down' } };
        }
    }

    // ---------------------------------------------------------
    // 3. GENERIC PAGE FALLBACK (Non-LinkedIn, Non-Google)
    // ---------------------------------------------------------
    // We want to scrape, maybe scroll once, and then go BACK.

    // Extract emails from body just in case
    const emailRegex = /[a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,6}/g;
    const foundEmails = bodyText.match(emailRegex);
    if (foundEmails) {
        extracted.emails.push(...foundEmails);
        extracted.emails = [...new Set(extracted.emails)]; // Deduplicate
    }

    // Check if we already visited/scrolled this generic page
    // We use a simple heuristic: If we are here, and it's not Google/LinkedIn, we should leave soon.
    // Let's use a "process count" for the current URL if possible, but we don't have the current URL.
    // So we'll just try to go BACK if we've been here. 
    // BUT we don't have a reliable "steps on this page" counter without passing URL.
    // simpler approach: Just go BACK immediately after extraction? 
    // Or Scroll once then Back? 
    // Let's Scroll once, but we need state to know we scrolled. 
    // Current Architecture doesn't pass "Current URL" easily unless we parse it from DOM or Client sends it.
    // Assuming Client sends DOM every 3s. 

    // SAFE FALLBACK: Just extract and go BACK. 
    // This ensures we continue the loop fast.
    logFindings(socketId, 'Generic Page', extracted);
    console.log(`[${socketId}] Generic page processed. Going BACK.`);
    return { extracted, command: { action: 'BACK', value: 'Generic Page -> Back' } };
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
