import React from 'react'
import ReactDOM from 'react-dom/client'
import { Buffer } from 'buffer';
import { SocketProvider } from './context/SocketProvider'; // 1. IMPORT PROVIDER

// --- 1. CRITICAL POLYFILLS & AUDIO HARDWARE ROUTING ---
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

if (typeof window !== 'undefined' && !("AudioSession" in window)) {
  let _underlyingHardwareAudioSession = undefined;
  Object.defineProperty(window, 'AudioSession', {
    configurable: true,
    enumerable: true,
    get() {
      if (_underlyingHardwareAudioSession) return _underlyingHardwareAudioSession;
      return {
        configureAudio: async () => ({ success: true }),
        startAudioSession: async () => {},
        stopAudioSession: async () => {},
        setAppleAudioConfiguration: async () => {}
      };
    },
    set(nativeSessionInstance) {
      _underlyingHardwareAudioSession = nativeSessionInstance;
    }
  });
}

import App from './App.jsx'
import './index.css'

// --- 3. PWA REDIRECTION LIFE-CYCLE ---
(function() {
  const isStandalone = window.navigator.standalone || window.matchMedia('(display-mode: standalone)').matches;
  if (isStandalone) {
    const params = new URLSearchParams(window.location.search);
    const target = params.get('pwa') || localStorage.getItem('agentSlug');
    if (target && (window.location.pathname === '/' || window.location.pathname === '/pricing')) {
        window.location.replace(`/${target}?v=${Date.now()}`);
    }
  }
})();

// --- 4. SERVICE WORKER REGISTRATION ---
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(console.error);
  });
}

// --- 5. RENDER SYSTEM ---
ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <SocketProvider> {/* 2. WRAP APP COMPONENT */}
      <App />
    </SocketProvider>
  </React.StrictMode>,
)