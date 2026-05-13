import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css'
import { Buffer } from 'buffer';

(function() {
  const isStandalone = window.navigator.standalone || window.matchMedia('(display-mode: standalone)').matches;
  
  if (isStandalone) {
    // 1. Try URL parameters (most reliable on iOS launch)
    const params = new URLSearchParams(window.location.search);
    const pwaSlug = params.get('pwa') || params.get('pwa_redirect');
    
    // 2. Try LocalStorage (fallback)
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

// --- CRITICAL POLYFILLS FOR WEBRTC ---
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

// --- SERVICE WORKER REGISTRATION ---
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('../sw.js')
      .then((registration) => {
        console.log('SW registered with scope:', registration.scope);
      })
      .catch((error) => {
        console.error('SW registration failed:', error);
      })
  });
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)




