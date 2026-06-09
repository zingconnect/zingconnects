import React from 'react'
import ReactDOM from 'react-dom/client'
import { Buffer } from 'buffer';
import App from './App.jsx'
import './index.css'
import { AuthProvider } from './context/AuthContext';

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

// Register the Service Worker independently of the React component logic
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js')
      .then(registration => {
        console.log('Service Worker registered successfully with scope:', registration.scope);
      })
      .catch(error => {
        console.error('Service Worker registration failed:', error);
      });
  });
}

const setupAudio = () => {
  const sound = new Audio('/sound/notification.mp3');
  window.notificationSound = sound;
  
  const primeAudio = () => {
    sound.play().then(() => {
      sound.pause();
      sound.currentTime = 0;
    }).catch(() => {});
    document.removeEventListener('click', primeAudio);
  };
  document.addEventListener('click', primeAudio, { once: true, capture: true });
};

setupAudio();

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <AuthProvider>
      <App />
    </AuthProvider>
  </React.StrictMode>,
)