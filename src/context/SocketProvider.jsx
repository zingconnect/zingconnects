import React, { createContext, useContext, useEffect, useState, useMemo } from 'react';
import io from 'socket.io-client';

const SocketContext = createContext(null);

export const SocketProvider = ({ children }) => {
  const [socket, setSocket] = useState(null);
  useEffect(() => {
    const token = localStorage.getItem('agentToken');
    if (!token) return;

const newSocket = io(import.meta.env.VITE_API_URL, {
          auth: { token },
      reconnection: true,
      reconnectionAttempts: 5
    });

    setSocket(newSocket);

    // Global event listener
    newSocket.on('new-message', (message) => {
      // 1. Play Sound
      const audio = new Audio('/sounds/notification.mp3');
      audio.play().catch(e => console.warn("Audio play blocked (interaction required)"));

      // 2. Trigger Notification
      if (Notification.permission === "granted") {
        new Notification("New Message from ZingConnect", {
          body: message.text,
          icon: '/favicon.ico'
        });
      }
    });

    // Cleanup on unmount
    return () => {
      newSocket.off('new-message');
      newSocket.close();
    };
  }, [localStorage.getItem('agentToken')]); 

  // Memoize the value to prevent unnecessary re-renders
  const value = useMemo(() => socket, [socket]);

  return (
    <SocketContext.Provider value={value}>
      {children}
    </SocketContext.Provider>
  );
};

export const useSocket = () => {
  const context = useContext(SocketContext);
  if (!context) {
    throw new Error('useSocket must be used within a SocketProvider');
  }
  return context;
};