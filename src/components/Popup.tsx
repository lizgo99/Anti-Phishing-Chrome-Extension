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

export default function Popup() {
  const [url, setUrl] = useState("https://example.com")
  const [scanning, setScanning] = useState(false)
  const [riskScore, setRiskScore] = useState(5)
  const [isDarkMode, setIsDarkMode] = useState(false)

  const handleScan = () => {
    setScanning(true)
    // Simulate scanning
    setTimeout(() => {
      setScanning(false)
      setRiskScore(Math.floor(Math.random() * 100))
    }, 2000)
  }

  useEffect(() => {
    // In a real extension, we would use chrome.tabs.query to get the current tab's URL
    // For demonstration, we'll just set a placeholder URL
    setUrl("https://example.com")
  }, [])

  const getRiskLevel = (score: number) => {
    if (score < 25) return "Safe"
    if (score < 50) return "Fair"
    if (score < 75) return "Weak"
    return "Risky"
  }

  const getRiskColor = (score: number) => {
    if (score < 25) return "text-green-500"
    if (score < 50) return "text-yellow-500"
    if (score < 75) return "text-orange-500"
    return "text-red-500"
  }

  const getThemeColors = () => {
    return isDarkMode
      ? {
          bg: 'bg-gray-900',
          text: 'text-white',
          border: 'border-purple-600',
          button: 'bg-purple-600 hover:bg-purple-700',
          buttonText: 'text-white',
        }
      : {
          bg: 'bg-green-50',
          text: 'text-gray-900',
          border: 'border-green-600',
          button: 'bg-green-600 hover:bg-green-700',
          buttonText: 'text-white',
        }
  }

  const colors = getThemeColors()

  return (
    <div className={`w-96 p-4 transition-colors duration-300 ${colors.bg} ${colors.text}`}>
      <div className="space-y-4">
        {/* URL Input and Scan Button */}
        <div className="flex items-center space-x-2">
          <div className="relative flex-grow">
            <Input
              type="url"
              placeholder="Enter URL: https://example.com"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              className={`w-full rounded-l-full rounded-r-full pr-20 ${colors.border} ${
                isDarkMode ? 'bg-gray-800 text-white' : 'bg-white text-gray-900'
              } placeholder-gray-400`}
            />
            <Button
              variant="ghost"
              onClick={handleScan}
              disabled={scanning}
              className={`absolute right-1 top-1/2 -translate-y-1/2 h-[calc(100%-8px)] px-3 rounded-full transition-colors duration-200 ${
                isDarkMode
                  ? 'text-purple-400 hover:text-purple-300 hover:bg-gray-700/50'
                  : 'text-green-600 hover:text-green-700 hover:bg-green-100/50'
              }`}
            >
              {scanning ? 'Scanning...' : 'Scan'}
            </Button>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setIsDarkMode(!isDarkMode)}
            className={`rounded-full p-2 transition-colors duration-200 ${isDarkMode ? 'text-purple-400 hover:text-purple-300 hover:bg-gray-800' : 'text-green-600 hover:text-green-700 hover:bg-green-100'}`}
          >
            {isDarkMode ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className={`rounded-full p-2 transition-colors duration-200 ${isDarkMode ? 'text-purple-400 hover:text-purple-300 hover:bg-gray-800' : 'text-green-600 hover:text-green-700 hover:bg-green-100'}`}
          >
            <Settings className="h-5 w-5" />
          </Button>
        </div>

        {/* Risk Score and Icons */}
        <div className="flex items-center justify-between space-x-2">
          {/* Risk Score Circle */}
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
                  {getRiskLevel(riskScore)}
                </div>
              </div>
            </div>
          </div>

          {/* Icons and Text (now as buttons) */}
          <div className="flex flex-col space-y-2 pt-2 -ml-2">
            <Button
              variant="ghost"
              className={`flex items-center space-x-2 ${isDarkMode ? 'hover:bg-gray-800' : 'hover:bg-green-100'} transition-colors duration-200 rounded-lg py-1.5 px-2 w-full justify-start`}
            >
              <Shield className={`h-6 w-6 ${isDarkMode ? 'text-purple-400' : 'text-green-600'} flex-shrink-0`} />
              <span className={`text-sm ${colors.text} font-medium`}>Declare As Safe</span>
            </Button>
            <Button
              variant="ghost"
              className={`flex items-center space-x-2 ${isDarkMode ? 'hover:bg-gray-800' : 'hover:bg-green-100'} transition-colors duration-200 rounded-lg py-1.5 px-2 w-full justify-start`}
            >
              <Info className={`h-6 w-6 ${isDarkMode ? 'text-purple-400' : 'text-green-600'} flex-shrink-0`} />
              <span className={`text-sm ${colors.text} font-medium`}>Info About Site</span>
            </Button>
            <Button
              variant="ghost"
              className={`flex items-center space-x-2 ${isDarkMode ? 'hover:bg-gray-800' : 'hover:bg-green-100'} transition-colors duration-200 rounded-lg py-1.5 px-2 w-full justify-start`}
            >
              <ExternalLink className={`h-6 w-6 ${isDarkMode ? 'text-purple-400' : 'text-green-600'} flex-shrink-0`} />
              <span className={`text-sm ${colors.text} font-medium whitespace-nowrap`}>Learn about Phishing</span>
            </Button>
          </div>
        </div>

        {/* Info About Site */}
        <Card className={`shadow-md ${colors.border} ${isDarkMode ? 'bg-gray-800' : 'bg-white'}`}>
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-2">
              <span className={`text-sm font-medium ${colors.text}`}>INFO ABOUT SITE</span>
              <span className={`text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                Risk Level: <span className={getRiskColor(riskScore)}>{getRiskLevel(riskScore)}</span>
              </span>
            </div>
            <div className={`text-xs ${isDarkMode ? 'text-gray-400' : 'text-gray-600'} mb-2`}>
              Last scanned: {new Date().toLocaleString()}
            </div>
            <Accordion type="single" collapsible className="w-full">
              <AccordionItem value="info">
                <AccordionTrigger className={`text-sm ${colors.text}`}>
                  More Details
                </AccordionTrigger>
                <AccordionContent>
                  <div className="space-y-2 text-xs">
                    <p className="font-medium">Why was it flagged:</p>
                    <ul className="list-disc pl-4 space-y-1">
                      <li>Suspicious URL pattern</li>
                      <li>Missing SSL certificate</li>
                      <li>Domain age less than 30 days</li>
                    </ul>
                    <p className={`italic ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                      Tooltip explanation of detected risks
                    </p>
                    <Button
                      variant="outline"
                      size="sm"
                      className={`w-full text-xs ${colors.border} ${isDarkMode ? 'hover:bg-gray-700' : 'hover:bg-gray-50'} transition-colors duration-200`}
                    >
                      Configuration options
                    </Button>
                  </div>
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          </CardContent>
        </Card>

        {/* Settings */}
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
      </div>
    </div>
  )
}
