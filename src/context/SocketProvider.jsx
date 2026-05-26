import React, { createContext, useContext, useEffect, useState, useMemo, useRef } from 'react';
import io from 'socket.io-client';

const SocketContext = createContext(null);

export const SocketProvider = ({ children }) => {
  const [socket, setSocket] = useState(null);
  const audioRef = useRef(null);

  useEffect(() => {
    // Initialize Audio once
    audioRef.current = new Audio('/sounds/notification.mp3');
  }, []);

  useEffect(() => {
    const token = localStorage.getItem('agentToken');
    if (!token) return;

    const newSocket = io(import.meta.env.VITE_API_URL, {
      auth: { token },
      reconnection: true,
      reconnectionAttempts: 5
    });

    newSocket.on('connect', () => console.log("Socket Connected:", newSocket.id));

    newSocket.on('new-message', (message) => {
      // 1. Play Sound (Browser will only allow if user has interacted with page)
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
      
      // 3. Dispatch global event for local state updates (Unread counts, etc.)
      window.dispatchEvent(new CustomEvent('zing-new-message', { detail: message }));
    });

    setSocket(newSocket);

    return () => {
      newSocket.off('new-message');
      newSocket.close();
    };
  }, [localStorage.getItem('agentToken')]);

  const value = useMemo(() => socket, [socket]);

  return (
    <SocketContext.Provider value={value}>
      {children}
    </SocketContext.Provider>
  );
};

export const useSocket = () => useContext(SocketContext);