const { config, APP_CONFIG } = require('./test-config');

// Test script for Google Safe Browsing API
const API_KEY = config.GOOGLE_SAFE_BROWSING_API_KEY;

// Test URLs - some known malicious URLs for testing
const testUrls = [
    'http://malware.testing.google.test/testing/malware/',  // Google's malware test URL
    'https://testsafebrowsing.appspot.com/s/phishing.html', // Google's phishing test URL
    'https://google.com',  // Known safe URL
];

// Function to test the Safe Browsing API directly
async function testSafeBrowsingAPI() {
    const apiUrl = `https://safebrowsing.googleapis.com/v4/threatMatches:find?key=${API_KEY}`;

    for (const url of testUrls) {
        console.log(`Testing URL: ${url}`);
        
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
            console.log(`Results for ${url}:`);
            console.log(data);
            const isUnsafe = data.matches && data.matches.length > 0;
            console.log('URL Safety Status:', isUnsafe ? '⚠️ UNSAFE' : '✅ SAFE');
            console.log('-------------------');
        } catch (error) {
            console.error(`Error testing ${url}:`, error);
        }
    }
}

// Run the test
testSafeBrowsingAPI().then(() => console.log('Testing complete!'));
