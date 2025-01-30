/*
 * popup.tsx
 * This component represents the main UI of the extension popup.
 * It provides URL scanning functionality and displays risk assessment results
 * with a clean, responsive interface that supports both light and dark modes.
 */

"use client"

import React, { useState, useEffect } from "react"
import { AlertTriangle, Lock, Settings, Shield, Info, ExternalLink, Moon, Sun } from 'lucide-react'
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
// import { loadModel, predict, extractFeatures } from '@/model';


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
}

interface CheckResult {
  type: 'URL_CHECK_RESULT';
  data: CheckResultData;
}

interface ScanResult {
  riskLevel: string;
  lastScanned: string;
  threats: string[];
  isSecure: boolean;
  mlPredictionScore?: number;
  detectionSources: string[];
  significantFeatures?: { [key: string]: number };
  featureDescriptions?: { [key: string]: string };
}

export default function Popup() {
  // State management for the component
  const [url, setUrl] = useState("")
  const [scanning, setScanning] = useState(false)
  const [riskScore, setRiskScore] = useState(0)
  const [isDarkMode, setIsDarkMode] = useState(() => {
    // Try to get the stored theme preference synchronously
    const storedTheme = localStorage.getItem('isDarkMode');
    return storedTheme ? JSON.parse(storedTheme) : false;
  })
  const [scanResult, setScanResult] = useState<ScanResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false);
  const [showInfoBox, setShowInfoBox] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  useEffect(() => {
    const initializePopup = async () => {
      try {
        // Load theme preference from storage and sync with localStorage
        const result = await chrome.storage.sync.get('isDarkMode');
        const syncedTheme = result.isDarkMode ?? false;
        setIsDarkMode(syncedTheme);
        localStorage.setItem('isDarkMode', JSON.stringify(syncedTheme));

        // Get current tab URL
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tabs[0]?.url) {
          setUrl(tabs[0].url);
          
          // Request latest check result from background script
          chrome.runtime.sendMessage({ type: 'GET_LATEST_RESULT' }, (response: CheckResult | null) => {
            if (response?.data) {
              const { riskScore, threats, lastScanned, isSecure, mlPredictionScore, detectionSources, significantFeatures, featureDescriptions } = response.data;
              setRiskScore(riskScore);
              setScanResult({
                riskLevel: getRiskLevelText(riskScore),
                lastScanned,
                threats,
                isSecure,
                mlPredictionScore,
                detectionSources,
                significantFeatures,
                featureDescriptions
              });
              setScanning(false);
            }
          });
        }
      } catch (err) {
        setError('Failed to initialize popup');
        console.error('Popup initialization error:', err);
      }
    };

    initializePopup();

    // Set up message listener
    const messageListener = (message: CheckResult) => {
      if (message.type === 'URL_CHECK_RESULT' && message.data) {
        const { riskScore, threats, lastScanned, isSecure, mlPredictionScore, detectionSources, significantFeatures, featureDescriptions } = message.data;
        setRiskScore(riskScore);
        setScanResult({
          riskLevel: getRiskLevelText(riskScore),
          lastScanned,
          threats,
          isSecure,
          mlPredictionScore,
          detectionSources,
          significantFeatures,
          featureDescriptions
        });
        setScanning(false);
        setError(null);
      }
    };

    chrome.runtime.onMessage.addListener(messageListener);

    // Cleanup
    return () => {
      chrome.runtime.onMessage.removeListener(messageListener);
    };
  }, []);

  // Handle keyboard events
  const handleKeyPress = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter' && !scanning) {
      handleScan();
    }
  };

  // Initiates the URL scanning process
  const handleScan = async () => {
    setScanning(true);
    try {
      // Send message to background script to check URL
      const response = await chrome.runtime.sendMessage({
        type: 'CHECK_URL',
        url: url
      });

      console.log('Response from Popup:', response);
      console.log('URL from Popup:', url)

      if (response && response.data) {
        const { riskScore, threats, lastScanned, isSecure, mlPredictionScore, detectionSources, significantFeatures, featureDescriptions } = response.data;
        setRiskScore(riskScore);
        setScanResult({
          riskLevel: getRiskLevelText(riskScore),
          lastScanned: new Date(lastScanned).toLocaleString(),
          threats: threats,
          isSecure: isSecure,
          mlPredictionScore,
          detectionSources,
          significantFeatures,
          featureDescriptions
        });
      } else {
        // Handle case where response is invalid
        setRiskScore(0);
        setScanResult({
          riskLevel: 'Error',
          lastScanned: new Date().toLocaleString(),
          threats: ['Could not analyze URL'],
          isSecure: false,
          mlPredictionScore: undefined,
          detectionSources: [],
          significantFeatures: undefined,
          featureDescriptions: undefined
        });
      }
    } catch (error) {
      console.error('Error scanning URL:', error);
      setRiskScore(0);
      setScanResult({
        riskLevel: 'Error',
        lastScanned: new Date().toLocaleString(),
        threats: ['Error scanning URL'],
        isSecure: false,
        mlPredictionScore: undefined,
        detectionSources: [],
        significantFeatures: undefined,
        featureDescriptions: undefined
      });
    } finally {
      setScanning(false);
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
          // bg: 'bg-[#29104A]',
          bg: 'bg-gray-900',
          // text: 'text-white',
          // text: 'text-[#FFE3D8]',
          text: 'text-[#CCBDD6]',
          // border: 'border-purple-600',
          border: 'border-[#522C5D]',
          // button: 'bg-purple-600 hover:bg-purple-700',
          button: 'bg-[#522C5D] hover:bg-[#522C5D]',
          // buttonText: 'text-white',
          // buttonText: 'text-[#FFE3D8]',
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

  return (
    // Main container with dynamic theme colors
    <div className={`w-96 p-4 transition-colors duration-300 ${colors.bg} ${colors.text}`}>
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
              onKeyPress={handleKeyPress}
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
            {/* Declare as safe button */}
            <Button
              variant="ghost"
              className={`flex items-center space-x-2 ${isDarkMode ? 'hover:bg-[#522C5D]/30' : 'hover:bg-[#AAB7B7]/20'} transition-colors duration-200 rounded-lg py-1.5 px-2 w-full justify-start`}
            >
              <Shield className={`h-6 w-6 ${isDarkMode ? 'text-[#CCBDD6]' : 'text-[#2E4156]'} flex-shrink-0`} />
              <span className={`text-sm ${colors.text} font-medium`}>Declare As Safe</span>
            </Button>
            {/* Info about site button */}
            <Button
              variant="ghost"
              onClick={() => setShowInfoBox(!showInfoBox)}
              className={`flex items-center space-x-2 ${isDarkMode ? 'hover:bg-[#522C5D]/30' : 'hover:bg-[#AAB7B7]/20'} transition-colors duration-200 rounded-lg py-1.5 px-2 w-full justify-start`}
            >
              <Info className={`h-6 w-6 ${isDarkMode ? 'text-[#CCBDD6]' : 'text-[#2E4156]'} flex-shrink-0`} />
              <span className={`text-sm ${colors.text} font-medium`}>Info About Site</span>
            </Button>
            {/* Learn about phishing button */}
            <Button
              variant="ghost"
              className={`flex items-center space-x-2 ${isDarkMode ? 'hover:bg-[#522C5D]/30' : 'hover:bg-[#AAB7B7]/20'} transition-colors duration-200 rounded-lg py-1.5 px-2 w-full justify-start`}
            >
              <ExternalLink className={`h-6 w-6 ${isDarkMode ? 'text-[#CCBDD6]' : 'text-[#2E4156]'} flex-shrink-0`} />
              <span className={`text-sm ${colors.text} font-medium whitespace-nowrap`}>Learn about Phishing</span>
            </Button>
          </div>
        </div>

        {/* Info About Site */}
        {showInfoBox && (
          <Card className={`shadow-md ${colors.border} ${isDarkMode ? 'bg-gray-800' : 'bg-white'}`}>
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-2">
                <span className={`text-sm font-medium ${colors.text}`}>INFO ABOUT SITE</span>
                <span className={`text-sm ${isDarkMode ? 'text-[#CCBDD6]' : 'text-gray-600'}`}>
                  Risk Level: <span className={getRiskColor(riskScore)}>{getRiskLevelText(riskScore)}</span>
                </span>
              </div>
              <div className={`text-xs ${isDarkMode ? 'text-[#CCBDD6]' : 'text-gray-600'} mb-2`}>
                Last scanned: {new Date().toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' })}
              </div>
              <Accordion type="single" collapsible className="w-full">
                <AccordionItem value="info">
                  <AccordionTrigger className={`text-sm ${colors.text}`}>
                    More Details
                  </AccordionTrigger>
                  <AccordionContent>
                    <div className="space-y-4">
                      {/* Threats List
                      <div className="space-y-2">
                        <h4 className={`font-medium ${colors.text}`}>Detected Threats:</h4>
                        <ul className="list-disc list-inside space-y-1">
                          {scanResult?.threats && scanResult.threats.length > 0 ? (
                            scanResult.threats.map((threat, index) => (
                              <li key={index} className="text-red-500">{threat}</li>
                            ))
                          ) : (
                            <li className="text-green-500">No threats detected</li>
                          )}
                        </ul>
                      </div> */}

                      {/* ML Model Score and Features */}
                      {scanResult?.mlPredictionScore !== undefined && (
                        <div className="space-y-2">
                          <h4 className={`font-medium ${colors.text}`}>ML Analysis:</h4>
                          <p className={isDarkMode ? 'text-gray-400' : 'text-gray-600'}>
                            Prediction Score: {Math.round(scanResult.mlPredictionScore * 100)}%
                          </p>
                          
                          {/* Show significant features for medium/high risk */}
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

                      {/* Detection Sources
                      {scanResult?.detectionSources && scanResult.detectionSources.length > 0 && (
                        <div className="space-y-1">
                          <h4 className={`font-medium ${colors.text}`}>Detection Sources:</h4>
                          <ul className="list-disc list-inside">
                            {scanResult.detectionSources.map((source, index) => (
                              <li key={index} className={isDarkMode ? 'text-gray-400' : 'text-gray-600'}>
                                {source}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )} */}

                      {/* <p className={`italic ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                        {scanResult?.isSecure 
                          ? 'This site appears to be safe based on our security checks.'
                          : 'Exercise caution when interacting with this site.'}
                      </p> */}
                    </div>
                  </AccordionContent>
                </AccordionItem>
              </Accordion>
            </CardContent>
          </Card>
        )}

        {/* Settings */}
        {showSettings && (
          <Card className={`shadow-md ${colors.border} ${isDarkMode ? 'bg-gray-800' : 'bg-white'}`}>
            <CardContent className="p-4">
              <h3 className={`text-lg font-semibold mb-4 ${colors.text}`}>Settings</h3>
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <Label htmlFor="auto-scan" className={`${colors.text}`}>Auto-scan new sites</Label>
                  <Switch id="auto-scan" />
                </div>
                <div className="flex items-center justify-between">
                  <Label htmlFor="notifications" className={`${colors.text}`}>Enable notifications</Label>
                  <Switch id="notifications" />
                </div>
                <div className="flex items-center justify-between">
                  <Label htmlFor="data-collection" className={`${colors.text}`}>Allow anonymous data collection</Label>
                  <Switch id="data-collection" />
                </div>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  )
}
