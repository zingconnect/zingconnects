import React, { createContext, useContext, useEffect, useState, useMemo, useRef } from 'react';
import io from 'socket.io-client';

const SocketContext = createContext(null);

export const SocketProvider = ({ children }) => {
  const [socket, setSocket] = useState(null);
  const audioRef = useRef(null);

  useEffect(() => {
    // 1. Initialize Audio reference
    audioRef.current = new Audio('/sounds/notification.mp3');

    // 2. Add an "Audio Unlock" listener to handle browser autoplay policies
    const unlockAudio = () => {
      if (audioRef.current) {
        audioRef.current.play().then(() => {
          audioRef.current.pause();
          audioRef.current.currentTime = 0;
          document.removeEventListener('click', unlockAudio);
        }).catch(() => {});
      }
    };
    document.addEventListener('click', unlockAudio);
    return () => document.removeEventListener('click', unlockAudio);
  }, []);

  useEffect(() => {
    const token = localStorage.getItem('agentToken');
    if (!token) return;

    const newSocket = io(import.meta.env.VITE_API_URL, {
      path: '/api/socket.io', // Ensure this matches your server config
      auth: { token },
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: 5
    });

    newSocket.on('connect', () => {
      console.log("Socket Connected:", newSocket.id);
      
      // Auto-join the main room using the agent's ID from the JWT
      try {
        const decoded = JSON.parse(atob(token.split('.')[1]));
        const agentId = decoded.id || decoded._id;
        newSocket.emit("join-main-room", agentId);
        console.log("Joined main room as:", agentId);
      } catch (err) {
        console.error("Failed to decode token for room join:", err);
      }
    });

    newSocket.on('new-message', (message) => {
      // 1. Play Sound
      if (audioRef.current) {
        audioRef.current.currentTime = 0;
        audioRef.current.play().catch(e => console.warn("Audio play blocked:", e));
      }

      // 2. Trigger Browser Notification
      if (Notification.permission === "granted") {
        new Notification("New Message from ZingConnect", {
          body: message.text,
          icon: '/favicon.ico'
        });
      }
      
      // 3. Dispatch global event for local state updates
      window.dispatchEvent(new CustomEvent('zing-new-message', { detail: message }));
    });

    setSocket(newSocket);

    return () => {
      newSocket.off('new-message');
      newSocket.close();
    };
  }, []); // Only run once on mount

  const value = useMemo(() => socket, [socket]);

  return (
    <SocketContext.Provider value={value}>
      {children}
    </SocketContext.Provider>
  );
};

export const useSocket = () => useContext(SocketContext);