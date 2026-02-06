(function () {
  let refreshInterval;
  let clearDataInterval;
  let idleCheckInterval;
  let safetyCheckInterval;
  let activeCheckInterval;
  let lastActivityTime = Date.now();
  let isProcessing = false;
  let automationTimeoutId;
  let currentStep = 0;
  let successfulApplications = 0;
  let failedApplications = 0;
  let scrollAttemptsOnPage = 0;
  const maxScrollsPerPage = 3;
  let consecutiveEmptySteps = 0;
  const maxConsecutiveEmptySteps = 5;
  const maxModalSteps = 8;
  let lastEasyApplyClickTime = 0;
  window.stopAutomation = false;

  // Utility Functions for Counts
  function getCurrentDate() {
    const now = new Date();
    return now.toISOString().split('T')[0]; // 'YYYY-MM-DD'
  }

  function getCurrentMonth() {
    const now = new Date();
    return now.toISOString().slice(0, 7); // 'YYYY-MM'
  }

  async function getApplicationCounts() {
    const applicationCounts = await getStorageValue('applicationCounts') || {};
    const today = getCurrentDate();
    const currentMonth = getCurrentMonth();
    const dailyCount = applicationCounts[today] || 0;
    const monthlyCount = Object.keys(applicationCounts)
      .filter(date => date.startsWith(currentMonth))
      .reduce((sum, date) => sum + (applicationCounts[date] || 0), 0);
    return { daily: dailyCount, monthly: monthlyCount };
  }

  async function incrementApplicationCount() {
    const today = getCurrentDate();
    const applicationCounts = await getStorageValue('applicationCounts') || {};
    applicationCounts[today] = (applicationCounts[today] || 0) + 1;
    await setStorageValue('applicationCounts', applicationCounts);
    updateCountsBanner();
  }

  function setStorageValue(key, value) {
    return new Promise((resolve) => {
      chrome.storage.local.set({ [key]: value }, resolve);
    });
  }

  function getStorageValue(key) {
    return new Promise((resolve) => {
      chrome.storage.local.get(key, (result) => resolve(result[key]));
    });
  }

  // Banner Functions
  function createCountsBanner() {
    if (document.getElementById('countsBanner')) return;
    const banner = document.createElement('div');
    banner.id = 'countsBanner';
    banner.style.position = 'fixed';
    banner.style.top = '20px';
    banner.style.right = '20px';
    banner.style.zIndex = '9999';
    banner.style.padding = '10px 15px';
    banner.style.backgroundColor = '#28a745';
    banner.style.color = '#ffffff';
    banner.style.borderRadius = '5px';
    banner.style.boxShadow = '0px 2px 6px rgba(0,0,0,0.3)';
    banner.style.fontSize = '14px';
    banner.style.fontFamily = 'Arial, sans-serif';
    banner.innerText = 'Applied today: 0, This month: 0';
    document.body.appendChild(banner);
    updateCountsBanner();
  }

  async function updateCountsBanner() {
    const counts = await getApplicationCounts();
    const banner = document.getElementById('countsBanner');
    if (banner) {
      banner.innerText = `Applied today: ${counts.daily}, This month: ${counts.monthly}`;
    }
  }

  // Existing Functions (Modified where necessary)
  async function checkIsActive(email) {
    // Bypass auth for local bot
    return true;
    /* 
    try {
      const response = await fetch(`http://localhost:3000/api/linkedin-bot/check-active?email=${encodeURIComponent(email)}`);
      if (!response.ok) throw new Error('Network response was not ok');
      const data = await response.json();
      return data.isActive;
    } catch (error) {
      console.error('Error checking isActive:', error);
      return false;
    }
    */
  }

  function createMessageBanner() {
    if (document.getElementById("automationMessageBanner")) return;
    const banner = document.createElement("div");
    banner.id = "automationMessageBanner";
    banner.style.position = "fixed";
    banner.style.bottom = "70px";
    banner.style.right = "20px";
    banner.style.zIndex = "9999";
    banner.style.padding = "15px 20px";
    banner.style.backgroundColor = "#0073b1";
    banner.style.color = "#ffffff";
    banner.style.borderRadius = "8px";
    banner.style.boxShadow = "0px 4px 8px rgba(0,0,0,0.2)";
    banner.style.fontSize = "16px";
    banner.style.fontFamily = "Arial, sans-serif";
    banner.style.display = "none";
    banner.style.maxWidth = "300px";
    banner.style.textAlign = "center";
    banner.innerText = "Your AI bot is initializing...";
    document.body.appendChild(banner);
  }

  function createWebsiteBanner() {
    if (document.getElementById("websiteBanner")) return;
    const banner = document.createElement("div");
    banner.id = "websiteBanner";
    banner.style.position = "fixed";
    banner.style.bottom = "20px";
    banner.style.left = "20px";
    banner.style.zIndex = "9999";
    banner.style.padding = "15px 20px";
    banner.style.backgroundColor = "#0073b1";
    banner.style.color = "#ffffff";
    banner.style.borderRadius = "8px";
    banner.style.boxShadow = "0px 4px 8px rgba(0,0,0,0.2)";
    banner.style.fontSize = "16px";
    banner.style.fontFamily = "Arial, sans-serif";
    banner.style.maxWidth = "300px";
    banner.style.textAlign = "center";
    banner.style.animation = "blink 1s infinite";
    const style = document.createElement('style');
    style.innerHTML = `
      @keyframes blink {
          0% { opacity: 1; }
          50% { opacity: 0; }
          100% { opacity: 1; }
      }
    `;
    document.head.appendChild(style);
    chrome.storage.local.get('userInfo', function (result) {
      const userName = result.userInfo && result.userInfo.name ? result.userInfo.name : "User";
      banner.innerText = `Hey ${userName},  🛑 Do Not Touch.🚨 Your AI Bot has entered God Mode. Just keep the screen on — it’s auto-firing applications like a job-seeking missile system 🚀You relax. It dominates. Everything is being handled — thermonuclear style 💣👉 https://infinite-apply.vercel.app/`;
    });
    document.body.appendChild(banner);
  }

  function updateMessageBanner(message, bgColor = "#0073b1") {
    const banner = document.getElementById("automationMessageBanner");
    if (banner) {
      banner.innerText = message;
      banner.style.backgroundColor = bgColor;
      banner.style.display = "block";
      console.log(`MessageBanner updated: ${message}`);
    }
  }

  function hideMessageBanner() {
    const banner = document.getElementById("automationMessageBanner");
    if (banner) {
      banner.style.display = "none";
      console.log("MessageBanner hidden");
    }
  }

  function addButtons() {
    if (document.getElementById("startAutomationBtn") || document.getElementById("stopAutomationBtn")) return;
    createMessageBanner();
    createWebsiteBanner();
    createCountsBanner();
    const startBtn = document.createElement("button");
    startBtn.id = "startAutomationBtn";
    startBtn.innerText = "Start Automation";
    startBtn.style.position = "fixed";
    startBtn.style.bottom = "20px";
    startBtn.style.right = "20px";
    startBtn.style.zIndex = "9999";
    startBtn.style.padding = "10px 15px";
    startBtn.style.backgroundColor = "#0073b1";
    startBtn.style.color = "#ffffff";
    startBtn.style.border = "none";
    startBtn.style.borderRadius = "5px";
    startBtn.style.cursor = "pointer";
    startBtn.style.boxShadow = "0px 2px 6px rgba(0,0,0,0.3)";
    startBtn.addEventListener("click", function () {
      chrome.storage.local.set({ automationActive: true }, function () {
        startBtn.style.display = "none";
        document.getElementById("stopAutomationBtn").style.display = "block";
        updateMessageBanner("Your AI bot is starting in 30 seconds...", "#0073b1");
        automationTimeoutId = setTimeout(startAutomation, 30000);
        console.log("Automation will start in 30 seconds. Please set your job search filters now.");
      });
    });
    document.body.appendChild(startBtn);
    const stopBtn = document.createElement("button");
    stopBtn.id = "stopAutomationBtn";
    stopBtn.innerText = "Stop Automation";
    stopBtn.style.position = "fixed";
    stopBtn.style.bottom = "20px";
    stopBtn.style.right = "20px";
    stopBtn.style.zIndex = "9999";
    stopBtn.style.padding = "10px 15px";
    stopBtn.style.backgroundColor = "#e60023";
    stopBtn.style.color = "#ffffff";
    stopBtn.style.border = "none";
    stopBtn.style.borderRadius = "5px";
    stopBtn.style.cursor = "pointer";
    stopBtn.style.boxShadow = "0px 2px 6px rgba(0,0,0,0.3)";
    stopBtn.style.display = "none";
    stopBtn.addEventListener("click", function () {
      window.stopAutomation = true;
      chrome.storage.local.set({ automationActive: false }, function () {
        if (automationTimeoutId) {
          clearTimeout(automationTimeoutId);
          automationTimeoutId = null;
          console.log("Automation start cancelled.");
          updateMessageBanner("Automation start cancelled.", "#e60023");
        }
        if (refreshInterval) clearInterval(refreshInterval);
        if (clearDataInterval) clearInterval(clearDataInterval);
        if (idleCheckInterval) clearInterval(idleCheckInterval);
        if (safetyCheckInterval) clearInterval(safetyCheckInterval);
        if (activeCheckInterval) clearInterval(activeCheckInterval);
        stopBtn.style.display = "none";
        startBtn.style.display = "block";
        console.log("Automation stopped by user.");
        updateMessageBanner(`Automation stopped. Stats: ${successfulApplications} applied, ${failedApplications} Non Relevant Jobs.`, "#e60023");
        setTimeout(hideMessageBanner, 5000);
      });
    });
    document.body.appendChild(stopBtn);
  }

  function clearLocalStorageExceptAutomationActive() {
    const automationActive = localStorage.getItem('automationActive');
    localStorage.clear();
    if (automationActive) localStorage.setItem('automationActive', automationActive);
  }

  function clearCookiesExceptSession() {
    const cookies = document.cookie.split(';');
    cookies.forEach(cookie => {
      const name = cookie.split('=')[0].trim();
      if (name !== 'li_at') {
        document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;`;
      }
    });
  }

  function waitForElement(selector, timeout = 9800) {
    return new Promise((resolve, reject) => {
      const interval = 312;
      let elapsed = 0;
      const check = setInterval(() => {
        const element = document.querySelector(selector);
        if (element) {
          clearInterval(check);
          resolve(element);
        } else if (elapsed >= timeout) {
          clearInterval(check);
          reject(new Error(`Element not found: ${selector}`));
        }
        elapsed += interval;
      }, interval);
    });
  }

  function waitForAnySelector(selectors, timeout = 12000) {
    return new Promise((resolve) => {
      const interval = 312;
      let elapsed = 0;
      const check = setInterval(() => {
        for (const selector of selectors) {
          const element = document.querySelector(selector);
          if (element) {
            clearInterval(check);
            resolve(element);
            return;
          }
        }
        if (elapsed >= timeout) {
          clearInterval(check);
          resolve(null);
          return;
        }
        elapsed += interval;
      }, interval);
    });
  }

  function setNativeValue(element, value) {
    if (!element) return;
    const setter =
      Object.getOwnPropertyDescriptor(element, 'value')?.set ||
      Object.getOwnPropertyDescriptor(element.__proto__ || Object.getPrototypeOf(element), 'value')?.set ||
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    if (setter) {
      setter.call(element, value);
    } else {
      element.value = value;
    }
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function closeTypeaheadDropdown(inputs = []) {
    inputs.filter(Boolean).forEach(input => {
      try {
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
        input.dispatchEvent(new KeyboardEvent('keyup', { key: 'Escape', code: 'Escape', bubbles: true }));
        input.blur();
      } catch (e) {
        // ignore
      }
    });
  }

  async function applyDatePostedFilter(userInfo) {
    try {
      console.log("User-selected date posted:", userInfo.datePosted);
      const datePostedButton = await waitForElement('#searchFilter_timePostedRange', 20000);
      const dropdownId = datePostedButton.getAttribute('aria-controls');
      if (!dropdownId) throw new Error('aria-controls attribute not found on Date Posted filter button');
      datePostedButton.click();
      console.log("Clicked Date Posted filter button");
      const dropdown = await waitForElement(`#${dropdownId}`, 20000);
      console.log("Date Posted dropdown opened");
      const datePostedMap = {
        'all': 'timePostedRange-',
        'month': 'timePostedRange-r2592000',
        'week': 'timePostedRange-r604800',
        '24hours': 'timePostedRange-r86400'
      };
      const radioButtons = dropdown.querySelectorAll('input[name="date-posted-filter-value"]');
      const availableOptions = Array.from(radioButtons).map(rb => ({
        id: rb.id,
        label: rb.closest('label')?.querySelector('.t-14.t-black--light.t-normal')?.textContent.trim() || 'Unknown'
      }));
      console.log("Available date posted radio buttons:", availableOptions);
      const filterValue = datePostedMap[userInfo.datePosted] || 'timePostedRange-';
      const input = dropdown.querySelector(`#${filterValue}`);
      if (input) {
        if (!input.checked) {
          input.checked = true;
          input.dispatchEvent(new Event('change', { bubbles: true }));
          console.log(`Selected Date Posted filter: ${userInfo.datePosted} (id: ${filterValue})`);
        } else {
          console.log(`Date Posted filter already selected: ${userInfo.datePosted} (id: ${filterValue})`);
        }
      } else {
        console.warn(`Date Posted radio button with id ${filterValue} not found for value: ${userInfo.datePosted}`);
      }
      const submitButton = await waitForElement(`#${dropdownId} button.artdeco-button--primary`, 9000);
      submitButton.click();
      console.log("Clicked 'Show results' button for Date Posted filter");
      await new Promise(resolve => setTimeout(resolve, 5000));
    } catch (error) {
      console.error(`Error applying Date Posted filter: ${error.message}`);
      updateMessageBanner("Error applying Date Posted filter.", "#e60023");
      throw error;
    }
  }

  async function applyExperienceLevelFilter(userInfo) {
    try {
      console.log("User-selected experience levels:", userInfo.experienceLevels);
      const experienceButton = await waitForElement('#searchFilter_experience', 10000);
      const dropdownId = experienceButton.getAttribute('aria-controls');
      if (!dropdownId) throw new Error('aria-controls attribute not found on Experience Level filter button');
      experienceButton.click();
      console.log("Clicked Experience Level filter button");
      const dropdown = await waitForElement(`#${dropdownId}`, 10000);
      console.log("Experience Level dropdown opened");
      const experienceLevelMap = {
        'internship': '1',
        'entry': '2',
        'associate': '3',
        'midSenior': '4',
        'director': '5',
        'executive': '6'
      };
      const labelMap = {
        'internship': 'Internship',
        'entry': 'Entry level',
        'associate': 'Associate',
        'midSenior': 'Mid-Senior level',
        'director': 'Director',
        'executive': 'Executive'
      };
      const checkboxes = dropdown.querySelectorAll('input[type="checkbox"]');
      const availableOptions = Array.from(checkboxes).map(cb => ({
        value: cb.value,
        label: cb.closest('label')?.textContent.trim() || 'Unknown'
      }));
      console.log("Available experience level checkboxes:", availableOptions);
      let selectionsMade = 0;
      const expectedSelections = (userInfo.experienceLevels || []).length;
      for (const level of userInfo.experienceLevels || []) {
        const trimmedLevel = level.trim();
        const filterValue = experienceLevelMap[trimmedLevel];
        if (filterValue) {
          const input = dropdown.querySelector(`input[value="${filterValue}"]`);
          if (input) {
            if (!input.checked) {
              input.checked = true;
              input.dispatchEvent(new Event('change', { bubbles: true }));
              console.log(`Selected Experience Level: ${trimmedLevel} (value: ${filterValue})`);
              selectionsMade++;
            } else {
              console.log(`Experience Level already selected: ${trimmedLevel} (value: ${filterValue})`);
              selectionsMade++;
            }
          } else {
            console.warn(`Checkbox with value ${filterValue} not found for level: ${trimmedLevel}`);
          }
        } else {
          console.warn(`No mapping found for Experience Level: ${trimmedLevel}`);
        }
        if (!filterValue || !dropdown.querySelector(`input[value="${filterValue}"]`)) {
          const expectedLabel = labelMap[trimmedLevel];
          if (expectedLabel) {
            const matchedCheckbox = Array.from(checkboxes).find(cb => {
              const label = cb.closest('label')?.textContent.trim();
              return label === expectedLabel;
            });
            if (matchedCheckbox) {
              if (!matchedCheckbox.checked) {
                matchedCheckbox.checked = true;
                matchedCheckbox.dispatchEvent(new Event('change', { bubbles: true }));
                console.log(`Selected Experience Level by label match: ${trimmedLevel} (label: ${expectedLabel}, value: ${matchedCheckbox.value})`);
                selectionsMade++;
              } else {
                console.log(`Experience Level already selected by label match: ${trimmedLevel} (label: ${expectedLabel}, value: ${matchedCheckbox.value})`);
                selectionsMade++;
              }
            } else {
              console.warn(`No checkbox found for Experience Level by label match: ${trimmedLevel} (expected label: ${expectedLabel})`);
            }
          } else {
            console.warn(`No label mapping found for Experience Level: ${trimmedLevel}`);
          }
        }
      }
      if (selectionsMade !== expectedSelections) {
        console.warn(`Selection mismatch: Expected ${expectedSelections} selections, but made ${selectionsMade}. Check user input and mappings.`);
      } else if (selectionsMade > 0) {
        console.log(`Successfully selected ${selectionsMade} experience level(s).`);
      } else if (expectedSelections > 0) {
        console.warn(`No experience levels were selected despite ${expectedSelections} user inputs.`);
      }
      const submitButton = await waitForElement(`#${dropdownId} button.artdeco-button--primary`, 5000);
      submitButton.click();
      console.log("Clicked 'Show results' button for Experience Level filter");
      await new Promise(resolve => setTimeout(resolve, 5000));
    } catch (error) {
      console.error(`Error applying Experience Level filter: ${error.message}`);
      updateMessageBanner("Error applying Experience Level filter.", "#e60023");
      throw error;
    }
  }

  async function applySortByFilter(userInfo) {
    try {
      const sortBy = userInfo.sortBy || 'recent';
      console.log(`User-selected sortBy: ${sortBy}`);
      const sortByMap = {
        'recent': 'advanced-filter-sortBy-DD',
        'relevant': 'advanced-filter-sortBy-R'
      };
      const filterId = sortByMap[sortBy];
      if (!filterId) {
        console.warn(`Invalid sortBy value: ${sortBy}`);
        updateMessageBanner("Invalid sort option selected.", "#e60023");
        return;
      }
      // Open the Sort By dropdown
      const { dropdown, dropdownId } = await openFilterDropdown('searchFilter_sortBy', 12000);
      console.log("Sort By dropdown opened");

      // Get all available radio buttons
      const radioButtons = dropdown.querySelectorAll('input[name="sort-by-filter-value"]');
      const availableOptions = Array.from(radioButtons).map(rb => ({
        id: rb.id,
        label: rb.closest('label')?.querySelector('.t-14.t-black--light.t-normal')?.textContent.trim() || 'Unknown'
      }));
      console.log("Available sort by radio buttons:", availableOptions);

      // Try selecting by ID
      let radio = dropdown.querySelector(`#${filterId}`);
      if (radio) {
        if (!radio.checked) {
          radio.checked = true;
          radio.dispatchEvent(new Event('change', { bubbles: true }));
          console.log(`Selected Sort By: ${sortBy} (id: ${filterId})`);
        } else {
          console.log(`Sort By already selected: ${sortBy} (id: ${filterId})`);
        }
      } else {
        console.warn(`Sort By radio button with id ${filterId} not found. Falling back to label match.`);
        // Fallback: Select by label
        radio = Array.from(radioButtons).find(rb => {
          const label = rb.closest('label')?.querySelector('.t-14.t-black--light.t-normal')?.textContent.trim();
          return label && label.toLowerCase().includes('most recent');
        });
        if (radio) {
          if (!radio.checked) {
            radio.checked = true;
            radio.dispatchEvent(new Event('change', { bubbles: true }));
            console.log(`Selected Sort By: Most recent (label match, id: ${radio.id})`);
          } else {
            console.log(`Sort By already selected: Most recent (label match, id: ${radio.id})`);
          }
        } else {
          console.warn("No 'Most recent' radio button found by label match.");
          updateMessageBanner("Failed to select 'Most recent' sort option.", "#e60023");
          return;
        }
      }

      // Click the submit button
      const submitButton = await waitForElement(`#${dropdownId} button.artdeco-button--primary`, 5000);
      submitButton.click();
      console.log("Clicked 'Show results' button for Sort By filter");
      await new Promise(resolve => setTimeout(resolve, 5000));
    } catch (error) {
      console.error(`Error applying Sort By filter: ${error.message}`);
      updateMessageBanner("Error applying Sort By filter.", "#e60023");
    }
  }

  async function openFilterDropdown(filterButtonId, timeout = 15000) {
    try {
      const filterButton = await waitForElement(`#${filterButtonId}`, timeout);
      const dropdownId = filterButton.getAttribute('aria-controls');
      if (!dropdownId) throw new Error(`aria-controls attribute not found on filter button: ${filterButtonId}`);
      filterButton.click();
      console.log(`Clicked filter button: ${filterButtonId}`);
      const dropdown = await waitForElement(`#${dropdownId}`, timeout);
      console.log(`Dropdown opened for ${filterButtonId}`);
      return { dropdown, dropdownId };
    } catch (error) {
      console.error(`Error opening filter dropdown ${filterButtonId}: ${error.message}`);
      updateMessageBanner(`Error opening filter: ${filterButtonId}.`, "#e60023");
      throw error;
    }
  }

  async function applyFilterSelections(dropdown, dropdownId, inputSelector, values) {
    try {
      const checkboxes = dropdown.querySelectorAll(inputSelector);
      const availableOptions = Array.from(checkboxes).map(cb => ({
        value: cb.value,
        label: cb.closest('label')?.querySelector('.t-14.t-black--light.t-normal')?.textContent.trim() || 'Unknown'
      }));
      console.log(`Available filter options for ${inputSelector}:`, availableOptions);
      let selectionsMade = 0;
      for (const value of values) {
        const input = dropdown.querySelector(`${inputSelector}[value="${value}"]`);
        if (input) {
          if (!input.checked) {
            input.checked = true;
            input.dispatchEvent(new Event('change', { bubbles: true }));
            console.log(`Selected filter value: ${value}`);
            selectionsMade++;
          } else {
            console.log(`Filter value already selected: ${value}`);
            selectionsMade++;
          }
        } else {
          console.warn(`Filter input with value ${value} not found`);
        }
      }
      if (selectionsMade === 0 && values.length > 0) {
        console.warn(`No filter selections made for values: ${values.join(', ')}`);
      } else if (selectionsMade > 0) {
        console.log(`Successfully selected ${selectionsMade} filter value(s).`);
      }
      const submitButton = await waitForElement(`#${dropdownId} button.artdeco-button--primary`, 5000);
      submitButton.click();
      console.log("Clicked 'Show results' button");
      await new Promise(resolve => setTimeout(resolve, 2000));
    } catch (error) {
      console.error(`Error applying filter selections: ${error.message}`);
      updateMessageBanner("Error applying filter selections.", "#e60023");
      throw error;
    }
  }

  async function applyAllFilters(userInfo) {
    try {
      const easyApplyButton = await waitForElement('#searchFilter_applyWithLinkedin', 10000);
      if (!easyApplyButton.classList.contains('artdeco-pill--selected')) {
        easyApplyButton.click();
        console.log("Selected Easy Apply filter");
        updateMessageBanner("Applying Easy Apply filter...", "#0073b1");
        await new Promise(resolve => setTimeout(resolve, 5000));
      } else {
        console.log("Easy Apply filter already selected");
      }
      if (userInfo.datePosted) {
        try {
          await applyDatePostedFilter(userInfo);
        } catch (error) {
          console.error(`Failed to apply Date Posted filter: ${error.message}`);
        }
      }
      if (userInfo.experienceLevels && userInfo.experienceLevels.length > 0) {
        try {
          await applyExperienceLevelFilter(userInfo);
        } catch (error) {
          console.error(`Failed to apply Experience Level filter: ${error.message}`);
        }
      }
      if (userInfo.jobType) {
        try {
          console.log("User-selected job type:", userInfo.jobType);
          const { dropdown, dropdownId } = await openFilterDropdown('searchFilter_workplaceType', 15000);
          const jobTypeMap = {
            'remote': '2',
            'onsite': '1',
            'hybrid': '3'
          };
          const jobTypeValue = jobTypeMap[userInfo.jobType] || '2';
          await applyFilterSelections(
            dropdown,
            dropdownId,
            'input[name="remote-filter-value"]',
            [jobTypeValue]
          );
          console.log(`Applied Job Type filter: ${userInfo.jobType}`);
          updateMessageBanner(`Applied Job Type: ${userInfo.jobType}`, "#0073b1");
        } catch (error) {
          console.error(`Failed to apply Job Type filter: ${error.message}`);
          updateMessageBanner("Error applying Job Type filter.", "#e60023");
        }
      }
      if (userInfo.sortBy) {
        try {
          await applySortByFilter(userInfo);
        } catch (error) {
          console.error(`Failed to apply Sort By filter: ${error.message}`);
        }
      }
      await waitForElement('.job-card-container--clickable', 30000);
      console.log("Job cards reloaded after applying filters");
      updateMessageBanner("Filters applied. Loading jobs...", "#0073b1");
    } catch (error) {
      console.error(`Error applying filters: ${error.message}`);
      updateMessageBanner("Error applying filters.", "#e60023");
    }
  }

  async function startAutomation() {
    window.stopAutomation = false;
    if (window.stopAutomation) return;
    updateMessageBanner("Your AI bot is applying jobs currently...", "#0073b1");
    console.log("Starting automation...");
    const accessInfo = await getStorageValue('accessInfo');
    const email = accessInfo?.email;
    if (!email) {
      console.error('No email found in storage');
      updateMessageBanner('No email found. Please configure access info.', '#e60023');
      setTimeout(hideMessageBanner, 5000);
      return;
    }
    const isActive = await checkIsActive(email);
    if (!isActive) {
      console.error('Automation is not active for this user');
      updateMessageBanner('Automation is not active. Please check your status.', '#e60023');
      setTimeout(hideMessageBanner, 5000);
      return;
    }
    const userInfo = await getStorageValue('userInfo');
    if (userInfo && userInfo.jobTitle) {
      try {
        // If we're on /jobs/search, wait for the search box to mount
        if (window.location.href.includes('/jobs/search/')) {
          await waitForAnySelector([
            '.jobs-search-box__container',
            '.jobs-search-box',
            'form.jobs-search-box'
          ], 10000);
        }

        // Try multiple selectors for keyword input
        const keywordSelectors = [
          '.jobs-search-box__input--keyword input.jobs-search-box__text-input',
          'input[id^="jobs-search-box-keyword-id-"]',
          'input[data-job-search-box-keywords-input-trigger]',
          '#jobs-search-box-keyword-id-ember',
          'input[aria-label="Search by title, skill, or company"]',
          'input[placeholder="Title, skill or Company"]',
          '.jobs-search-box__input--keyword input[type="text"]',
          'input[aria-label^="Search by title"]',
          'input.jobs-search-box__text-input'
        ];
        const locationSelectors = [
          '.jobs-search-box__input--location input.jobs-search-box__text-input',
          'input[id^="jobs-search-box-location-id-"]',
          '#jobs-search-box-location-id-ember',
          'input[aria-label="City, state, or zip code"]',
          'input[placeholder="City, state, or zip code"]',
          '.jobs-search-box__input--location input[type="text"]',
          'input[aria-label^="City, state"]',
          'input[aria-label^="Search location"]'
        ];

        const getInputs = async () => {
          const keywordInput = await waitForAnySelector(keywordSelectors, 10000);
          const locationInput = await waitForAnySelector(locationSelectors, 10000);
          return { keywordInput, locationInput };
        };

        const fillInputs = async () => {
          const { keywordInput, locationInput } = await getInputs();
          if (keywordInput) {
            setNativeValue(keywordInput, userInfo.jobTitle);
            console.log(`Set job title to "${userInfo.jobTitle}"`);
          } else {
            console.error("Keyword input not found");
            updateMessageBanner("Error: Search input not found.", "#e60023");
            return { keywordInput: null, locationInput: null };
          }

          if (locationInput) {
            setNativeValue(locationInput, userInfo.location || "India");
            console.log(`Set location to "${userInfo.location || 'India'}"`);
          }
          // Close any typeahead/modal that pops up after typing
          closeTypeaheadDropdown([keywordInput, locationInput]);
          return { keywordInput, locationInput };
        };

        const triggerSearch = async (inputs) => {
          const { keywordInput, locationInput } = inputs || {};
          // Try clicking the submit button if present
          let searchButton = document.querySelector('.jobs-search-box__submit-button');
          if (!searchButton) {
            searchButton = await waitForElement('.jobs-search-box__submit-button', 8000).catch(() => null);
          }
          if (searchButton) {
            searchButton.click();
            console.log("Clicked search button");
            return true;
          }

          // Fallback: submit the form or press Enter
          const form = (keywordInput && keywordInput.closest('form')) || (locationInput && locationInput.closest('form'));
          if (form) {
            if (form.requestSubmit) {
              form.requestSubmit();
            } else {
              form.submit();
            }
            console.log("Submitted search form");
            return true;
          }

          const target = keywordInput || locationInput;
          if (target) {
            target.focus();
            target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));
            target.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', bubbles: true }));
            console.log("Triggered search with Enter key");
            return true;
          }
          return false;
        };

        // If we refreshed after first search, refill once more before continuing.
        try {
          if (sessionStorage.getItem('infinite_apply_needs_refill') === '1') {
            sessionStorage.removeItem('infinite_apply_needs_refill');
            await new Promise(resolve => setTimeout(resolve, 5000));
          }
        } catch (e) {
          // ignore
        }

        const initialInputs = await fillInputs();
        const didSearch = await triggerSearch(initialInputs);
        if (!didSearch) {
          console.error("Unable to trigger search");
          updateMessageBanner("Unable to trigger search.", "#e60023");
          return;
        }
        // One-time refresh after initial search to stabilize LinkedIn UI
        try {
          const refreshKey = 'infinite_apply_post_search_refresh';
          if (!sessionStorage.getItem(refreshKey)) {
            sessionStorage.setItem(refreshKey, '1');
            sessionStorage.setItem('infinite_apply_needs_refill', '1');
            console.log("Post-search refresh scheduled in 5 seconds...");
            updateMessageBanner("Refreshing once to stabilize results...", "#0073b1");
            setTimeout(() => location.reload(), 5000);
            return;
          }
        } catch (e) {
          // If sessionStorage fails, continue without the refresh
        }
        // If LinkedIn redirects to /jobs/search with params, re-apply inputs and click Search once.
        const waitForSearchUrl = async (timeout = 10000) => {
          const interval = 300;
          let elapsed = 0;
          while (elapsed < timeout) {
            if (window.location.href.includes('/jobs/search/')) {
              return true;
            }
            await new Promise(resolve => setTimeout(resolve, interval));
            elapsed += interval;
          }
          return false;
        };
        const movedToSearch = await waitForSearchUrl(10000);
        if (movedToSearch) {
          const currentUrl = window.location.href;
          if (window.__lastSearchUrl !== currentUrl) {
            window.__lastSearchUrl = currentUrl;
            const refreshedInputs = await fillInputs();
            await triggerSearch(refreshedInputs);
            console.log("Re-applied title/location after /jobs/search URL change.");
          }
        }
        // LinkedIn sometimes clears controlled inputs on submit; re-apply once.
        await new Promise(resolve => setTimeout(resolve, 1200));
        const keywordAfter = await waitForAnySelector(keywordSelectors, 3000);
        const locationAfter = await waitForAnySelector(locationSelectors, 3000);
        if (keywordAfter && !keywordAfter.value?.trim()) {
          setNativeValue(keywordAfter, userInfo.jobTitle);
          console.log("Re-applied job title after search");
        }
        if (locationAfter && !locationAfter.value?.trim()) {
          setNativeValue(locationAfter, userInfo.location || "India");
          console.log("Re-applied location after search");
        }
        const resultSelectors = [
          '.job-card-container--clickable',
          '.jobs-search-results__list-item',
          'ul.jobs-search-results__list',
          '.jobs-search-results-list',
          '.scaffold-layout__list-container'
        ];

        let resultsReady = await waitForAnySelector(resultSelectors, 30000);
        if (!resultsReady) {
          console.warn("Job results not detected. Retrying search...");
          await new Promise(resolve => setTimeout(resolve, 3000));
          await triggerSearch(await getInputs());
          resultsReady = await waitForAnySelector(resultSelectors, 30000);
        }

        if (!resultsReady) {
          console.error("Job results not loading. Refreshing page...");
          updateMessageBanner("Job results not loading. Refreshing...", "#e60023");
          setTimeout(() => location.reload(), 5000);
          return;
        }

        console.log("Job cards loaded after search");
        await applyAllFilters(userInfo);
      } catch (error) {
        console.error(`Error setting search criteria or applying filters: ${error.message}`);
        updateMessageBanner("Error setting search criteria.", "#e60023");
      }
    } else {
      console.error("No userInfo or jobTitle found in storage");
      updateMessageBanner("No job title found. Please configure user info.", "#e60023");
      setTimeout(hideMessageBanner, 5000);
      return;
    }
    try {
      const resultSelectors = [
        '.job-card-container--clickable',
        '.jobs-search-results__list-item',
        'ul.jobs-search-results__list',
        '.jobs-search-results-list',
        '.scaffold-layout__list-container'
      ];
      const ready = await waitForAnySelector(resultSelectors, 30000);
      if (!ready) throw new Error('Results not found');
    } catch (error) {
      console.error("Job cards not found after 30 seconds. Refreshing page...");
      updateMessageBanner("No jobs found. Refreshing page...", "#e60023");
      setTimeout(() => location.reload(), 5000);
      return;
    }
    refreshInterval = setInterval(() => {
      chrome.storage.local.get('automationActive', function (result) {
        if (result.automationActive === true) {
          console.log("30 minutes passed. Refreshing page...");
          updateMessageBanner("Refreshing page to load new jobs...", "#0073b1");
          location.reload();
        }
      });
    }, 7200000);
    clearDataInterval = setInterval(() => {
      chrome.storage.local.get('automationActive', function (result) {
        if (result.automationActive === true) {
          clearLocalStorageExceptAutomationActive();
          clearCookiesExceptSession();
          console.log("Cleared local storage except 'automationActive' and cookies except 'li_at'.");
          updateMessageBanner("Cleared data to maintain performance.", "#0073b1");
        }
      });
    }, 900000);
    idleCheckInterval = setInterval(() => {
      chrome.storage.local.get('automationActive', function (result) {
        if (!isProcessing && result.automationActive === true && (Date.now() - lastActivityTime) > 10 * 60 * 1000) {
          console.log("Idle for more than 10 minutes. Refreshing page...");
          updateMessageBanner("Idle detected. Refreshing page...", "#0073b1");
          location.reload();
        }
      });
    }, 60000);
    safetyCheckInterval = setInterval(handleSafetyReminderPopup, 50000);
    activeCheckInterval = setInterval(async () => {
      const isActive = await checkIsActive(email);
      if (!isActive) {
        window.stopAutomation = true;
        console.log('Automation stopped by server');
        updateMessageBanner('Automation stopped by server.', '#e60023');
        if (refreshInterval) clearInterval(refreshInterval);
        if (clearDataInterval) clearInterval(clearDataInterval);
        if (idleCheckInterval) clearInterval(idleCheckInterval);
        if (safetyCheckInterval) clearInterval(safetyCheckInterval);
        if (activeCheckInterval) clearInterval(activeCheckInterval);
        document.getElementById('stopAutomationBtn').style.display = 'none';
        document.getElementById('startAutomationBtn').style.display = 'block';
      }
    }, 6 * 60 * 60 * 1000);
    applyJobsSequentially(0, userInfo);
  }

  function findScrollableContainer() {
    const jobCards = document.querySelectorAll('.job-card-container--clickable');
    if (jobCards.length === 0) return null;
    let element = jobCards[0].parentElement;
    while (element) {
      const style = window.getComputedStyle(element);
      if (style.overflowY === 'scroll' || style.overflowY === 'auto') return element;
      element = element.parentElement;
    }
    return null;
  }

  async function scrollToLoadMoreJobs() {
    if (scrollAttemptsOnPage >= maxScrollsPerPage) {
      console.log(`Reached maximum scroll limit (${maxScrollsPerPage}) on this page.`);
      updateMessageBanner("Reached scroll limit on this page.", "#0073b1");
      return false;
    }
    try {
      const jobListContainer = findScrollableContainer();
      if (!jobListContainer) {
        console.error("Scrollable job list container not found.");
        updateMessageBanner("Error: Job list container not found.", "#e60023");
        return false;
      }
      const initialJobCount = document.querySelectorAll('.job-card-container--clickable').length;
      console.log(`Current job count: ${initialJobCount}. Scrolling...`);
      updateMessageBanner(`Scrolling to load more jobs...`, "#0073b1");
      jobListContainer.scrollTo({ top: jobListContainer.scrollHeight, behavior: 'smooth' });
      scrollAttemptsOnPage++;
      console.log(`Scroll attempt ${scrollAttemptsOnPage} of ${maxScrollsPerPage}`);
      await new Promise(resolve => setTimeout(resolve, 7800));
      let attempts = 0;
      const maxAttempts = 20;
      while (attempts < maxAttempts) {
        await new Promise(resolve => setTimeout(resolve, 1780));
        const newJobCount = document.querySelectorAll('.job-card-container--clickable').length;
        if (newJobCount > initialJobCount) {
          console.log(`Loaded ${newJobCount - initialJobCount} more jobs.`);
          updateMessageBanner(`Loaded ${newJobCount - initialJobCount} more jobs.`, "#0073b1");
          lastActivityTime = Date.now();
          return true;
        }
        attempts++;
      }
      console.log("No more jobs loaded after scrolling.");
      updateMessageBanner("No more jobs loaded.", "#0073b1");
      return false;
    } catch (error) {
      console.error(`Error while scrolling: ${error.message}`);
      updateMessageBanner("Error while scrolling.", "#e60023");
      return false;
    }
  }

  async function processApplication(successCallback, failureCallback, jobIndex) {
    currentStep = 0;
    consecutiveEmptySteps = 0;
    updateMessageBanner(`Applying to job ${jobIndex + 1}...`, "#0073b1");
    const modalInterval = setInterval(() => {
      if (window.stopAutomation) {
        clearInterval(modalInterval);
        failureCallback && failureCallback(jobIndex);
        return;
      }
      try {
        const modal = document.querySelector('.jobs-easy-apply-modal');
        if (modal) {
          clearInterval(modalInterval);
          lastActivityTime = Date.now();
          console.log(`Application modal detected for job ${jobIndex + 1}.`);
          updateMessageBanner(`Detected application modal for job ${jobIndex + 1}.`, "#0073b1");
          setTimeout(() => {
            handleModalSteps(successCallback, failureCallback, jobIndex);
          }, 9000);
        }
      } catch (error) {
        console.error(`Error checking modal for job ${jobIndex + 1}: ${error.message}. Abandoning job.`);
        updateMessageBanner(`Error applying to job ${jobIndex + 1}.`, "#e60023");
        clearInterval(modalInterval);
        setTimeout(() => failureCallback && failureCallback(jobIndex), 23800);
      }
    }, 10000);
  }

  // Helper function to introduce a delay
  function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Helper function to wait for an element to appear in the DOM
  function waitForElement(selector, timeout = 1000, container = document) {
    return new Promise((resolve, reject) => {
      const startTime = Date.now();
      const checkElement = () => {
        const element = container.querySelector(selector);
        if (element) {
          resolve(element);
        } else if (Date.now() - startTime > timeout) {
          reject(new Error(`Timeout waiting for element: ${selector}`));
        } else {
          setTimeout(checkElement, 100);
        }
      };
      checkElement();
    });
  }

  async function handleFormElements(modal) {
    const userInfo = await getStorageValue('userInfo');
    return new Promise(async (resolve) => {
      const timeout = setTimeout(() => {
        console.log("500ms timeout reached. No form elements found.");
        resolve(false);
      }, 500);
      let elementsFound = false;
      try {
        // Handle text inputs
        const labels = modal.querySelectorAll('label');
        for (const label of labels) {
          const labelText = label.textContent.toLowerCase().trim();
          const inputId = label.getAttribute('for');
          const input = inputId ? modal.querySelector(`[id="${inputId}"]`) : null;
          if (!input || input.type === 'checkbox' || input.type === 'radio') continue;
          if (input.value.trim() === '') {
            if (labelText.includes("location")) {
              input.value = `${userInfo.location}`;
              input.dispatchEvent(new Event('input', { bubbles: true }));
              console.log(`Filled 'Location' with '${userInfo.location}'`);
              updateMessageBanner(`Filled location: '${userInfo.location}'`, "#0073b1");
              elementsFound = true;

              // Wait for dropdown to appear
              await delay(1000);

              // Simulate down arrow key to select the first item
              input.dispatchEvent(new KeyboardEvent('keydown', {
                key: 'ArrowDown',
                code: 'ArrowDown',
                keyCode: 40,
                bubbles: true
              }));
              console.log("Pressed down arrow key to select first item");

              // Delay to ensure dropdown update
              await delay(500);

              // Simulate Enter key to confirm selection
              input.dispatchEvent(new KeyboardEvent('keydown', {
                key: 'Enter',
                code: 'Enter',
                keyCode: 13,
                bubbles: true
              }));
              console.log("Pressed Enter key to confirm selection");

              // Additional delay to ensure selection is processed
              await delay(500);

              // Fallback: Attempt to click the first item if keyboard events fail
              const container = input.closest('.relative');
              if (container) {
                try {
                  const dropdown = await waitForElement('ul', 500, container);
                  const firstItem = dropdown.querySelector('li');
                  if (firstItem) {
                    firstItem.click();
                    console.log("Fallback: Clicked first item in location dropdown");
                    updateMessageBanner("Fallback: Selected location from dropdown.", "#0073b1");
                  } else {
                    console.log("No items found in location dropdown for fallback");
                  }
                } catch (error) {
                  console.error(`Fallback error with location dropdown: ${error.message}`);
                }
              }

              updateMessageBanner("Confirmed selection of location from dropdown.", "#0073b1");
            } else if (labelText.includes("expected ctc") || labelText.includes("expected salary")) {
              input.value = userInfo.expectedCTC || "1500000";
              input.dispatchEvent(new Event('input', { bubbles: true }));
              console.log(`Filled 'Expected CTC' with '${userInfo.expectedCTC || "1500000"}'`);
              updateMessageBanner(`Filled Expected CTC: ${userInfo.expectedCTC || "1500000"}`, "#0073b1");
              elementsFound = true;
            } else if (labelText.includes("current ctc") || labelText.includes("current salary")) {
              input.value = userInfo.currentCTC || "1250000";
              input.dispatchEvent(new Event('input', { bubbles: true }));
              console.log(`Filled 'Current CTC' with '${userInfo.currentCTC || "1250000"}'`);
              updateMessageBanner(`Filled Current CTC: ${userInfo.currentCTC || "1250000"}`, "#0073b1");
              elementsFound = true;
            } else if (labelText.includes("notice")) {
              input.value = userInfo.noticePeriod || "15";
              input.dispatchEvent(new Event('input', { bubbles: true }));
              console.log(`Filled 'Notice PERIOD' with '${userInfo.noticePeriod || "15"}'`);
              updateMessageBanner(`Filled Notice Period: ${userInfo.noticePeriod || "15"}`, "#0073b1");
              elementsFound = true;
            } else {
              // Handle any other empty text inputs not explicitly mentioned
              input.value = userInfo.experience;
              input.dispatchEvent(new Event('input', { bubbles: true }));
              console.log(`Filled input with label '${labelText}' with '${userInfo.experience}'`);
              updateMessageBanner(`Filled input: ${labelText} with '${userInfo.experience}'`, "#0073b1");
              elementsFound = true;
            }
          }
        }

        // Handle dropdowns for English proficiency
        const dropdowns = modal.querySelectorAll('select');
        for (const dropdown of dropdowns) {
          const label = dropdown.closest('div').querySelector('label');
          const labelText = label ? label.textContent.toLowerCase().trim() : '';
          if (labelText.includes("english") && dropdown.value === 'Select an option') {
            const options = dropdown.querySelectorAll('option');
            const nativeOrBilingualOption = Array.from(options).find(option =>
              option.textContent.trim().toLowerCase() === 'native or bilingual'
            );
            if (nativeOrBilingualOption) {
              dropdown.value = nativeOrBilingualOption.value;
              dropdown.dispatchEvent(new Event('change', { bubbles: true }));
              console.log(`Selected 'Native or Bilingual' for dropdown with id: ${dropdown.id}`);
              updateMessageBanner(`Selected 'Native or Bilingual' for English proficiency`, "#0073b1");
              elementsFound = true;
            } else {
              console.warn(`No 'Native or Bilingual' option found in dropdown with id: ${dropdown.id}`);
            }
          } else if (dropdown.value === 'Select an option') {
            // Handle other dropdowns with Yes/No options
            const options = dropdown.querySelectorAll('option');
            const hasYesNoOptions = Array.from(options).some(option =>
              option.value.toLowerCase() === 'yes' || option.value.toLowerCase() === 'no'
            );
            if (hasYesNoOptions) {
              const yesOption = Array.from(options).find(option =>
                option.value.toLowerCase() === 'yes'
              );
              if (yesOption) {
                dropdown.value = yesOption.value;
                dropdown.dispatchEvent(new Event('change', { bubbles: true }));
                console.log(`Selected 'Yes' for dropdown with id: ${dropdown.id}`);
                updateMessageBanner(`Selected 'Yes' for dropdown question`, "#0073b1");
                elementsFound = true;
              } else {
                console.warn(`No 'Yes' option found in dropdown with id: ${dropdown.id}`);
              }
            }
          }
        }

        // Handle radio buttons within fieldsets to always select "Yes"
        const yesRadioButtons = modal.querySelectorAll('input[type="radio"][data-test-text-selectable-option__input="Yes"]');
        for (const radio of yesRadioButtons) {
          if (!radio.checked) {
            radio.checked = true;
            radio.dispatchEvent(new Event('change', { bubbles: true }));
            console.log(`Selected 'Yes' for radio button with name: ${radio.name}`);
            updateMessageBanner(`Selected 'Yes' for question`, "#0073b1");
            elementsFound = true;
          }
        }

        clearTimeout(timeout);
        resolve(elementsFound);
      } catch (error) {
        console.error(`Error handling form elements: ${error.message}`);
        updateMessageBanner("Error handling form elements.", "#e60023");
        clearTimeout(timeout);
        resolve(false);
      }
    });
  }

  async function handleModalSteps(successCallback, failureCallback, jobIndex) {
    if (window.stopAutomation) {
      failureCallback && failureCallback(jobIndex);
      return;
    }
    if (currentStep >= maxModalSteps) {
      console.log(`Max modal steps (${maxModalSteps}) reached for job ${jobIndex + 1}. Abandoning job.`);
      failedApplications++;
      updateMessageBanner(`Failed job ${jobIndex + 1}: Too many steps.`, "#e60023");
      setTimeout(() => failureCallback && failureCallback(jobIndex), 23800);
      return;
    }
    try {
      const modal = document.querySelector('.jobs-easy-apply-modal');
      if (!modal) {
        console.log(`Modal not found for job ${jobIndex + 1}. Checking confirmation popup...`);
        updateMessageBanner(`Checking confirmation for job ${jobIndex + 1}...`, "#0073b1");
        checkAndCloseConfirmationPopup(jobIndex, successCallback, failureCallback);
        return;
      }
      console.log(`Processing step ${currentStep + 1} for job ${jobIndex + 1}`);
      updateMessageBanner(`Processing step ${currentStep + 1} for job ${jobIndex + 1}...`, "#0073b1");

      // Fill location input before clicking next button on first step
      if (currentStep === 0) {
        const locationInput = modal.querySelector('input[placeholder="Location"]') ||
          Array.from(modal.querySelectorAll('label')).find(label =>
            label.textContent.toLowerCase().includes('location'))?.querySelector('input');
        if (locationInput && locationInput.value.trim() === '') {
          locationInput.value = "Noida";
          locationInput.dispatchEvent(new Event('input', { bubbles: true }));
          console.log(`Filled location with 'Noida' for job ${jobIndex + 1}`);
          updateMessageBanner(`Filled location: Noida for job ${jobIndex + 1}`, "#0073b1");

          // Simulate selection from dropdown
          await delay(1000);
          locationInput.dispatchEvent(new KeyboardEvent('keydown', {
            key: 'ArrowDown',
            code: 'ArrowDown',
            keyCode: 40,
            bubbles: true
          }));
          console.log("Pressed down arrow key to select first item");
          await delay(500);
          locationInput.dispatchEvent(new KeyboardEvent('keydown', {
            key: 'Enter',
            code: 'Enter',
            keyCode: 13,
            bubbles: true
          }));
          console.log("Pressed Enter key to confirm selection");
          await delay(500);

          // Fallback: Attempt to click the first item if keyboard events fail
          const container = locationInput.closest('.relative');
          if (container) {
            try {
              const dropdown = await waitForElement('ul', 500, container);
              const firstItem = dropdown.querySelector('li');
              if (firstItem) {
                firstItem.click();
                console.log("Fallback: Clicked first item in location dropdown");
                updateMessageBanner("Fallback: Selected location from dropdown.", "#0073b1");
              } else {
                console.log("No items found in location dropdown for fallback");
              }
            } catch (error) {
              console.error(`Fallback error with location dropdown: ${error.message}`);
            }
          }
          updateMessageBanner("Confirmed selection of location from dropdown.", "#0073b1");
        }
        // Proceed to click next button after filling location
        waitForNextActionButton(modal, (button) => {
          try {
            if (button) {
              const buttonText = button.textContent.trim() || button.getAttribute('aria-label') || 'Unknown';
              console.log(`Found button: ${buttonText} for job ${jobIndex + 1}`);
              button.click();
              lastActivityTime = Date.now();
              console.log(`Clicked button: ${buttonText}`);
              setTimeout(() => {
                currentStep++;
                handleModalSteps(successCallback, failureCallback, jobIndex);
              }, 6000);
            } else {
              console.log(`No next button found for job ${jobIndex + 1}. Abandoning job.`);
              failedApplications++;
              updateMessageBanner(`Failed job ${jobIndex + 1}: No next button.`, "#e60023");
              setTimeout(() => failureCallback && failureCallback(jobIndex), 23800);
            }
          } catch (error) {
            console.error(`Error processing button for job ${jobIndex + 1}: ${error.message}. Abandoning job.`);
            failedApplications++;
            updateMessageBanner(`Error applying to job ${jobIndex + 1}.`, "#e60023");
            setTimeout(() => failureCallback && failureCallback(jobIndex), 23800);
          }
        });
      } else {
        // Handle subsequent steps (1, 2, 3, etc.)
        const isSubmitButton = await handleFormElements(modal);
        waitForNextActionButton(modal, (button) => {
          try {
            if (button) {
              const buttonText = button.textContent.trim() || button.getAttribute('aria-label') || 'Unknown';
              console.log(`Found button: ${buttonText} for job ${jobIndex + 1}`);
              button.click();
              lastActivityTime = Date.now();
              console.log(`Clicked button: ${buttonText}`);
              const isSubmitButton = buttonText.toLowerCase().includes('submit') || buttonText.toLowerCase().includes('apply');
              if (isSubmitButton) {
                console.log(`Submit button detected for job ${jobIndex + 1}. Handling confirmation popup...`);
                updateMessageBanner(`Submitting job ${jobIndex + 1}...`, "#0073b1");
                checkAndCloseConfirmationPopup(jobIndex, successCallback, failureCallback);
              } else {
                setTimeout(async () => {
                  try {
                    currentStep++;
                    if (!isSubmitButton) {
                      console.log(`Checking form elements for job ${jobIndex + 1}...`);
                      const elementsFound = await handleFormElements(modal);
                      if (!elementsFound) {
                        consecutiveEmptySteps++;
                        console.log(`No form elements found. Consecutive empty steps: ${consecutiveEmptySteps}`);
                        if (consecutiveEmptySteps >= maxConsecutiveEmptySteps) {
                          console.log(`Reached ${maxConsecutiveEmptySteps} empty steps for job ${jobIndex + 1}. Abandoning job.`);
                          failedApplications++;
                          updateMessageBanner(`Failed job ${jobIndex + 1}: No form elements.`, "#e60023");
                          setTimeout(() => failureCallback && failureCallback(jobIndex), 23800);
                          return;
                        }
                      } else {
                        consecutiveEmptySteps = 0;
                      }
                    } else {
                      console.log(`CV step detected for job ${jobIndex + 1}. Skipping form handling.`);
                      consecutiveEmptySteps = 0;
                      updateMessageBanner(`Processing CV step for job ${jobIndex + 1}...`, "#0073b1");
                    }
                    handleModalSteps(successCallback, failureCallback, jobIndex);
                  } catch (error) {
                    console.error(`Error after clicking button for job ${jobIndex + 1}: ${error.message}. Abandoning job.`);
                    failedApplications++;
                    updateMessageBanner(`Error applying to job ${jobIndex + 1}.`, "#e60023");
                    setTimeout(() => failureCallback && failureCallback(jobIndex), 23800);
                  }
                }, 6000);
              }
            } else {
              console.log(`No next button found for job ${jobIndex + 1}. Abandoning job.`);
              failedApplications++;
              updateMessageBanner(`Failed job ${jobIndex + 1}: No next button.`, "#e60023");
              setTimeout(() => failureCallback && failureCallback(jobIndex), 23800);
            }
          } catch (error) {
            console.error(`Error processing button for job ${jobIndex + 1}: ${error.message}. Abandoning job.`);
            failedApplications++;
            updateMessageBanner(`Error applying to job ${jobIndex + 1}.`, "#e60023");
            setTimeout(() => failureCallback && failureCallback(jobIndex), 23800);
          }
        });
      }
    } catch (error) {
      console.error(`Error in modal steps for job ${jobIndex + 1}: ${error.message}. Abandoning job.`);
      failedApplications++;
      updateMessageBanner(`Error applying to job ${jobIndex + 1}.`, "#e60023");
      setTimeout(() => failureCallback && failureCallback(jobIndex), 23800);
    }
  }

  function waitForNextActionButton(modal, callback, timeout = 7800) {
    const interval = 312;
    let elapsed = 0;
    const check = setInterval(() => {
      try {
        const button = findNextActionButton(modal);
        if (button) {
          clearInterval(check);
          callback(button);
        } else if (elapsed >= timeout) {
          clearInterval(check);
          callback(null);
        }
        elapsed += interval;
      } catch (error) {
        console.error(`Error in waitForNextActionButton: ${error.message}`);
        updateMessageBanner("Error finding next action button.", "#e60023");
        clearInterval(check);
        callback(null);
      }
    }, interval);
  }

  function findNextActionButton(modal) {
    const excludedTexts = ['back', 'previous', 'cancel', 'dismiss', 'close'];
    const preferredTexts = ['next', 'continue', 'submit', 'review', 'apply'];
    const buttons = Array.from(modal.querySelectorAll('button'));
    const progressionButtons = buttons.filter(button => {
      const text = (button.textContent.toLowerCase().trim() || button.getAttribute('aria-label')?.toLowerCase().trim() || '');
      return !excludedTexts.some(excluded => text.includes(excluded)) &&
        !button.disabled &&
        button.offsetParent !== null;
    });
    const preferredButton = progressionButtons.find(button => {
      const text = (button.textContent.toLowerCase().trim() || button.getAttribute('aria-label')?.toLowerCase().trim() || '');
      return preferredTexts.some(preferred => text.includes(preferred));
    });
    if (preferredButton) {
      console.log(`Selected preferred button: ${preferredButton.textContent.trim() || preferredButton.getAttribute('aria-label')}`);
      return preferredButton;
    }
    const actionBar = modal.querySelector('.artdeco-modal__actionbar');
    if (actionBar) {
      const actionButtons = Array.from(actionBar.querySelectorAll('button'));
      const validButtons = actionButtons.flatMap(button => {
        const text = (button.textContent.toLowerCase().trim() || button.getAttribute('aria-label')?.toLowerCase().trim() || '');
        return !excludedTexts.some(excluded => text.includes(excluded)) &&
          !button.disabled &&
          button.offsetParent !== null ? [button] : [];
      });
      const actionPreferredButton = validButtons.find(button => {
        const text = (button.textContent.toLowerCase().trim() || button.getAttribute('aria-label')?.toLowerCase().trim() || '');
        return preferredTexts.some(preferred => text.includes(preferred));
      });
      if (actionPreferredButton) {
        console.log(`Selected action bar button: ${actionPreferredButton.textContent.trim() || actionPreferredButton.getAttribute('aria-label')}`);
        return actionPreferredButton;
      } else if (validButtons.length > 0) {
        console.log(`Falling back to last valid button: ${validButtons[validButtons.length - 1].textContent.trim() || validButtons[validButtons.length - 1].getAttribute('aria-label')}`);
        return validButtons[validButtons.length - 1];
      }
    }
    console.log(`Found ${progressionButtons.length} eligible buttons in modal.`);
    return progressionButtons.length > 0 ? progressionButtons[progressionButtons.length - 1] : null;
  }

  function checkAndCloseConfirmationPopup(jobIndex, successCallback, failureCallback, attempts = 0) {
    const maxAttempts = 5;
    const delay = attempts === 0 ? 5000 : 3000;
    setTimeout(() => {
      try {
        const confirmationPopup = document.querySelector('[aria-labelledby="jobs-apply-confirmation-title"]') ||
          document.querySelector('.artdeco-modal[role="dialog"]');
        if (!confirmationPopup) {
          console.log(`Confirmation popup closed for job ${jobIndex + 1}.`);
          successfulApplications++;
          incrementApplicationCount();
          updateMessageBanner(`Applied to job ${jobIndex + 1}! Stats: ${successfulApplications} applied, ${failedApplications} Non relevant jobs.`, "#28a745");
          successCallback();
          lastActivityTime = Date.now();
          return;
        }
        if (attempts >= maxAttempts) {
          console.log(`Failed to close confirmation popup after ${maxAttempts} attempts for job ${jobIndex + 1}.`);
          failedApplications++;
          updateMessageBanner(`Failed job ${jobIndex + 1}: Popup not closed.`, "#e60023");
          failureCallback(jobIndex);
          return;
        }
        console.log(`Attempt ${attempts + 1} to close confirmation popup for job ${jobIndex + 1}.`);
        const buttons = confirmationPopup.querySelectorAll('button');
        const doneOrCloseButton = Array.from(buttons).find(button => {
          const text = (button.textContent.toLowerCase().trim() || button.getAttribute('aria-label')?.toLowerCase().trim() || '');
          return text.includes('done') || text.includes('close');
        });
        if (doneOrCloseButton) {
          doneOrCloseButton.click();
          lastActivityTime = Date.now();
          console.log(`Clicked ${doneOrCloseButton.textContent.trim() || doneOrCloseButton.getAttribute('aria-label')}`);
        }
        checkAndCloseConfirmationPopup(jobIndex, successCallback, failureCallback, attempts + 1);
      } catch (error) {
        console.error(`Error handling confirmation popup for job ${jobIndex + 1}: ${error.message}`);
        if (attempts >= maxAttempts) {
          failedApplications++;
          updateMessageBanner(`Failed job ${jobIndex + 1}: Popup error.`, "#e60023");
          failureCallback(jobIndex);
        } else {
          checkAndCloseConfirmationPopup(jobIndex, successCallback, failureCallback, attempts + 1);
        }
      }
    }, delay);
  }

  function handleSafetyReminderPopup() {
    const modals = document.querySelectorAll('.artdeco-modal');
    for (const modal of modals) {
      const header = modal.querySelector('.artdeco-modal__header h2');
      if (header && header.textContent.trim().toLowerCase().includes('job search safety reminder')) {
        console.log("Safety reminder popup detected.");
        const primaryButton = modal.querySelector('.artdeco-modal__actionbar button.artdeco-button--primary');
        if (primaryButton && primaryButton.textContent.toLowerCase().includes('continue applying')) {
          primaryButton.click();
          lastActivityTime = Date.now();
          console.log("Clicked 'Continue applying' button.");
          updateMessageBanner("Closed safety reminder popup.", "#0073b1");
          setTimeout(() => {
            if (!document.body.contains(modal)) {
              console.log("Popup closed successfully.");
            } else {
              console.log("Popup did not close.");
              updateMessageBanner("Failed to close safety popup.", "#e60023");
            }
          }, 3125);
          return;
        }
      }
    }
    console.log("No safety reminder popup found.");
  }

  async function fetchAndClickNextPageButton() {
    try {
      const nextButton = document.querySelector('.jobs-search-pagination__button--next');
      if (nextButton && !nextButton.disabled) {
        console.log("Found 'Next' button. Clicking...");
        updateMessageBanner("Moving to next page...", "#0073b1");
        nextButton.click();
        lastActivityTime = Date.now();
        return true;
      } else {
        console.log("No 'Next' button found or it is disabled.");
        updateMessageBanner("No next page available.", "#0073b1");
        return false;
      }
    } catch (error) {
      console.error(`Error clicking next page button: ${error.message}`);
      updateMessageBanner("Error navigating to next page.", "#e60023");
      return false;
    }
  }

  async function goToNextPage() {
    let retryAttempts = 0;
    const maxRetryAttempts = 3;
    while (retryAttempts < maxRetryAttempts) {
      try {
        console.log(`Attempt ${retryAttempts + 1} to navigate to next page...`);
        const clicked = await fetchAndClickNextPageButton();
        if (clicked) {
          await waitForElement('.job-card-container--clickable', 30000);
          console.log("Job cards loaded on the new page.");
          scrollAttemptsOnPage = 0;
          lastActivityTime = Date.now();
          return true;
        } else {
          retryAttempts++;
          await new Promise(resolve => setTimeout(resolve, 5000));
        }
      } catch (error) {
        console.error(`Error navigating to next page retryAttempts + 1}): ${error.message}`);
        retryAttempts++;
        continue;
      }
    }
    console.log(`Failed to navigate to next page after ${retryAttempts} maxRetryAttempts attempts. Assuming last page reached.`);
    updateMessageBanner("Last page reached.", "#0073b1");
    return false;
  }

  function navigateToFirstPage() {
    const url = new URL(window.location.href);
    url.searchParams.delete('start');
    console.log("Navigating to first page...");
    updateMessageBanner("Returning to first page...", "#0073b1");
    window.location.href = url.toString();
  }

  async function closeAnyOpenModals() {
    return new Promise((resolve) => {
      let attempts = 0;
      const maxAttempts = 5;
      const interval = setInterval(() => {
        if (attempts >= maxAttempts) {
          clearInterval(interval);
          console.log("Max attempts reached. Unable to close all modals.");
          updateMessageBanner("Unable to close modals.", "#e60023");
          setTimeout(resolve, attempts);
        }
        const modals = document.querySelectorAll('.artdeco-modal');
        if (modals.length === 0) {
          clearInterval(interval);
          console.log("All modals closed.");
          updateMessageBanner("All modals closed.", "#0073b1");
          setTimeout(resolve, 2000);
          return;
        }
        modals.forEach(modal => {
          const secondaryButton = modal.querySelector('button.artdeco-button--secondary');
          if (secondaryButton) {
            secondaryButton.click();
            console.log("Clicked secondary button in modal.");
            updateMessageBanner("Closing modal...", "#0073b1");
          } else {
            const closeButton = modal.querySelector('button[aria-label="Dismiss"]') || modal.querySelector('.modal__dismiss');
            if (closeButton) {
              closeButton.click();
              console.log("Clicked close button in modal.");
              updateMessageBanner("Closing modal...", "#0073b1");
            }
          }
        });
        attempts++;
      }, 2000);
    });
  }

  async function applyJobsSequentially(index, userInfo) {
    if (window.stopAutomation) {
      console.log(`Automation stopped. Final stats: Successfully applied: ${successfulApplications}, Non Relevant jobs: ${failedApplications}`);
      updateMessageBanner(`Automation stopped. Stats: ${successfulApplications} applied, ${failedApplications} Non Relevant jobs.`, "#e60023");
      if (safetyCheckInterval) clearInterval(safetyCheckInterval);
      setTimeout(hideMessageBanner, 5000);
      return;
    }
    let jobCards = document.querySelectorAll('.job-card-container--clickable');
    if (jobCards.length === 0) {
      console.log("No job cards found on this page.");
      updateMessageBanner("No jobs found on this page.", "#0073b1");
      const wentToNextPage = await goToNextPage();
      if (wentToNextPage) {
        await applyJobsSequentially(0, userInfo);
      } else {
        console.log("No more pages available. Going back to first page...");
        navigateToFirstPage();
      }
      return;
    }
    if (index >= jobCards.length) {
      console.log(`All ${jobCards.length} job cards on this page processed.`);
      updateMessageBanner(`Processed all ${jobCards.length} jobs on page.`, "#0073b1");
      if (scrollAttemptsOnPage < maxScrollsPerPage) {
        const moreJobsLoaded = await scrollToLoadMoreJobs();
        jobCards = document.querySelectorAll('.job-card-container--clickable');
        if (moreJobsLoaded && jobCards.length > index) {
          console.log(`More jobs loaded. Continuing with job card ${index + 1}.`);
          updateMessageBanner(`More jobs loaded. Applying job ${index + 1}...`, "#0073b1");
          await applyJobsSequentially(index, userInfo);
        } else {
          const wentToNextPage = await goToNextPage();
          if (wentToNextPage) {
            console.log("Moved to next page. Starting application process...");
            updateMessageBanner("Moved to next page.", "#0073b1");
            await applyJobsSequentially(0, userInfo);
          } else {
            console.log("No more pages available. Going back to first page...");
            navigateToFirstPage();
          }
        }
      } else {
        const wentToNextPage = await goToNextPage();
        if (wentToNextPage) {
          console.log("Moved to next page. Starting application process...");
          updateMessageBanner("Moved to next page.", "#0073b1");
          await applyJobsSequentially(0, userInfo);
        } else {
          console.log("No more pages available. Going back to first page...");
          navigateToFirstPage();
        }
      }
      return;
    }
    await closeAnyOpenModals();
    const modals = document.querySelectorAll('.artdeco-modal');
    if (modals.length > 0) {
      console.log(`Modals still present after 5 attempts. Refreshing Page ${index + 1}.`);
      updateMessageBanner(`Unable to close modals. Refreshing page...`, "#e60023");
      location.reload();
      return;
    }
    const now = new Date();
    const timeSinceLastClick = now - lastEasyApplyClickTime;
    if (timeSinceLastClick < 15000) {
      const waitTime = 15000 - timeSinceLastClick;
      console.log(`Waiting ${waitTime / 1000} seconds before processing job card ${index + 1}.`);
      updateMessageBanner(`Waiting ${Math.ceil(waitTime / 1000)}s for job ${index + 1}...`, "#0073b1");
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
    console.log(`Processing job card ${index + 1}`);
    updateMessageBanner(`Processing job ${index + 1}...`, "#0073b1");
    isProcessing = true;
    lastActivityTime = Date.now();
    try {
      const jobCard = jobCards[index];
      const companyNameElement = jobCard.querySelector('.artdeco-entity-lockup__subtitle span');
      const companyName = companyNameElement ? companyNameElement.textContent.trim() : '';
      const avoidCompanies = userInfo.avoidCompanies || [];
      const avoidCompaniesLower = avoidCompanies.map(company => company.toLowerCase());
      if (avoidCompaniesLower.includes(companyName.toLowerCase())) {
        console.log(`Job ${index + 1} is from a company to avoid: ${companyName}. Skipping.`);
        failedApplications++;
        updateMessageBanner(`Job ${index + 1} skipped: Company to avoid.`, "#e60023");
        isProcessing = false;
        lastActivityTime = Date.now();
        await applyJobsSequentially(index + 1, userInfo);
        return;
      }
      jobCard.click();
      await new Promise(resolve => setTimeout(resolve, 7400));
      try {
        const jobDescriptionElement = await waitForElement('#job-details .mt4', 7400);
        const descriptionText = jobDescriptionElement.textContent.toLowerCase();
        const desiredSkills = userInfo.skills || [];
        const nonRelevantSkills = userInfo.nonRelevantSkills || [];
        const hasDesiredSkill = desiredSkills.length === 0 || desiredSkills.some(skill => descriptionText.includes(skill.toLowerCase()));
        const hasNonRelevantSkill = nonRelevantSkills.some(skill => descriptionText.includes(skill.toLowerCase()));
        if (!hasDesiredSkill || hasNonRelevantSkill) {
          console.log(`Job ${index + 1} does not match skills criteria. Skipping.`);
          failedApplications++;
          updateMessageBanner(`Job ${index + 1} skipped: Does not match skills criteria.`, "#e60023");
          isProcessing = false;
          lastActivityTime = Date.now();
          await applyJobsSequentially(index + 1, userInfo);
          return;
        }
        console.log(`Job ${index + 1} matches skills criteria. Proceeding to apply.`);
        updateMessageBanner(`Job ${index + 1} matches skills. Applying...`, "#0073b1");
        const easyApplyButton = document.querySelector('.jobs-apply-button');
        if (easyApplyButton && easyApplyButton.textContent.includes('Easy Apply')) {
          easyApplyButton.click();
          lastEasyApplyClickTime = Date.now();
          console.log(`Clicked Easy Apply on job card ${index + 1} at ${new Date(lastEasyApplyClickTime).toISOString()}`);
          processApplication(
            () => {
              console.log(`Successfully applied to job card ${index + 1}.`);
              isProcessing = false;
              lastActivityTime = Date.now();
              applyJobsSequentially(index + 1, userInfo);
            },
            (jobIndex) => {
              console.log(`Failed to apply to job card ${jobIndex + 1}. Moving to next job.`);
              isProcessing = false;
              lastActivityTime = Date.now();
              applyJobsSequentially(jobIndex + 1, userInfo);
            },
            index
          );
        } else {
          console.log(`Easy Apply button not found on job card ${index + 1}. Skipping.`);
          failedApplications++;
          updateMessageBanner(`Job ${index + 1} skipped: No Easy Apply button.`, "#e60023");
          isProcessing = false;
          lastActivityTime = Date.now();
          await applyJobsSequentially(index + 1, userInfo);
        }
      } catch (error) {
        console.error(`Error processing job card ${index + 1}: ${error.message}. Skipping.`);
        failedApplications++;
        updateMessageBanner(`Error processing job ${index + 1}.`, "#e60023");
        isProcessing = false;
        lastActivityTime = Date.now();
        await applyJobsSequentially(index + 1, userInfo);
      }
    } catch (error) {
      console.error(`Error clicking job card ${index + 1}: ${error.message}. Skipping.`);
      failedApplications++;
      updateMessageBanner(`Error clicking job ${index + 1}.`, "#e60023");
      isProcessing = false;
      lastActivityTime = Date.now();
      setTimeout(() => applyJobsSequentially(index + 1, userInfo), 5000);
    }
  }

  addButtons();
  createWebsiteBanner();
  chrome.storage.local.get('automationActive', function (result) {
    if (result.automationActive) {
      const startBtn = document.getElementById('startAutomationBtn');
      const stopBtn = document.getElementById('stopAutomationBtn');
      if (startBtn) startBtn.style.display = 'none';
      if (stopBtn) stopBtn.style.display = 'block';
      updateMessageBanner("Your AI bot is starting in 5 seconds...", "#0073b1");
      automationTimeoutId = setTimeout(startAutomation, 5000);
    }
  });
})();
