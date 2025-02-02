/*
 * background.ts
 * 
 * Core service worker for the Anti-Phishing Chrome Extension that manages URL analysis,
 * threat detection, and browser integration. Implements real-time website scanning using
 * machine learning and heuristic analysis.
 * 
 * Core Functions:
 * - URL monitoring and interception
 * - ML-based threat detection (TensorFlow.js)
 * - Safe preview functionality
 * - Warning page management
 * - Chrome API orchestration
 */

/// <reference types="chrome"/>
declare global {
  interface Window {
    initWarningPage: (params: { url: string; riskScore: number; threats: string[] }) => void;
  }
}

import * as tf from '@tensorflow/tfjs';
import {loadModel,extractFeatures,predict,getSignificantFeatures,featureDescriptions} from '@/model';

/**
 * Updates the extension icon based on risk level
 * @param color - Icon color indicating risk level (blue=default, green=safe, yellow=caution, orange=warning, red=danger)
 */
const setIconColor = (color: string) => {
  chrome.action.setIcon({
    path: {
      '16': `${color}/${color}_icon_16.png`,
      '48': `${color}/${color}_icon_48.png`,
      '128': `${color}/${color}_icon_128.png`,
    },
  });
};

/**
 * Determines icon color based on risk assessment score
 * @param riskScore - Numerical risk score (0-100)
 * @returns Color code for the extension icon
 */
const getIconColorFromRiskScore = (riskScore: number | undefined): string => {
  if (riskScore === undefined) return 'blue';
  if (riskScore >= 0 && riskScore <= 25) return 'green';
  if (riskScore > 25 && riskScore <= 50) return 'yellow';
  if (riskScore > 50 && riskScore <= 75) return 'orange';
  if (riskScore > 75) return 'red';
  return 'blue';
};

/**
 * Initializes the extension by setting up storage and TensorFlow
 */
chrome.runtime.onInstalled.addListener(async () => {
  console.log('Anti-Phishing Extension installed');
  await chrome.storage.sync.set({
    autoScan: true,
    latestScanResult: null,
  });
  await tf.ready();
  console.log('TensorFlow.js initialized');
  try {
    await loadModel();
  } catch (error) {
    console.error('Error loading model:', error);
  }
  setIconColor('blue');
  chrome.action.enable();
});

interface CheckResultData {
  /** Target URL that was analyzed */
  url: string;
  /** Aggregated risk score (0-100) */
  riskScore: number;
  /** List of identified security concerns */
  threats: string[];
  /** Timestamp of the scan */
  lastScanned: string;
  /** Security assessment result */
  isSecure: boolean;
  /** Raw ML model prediction score */
  mlPredictionScore?: number;
  /** Sources that contributed to threat detection */
  detectionSources: string[];
  /** ML model's significant feature weights */
  significantFeatures?: { [key: string]: number };
  /** Human-readable descriptions of ML features */
  featureDescriptions?: { [key: string]: string };
  /** Technical site information */
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

/**
 * Message format for scan results
 */
interface CheckResult {
  type: 'URL_CHECK_RESULT';
  data: CheckResultData;
}

/**
 * Map of URLs that have been warned about
 */
interface WarnedUrls {
  [url: string]: boolean;
}

/**
 * Pending decisions for user approval after warning
 */
interface PendingDecision {
  resolve: (allow: boolean) => void;
  tabId: number;
}

const pendingDecisions: Map<string, PendingDecision> = new Map();

/**
 * Sends a message to the popup
 * @param message - Message to send
 */
const sendMessageToPopup = async (message: CheckResult) => {
  try {
    const views = chrome.extension.getViews({ type: 'popup' });
    if (views.length > 0) {
      await chrome.runtime.sendMessage(message);
    }
  } catch {
    console.log('Popup not ready to receive messages');
  }
};

/**
 * Checks if a URL is forbidden
 * @param url - URL to check
 * @returns `true` if the URL is forbidden, `false` otherwise
 */
function isForbiddenUrl(url: string): boolean {
  try {
    const urlObj = new URL(url);
    const forbiddenProtocols = [
      'chrome:',
      'edge:',
      'file:',
      'chrome-extension:',
      'about:',
      'data:',
    ];
    return forbiddenProtocols.includes(urlObj.protocol.toLowerCase());
  } catch {
    return true;
  }
}

/**
 * Gets page title and hyperlinks
 * @param tabId - ID of the tab to get info from
 * @returns Object with title and hyperlinks
 */
async function getPageInfo(tabId: number): Promise<{ title: string; hyperlinks: string[] }> {
  try {
    const tab = await chrome.tabs.get(tabId);
    if (!tab.url || isForbiddenUrl(tab.url)) {
      return { title: '', hyperlinks: [] };
    }
    try {
      const [results] = await chrome.scripting.executeScript({
        target: { tabId },
        func: () => {
          const links = Array.from(document.getElementsByTagName('a'))
            .map(a => a.href)
            .filter(href => href && href.startsWith('http'));
          return { title: document.title || '', hyperlinks: links };
        },
      });
      return results?.result || { title: '', hyperlinks: [] };
    } catch (scriptError) {
      console.error('Script execution error:', scriptError);
      return { title: tab.title || '', hyperlinks: [] };
    }
  } catch (error) {
    console.error('Error getting page info:', error);
    return { title: '', hyperlinks: [] };
  }
}

/**
 * Gets site information (domain, IP address, protocol, port, HTTPS status, last modified, and server info)
 * @param url - URL to get site info for
 * @returns Object with site information
 */
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
    const response = await fetch(url, { method: 'HEAD' });
    serverInfo = response.headers.get('server') || '';
    lastModified = response.headers.get('last-modified') || '';
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
    serverInfo,
  };
}

/**
 * Checks if a URL has been warned about
 * @param url - URL to check
 * @returns True if the URL has been warned about, false otherwise
 */
async function wasWarningShown(url: string): Promise<boolean> {
  const result = await chrome.storage.local.get('warnedUrls');
  const warnedUrls = (result.warnedUrls as WarnedUrls) || {};
  return !!warnedUrls[url];
}

/**
 * Marks a URL as warned
 * @param url - URL to mark as warned
 */
async function markUrlAsWarned(url: string): Promise<void> {
  const result = await chrome.storage.local.get('warnedUrls');
  const warnedUrls = (result.warnedUrls as WarnedUrls) || {};
  warnedUrls[url] = true;
  await chrome.storage.local.set({ warnedUrls });
}

/**
 * Checks a URL and sends the result to the popup
 * @param url - URL to check
 * @param tabId - ID of the tab to check (optional)
 * @returns CheckResult object or null if the URL is forbidden
 */
async function checkUrl(url: string, tabId?: number): Promise<CheckResult | null> {
  try {
    // Reset icon color to default blue when starting a new check
    setIconColor('blue');

    // Skip warning if this URL was already warned about
    if (await wasWarningShown(url)) {
      return null;
    }

    if (isForbiddenUrl(url)) {
      setIconColor('blue');
      return null;
    }

    let pageInfo: { title: string; hyperlinks: string[] } = { title: '', hyperlinks: [] };
    if (tabId && tabId > 0) {
      pageInfo = await getPageInfo(tabId);
    }

    const urlData = {
      url,
      hostname: new URL(url).hostname,
      path: new URL(url).pathname,
      title: pageInfo.title,
      hyperlinks: pageInfo.hyperlinks,
    };
    const features = extractFeatures(urlData);
    const mlScore = await predict(features);

    let significantFeatures;
    if (mlScore > 0) {
      significantFeatures = getSignificantFeatures(features);
    }

    let riskScore = Math.round(mlScore * 100);
    const threats: string[] = [];
    const detectionSources: string[] = [];

    if (mlScore > 0.3) {
      threats.push(`ML Model detected suspicious patterns (${Math.round(mlScore * 100)}% confidence)`);
      detectionSources.push('Machine Learning Model');
    }
    riskScore = Math.min(100, riskScore);

    setIconColor(getIconColorFromRiskScore(riskScore));

    const result: CheckResult = {
      type: 'URL_CHECK_RESULT',
      data: {
        url,
        riskScore,
        threats,
        lastScanned: new Date().toISOString(),
        isSecure: riskScore < 40,
        mlPredictionScore: mlScore,
        detectionSources,
        significantFeatures,
        featureDescriptions: significantFeatures ? featureDescriptions : undefined,
      },
    };

    await sendMessageToPopup(result);

    getSiteInfo(url)
      .then(async siteInfo => {
        result.data.siteInfo = siteInfo;
        await sendMessageToPopup(result);
        await chrome.storage.sync.set({ latestScanResult: result });
      })
      .catch(err => console.error('Error fetching site info:', err));

    if (riskScore > 95 && tabId !== undefined && tabId > 0) {
      await chrome.storage.local.set({ warnedUrls: {} });
      const alreadyWarned = await wasWarningShown(url);
      if (!alreadyWarned) {
        await markUrlAsWarned(url);
        const decisionPromise = new Promise<boolean>(resolve => {
          pendingDecisions.set(url, { resolve, tabId });
        });
        await chrome.scripting.executeScript({
          target: { tabId },
          func: () => {
            window.stop();
            const overlay = document.createElement('div');
            overlay.id = 'anti-phish-warning';
            Object.assign(overlay.style, {
              position: 'fixed',
              inset: '0',
              zIndex: '9999999999',
              backgroundColor: 'rgba(0,0,0,0.9)',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'red',
            });
            document.body.appendChild(overlay);
            const container = document.createElement('div');
            container.id = 'warning-container';
            overlay.appendChild(container);
          },
        });
        await chrome.scripting.executeScript({
          target: { tabId },
          func: (theUrl: string, score: number, thr: string[]) => {
            const script = document.createElement('script');
            script.src = chrome.runtime.getURL('warningPage.js');
            script.onload = () => {
              const container = document.getElementById('warning-container');
              if (container && window.initWarningPage) {
                window.initWarningPage({ url: theUrl, riskScore: score, threats: thr });
              }
            };
            document.head.appendChild(script);
          },
          args: [url, riskScore, threats],
        });
      }
    }

    return result;
  } catch (error) {
    console.error('Error checking URL:', error);
    const errorResult: CheckResult = {
      type: 'URL_CHECK_RESULT',
      data: {
        url,
        riskScore: 0,
        threats: ['Error checking URL: ' + (error as Error).message],
        lastScanned: new Date().toISOString(),
        isSecure: false,
        detectionSources: [],
      },
    };
    return errorResult;
  }
}

// Track URLs that are currently being checked to avoid duplicate checks
const urlsBeingChecked = new Set<string>();

/**
 * Handles messages from the content script
 * @param message - The message from the content script
 * @param sender - The sender of the message
 * @param sendResponse - The response to send back to the sender
 * @returns Whether the message was handled
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'WARNING_DECISION') {
    const { url, allow } = message;
    const decision = pendingDecisions.get(url);
    if (decision) {
      if (!allow) {
        chrome.scripting.executeScript({
          target: { tabId: decision.tabId },
          func: () => {
            const overlay = document.getElementById('anti-phish-warning');
            if (overlay) overlay.remove();
          },
        })
        .then(() => {
          chrome.tabs.goBack(decision.tabId);
        })
        .catch(err => console.error('Error during cleanup or navigation:', err));
      } else {
        (async () => {
          await markUrlAsWarned(url);
          chrome.scripting.executeScript({
            target: { tabId: decision.tabId },
            func: () => {
              const overlay = document.getElementById('anti-phish-warning');
              if (overlay) overlay.remove();
            },
          })
          .catch(err => console.error('Error during cleanup:', err));
          decision.resolve(allow);
        })();
      }
      pendingDecisions.delete(url);
      sendResponse({ success: true });
    }
    return true;
  }
});

/**
 * Listener for URL navigation events
 * @param details - The details of the navigation event
 * @returns 
 */
chrome.webNavigation.onBeforeNavigate.addListener(async details => {
  if (details.frameId !== 0) return;
  if (isForbiddenUrl(details.url)) return;
  
  if (urlsBeingChecked.has(details.url)) return;
  urlsBeingChecked.add(details.url);

  try {
    const result = await checkUrl(details.url, details.tabId);
    if (result) {
      await chrome.storage.sync.set({ latestScanResult: result });
    }
  } finally {
    urlsBeingChecked.delete(details.url);
  }
});

/**
 * Listener for when a tab's URL changes
 * @param tabId - The ID of the tab
 * @param changeInfo - Information about the change
 * @param tab - The tab that changed
 * @returns 
 */
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url) {
    if (isForbiddenUrl(tab.url)) {
      setIconColor('blue');
      return;
    }

    const { autoScan } = await chrome.storage.sync.get('autoScan');
    if (!autoScan) return;

    if (urlsBeingChecked.has(tab.url)) return;
    urlsBeingChecked.add(tab.url);

    try {
      const result = await checkUrl(tab.url, tabId);
      if (result) {
        await chrome.storage.sync.set({ latestScanResult: result });
        try {
          await chrome.runtime.sendMessage(result);
        } catch {
          console.log('Could not send result to popup (it might be closed)');
        }
      }
    } finally {
      urlsBeingChecked.delete(tab.url);
    }
  }
});

/**
 * Listener for when a tab is activated
 * @param activeInfo - Information about the active tab
 * @returns 
 */
chrome.tabs.onActivated.addListener(async activeInfo => {
  const { autoScan } = await chrome.storage.sync.get('autoScan');
  if (!autoScan) return;
  
  const tab = await chrome.tabs.get(activeInfo.tabId);
  if (!tab.url || isForbiddenUrl(tab.url)) return;

  // If this URL is already being checked, skip
  if (urlsBeingChecked.has(tab.url)) return;
  urlsBeingChecked.add(tab.url);

  try {
    const result = await checkUrl(tab.url, activeInfo.tabId);
    if (result) {
      await chrome.storage.sync.set({ latestScanResult: result });
      try {
        await chrome.runtime.sendMessage(result);
      } catch {
        console.log('Could not send result to popup (it might be closed)');
      }
    }
  } finally {
    urlsBeingChecked.delete(tab.url);
  }
});

interface SafePreviewWindow {
  windowId: number;
  tabId: number;
  url: string;
}

let activePreviewWindows: SafePreviewWindow[] = [];

/**
 * Opens a hidden safe preview tab for the given URL
 * @param url - URL to open in the safe preview tab
 * @returns The SafePreviewWindow object representing the opened tab
 */
async function openSafePreview(url: string): Promise<SafePreviewWindow> {
  console.log('[DEBUG] Opening hidden safe preview for URL:', url);
  
  try {
    // Create new hidden incognito tab
    const tab = await chrome.tabs.create({
      url: url,
      active: false, 
      selected: false
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

/**
 * Cleans up a preview window
 * @param windowId - ID of the window to clean up
 */
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

/**
 * Listener for when a window is removed
 * @param windowId - ID of the window that was removed
 */
chrome.windows.onRemoved.addListener((windowId) => {
  cleanupPreviewWindow(windowId);
});

/**
 * Listener for incoming messages from the content script
 * @param message - The message sent from the content script
 * @param sender - The sender of the message
 * @param sendResponse - Function to send a response back to the sender
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'UPDATE_AUTO_SCAN') {
    (async () => {
      chrome.storage.sync.set({ autoScan: message.autoScan });
      if (!message.autoScan) {
        setIconColor('blue');
      } else {
        const { latestScanResult } = await chrome.storage.sync.get('latestScanResult');
        if (latestScanResult?.data) {
          setIconColor(getIconColorFromRiskScore(latestScanResult.data.riskScore));
        }
      }
      sendResponse({ success: true });
    })();
    return true;
  }

  if (message.type === 'GET_LATEST_RESULT') {
    chrome.storage.sync.get('latestScanResult', result => {
      sendResponse(result.latestScanResult);
    });
    return true;
  }

  if (message.type === 'CHECK_URL' && message.url) {
    checkUrl(message.url, sender.tab?.id || 0)
      .then(async result => {
        if (result) {
          await chrome.storage.sync.set({ latestScanResult: result });
        }
        sendResponse(result);
      })
      .catch(error => {
        const errorResult: CheckResult = {
          type: 'URL_CHECK_RESULT',
          data: {
            url: message.url!,
            riskScore: 0,
            threats: ['Error checking URL: ' + error.message],
            lastScanned: new Date().toISOString(),
            isSecure: false,
            detectionSources: [],
          },
        };
        chrome.storage.sync.set({ latestScanResult: errorResult });
        sendResponse(errorResult);
      });
    return true;
  }

  if (message.type === 'OPEN_SAFE_PREVIEW') {
    openSafePreview(message.data.url)
      .then(() => {
        sendResponse({ success: true });
      })
      .catch(error => {
        sendResponse({ error: error.message });
      });
    return true;
  }
});
