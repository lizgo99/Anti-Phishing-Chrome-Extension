# Anti-Phishing Chrome Extension

## Setup Instructions

1. Clone this repository

2. Install dependencies:
   ```bash
   npm install
   ```

3. Build the extension:
   ```bash
   npm run build
   ```

4. Load the extension in Chrome:
   - Open Chrome and go to `chrome://extensions/`
   - Enable "Developer mode"
   - Click "Load unpacked"
   - Select the `dist` folder from this project

## Note
This project uses the Google Safe Browsing API to check for potentially malicious URLs. The API key is included in the project configuration for evaluation purposes.
