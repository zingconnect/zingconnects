import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css'
import { Buffer } from 'buffer';

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
      });
  });
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)