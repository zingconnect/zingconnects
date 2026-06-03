import React from 'react'
import ReactDOM from 'react-dom/client'
import { Buffer } from 'buffer';
import App from './App.jsx'
import './index.css'
import { secureFetch } from "./api/utils/api";

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

// --- 2. PUSH NOTIFICATION HELPERS ---
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  return Uint8Array.from([...rawData].map((char) => char.charCodeAt(0)));
}

async function registerPushNotifications(registration) {
  const publicKey = import.meta.env.VITE_PUBLIC_KEY;
  if (!publicKey) return;

  try {
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') return;

    let subscription = await registration.pushManager.getSubscription();
    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey)
      });
    }
// Retrieve the token from localStorage
    const token = localStorage.getItem('token') || localStorage.getItem('agentToken');
    if (!token) return;

    const response = await secureFetch('/api/save-subscription', token, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subscription: subscription.toJSON() })
    });
    console.log("Push Synced to DB");
  } catch (err) {
    console.error("Push registration failed:", err);
  }
}

// --- 3. SERVICE WORKER & AUDIO PRIMING ---
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').then(async (registration) => {
      console.log('SW registered');
      await registerPushNotifications(registration); 
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

// --- 4. RENDER SYSTEM ---
ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)