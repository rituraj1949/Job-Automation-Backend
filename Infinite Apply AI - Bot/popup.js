document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('userInfoForm');

  // Load saved data from chrome.storage.local
  chrome.storage.local.get(['userInfo', 'accessInfo'], (data) => {
    if (data.userInfo) {
      document.getElementById('name').value = data.userInfo.name || '';
      document.getElementById('jobTitle').value = data.userInfo.jobTitle || '';
      document.getElementById('noticePeriod').value = data.userInfo.noticePeriod || '';
      document.getElementById('currentCTC').value = data.userInfo.currentCTC || '';
      document.getElementById('expectedCTC').value = data.userInfo.expectedCTC || '';
      document.getElementById('location').value = data.userInfo.location || '';
      document.getElementById('experience').value = data.userInfo.experience || '';
      document.getElementById('datePosted').value = data.userInfo.datePosted || 'all';
      document.getElementById('jobType').value = data.userInfo.jobType || 'remote';
      document.getElementById('sortBy').value = data.userInfo.sortBy || 'relevant';
      const experienceLevels = data.userInfo.experienceLevels || [];
      document.querySelectorAll('input[name="experienceLevels[]"]').forEach(checkbox => {
        checkbox.checked = experienceLevels.includes(checkbox.value);
      });
      // Load skills
      if (data.userInfo.skills) {
        const skills = data.userInfo.skills;
        document.getElementById('skill1').value = skills[0] || '';
        document.getElementById('skill2').value = skills[1] || '';
        document.getElementById('skill3').value = skills[2] || '';
        document.getElementById('skill4').value = skills[3] || '';
        document.getElementById('skill5').value = skills[4] || '';
        document.getElementById('skill6').value = skills[5] || '';

      }
      // Load non-relevant skills
      if (data.userInfo.nonRelevantSkills) {
        const nonRelevantSkills = data.userInfo.nonRelevantSkills;
        document.getElementById('nonRelevantSkill1').value = nonRelevantSkills[0] || '';
        document.getElementById('nonRelevantSkill2').value = nonRelevantSkills[1] || '';
        document.getElementById('nonRelevantSkill3').value = nonRelevantSkills[2] || '';
      }
      // Load companies to avoid
      if (data.userInfo.avoidCompanies) {
        document.getElementById('avoidCompanies').value = data.userInfo.avoidCompanies.join('\n');
      }
    }
    if (data.accessInfo && data.accessInfo.email) {
      document.getElementById('email').value = data.accessInfo.email;
    }
  });

  // Handle form submission
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    saveFormData();
  });

  function saveFormData() {
    const skills = Array.from(document.querySelectorAll('input[name="skills[]"]'))
      .map(input => input.value.trim())
      .filter(skill => skill !== '');
    const nonRelevantSkills = Array.from(document.querySelectorAll('input[name="nonRelevantSkills[]"]'))
      .map(input => input.value.trim())
      .filter(skill => skill !== '');
    const avoidCompanies = document.getElementById('avoidCompanies').value
      .split('\n')
      .map(company => company.trim())
      .filter(company => company !== '');
    const formData = {
      name: document.getElementById('name').value,
      email: document.getElementById('email').value,
      jobTitle: document.getElementById('jobTitle').value,
      noticePeriod: document.getElementById('noticePeriod').value,
      currentCTC: document.getElementById('currentCTC').value,
      expectedCTC: document.getElementById('expectedCTC').value,
      location: document.getElementById('location').value,
      experience: document.getElementById('experience').value,
      datePosted: document.getElementById('datePosted').value,
      experienceLevels: Array.from(document.querySelectorAll('input[name="experienceLevels[]"]:checked')).map(el => el.value),
      jobType: document.getElementById('jobType').value,
      sortBy: document.getElementById('sortBy').value,
      skills,
      nonRelevantSkills,
      avoidCompanies
    };
    chrome.storage.local.set({ userInfo: formData }, () => {
      console.log('Form data saved:', formData);
      chrome.tabs.create({ url: 'https://www.linkedin.com/jobs/' }, () => {
        chrome.storage.local.set({ automationActive: true }, () => {
          console.log('Automation activated');
        });
      });
    });
  }
});