/*
 * background.ts
 * This is the background script for the Anti-Phishing Chrome Extension.
 * It runs continuously in the background and handles URL monitoring,
 * suspicious site detection, and communication with the popup interface.
 */

import * as tf from '@tensorflow/tfjs';
import {config, APP_CONFIG} from '@/config/config';
import { loadModel, extractFeatures, predict } from '@/model';

// Event listener that runs when the extension is first installed
chrome.runtime.onInstalled.addListener(async () => {
    console.log('Anti-Phishing Extension installed')
    
    // Wait for TensorFlow.js to be ready
    await tf.ready();
    console.log('TensorFlow.js initialized');
    
    // Load the ML model
    try {
      await loadModel();
    } catch (error) {
      console.error('Error loading model:', error);
    }
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
  mlPredictionScore?: number;  // ML model's prediction score
  detectionSources: string[]; // Sources that contributed to detection
}

interface CheckResult {
  type: 'URL_CHECK_RESULT';
  data: CheckResultData;
}

// Store the latest check result
let latestCheckResult: CheckResult | null = null;

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

// Function to get page information (title and hyperlinks)
async function getPageInfo(tabId: number): Promise<{title: string, hyperlinks: string[]}> {
  try {
    const [results] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        // Get all hyperlinks from the page
        const links = Array.from(document.getElementsByTagName('a'))
          .map(a => a.href)
          .filter(href => href && href.startsWith('http')); // Only keep valid http(s) URLs

        return {
          title: document.title,
          hyperlinks: links
        };
      }
    });

    return results.result;
  } catch (error) {
    console.error('Error getting page info:', error);
    return {
      title: '',
      hyperlinks: []
    };
  }
}

// Function to check URL and update UI
async function checkUrl(url: string, tabId?: number) {
  try {
    // Skip chrome:// URLs
    if (url.startsWith('chrome://')) {
      console.log('Skipping chrome:// URL:', url);
      return;
    }

    // Parse the URL for analysis
    const parsedUrl = new URL(url);

    // Get page info if we have a valid tab ID
    let pageInfo: { title: string, hyperlinks: string[] } = { title: '', hyperlinks: [] as string[] };
    if (tabId && tabId > 0) {
      pageInfo = await getPageInfo(tabId);
    }

    // Extract features for ML model
    const features = extractFeatures({
      url: url,
      hostname: parsedUrl.hostname,
      path: parsedUrl.pathname,
      title: pageInfo.title,
      hyperlinks: pageInfo.hyperlinks
    });

    // Get ML model prediction
    const mlPredictionScore = await predict(features);
    
    // Check URL with Google Safe Browsing API
    const isUnsafe = await checkUrlWithSafeBrowsing(url);
    
    // Calculate risk score and prepare threat info
    let riskScore = 0;
    const threats = [];
    const detectionSources = [];
    
    // // Add ML model contribution
    // if (mlPredictionScore > 0.5) {
    //   const mlContribution = Math.round((mlPredictionScore - 0.5) * 100);
    //   riskScore += mlContribution;
    //   threats.push(`ML Model detected suspicious patterns (${Math.round(mlPredictionScore * 100)}% confidence)`);
    //   detectionSources.push('Machine Learning Model');
    // }

    riskScore += Math.round(mlPredictionScore * 100);
    threats.push(`ML Model detected suspicious patterns (${Math.round(mlPredictionScore * 100)}% confidence)`);
    detectionSources.push('Machine Learning Model');
    
    // Add Safe Browsing contribution
    if (isUnsafe) {
      riskScore += 60;
      threats.push('Flagged by Google Safe Browsing');
      detectionSources.push('Google Safe Browsing');
    }

    // Normalize risk score to be between 0 and 100
    riskScore = Math.min(100, riskScore);

    // Create the check result
    const checkResult: CheckResult = {
      type: 'URL_CHECK_RESULT',
      data: {
        url: url,
        riskScore,
        threats,
        lastScanned: new Date().toISOString(),
        isSecure: riskScore < 40,
        mlPredictionScore,
        detectionSources
      }
    };

    // Update badge only if we have a valid tab ID
    if (tabId && tabId > 0) {
      try {
        if (riskScore > 90) {
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
    if (riskScore > 75) {
      chrome.notifications.create({
        type: 'basic',
        iconUrl: 'icon128.png',
        title: 'Warning: Potentially Unsafe Website',
        message: 'This website has been flagged as potentially dangerous by our extension.'
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
        isSecure: false,
        detectionSources: []
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
            isSecure: false,
            detectionSources: []
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