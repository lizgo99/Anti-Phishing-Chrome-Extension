import React from 'react';
import { createRoot } from 'react-dom/client';
import Popup from './components/Popup';
import './index.css';

// This is the entry point file that initializes React
const container = document.getElementById('root');
if (!container) {
  throw new Error('Root element not found');
}
const root = createRoot(container);
root.render(
  <React.StrictMode>
    <Popup />
  </React.StrictMode>
);