function generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }
  
  async function getIPAddress() {
    try {
      const response = await fetch('https://api.ipify.org?format=json');
      const data = await response.json();
      return data.ip;
    } catch (error) {
      console.error('Error fetching IP address:', error);
      return null;
    }
  }
  
  // Handle extension installation
  chrome.runtime.onInstalled.addListener(async (details) => {
    if (details.reason === 'install') {
      // Open access.html to prompt for email
      chrome.windows.create({ url: 'access.html', type: 'popup' });
    }
  });
  
  // Listen for messages from access.js to check IP status
  chrome.runtime.onMessage.addListener(async (message, sender, sendResponse) => {
    if (message.action === 'checkIpStatus') {
      const { email } = message;
      try {
        const response = await fetch('https://infinite-apply-backend.onrender.com/check-ip', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email }),
        });
        const data = await response.json();
        if (!response.ok) {
          sendResponse({ error: data.error });
          return;
        }
        if (!data.hasIpAddress) {
          // No IP linked, register device
          const ipAddress = await getIPAddress();
          if (!ipAddress) {
            sendResponse({ error: 'Failed to fetch IP address' });
            return;
          }
          const uuid = generateUUID();
          const saveResponse = await fetch('https://infinite-apply-backend.onrender.com/save-ip', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, ipAddress, uuid }),
          });
          const saveData = await saveResponse.json();
          if (!saveResponse.ok) {
            sendResponse({ error: saveData.error });
            return;
          }
          // Store UUID in local storage
          chrome.storage.local.set(
            { accessInfo: { email, uuid } },
            () => sendResponse({ success: true, message: 'Device registered successfully' })
          );
        } else {
          sendResponse({ error: 'Already running AI bot on another device' });
        }
      } catch (error) {
        console.error('Error during installation:', error);
        sendResponse({ error: 'Internal error during registration' });
      }
      return true; // Keep message channel open for async response
    }
  });