/*
 * background.ts
 * This is the background script for the Anti-Phishing Chrome Extension.
 * It runs continuously in the background and handles URL monitoring,
 * suspicious site detection, and communication with the popup interface.
 */

import * as tf from '@tensorflow/tfjs';
import {config, APP_CONFIG} from '@/config/config';
import { loadModel, extractFeatures, predict, getSignificantFeatures, featureDescriptions } from '@/model';

const setIconColor = (color: string) => {
  chrome.action.setIcon({
    path: {
      "16": `${color}/${color}_icon_16.png`,
      "48": `${color}/${color}_icon_48.png`,
      "128": `${color}/${color}_icon_128.png`
    }
  });
};

// Function to set icon color based on risk score
const getIconColorFromRiskScore = (riskScore: number | undefined): string => {
  if (riskScore === undefined) return 'blue';
  if (riskScore >= 0 && riskScore <= 25) return 'green';
  if (riskScore > 25 && riskScore <= 50) return 'yellow';
  if (riskScore > 50 && riskScore <= 75) return 'orange';
  if (riskScore > 75) return 'red';
  return 'blue';
};

// Event listener that runs when the extension is first installed
chrome.runtime.onInstalled.addListener(async () => {
    console.log('Anti-Phishing Extension installed');
    
    // Set default settings
    await chrome.storage.sync.set({ 
      autoScan: true,
      latestScanResult: null
    });
    
    // Wait for TensorFlow.js to be ready
    await tf.ready();
    console.log('TensorFlow.js initialized');
    
    // Load the ML model
    try {
      await loadModel();
    } catch (error) {
      console.error('Error loading model:', error);
    }
    
    setIconColor('blue');

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
  mlPredictionScore?: number;
  detectionSources: string[];
  significantFeatures?: { [key: string]: number };
  featureDescriptions?: { [key: string]: string };
  siteInfo?: {
    domain: string;
    ipAddress: string;
    protocol: string;
    port: string;
    isHttps: boolean;
    lastModified?: string;
    serverInfo?: string;
  };
}

interface CheckResult {
  type: 'URL_CHECK_RESULT';
  data: CheckResultData;
}

// Function to safely send messages to popup
const sendMessageToPopup = async (message: CheckResult) => {
  try {
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

// Function to get detailed site information
async function getSiteInfo(url: string): Promise<{
  domain: string;
  ipAddress: string;
  protocol: string;
  port: string;
  isHttps: boolean;
  lastModified?: string;
  serverInfo?: string;
}> {
  const urlObj = new URL(url);
  let ipAddress = '';
  let serverInfo = '';
  let lastModified = '';
  
  try {
    // Fetch the page to get headers
    const response = await fetch(url, { method: 'HEAD' });
    serverInfo = response.headers.get('server') || '';
    lastModified = response.headers.get('last-modified') || '';
    
    // Try to resolve IP using DNS
    const dnsResponse = await fetch(`https://dns.google/resolve?name=${urlObj.hostname}`);
    const dnsData = await dnsResponse.json();
    if (dnsData.Answer && dnsData.Answer.length > 0) {
      ipAddress = dnsData.Answer[0].data;
    }
  } catch (error) {
    console.error('Error fetching site info:', error);
  }

  return {
    domain: urlObj.hostname,
    ipAddress,
    protocol: urlObj.protocol,
    port: urlObj.port || (urlObj.protocol === 'https:' ? '443' : '80'),
    isHttps: urlObj.protocol === 'https:',
    lastModified,
    serverInfo
  };
}

// Function to check URL and update UI
async function checkUrl(url: string, tabId?: number): Promise<CheckResult | null> {
  try {
    // Skip chrome:// URLs
    if (url.startsWith('chrome://')) {
      setIconColor('green');
      console.log('Skipping chrome:// URL:', url);
      return null;
    }

    // Get page info if we have a valid tab ID
    let pageInfo: { title: string, hyperlinks: string[] } = { title: '', hyperlinks: [] };
    if (tabId && tabId > 0) {
      try {
        pageInfo = await getPageInfo(tabId);
      } catch (error) {
        console.warn('Could not get page info:', error);
        // Continue with empty page info
      }
    }

    // Extract features for ML model
    const urlData = {
      url: url,
      hostname: new URL(url).hostname,
      path: new URL(url).pathname,
      title: pageInfo?.title || '',  // Use optional chaining and provide default empty string
      hyperlinks: pageInfo?.hyperlinks || []  // Use optional chaining and provide default empty array
    };
    console.log('[DEBUG] URL Data for feature extraction:', urlData);
    const features = extractFeatures(urlData);
    console.log('[DEBUG] Extracted Features:', features);
    const mlScore = await predict(features);
    console.log('[DEBUG] ML Model Score:', mlScore);
    
    let significantFeatures;
    if (mlScore > 0) {
      significantFeatures = getSignificantFeatures(features);
      console.log('[DEBUG] Significant Features:', significantFeatures);
    }

    // Check URL with Google Safe Browsing API
    const isUnsafe = await checkUrlWithSafeBrowsing(url);
    console.log('[DEBUG] Safe Browsing API Result:', isUnsafe);
    
    // Calculate risk score and prepare threat info
    let riskScore = Math.round(mlScore * 100);
    const threats = [];
    const detectionSources = [];
    
    // Add ML model contribution
    if (mlScore > 0.5) {
      threats.push(`ML Model detected suspicious patterns (${Math.round(mlScore * 100)}% confidence)`);
      detectionSources.push('Machine Learning Model');
    }
    
    // Add Safe Browsing contribution
    if (isUnsafe) {
      riskScore += 60;
      threats.push('Flagged by Google Safe Browsing');
      detectionSources.push('Google Safe Browsing');
    }

    console.log('[DEBUG] Calculated Risk Score:', riskScore);
    console.log('[DEBUG] Threats:', threats);
    console.log('[DEBUG] Detection Sources:', detectionSources);

    // Normalize risk score to be between 0 and 100
    riskScore = Math.min(100, riskScore);

    // Update icon color immediately based on risk score
    setIconColor(getIconColorFromRiskScore(riskScore));

    // Create initial result without site info
    const result: CheckResult = {
      type: 'URL_CHECK_RESULT',
      data: {
        url: url,
        riskScore,
        threats,
        lastScanned: new Date().toISOString(),
        isSecure: riskScore < 40,
        mlPredictionScore: mlScore,
        detectionSources,
        significantFeatures,
        featureDescriptions: significantFeatures ? featureDescriptions : undefined
      }
    };

    // Send initial result to popup
    await sendMessageToPopup(result);

    // Fetch site information asynchronously
    getSiteInfo(url).then(async (siteInfo) => {
      // Update result with site info
      result.data.siteInfo = siteInfo;
      
      // Send updated result to popup
      await sendMessageToPopup(result);
      
      // Store the complete result
      await chrome.storage.sync.set({ latestScanResult: result });
    }).catch(error => {
      console.error('Error fetching site info:', error);
    });

    return result;

  } catch (error) {
    console.error('Error checking URL:', error);
    const errorResult: CheckResult = {
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
    return errorResult;
  }
}

// Monitor all tab updates to check for suspicious URLs
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  // Only scan when the URL has changed and page is complete
  if (changeInfo.status === 'complete' && tab.url) {
    // Check if auto-scan is enabled
    const { autoScan } = await chrome.storage.sync.get('autoScan');
    if (!autoScan) {
      console.log('Auto-scan is disabled, skipping scan');
      return;
    }

    console.log('Auto-scanning URL:', tab.url);
    const result = await checkUrl(tab.url, tabId);
    if (result) {
      await chrome.storage.sync.set({ latestScanResult: result });
      try {
        await chrome.runtime.sendMessage(result);
      } catch (error) {
        console.log('Could not send result to popup (it might be closed)');
      }
    }
  }
});

// Monitor tab activation
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  // Check if auto-scan is enabled
  const { autoScan } = await chrome.storage.sync.get('autoScan');
  if (!autoScan) {
    console.log('Auto-scan is disabled, skipping scan');
    return;
  }

  const tab = await chrome.tabs.get(activeInfo.tabId);
  if (tab.url) {
    console.log('Auto-scanning URL on tab activation:', tab.url);
    const result = await checkUrl(tab.url, activeInfo.tabId);
    if (result) {
      await chrome.storage.sync.set({ latestScanResult: result });
      try {
        await chrome.runtime.sendMessage(result);
      } catch (error) {
        console.log('Could not send result to popup (it might be closed)');
      }
    }
  }
});

// Safe Preview Window management
interface SafePreviewWindow {
  windowId: number;
  tabId: number;
  url: string;
}

let activePreviewWindows: SafePreviewWindow[] = [];

async function openSafePreview(url: string): Promise<SafePreviewWindow> {
  console.log('[DEBUG] Opening hidden safe preview for URL:', url);
  
  try {
    // Create new hidden incognito tab
    const tab = await chrome.tabs.create({
      url: url,
      active: false,  // Keep it inactive (won't be visible)
      selected: false // Won't be selected
    });

    console.log('[DEBUG] Hidden tab created:', tab);

    let targetTabId = tab?.id;
    if (!targetTabId) {
      throw new Error('Failed to create preview tab');
    }

    // Wait for the page to load completely
    await new Promise<void>((resolve) => {
      const listener = (tabId: number, info: chrome.tabs.TabChangeInfo) => {
        if (tabId === targetTabId && info.status === 'complete') {
          chrome.tabs.onUpdated.removeListener(listener);
          resolve();
        }
      };
      chrome.tabs.onUpdated.addListener(listener);
    });

    // Give a small delay for any dynamic content to load
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Clean up the tab
    try {
      await chrome.tabs.remove(targetTabId);
      console.log('[DEBUG] Successfully closed preview tab');
    } catch (closeError) {
      console.warn('[DEBUG] Error closing tab:', closeError);
    }

    // Return the preview info
    return {
      windowId: tab.windowId,
      tabId: targetTabId,
      url: url
    };
  } catch (error: unknown) {
    console.error('[DEBUG] Error in openSafePreview:', error);
    return {
      windowId: -1,
      tabId: -1,
      url: url
    };
  }
}

// Clean up preview window
async function cleanupPreviewWindow(windowId: number) {
  const index = activePreviewWindows.findIndex(pw => pw.windowId === windowId);
  if (index !== -1) {
    const previewWindow = activePreviewWindows[index];
    activePreviewWindows.splice(index, 1);
    
    try {
      await chrome.windows.remove(windowId);
    } catch (error) {
      console.error('Error cleaning up preview window:', error);
    }
  }
}

// Listen for preview window closes
chrome.windows.onRemoved.addListener((windowId) => {
  cleanupPreviewWindow(windowId);
});

// Listen for messages from the popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('[DEBUG] Received message:', message);
  
  if (message.type === 'UPDATE_AUTO_SCAN') {
    (async () => {
      chrome.storage.sync.set({ autoScan: message.autoScan });
      console.log('Updated auto-scan setting:', message.autoScan);
      
      // Set icon to blue when auto-scan is disabled
      if (!message.autoScan) {
        setIconColor('blue');
      } else {
        // Restore icon color based on latest scan result
        const { latestScanResult } = await chrome.storage.sync.get('latestScanResult');
        if (latestScanResult?.data) {
          const riskScore = latestScanResult.data.riskScore;
          setIconColor(getIconColorFromRiskScore(riskScore));
        }
      }
      sendResponse({ success: true });
    })();
    return true; // Will respond asynchronously
  }

  if (message.type === 'GET_LATEST_RESULT') {
    chrome.storage.sync.get('latestScanResult', (result) => {
      sendResponse(result.latestScanResult);
    });
    return true;
  }

  if (message.type === 'CHECK_URL' && message.url) {
    console.log('Manual scan requested for URL:', message.url);
    checkUrl(message.url, sender.tab?.id || 0)
      .then(async (result) => {
        if (result) {
          await chrome.storage.sync.set({ latestScanResult: result });
        }
        sendResponse(result);
      })
      .catch(error => {
        console.error('Error checking URL:', error);
        const errorResult: CheckResult = {
          type: 'URL_CHECK_RESULT',
          data: {
            url: message.url!,
            riskScore: 0,
            threats: ['Error checking URL: ' + error.message],
            lastScanned: new Date().toISOString(),
            isSecure: false,
            detectionSources: []
          }
        };
        chrome.storage.sync.set({ latestScanResult: errorResult });
        sendResponse(errorResult);
      });
    return true;
  }

  if (message.type === 'OPEN_SAFE_PREVIEW') {
    openSafePreview(message.data.url)
      .then(() => {
        console.log('[DEBUG] Safe preview opened successfully');
        sendResponse({ success: true });
      })
      .catch(error => {
        console.error('[DEBUG] Safe preview error:', error);
        sendResponse({ error: error.message });
      });
    return true; // Will respond asynchronously
  }
});

// Handle communication with the popup interface
chrome.runtime.onMessage.addListener(async (request, sender, sendResponse) => {
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