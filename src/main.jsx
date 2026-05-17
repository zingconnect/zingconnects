import React from 'react'
import ReactDOM from 'react-dom/client'
import { Buffer } from 'buffer';

// --- 1. CRITICAL POLYFILLS FOR WEBRTC (MUST RUN FIRST) ---
window.global = window;
window.Buffer = Buffer;
window.process = {
  env: { DEBUG: undefined },
  version: '',
  nextTick: (fn) => setTimeout(fn, 0),
  listeners: () => [],
  on: () => [],
  removeListener: () => [],
};

// --- 2. NOW SAFE TO IMPORT APPLICATION CORE ---
import App from './App.jsx'
import './index.css'

// --- 3. PWA REDIRECTION LIFE-CYCLE ---
(function() {
  const isStandalone = window.navigator.standalone || window.matchMedia('(display-mode: standalone)').matches;
  
  if (isStandalone) {
    // Try URL parameters (most reliable on iOS launch)
    const params = new URLSearchParams(window.location.search);
    const pwaSlug = params.get('pwa') || params.get('pwa_redirect');
    
    // Try LocalStorage (fallback)
    const storageSlug = localStorage.getItem('agentSlug') || localStorage.getItem('lastVisitedSlug');
    
    const target = pwaSlug || storageSlug;

    // Only redirect if we are stuck on the root/pricing page
    if (target && (window.location.pathname === '/' || window.location.pathname === '/pricing')) {
        console.log("PWA Redirecting to:", target);
        const cacheBuster = Date.now();
        window.location.replace(`/${target}?v=${cacheBuster}`);
    }
  }
})();

// --- 4. SERVICE WORKER REGISTRATION (ROOTED PATH) ---
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    // Changed from '../sw.js' to '/sw.js' for absolute scoping stability
    navigator.serviceWorker.register('/sw.js')
      .then((registration) => {
        console.log('SW registered with scope:', registration.scope);
      })
      .catch((error) => {
        console.error('SW registration failed:', error);
      })
  });
}

// --- 5. RENDER SYSTEM ---
ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)