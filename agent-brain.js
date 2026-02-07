const cheerio = require('cheerio');

// In-memory state: Map<socketId, { visitedUrls: Set<string>, processedProfiles: Set<string> }>
const clientStates = new Map();

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
            processedProfiles: new Set()
        });
    }
    const state = clientStates.get(socketId);
    const visited = state.visitedUrls;
    const processedProfiles = state.processedProfiles;

    const $ = cheerio.load(domHtml);
    const title = $('title').text().toLowerCase();
    const bodyText = $('body').text();

    const extracted = {
        emails: [],
        links: [],
        jobCards: 0,
        isGoogleSearch: title.includes('google search') || title.includes(' - google'),
        isLinkedin: title.includes('linkedin') || domHtml.includes('linkedin.com')
    };

    let command = null;

    // ---------------------------------------------------------
    // 1. LINKEDIN SPECIFIC LOGIC
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

        // B. DETERMINE PAGE TYPE
        // Check URL for /recent-activity/ or /posts/ to know if we are on the "Posts" page
        // Since we don't have the URL in arguments, we infer from DOM cues
        const isActivityPage = $('h1:contains("Activity")').length > 0 ||
            $('.feed-shared-update-v2').length > 0 ||
            title.includes('activity') || title.includes('posts');

        // Extract Profile Name/ID identifier (simple fallback)
        const profileName = $('h1.top-card-layout__title').text().trim() || title.split('|')[0].trim();

        if (isActivityPage) {
            // --- ON POSTS PAGE --- 
            console.log(`[${socketId}] Analyzing Posts for: ${profileName}`);

            // 1. Extract Emails from Posts (with keywords)
            const posts = $('.feed-shared-update-v2, .feed-shared-update-v2__description-wrapper');
            const keywords = ['hiring', 'join our team', 'looking for', 'openings', 'opportunity'];

            posts.each((i, el) => {
                const text = $(el).text();
                const textLower = text.toLowerCase();
                const hasKeyword = keywords.some(k => textLower.includes(k));

                if (hasKeyword) {
                    const emailRegex = /[a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,6}/g;
                    const found = text.match(emailRegex);
                    if (found) {
                        extracted.emails.push(...found);
                        console.log(`[${socketId}] FOUND EMAIL in hiring post:`, found);
                    }
                }
            });

            // 2. Mark Done & Go Back
            processedProfiles.add(profileName);
            console.log(`[${socketId}] Done with posts for ${profileName}. Going BACK.`);
            return { extracted, command: { action: 'BACK', value: 'Posts Scanned -> Back' } };

        } else {
            // --- ON MAIN PROFILE PAGE ---
            if (processedProfiles.has(profileName)) {
                console.log(`[${socketId}] Already processed ${profileName}. Going BACK.`);
                return { extracted, command: { action: 'BACK', value: 'Already Processed -> Back' } };
            }

            // Find "Show all activity" or "Posts" button
            // Typical usage: "Show all activity" link or "Posts" tab
            const activityBtn = $('a.profile-section-card__add-icon, a:contains("Show all activity"), a:contains("See all activity"), #generated-id-posts-tab');

            if (activityBtn.length > 0) {
                console.log(`[${socketId}] Clicking 'Show all activity' for ${profileName}`);
                return { extracted, command: { action: 'CLICK', selector: `a[href*="recent-activity"]`, value: 'Go to Posts' } };
                // Note: Selector might need refining if not standard 'recent-activity' href
            } else {
                // If we can't find activity button, scan bio for emails then go back
                const emailRegex = /[a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,6}/g;
                const bioEmails = bodyText.match(emailRegex);
                if (bioEmails) extracted.emails = [...new Set(bioEmails)];

                processedProfiles.add(profileName);
                console.log(`[${socketId}] No activity button found for ${profileName}. Scanned bio. Going BACK.`);
                return { extracted, command: { action: 'BACK', value: 'No Posts -> Back' } };
            }
        }
    }

    // ---------------------------------------------------------
    // 2. GOOGLE SEARCH NAVIGATION (The Loop)
    // ---------------------------------------------------------
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
        console.log(`[${socketId}] Found ${resultLinks.length} Google results.`);

        // Find Unvisited Link
        for (const link of resultLinks) {
            if (!visited.has(link.href)) {
                console.log(`[${socketId}] Clicking Result: ${link.title}`);
                visited.add(link.href);

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

        // Next Page
        console.log(`[${socketId}] All results visited. Next Page?`);
        const nextBtn = $('#pnnext, a:contains("Next")').first();
        if (nextBtn.length > 0) {
            // Need robust selector for generic 'Next' text
            return { extracted, command: { action: 'CLICK', selector: '#pnnext', value: 'Next Page' } };
        }
    }

    // ---------------------------------------------------------
    // 3. FALLBACK / SCROLL
    // ---------------------------------------------------------
    if (!command) {
        command = { action: 'SCROLL', selector: 'body', value: 'down' };
    }

    return { extracted, command };
}

// Reset state
function resetClientState(socketId) {
    clientStates.delete(socketId);
}

module.exports = { processDom, resetClientState };
