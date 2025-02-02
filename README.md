# Anti-Phishing Chrome Extension

AntiPhish is a security-focused Chrome extension that uses machine learning to protect users from phishing attacks. The tool analyzes URLs in real-time, alerts users about suspicious sites, and provides educational content to raise awareness about phishing threats.

## Key Features

- **Machine Learning-Powered Detection**: Utilizes a trained model (based on the Web page Phishing Detection Dataset from Kaggle)
- **Real-time URL Analysis**: Automatically checks website security levels and adjusts the extension icon color accordingly
- **Visual Security Indicator**: Clear visual feedback about the security level of visited websites
- **Manual Site Scanning**: Ability to manually scan any URL for potential threats
- **Configurable Protection**: Option to toggle between automatic and manual scanning modes
- **Security Warnings**: Displays warning pages for high-risk websites before allowing access
- **Educational Content**: Daily phishing awareness tips to help users stay informed
- **Phishing Report System**: Integration with official reporting platforms for suspicious websites
- **User-friendly Interface**: Clean and intuitive design with theme customization options
- **Persistent Settings**: Chrome API integration for maintaining user preferences

## How It Works

1. When you visit a website, AntiPhish automatically analyzes the URL's security level
2. The extension icon changes color based on the risk level detected
3. For high-risk sites, a warning page appears before allowing access
4. Users can choose to proceed to the site or return to safety
5. Manual URL scanning is available for checking specific websites
6. Daily tips and educational content help improve phishing awareness

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

## Security Note

While AntiPhish provides an additional layer of security, it should be used in conjunction with other security practices and common sense when browsing the internet. Always be cautious with sensitive information online.
