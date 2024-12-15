/*
 * background.ts
 * This is the background script for the Anti-Phishing Chrome Extension.
 * It runs continuously in the background and handles URL monitoring,
 * suspicious site detection, and communication with the popup interface.
 */

import {config, APP_CONFIG} from '@/config/config';

// Event listener that runs when the extension is first installed
chrome.runtime.onInstalled.addListener(() => {
    console.log('Anti-Phishing Extension installed')
    
    // Set up the extension icon in different sizes for various contexts
    chrome.action.setIcon({
      path: {
        "16": "icon16.png",  // Icon for favicon size
        "48": "icon48.png",  // Icon for extension menu
        "128": "icon128.png" // Icon for Chrome Web Store
      }
    });
  
    // Make sure the extension icon is clickable in the toolbar
    chrome.action.enable();
})

// Function to check URL using Google Safe Browsing API
async function checkUrlWithSafeBrowsing(url: string): Promise<boolean> {
  const apiKey = config.GOOGLE_SAFE_BROWSING_API_KEY;
  const apiUrl = `https://safebrowsing.googleapis.com/v4/threatMatches:find?key=${apiKey}`;
  
  const requestBody = {
    client: {
      clientId: APP_CONFIG.CLIENT_ID,
      clientVersion: APP_CONFIG.API_VERSION
    },
    threatInfo: {
      threatTypes: ["MALWARE", "SOCIAL_ENGINEERING", "UNWANTED_SOFTWARE", "POTENTIALLY_HARMFUL_APPLICATION"],
      platformTypes: ["ANY_PLATFORM"],
      threatEntryTypes: ["URL"],
      threatEntries: [{ url: url }]
    }
  };

  try {
    const response = await fetch(apiUrl, {
      method: 'POST',
      body: JSON.stringify(requestBody),
      headers: {
        'Content-Type': 'application/json',
      }
    });

    const data = await response.json();
    // If matches are found, the URL is unsafe
    return data.matches && data.matches.length > 0;
  } catch (error) {
    console.error('Error checking URL with Safe Browsing API:', error);
    return false;
  }
}

// Define types for our messages and results
interface CheckResultData {
  url: string;
  riskScore: number;
  threats: string[];
  lastScanned: string;
  isSecure: boolean;
}

interface CheckResult {
  type: 'URL_CHECK_RESULT';
  data: CheckResultData;
}

// Function to safely send messages to popup
const sendMessageToPopup = async (message: CheckResult) => {
  try {
    // Store the latest result
    if (message.type === 'URL_CHECK_RESULT') {
      latestCheckResult = message;
    }
    // Check if there are any popup windows that can receive the message
    const views = chrome.extension.getViews({ type: 'popup' });
    if (views.length > 0) {
      await chrome.runtime.sendMessage(message);
    }
  } catch (error) {
    console.log('Popup not ready to receive messages');
  }
};

// Store the latest check result
let latestCheckResult: CheckResult | null = null;

// Function to check URL and update UI
async function checkUrl(url: string, tabId?: number) {
  try {
    // Parse the URL for analysis
    const parsedUrl = new URL(url);

    // Define patterns that are commonly associated with phishing attempts
    const suspiciousPatterns = [
      /^[0-9]+\./,  // URLs that start with IP addresses instead of domain names
      /\.(tk|ml|ga|cf|gq)$/,  // Free domain TLDs often abused by phishers
      /^https?:\/\/[^/]+\.[^/]+\/[^/]+\.[^/]+$/  // Complex URL patterns that might indicate phishing
    ];

    // Check if the URL matches any suspicious patterns
    let isSuspicious = suspiciousPatterns.some(pattern => pattern.test(parsedUrl.hostname));
    
    // Check URL with Google Safe Browsing API
    const isUnsafe = await checkUrlWithSafeBrowsing(url);
    
    // Calculate risk score and prepare threat info
    let riskScore = 0;
    const threats = [];
    
    if (isSuspicious) {
      riskScore += 40;
      threats.push('Suspicious URL pattern detected');
    }
    
    if (isUnsafe) {
      riskScore += 60;
      threats.push('Flagged by Google Safe Browsing');
    }

    // Create the check result
    const checkResult: CheckResult = {
      type: 'URL_CHECK_RESULT',
      data: {
        url: url,
        riskScore,
        threats,
        lastScanned: new Date().toISOString(),
        isSecure: !isUnsafe && !isSuspicious
      }
    };

    // Update badge only if we have a valid tab ID
    if (tabId && tabId > 0) {
      try {
        if (isSuspicious || isUnsafe) {
          await chrome.action.setBadgeText({ text: '!', tabId });
          await chrome.action.setBadgeBackgroundColor({ color: '#FF0000', tabId });
        } else {
          await chrome.action.setBadgeText({ text: '', tabId });
        }
      } catch (error) {
        console.log('Could not update badge for tab:', error);
        // Continue execution even if badge update fails
      }
    }

    // Send detailed information to popup
    await sendMessageToPopup(checkResult);
    
    // Show notification for unsafe sites
    if (isUnsafe) {
      chrome.notifications.create({
        type: 'basic',
        iconUrl: 'icon128.png',
        title: 'Warning: Potentially Unsafe Website',
        message: 'This website has been flagged as potentially dangerous by Google Safe Browsing.'
      });
    }

    return checkResult;
  } catch (error) {
    console.error('Error checking URL:', error);
    return {
      type: 'URL_CHECK_RESULT',
      data: {
        url: url,
        riskScore: 0,
        threats: ['Error checking URL: ' + (error as Error).message],
        lastScanned: new Date().toISOString(),
        isSecure: false
      }
    };
  }
}

// Monitor all tab updates to check for suspicious URLs
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url) {
    await checkUrl(tab.url, tabId);
  }
});

// Monitor tab activation
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  const tab = await chrome.tabs.get(activeInfo.tabId);
  if (tab.url) {
    // Always perform a fresh check when switching tabs
    await checkUrl(tab.url, activeInfo.tabId);
  }
});

// Listen for messages from the popup
chrome.runtime.onMessage.addListener((
  message: { type: string; url?: string },
  sender: chrome.runtime.MessageSender,
  sendResponse: (response: any) => void
) => {
  if (message.type === 'GET_LATEST_RESULT') {
    // Perform a fresh check for the current tab
    chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
      if (tabs[0]?.url) {
        const result = await checkUrl(tabs[0].url, tabs[0].id!);
        sendResponse(result);
      } else {
        sendResponse(null);
      }
    });
    return true;
  }
  
  if (message.type === 'CHECK_URL' && message.url) {
    // Use the full checkUrl function which includes both Safe Browsing and pattern checks
    checkUrl(message.url, sender.tab?.id || 0)
      .then(result => {
        sendResponse(result);
      })
      .catch(error => {
        console.error('Error checking URL:', error);
        sendResponse({
          type: 'URL_CHECK_RESULT',
          data: {
            url: message.url!,
            riskScore: 0,
            threats: ['Error checking URL: ' + error.message],
            lastScanned: new Date().toISOString(),
            isSecure: false
          }
        });
      });
    return true; // Will respond asynchronously
  }
});

// Handle communication with the popup interface
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    // Handle detailed scan requests from the popup
    if (request.action === 'scan') {
      console.log('Performing detailed scan on:', request.url)
      
      // TODO: Replace this with actual phishing detection logic
      // Currently using a random score for demonstration
      setTimeout(() => {
        const riskScore = Math.floor(Math.random() * 100)
        sendResponse({ riskScore: riskScore })
      }, 2000)
  
      // Required for async response handling in Chrome extensions
      return true
    }
})