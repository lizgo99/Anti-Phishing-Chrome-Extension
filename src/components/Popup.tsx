/*
 * popup.tsx
 * This component represents the main UI of the extension popup.
 * It provides URL scanning functionality and displays risk assessment results
 * with a clean, responsive interface that supports both light and dark modes.
 */

"use client"

import React, { useState, useEffect } from "react"
import { AlertTriangle, Lock, Settings, Shield, Info, ExternalLink, Moon, Sun, Flag } from 'lucide-react'
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent } from "@/components/ui/card"
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion"
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"
import phishingFacts from '../../phishingFacts.json'

interface ScanResult {
  url: string;
  riskScore: number;
  riskLevel: string;
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
  data: ScanResult;
}

export default function Popup() {
  // State management for the component
  const [url, setUrl] = useState("")
  const [scanning, setScanning] = useState(false)
  const [riskScore, setRiskScore] = useState(0)
  const [isDarkMode, setIsDarkMode] = useState(() => {
          const storedTheme = localStorage.getItem('isDarkMode');
          return storedTheme ? JSON.parse(storedTheme) : false;
        })
  const [autoScan, setAutoScan] = useState(true); // Default to true
  const [scanResult, setScanResult] = useState<ScanResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false);
  const [showInfoBox, setShowInfoBox] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [currentFact, setCurrentFact] = useState<string>("");
  const [currentFactId, setCurrentFactId] = useState<number>(1);

  useEffect(() => {
    const initializePopup = async () => {
      try {
        // Load settings from storage
        const { isDarkMode, autoScan, latestScanResult, lastFactDate, lastFactId } = await chrome.storage.sync.get([
          'isDarkMode',
          'autoScan',
          'latestScanResult',
          'lastFactDate',
          'lastFactId'
        ]);

        console.log('[DEBUG] Loading facts:', { phishingFacts, lastFactDate, lastFactId });

        console.log('[DEBUG] Loading cached scan result:', latestScanResult);

        // Set theme
        const syncedTheme = isDarkMode ?? false;
        setIsDarkMode(syncedTheme);
        localStorage.setItem('isDarkMode', JSON.stringify(syncedTheme));

        // Set auto-scan
        const syncedAutoScan = autoScan ?? true;
        setAutoScan(syncedAutoScan);

        // Update fact if it's a new day
        const today = new Date().toDateString();
        if (lastFactDate !== today) {
          const nextFactId = lastFactId ? (lastFactId % phishingFacts.facts.length) + 1 : 1;
          console.log('[DEBUG] New day, setting fact:', { nextFactId, fact: phishingFacts.facts[nextFactId - 1]?.fact });
          setCurrentFactId(nextFactId);
          setCurrentFact(phishingFacts.facts[nextFactId - 1]?.fact || "Loading fact...");
          await chrome.storage.sync.set({ 
            lastFactDate: today,
            lastFactId: nextFactId
          });
        } else if (lastFactId) {
          console.log('[DEBUG] Same day, using existing fact:', { lastFactId, fact: phishingFacts.facts[lastFactId - 1]?.fact });
          setCurrentFactId(lastFactId);
          setCurrentFact(phishingFacts.facts[lastFactId - 1]?.fact || "Loading fact...");
        } else {
          console.log('[DEBUG] First time, using first fact');
          setCurrentFactId(1);
          setCurrentFact(phishingFacts.facts[0]?.fact || "Loading fact...");
          await chrome.storage.sync.set({ 
            lastFactDate: today,
            lastFactId: 1
          });
        }

        // Get current tab URL
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tabs[0]?.url) {
          setUrl(tabs[0].url);
          
          // Update UI with latest scan result if available and auto-scan is enabled
          if (syncedAutoScan && latestScanResult?.data) {
            updateScanResult(latestScanResult.data);
          } else {
            setRiskScore(0);
            setScanResult(null);
          }
        }
        setScanning(false);
      } catch (err) {
        setError('Failed to initialize popup');
        console.error('Popup initialization error:', err);
      }
    };

    initializePopup();

    // Set up message listener for updates from background script
    const messageListener = (message: CheckResult) => {
      if (message.type === 'URL_CHECK_RESULT' && message.data) {
        updateScanResult(message.data);
        setScanning(false);
        setError(null);
      }
    };

    chrome.runtime.onMessage.addListener(messageListener);

    // Listen for storage changes
    const handleStorageChange = (changes: { [key: string]: chrome.storage.StorageChange }) => {
      if (changes.autoScan) {
        setAutoScan(changes.autoScan.newValue);
      }
      if (changes.latestScanResult && changes.latestScanResult.newValue?.data) {
        updateScanResult(changes.latestScanResult.newValue.data);
      }
    };

    chrome.storage.onChanged.addListener(handleStorageChange);

    return () => {
      chrome.runtime.onMessage.removeListener(messageListener);
      chrome.storage.onChanged.removeListener(handleStorageChange);
    };
  }, []);

  // Helper function to update scan result state
  const updateScanResult = (data: ScanResult) => {
    const { riskScore: newRiskScore, threats, lastScanned, isSecure, mlPredictionScore, detectionSources, significantFeatures, featureDescriptions, siteInfo } = data;
    setRiskScore(newRiskScore);
    setScanResult({
      url: data.url,
      riskScore: newRiskScore,
      riskLevel: getRiskLevelText(newRiskScore),
      threats,
      lastScanned,
      isSecure,
      mlPredictionScore,
      detectionSources,
      significantFeatures,
      featureDescriptions,
      siteInfo
    });
  };

  // Handle auto-scan toggle
  const handleAutoScanToggle = async (checked: boolean) => {
    setAutoScan(checked);
    await chrome.storage.sync.set({ autoScan: checked });
    
    // Notify background script of the change
    chrome.runtime.sendMessage({ type: 'UPDATE_AUTO_SCAN', autoScan: checked });
    
    // If enabling auto-scan, trigger a fresh scan
    if (checked && url) {
      handleScan();
    }
  };

  // Initiates the URL scanning process
  const handleScan = async () => {
    setScanning(true);
    setError(null);
    
    try {
      // Get the active tab
      const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
      
      // If URL is different from current tab, use safe preview only.
      if (activeTab?.url !== url) {
        await chrome.runtime.sendMessage({
          type: 'OPEN_SAFE_PREVIEW',
          data: { url }
        });
      } else {
        // For the active tab URL, do a normal scan.
        const response = await chrome.runtime.sendMessage({
          type: 'CHECK_URL',
          data: { url, tabId: activeTab?.id }
        });
        if (response?.error) {
          setError(response.error);
        }
      }
    } catch (error) {
      console.error('Scan error:', error);
      setError('Failed to scan URL');
    } finally {
      setScanning(false);
    }
  };  

  // Handle keyboard events
  const handleKeyPress = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter' && !scanning) {
      handleScan();
    }
  };

  // Helper function to determine risk level text
  const getRiskLevelText = (score: number): string => {
    if (score >= 75) return 'High Risk';
    if (score >= 50) return 'Medium Risk';
    return 'Low Risk';
  };

  // Render the risk score circle
  const RiskScoreCircle = () => (
    <div className="relative aspect-square w-40 flex-shrink-0">
      {/* Outer shadow ring */}
      <div className={`absolute inset-0 rounded-full ${isDarkMode ? 'bg-gray-800' : 'bg-white'} shadow-lg`} />

      {/* Colored segments */}
      <div className="absolute inset-2 rounded-full overflow-hidden">
        <div className="absolute inset-0 flex">
          <div className="w-1/4 bg-green-500 opacity-80" />
          <div className="w-1/4 bg-yellow-500 opacity-80" />
          <div className="w-1/4 bg-orange-500 opacity-80" />
          <div className="w-1/4 bg-red-500 opacity-80" />
        </div>
      </div>

      {/* Inner circle */}
      <div className={`absolute inset-4 rounded-full ${isDarkMode ? 'bg-gray-800' : 'bg-white'} shadow-lg flex items-center justify-center`}>
        <div className="text-center">
          <div className={`text-4xl font-bold ${getRiskColor(riskScore)}`}>{riskScore}%</div>
          <div className={`text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>Risk Score</div>
          <div className={`text-lg font-medium ${getRiskColor(riskScore)}`}>
            {getRiskLevelText(riskScore)}
          </div>
        </div>
      </div>
    </div>
  );

  // Utility function to get appropriate color for risk level
  const getRiskColor = (score: number) => {
    if (score < 25) return "text-green-500"   // Safe - Green
    if (score < 50) return "text-yellow-500"  // Fair - Yellow
    if (score < 75) return "text-orange-500"  // Weak - Orange
    return "text-red-500"                     // Risky - Red
  }

  // Theme configuration for dark/light mode
  const getThemeColors = () => {
    return isDarkMode
      ? {
          bg: 'bg-gray-900',
          text: 'text-[#CCBDD6]',
          border: 'border-[#522C5D]',
          button: 'bg-[#522C5D] hover:bg-[#522C5D]',
          buttonText: 'text-[#CCBDD6]',
        }
      : {
          bg: 'bg-[#F5FAFF]',
          text: 'text-[#2E4156]',
          border: 'border-[#2E4156]',
          button: 'bg-[#2E4156] hover:bg-[#2E4156]',
          buttonText: 'text-[#AAB7B7]',
        }
  }

  const colors = getThemeColors()

  // Handle theme toggle
  const handleThemeToggle = () => {
    const newTheme = !isDarkMode;
    setIsDarkMode(newTheme);
    // Save theme preference to both storage and localStorage
    chrome.storage.sync.set({ isDarkMode: newTheme });
    localStorage.setItem('isDarkMode', JSON.stringify(newTheme));
  };

  const handleReportToGoogle = () => {
    window.open('https://safebrowsing.google.com/safebrowsing/report_phish/', '_blank');
  };

  return (
    // Main container with dynamic theme colors
    <div className={`w-96 p-4 transition-colors duration-300 ${colors.bg} ${colors.text} ${isDarkMode ? 'dark' : ''}`}>
      <div className="space-y-4">
        {/* URL Input and Scan Button */}
        <div className="flex items-center gap-1">
          <div className="relative flex-grow">
            {/* URL input field */}
            <Input
              type="url"
              placeholder="Enter URL: https://example.com"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={handleKeyPress}
              className={`w-full rounded-l-full rounded-r-full pr-24 ${colors.border} ${
                isDarkMode ? 'bg-gray-800 text-[#CCBDD6]' : 'bg-white text-gray-900'
              } placeholder-gray-400`}
            />
            {/* Scan button */}
            <Button
              variant="ghost"
              onClick={() => handleScan()}
              disabled={scanning}
              className={`absolute right-1 top-1/2 -translate-y-1/2 h-[calc(100%-8px)] min-w-[80px] px-3 rounded-full transition-colors duration-200 ${
                isDarkMode
                  ? 'text-[#CCBDD6] hover:text-[#CCBDD6] hover:bg-[#522C5D]/50'
                  : 'text-[#2E4156] hover:text-[#2E4156] hover:bg-[#AAB7B7]/20'
              }`}
            >
              <span className="whitespace-nowrap">{scanning ? 'Scanning...' : 'Scan'}</span>
            </Button>
          </div>
          {/* Theme and Settings buttons container */}
          <div className="flex gap-0.5">
            {/* Theme toggle button */}
            <Button
              variant="ghost"
              size="sm"
              onClick={handleThemeToggle}
              className={`rounded-full p-2 transition-colors duration-200 ${isDarkMode ? 'text-[#CCBDD6] hover:text-[#CCBDD6] hover:bg-[#522C5D]/50' : 'text-[#2E4156] hover:text-[#2E4156] hover:bg-[#AAB7B7]/20'}`}
            >
              {isDarkMode ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
            </Button>
            {/* Settings button */}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowSettings(!showSettings)}
              className={`rounded-full p-2 transition-colors duration-200 ${isDarkMode ? 'text-[#CCBDD6] hover:text-[#CCBDD6] hover:bg-[#522C5D]/50' : 'text-[#2E4156] hover:text-[#2E4156] hover:bg-[#AAB7B7]/20'}`}
            >
              <Settings className="h-5 w-5" />
            </Button>
          </div>
        </div>

        {/* Risk Score and Icons */}
        <div className="flex items-center justify-between space-x-2">
          {/* Risk Score Circle */}
          <RiskScoreCircle />
          {/* Icons and Text (now as buttons) */}
          <div className="flex flex-col space-y-2 pt-2 -ml-2">
            {/* Report button */}
            <Button
              variant="ghost"
              onClick={handleReportToGoogle}
              className={`flex items-center space-x-2 ${isDarkMode ? 'hover:bg-[#522C5D]/30' : 'hover:bg-[#AAB7B7]/20'} transition-colors duration-200 rounded-lg py-1.5 px-2 w-full justify-start`}
            >
              <Flag className={`h-6 w-6 ${isDarkMode ? 'text-[#CCBDD6]' : 'text-[#2E4156]'} flex-shrink-0`} />
              <span className={`text-sm ${colors.text} font-medium`}>Report this Site</span>
            </Button>
            {/* Site Information button */}
            <Button
              variant="ghost"
              onClick={() => setShowInfoBox(!showInfoBox)}
              className={`flex items-center space-x-2 ${isDarkMode ? 'hover:bg-[#522C5D]/30' : 'hover:bg-[#AAB7B7]/20'} transition-colors duration-200 rounded-lg py-1.5 px-2 w-full justify-start`}
            >
              <Info className={`h-6 w-6 ${isDarkMode ? 'text-[#CCBDD6]' : 'text-[#2E4156]'} flex-shrink-0`} />
              <span className={`text-sm ${colors.text} font-medium`}>Site Information</span>
            </Button>
            {/* Learn about Phishing button */}
            <Button
              variant="ghost"
              onClick={() => window.open("https://www.ncsc.gov.uk/collection/phishing-scams", "_blank")}
              className={`flex items-center space-x-2 ${isDarkMode ? 'hover:bg-[#522C5D]/30' : 'hover:bg-[#AAB7B7]/20'} transition-colors duration-200 rounded-lg py-1.5 px-2 w-full justify-start`}
            >
              <ExternalLink className={`h-6 w-6 ${isDarkMode ? 'text-[#CCBDD6]' : 'text-[#2E4156]'} flex-shrink-0`} />
              <span className={`text-sm ${colors.text} font-medium whitespace-nowrap`}>Learn about Phishing</span>
            </Button>
          </div>
        </div>

        {/* Site Information */}
        {showInfoBox && (
          <Card className={`shadow-md ${colors.border} ${isDarkMode ? 'bg-gray-800' : 'bg-white'}`}>
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-2">
                <span className={`text-sm font-medium ${colors.text}`}>Site Information</span>
                <span className={`text-sm ${isDarkMode ? 'text-[#CCBDD6]' : 'text-gray-600'}`}>
                  Risk Level: <span className={getRiskColor(riskScore)}>{getRiskLevelText(riskScore)}</span>
                </span>
              </div>
              <div className={`text-xs ${isDarkMode ? 'text-[#CCBDD6]' : 'text-gray-600'} mb-2`}>
                Last scanned: {new Date().toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' })}
              </div>
              {/* Site Information */}
              {scanResult?.siteInfo && (
                <div className={`text-xs ${isDarkMode ? 'text-[#CCBDD6]' : 'text-gray-600'} space-y-1 mb-2`}>
                <div className="flex items-center justify-between">
                  <span>Domain:</span>
                  <span className="font-medium">{scanResult.siteInfo.domain}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span>IP Address:</span>
                  <span className="font-medium">{scanResult.siteInfo.ipAddress}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Port:</span>
                  <span className="font-medium">{scanResult.siteInfo.port}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Security:</span>
                  <span className={`font-medium ${scanResult.siteInfo.isHttps ? 'text-green-500' : 'text-yellow-500'}`}>
                    {scanResult.siteInfo.isHttps ? 'HTTPS' : 'HTTP'}
                  </span>
                </div>
                {scanResult.siteInfo.serverInfo && (
                  <div className="flex items-center justify-between">
                    <span>Server:</span>
                    <span className="font-medium">{scanResult.siteInfo.serverInfo}</span>
                  </div>
                )}
              </div>
              )}
              <Accordion type="single" collapsible className="w-full">
                <AccordionItem value="info">
                  <AccordionTrigger className={`text-sm ${colors.text}`}>
                    More Details
                  </AccordionTrigger>
                  <AccordionContent>
                    <div className="space-y-4">
                      {/* ML Model Score and Features */}
                      {scanResult?.mlPredictionScore !== undefined && (
                        <div className="space-y-2">
                          <h4 className={`font-medium ${colors.text}`}>ML Analysis:</h4>
                          <p className={isDarkMode ? 'text-gray-400' : 'text-gray-600'}>
                            Prediction Score: {Math.round(scanResult.mlPredictionScore * 100)}%
                          </p>
                          
                          {/* Show significant features */}
                          {scanResult.significantFeatures && Object.keys(scanResult.significantFeatures).length > 0 && (
                            <div className="mt-2">
                              <h5 className={`text-sm font-medium ${colors.text} mb-1`}>Suspicious Features Detected:</h5>
                              <ul className="list-disc list-inside space-y-1">
                                {Object.entries(scanResult.significantFeatures).map(([feature, value]) => (
                                  <li key={feature} className={`text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                                    {scanResult.featureDescriptions?.[feature] || feature}: {typeof value === 'number' && !Number.isInteger(value) ? value.toFixed(2) : value}
                                  </li>
                                ))}
                              </ul>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </AccordionContent>
                </AccordionItem>
              </Accordion>
            </CardContent>
          </Card>
        )}

        {/* Fact Box */}
        <Card className={`shadow-md ${colors.border} ${isDarkMode ? 'bg-gray-800' : 'bg-white'}`}>
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-4">
              <span className={`text-sm font-medium ${colors.text}`}>Fact of the Day</span>
            </div>
            <p className={`text-sm ${isDarkMode ? 'text-[#CCBDD6]' : 'text-gray-600'} whitespace-pre-wrap`}>
              {currentFact || "Loading fact..."}
            </p>
          </CardContent>
        </Card>

        {/* Settings */}
        {showSettings && (
          <Card className={`shadow-md ${colors.border} ${isDarkMode ? 'bg-gray-800' : 'bg-white'}`}>
            <CardContent className="p-4">
              <h3 className={`text-lg font-semibold mb-4 ${colors.text}`}>Settings</h3>
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <Label htmlFor="auto-scan" className={`${colors.text}`}>Auto-scan new sites</Label>
                  <Switch 
                    id="auto-scan" 
                    checked={autoScan}
                    onCheckedChange={handleAutoScanToggle}
                  />
                </div>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  )
}
