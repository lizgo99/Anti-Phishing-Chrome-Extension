import React from 'react';
import { createRoot } from 'react-dom/client';
import { AlertTriangle, ArrowLeft, ExternalLink } from 'lucide-react';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";

interface WarningPageProps {
  url: string;
  riskScore: number;
  threats: string[];
}

const WarningPage: React.FC<WarningPageProps> = ({ url, riskScore, threats }) => {
  const handleContinue = async () => {
    try {
      await chrome.runtime.sendMessage({
        type: 'WARNING_DECISION',
        url,
        allow: true
      });
    } catch (error) {
      console.error('Error handling continue:', error);
    }
  };

  const handleGoBack = async () => {
    try {
      console.log('Handling go back');
      
      // Disable the button to prevent multiple clicks
      const button = document.querySelector('button') as HTMLButtonElement;
      if (button) button.disabled = true;
      
      // Send the decision to the background script
      await chrome.runtime.sendMessage({
        type: 'WARNING_DECISION',
        url,
        allow: false
      });
      
      // The background script will handle the navigation and cleanup
    } catch (error) {
      console.error('Error handling go back:', error);
      // Re-enable the button if there was an error
      const button = document.querySelector('button') as HTMLButtonElement;
      if (button) button.disabled = false;
    }
  };

  return (
    <div className="fixed inset-0 bg-red-500/90 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <Card className="w-full max-w-2xl border-destructive">
        <CardHeader className="border-b border-border pb-4">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-6 w-6 text-destructive" />
            <CardTitle className="text-destructive text-xl">Warning: Suspicious Website Detected!</CardTitle>
          </div>
        </CardHeader>
        
        <CardContent className="pt-6 space-y-6">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-lg font-semibold">Risk Score</span>
              <span className="text-lg text-destructive font-bold">{riskScore.toFixed(1)}%</span>
            </div>
            <Progress value={riskScore} className="h-3 bg-destructive/20" indicatorClassName="bg-destructive" />
          </div>

          <div className="space-y-2">
            <span className="font-semibold">URL:</span>
            <div className="p-2 bg-muted rounded-md break-all flex items-center gap-2">
              {url}
              <ExternalLink className="h-4 w-4 shrink-0" />
            </div>
          </div>

          {threats && threats.length > 0 && (
            <div className="space-y-2">
              <span className="font-semibold">Detected Threats:</span>
              <ul className="list-disc list-inside space-y-1">
                {threats.map((threat, index) => (
                  <li key={index} className="text-destructive">{threat}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="flex justify-end gap-4 mt-6">
            <Button variant="outline" onClick={handleGoBack}>
              Go Back (Recommended)
            </Button>
            <Button variant="destructive" onClick={handleContinue}>
              Continue Anyway
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

// Function to initialize the warning page
function initWarningPage(props: WarningPageProps) {
  const container = document.getElementById('anti-phish-warning');
  if (container) {
    const root = createRoot(container);
    root.render(<WarningPage {...props} />);
  }
}

// Expose the initialization function globally
window.initWarningPage = initWarningPage;

export default WarningPage;
