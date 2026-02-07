const mongoose = require('mongoose');

const CompanySchema = new mongoose.Schema({
    companyName: { type: String, required: true },
    companySize: { type: String, default: 'N/A' },
    location: { type: String, default: 'N/A' },
    industry: { type: String, default: 'N/A' },
    bio: { type: String, default: '' },
    isHiring: { type: String, default: 'unknown' }, // "yes" or "unknown"
    officialWebsite: { type: String, default: '' },
    careerWebsite: { type: String, default: '' },
    linkedinCompanyUrl: { type: String, required: true, unique: true },
    emails: { type: [String], default: [] },
    JobsCount: { type: String, default: '0' },
    JobsCountTime: { type: String, default: '' },
    applied: { type: String, default: 'No' },
    totalSkillsMatched: { type: String, default: '0' },
    skillsFoundInJob: { type: [String], default: [] },
    note: { type: String, default: '' },
    appliedJobTitle: { type: String, default: '' },
    matchedJobTitle: { type: String, default: '' },
    createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('LinkedInCompany', CompanySchema);
