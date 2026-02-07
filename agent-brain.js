const cheerio = require('cheerio');

// In-memory state: Map<socketId, Set<visitedUrls>>
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
        clientStates.set(socketId, new Set());
    }
    const visited = clientStates.get(socketId);

    const $ = cheerio.load(domHtml);
    const title = $('title').text().toLowerCase();
    const bodyText = $('body').text();

    const extracted = {
        emails: [],
        links: [],
        jobCards: 0,
        isGoogleSearch: title.includes('google search') || title.includes(' - google')
    };

    // 1. EXTRACT EMAILS (Simple Regex)
    const emailRegex = /[a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,6}/g;
    const foundEmails = bodyText.match(emailRegex);
    if (foundEmails) {
        extracted.emails = [...new Set(foundEmails)]; // Deduplicate
    }

    let command = null;

    // 2. GOOGLE SEARCH NAVIGATION STRATEGY
    if (extracted.isGoogleSearch) {
        // Find all results (standard Google structure .g -> .tF2Cxc -> a)
        // Or just look for h3 parent anchors as a robust fallback
        const resultLinks = [];

        // Strategy: Find all anchors that contain an h3 (title of result)
        $('a').each((i, el) => {
            const hasH3 = $(el).find('h3').length > 0;
            const href = $(el).attr('href');

            if (hasH3 && href && href.startsWith('http') && !href.includes('google.com')) {
                resultLinks.push({ href: href, title: $(el).text() });
            }
        });

        extracted.googleResultsCount = resultLinks.length;
        console.log(`[${socketId}] Found ${resultLinks.length} Google results.`);

        // Check for unvisited links
        for (const link of resultLinks) {
            if (!visited.has(link.href)) {
                // FOUND NEW LINK!
                console.log(`[${socketId}] Decided to click: ${link.title}`);
                visited.add(link.href);

                // Generate Click Command
                // We need a selector for this specific link.
                // Best is href attribute selector
                command = {
                    action: 'CLICK',
                    selector: `a[href="${link.href}"]`,
                    value: `Visiting: ${link.title}`
                };
                break; // Stop after finding one
            }
        }

        // All links on this page visited? Click Next Page.
        if (!command) {
            console.log(`[${socketId}] All results visited. Looking for 'Next' button.`);
            // Google 'Next' button usually has id "pnnext" or text "Next"
            const nextBtn = $('#pnnext');
            if (nextBtn.length > 0) {
                command = { action: 'CLICK', selector: '#pnnext', value: 'Next Page (Google)' };
            } else {
                // Try searching by text if ID fails
                command = { action: 'CLICK', selector: `a:contains("Next")`, value: 'Next Page (Fallback)' };
            }
        }

    } else {
        // 3. GENERIC PAGE STRATEGY (Not Google)
        // Extract career links
        $('a').each((i, el) => {
            const href = $(el).attr('href');
            const text = $(el).text().toLowerCase();
            if (href && (text.includes('career') || text.includes('job') || text.includes('openings'))) {
                extracted.links.push({ text: $(el).text().trim(), href });
            }
        });

        // Strategy: If "Next" button exists (pagination), click it.
        const nextButton = $('a, button').filter((i, el) => {
            const t = $(el).text().toLowerCase();
            return t.includes('next') || t.includes('older') || $(el).attr('aria-label')?.includes('next');
        });

        if (nextButton.length > 0) {
            let selector = '';
            const id = nextButton.first().attr('id');
            const cls = nextButton.first().attr('class');

            if (id) selector = `#${id}`;
            else if (cls) selector = `.${cls.split(' ').join('.')}`;
            else selector = `a:contains("${nextButton.first().text()}")`;

            if (selector) {
                command = { action: 'CLICK', selector: selector, value: 'Next Page' };
            }
        }

        // Fallback: SCROLL
        if (!command) {
            command = { action: 'SCROLL', selector: 'body', value: 'down' };
        }
    }

    return { extracted, command };
}

// Helper to reset state (optional)
function resetClientState(socketId) {
    clientStates.delete(socketId);
}

module.exports = { processDom, resetClientState };
