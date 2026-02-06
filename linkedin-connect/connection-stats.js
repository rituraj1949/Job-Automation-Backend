const fs = require('fs');
const path = require('path');

const STATS_FILE = path.join(__dirname, 'connection-stats.json');

// Initialize stats file if needed
if (!fs.existsSync(STATS_FILE)) {
    try {
        fs.writeFileSync(STATS_FILE, JSON.stringify([], null, 2));
    } catch (e) {
        // ignore
    }
}

function loadStats() {
    try {
        if (!fs.existsSync(STATS_FILE)) return [];
        const raw = fs.readFileSync(STATS_FILE, 'utf8');
        return JSON.parse(raw);
    } catch (e) {
        return [];
    }
}

function saveStats(stats) {
    try {
        fs.writeFileSync(STATS_FILE, JSON.stringify(stats, null, 2));
    } catch (e) {
        // ignore
    }
}

function addConnectionStat(name) {
    const stats = loadStats();
    stats.push({
        name: name || 'Unknown',
        timestamp: new Date().toISOString()
    });
    // Optional: Keep only last 60 days to prevent infinite growth
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 60);
    const filtered = stats.filter(s => new Date(s.timestamp) > cutoff);
    saveStats(filtered);
}

function getStatsSummary() {
    const stats = loadStats();
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfWeek = new Date(startOfDay);
    startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay()); // Sunday as start
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const today = stats.filter(s => new Date(s.timestamp) >= startOfDay).length;
    const week = stats.filter(s => new Date(s.timestamp) >= startOfWeek).length;
    const month = stats.filter(s => new Date(s.timestamp) >= startOfMonth).length;

    return { today, week, month, total: stats.length };
}

module.exports = { addConnectionStat, getStatsSummary };
