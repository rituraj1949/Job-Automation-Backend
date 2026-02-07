const cheerio = require('cheerio');

/**
 * Analyzes the DOM snapshot from Android Agent and decides next actions.
 * @param {string} domHtml - The full HTML string of the page.
 * @returns {object} - { extracted: object, command: object | null }
 */
function processDom(domHtml) {
    if (!domHtml || typeof domHtml !== 'string') {
        return { error: 'Invalid DOM' };
    }

    const $ = cheerio.load(domHtml);
    const extracted = {
        emails: [],
        links: [],
        jobCards: 0
    };

    // 1. EXTRACT EMAILS (Simple Regex)
    const bodyText = $('body').text();
    const emailRegex = /[a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,6}/g;
    const foundEmails = bodyText.match(emailRegex);
    if (foundEmails) {
        extracted.emails = [...new Set(foundEmails)]; // Deduplicate
    }

    // 2. EXTRACT LINKS (Career/Job specific)
    $('a').each((i, el) => {
        const href = $(el).attr('href');
        const text = $(el).text().toLowerCase();
        if (href && (text.includes('career') || text.includes('job') || text.includes('openings'))) {
            extracted.links.push({ text: $(el).text().trim(), href });
        }
    });

    // 3. DECIDE NEXT ACTION
    let command = null;

    // Strategy: If "Next" button exists, click it.
    // Common "Next" button selectors/text
    const nextButton = $('a, button').filter((i, el) => {
        const t = $(el).text().toLowerCase();
        return t.includes('next') || t.includes('older') || $(el).attr('aria-label')?.includes('next');
    });

    if (nextButton.length > 0) {
        // We found a next button!
        // We need a robust selector for the Android agent.
        // For now, let's try a generic text-based strategy if no ID/Class.
        // But Android agent needs a CSS selector.
        // Let's assume the first one is good.
        let selector = '';
        const id = nextButton.first().attr('id');
        const cls = nextButton.first().attr('class');

        if (id) selector = `#${id}`;
        else if (cls) selector = `.${cls.split(' ').join('.')}`;
        else selector = `a:contains("${nextButton.first().text()}")`; // jQuery-ish, might fail on simple querySelector

        if (selector) {
            command = { action: 'CLICK', selector: selector, value: 'Next Page' };
        }
    }

    // Fallback: If no "Next" button, SCROLL down to trigger lazy load or find more.
    if (!command) {
        command = { action: 'SCROLL', selector: 'body', value: 'down' };
    }

    return { extracted, command };
}

module.exports = { processDom };
