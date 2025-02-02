/*
 * background.ts
 * This is the background script for the Anti-Phishing Chrome Extension.
 * It runs continuously in the background and handles URL monitoring,
 * suspicious site detection, and communication with the popup interface.
 */

/// <reference types="chrome"/>
declare global {
  interface Window {
    initWarningPage: (params: { url: string; riskScore: number; threats: string[] }) => void;
  }
}

import * as tf from '@tensorflow/tfjs';
import { config, APP_CONFIG } from '@/config/config';
import {
  loadModel,
  extractFeatures,
  predict,
  getSignificantFeatures,
  featureDescriptions,
} from '@/model';

const setIconColor = (color: string) => {
  chrome.action.setIcon({
    path: {
      '16': `${color}/${color}_icon_16.png`,
      '48': `${color}/${color}_icon_48.png`,
      '128': `${color}/${color}_icon_128.png`,
    },
  });
};

const getIconColorFromRiskScore = (riskScore: number | undefined): string => {
  if (riskScore === undefined) return 'blue';
  if (riskScore >= 0 && riskScore <= 25) return 'green';
  if (riskScore > 25 && riskScore <= 50) return 'yellow';
  if (riskScore > 50 && riskScore <= 75) return 'orange';
  if (riskScore > 75) return 'red';
  return 'blue';
};

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

async function checkUrlWithSafeBrowsing(url: string): Promise<boolean> {
  const apiKey = process.env.GOOGLE_SAFE_BROWSING_API_KEY;
  
  if (!apiKey) {
    console.error('Google Safe Browsing API key is not configured');
    return false;
  }

  const apiUrl = `https://safebrowsing.googleapis.com/v4/threatMatches:find?key=${apiKey}`;

  const requestBody = {
    client: {
      clientId: APP_CONFIG.CLIENT_ID,
      clientVersion: APP_CONFIG.API_VERSION,
    },
    threatInfo: {
      threatTypes: [
        'MALWARE',
        'SOCIAL_ENGINEERING',
        'UNWANTED_SOFTWARE',
        'POTENTIALLY_HARMFUL_APPLICATION',
      ],
      platformTypes: ['ANY_PLATFORM'],
      threatEntryTypes: ['URL'],
      threatEntries: [{ url }],
    },
  };

  try {
    const response = await fetch(apiUrl, {
      method: 'POST',
      body: JSON.stringify(requestBody),
      headers: { 'Content-Type': 'application/json' },
    });
    const data = await response.json();
    return data.matches && data.matches.length > 0;
  } catch (error) {
    console.error('Error checking URL with Safe Browsing API:', error);
    return false;
  }
}

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

interface WarnedUrls {
  [url: string]: boolean;
}

interface PendingDecision {
  resolve: (allow: boolean) => void;
  tabId: number;
}

const pendingDecisions: Map<string, PendingDecision> = new Map();

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

async function wasWarningShown(url: string): Promise<boolean> {
  const result = await chrome.storage.local.get('warnedUrls');
  const warnedUrls = (result.warnedUrls as WarnedUrls) || {};
  return !!warnedUrls[url];
}

async function markUrlAsWarned(url: string): Promise<void> {
  const result = await chrome.storage.local.get('warnedUrls');
  const warnedUrls = (result.warnedUrls as WarnedUrls) || {};
  warnedUrls[url] = true;
  await chrome.storage.local.set({ warnedUrls });
}

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

    const isUnsafe = await checkUrlWithSafeBrowsing(url);

    let riskScore = Math.round(mlScore * 100);
    const threats: string[] = [];
    const detectionSources: string[] = [];

    // Lower the ML threshold to be more sensitive
    if (mlScore > 0.3) {
      threats.push(`ML Model detected suspicious patterns (${Math.round(mlScore * 100)}% confidence)`);
      detectionSources.push('Machine Learning Model');
    }
    if (isUnsafe) {
      riskScore += 60;
      threats.push('Flagged by Google Safe Browsing');
      detectionSources.push('Google Safe Browsing');
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

    // Lower threshold to 70 to show warnings more aggressively
    if (riskScore > 95 && tabId !== undefined && tabId > 0) {
      // Reset warned state on each check to ensure warnings show up
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

chrome.webNavigation.onBeforeNavigate.addListener(async details => {
  if (details.frameId !== 0) return;
  if (isForbiddenUrl(details.url)) return;
  
  // If this URL is already being checked, skip
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

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url) {
    if (isForbiddenUrl(tab.url)) {
      setIconColor('blue');
      return;
    }

    const { autoScan } = await chrome.storage.sync.get('autoScan');
    if (!autoScan) return;

    // If this URL is already being checked, skip
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

// chrome.runtime.onMessage.addListener(async (request, sender, sendResponse) => {
//   if (request.action === 'scan') {
//     setTimeout(() => {
//       const riskScore = Math.floor(Math.random() * 100);
//       sendResponse({ riskScore });
//     }, 2000);
//     return true;
//   }
// });
