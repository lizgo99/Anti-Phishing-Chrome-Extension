chrome.runtime.onInstalled.addListener(() => {
    console.log('Anti-Phishing Extension installed')
    
    // Pin the extension to the toolbar by default
    chrome.action.setIcon({
      path: {
        "16": "icon16.png",
        "48": "icon48.png",
        "128": "icon128.png"
      }
    });
  
    // Ensure extension is always visible
    chrome.action.enable();
  })
  
  chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status === 'complete' && tab.url) {
      // Perform a basic check on the URL
      const url = new URL(tab.url)
      const suspiciousPatterns = [
        /^[0-9]+\./,  // IP address
        /\.(tk|ml|ga|cf|gq)$/,  // Free domains often used in phishing
        /^https?:\/\/[^/]+\.[^/]+\/[^/]+\.[^/]+$/  // URL with subdomain and path
      ]
  
      let isSuspicious = suspiciousPatterns.some(pattern => pattern.test(url.hostname))
  
      if (isSuspicious) {
        chrome.action.setBadgeText({ text: '!' })
        chrome.action.setBadgeBackgroundColor({ color: '#FF0000' })
      } else {
        chrome.action.setBadgeText({ text: '' })
      }
  
      // Send message to popup
      chrome.runtime.sendMessage({ 
        action: 'updateUrl', 
        url: tab.url,
        isSuspicious: isSuspicious
      })
    }
  })
  
  // Listen for messages from popup
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'scan') {
      // Perform more detailed scan
      console.log('Performing detailed scan on:', request.url)
      
      // Simulate a scan with a random result
      setTimeout(() => {
        const riskScore = Math.floor(Math.random() * 100)
        sendResponse({ riskScore: riskScore })
      }, 2000)
  
      // Return true to indicate that the response will be sent asynchronously
      return true
    }
  })