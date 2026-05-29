import React from 'react'
import ReactDOM from 'react-dom/client'
import { Buffer } from 'buffer';

// --- 1. CRITICAL POLYFILLS & AUDIO HARDWARE ROUTING (MUST RUN FIRST) ---
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
            console.warn("⚠️ LiveKit probed AudioSession prior to native bridge attachment.");
      return {
        configureAudio: async () => { return { success: true }; },
        startAudioSession: async () => {},
        stopAudioSession: async () => {},
        setAppleAudioConfiguration: async () => {}
      };
    },
    set(nativeSessionInstance) {
      // Automatically captures and maps your true native environment audio configuration when it connects
      console.log("🍏 Genuine application AudioSession attached to global engine runtime successfully.");
      _underlyingHardwareAudioSession = nativeSessionInstance;
    }
  });
}

// --- 2. NOW SAFE TO IMPORT APPLICATION CORE ---
import App from './App.jsx'
import './index.css'

// --- 3. PWA REDIRECTION LIFE-CYCLE ---
(function() {
  const isStandalone = window.navigator.standalone || window.matchMedia('(display-mode: standalone)').matches;
  
  if (isStandalone) {
    const params = new URLSearchParams(window.location.search);
    const pwaSlug = params.get('pwa') || params.get('pwa_redirect');
    const storageSlug = localStorage.getItem('agentSlug') || localStorage.getItem('lastVisitedSlug');
    const target = pwaSlug || storageSlug;

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
    navigator.serviceWorker.register('/sw.js')
      .then((registration) => {
        console.log('SW registered with scope:', registration.scope);
      })
      .catch((error) => {
        console.error('SW registration failed:', error);
      })
  });
}

window.notificationSound = new Audio('/sound/notification.mp3');

const primeAudio = () => {
  window.notificationSound.play().then(() => {
    window.notificationSound.pause();
    window.notificationSound.currentTime = 0;
  }).catch(() => {
    // Expected to fail until user interaction
  });
  document.removeEventListener('click', primeAudio);
};

document.addEventListener('click', primeAudio, { once: true, capture: true });

// --- 5. RENDER SYSTEM ---
ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)