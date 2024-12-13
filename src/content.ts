// This script runs in the context of web pages
console.log('PhishGuard content script loaded');

// Listen for messages from the background script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'analyzePage') {
    // Analyze the current page for phishing indicators
    const pageAnalysis = {
      url: window.location.href,
      title: document.title,
      hasLoginForm: document.querySelectorAll('input[type="password"]').length > 0,
      hasHttps: window.location.protocol === 'https:',
      externalLinks: Array.from(document.getElementsByTagName('a'))
        .filter(link => {
          try {
            const url = new URL(link.href);
            return url.host !== window.location.host;
          } catch {
            return false;
          }
        }).length
    };
    
    sendResponse(pageAnalysis);
  }
});

// Prevent this script from being injected multiple times
if (!(window as any).hasPhishGuard) {
  (window as any).hasPhishGuard = true;
}