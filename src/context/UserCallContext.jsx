import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { useUserZingCall } from '../hooks/useUserZingCall';
// Bring in LiveKit parts to prevent the "silent connection" track failure
import { LiveKitRoom, RoomAudioRenderer, useLocalParticipant, useRoomContext } from '@livekit/components-react';

const UserCallContext = createContext(null);

const socket = io(import.meta.env.VITE_API_URL, {
  autoConnect: true,
  reconnectionAttempts: 5,
  reconnectionDelay: 2000
});

export const UserCallProvider = ({ children }) => {
  const [userData, setUserData] = useState(null);
  const [agent, setAgent] = useState(null);
  const messagesEndRef = useRef(null);
  const ringtoneRef = useRef(null);
  const [avatarError, setAvatarError] = useState(false);

  useEffect(() => {
    setAvatarError(false);
  }, [agent?.id, agent?._id]);

  // Session Engine Poller Engine
  useEffect(() => {
    const token = localStorage.getItem('userToken');
    if (!token) return;

    const fetchUserSession = async () => {
      try {
        const response = await fetch(`${import.meta.env.VITE_API_URL}/api/users/my-session`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        
        const data = await response.json();
        if (response.ok) {
          setAgent(data.agent);
          setUserData(data.user);
        }
      } catch (err) {
        console.error("Global Context Session fetch error:", err);
      }
    };

    fetchUserSession();
    const interval = setInterval(fetchUserSession, 30000);
    return () => clearInterval(interval);
  }, []);

  const callEngine = useUserZingCall(socket, userData, agent, messagesEndRef);

  // Sound Engine Lifecycle Rules
  useEffect(() => {
    const isIncoming = callEngine.callStatus === 'ringing' || (callEngine.callStatus !== 'idle' && callEngine.isIncomingCall);

    if (isIncoming && callEngine.callStatus !== 'connected') {
      if (!ringtoneRef.current) {
        ringtoneRef.current = new Audio('/sounds/calling.wav'); 
        ringtoneRef.current.loop = true;
      }
      ringtoneRef.current.play().catch(err => {
        console.warn("Ringtone playback deferred:", err);
      });
    } else {
      if (ringtoneRef.current) {
        ringtoneRef.current.pause();
        ringtoneRef.current.currentTime = 0;
      }
    }

    return () => {
      if (ringtoneRef.current) ringtoneRef.current.pause();
    };
  }, [callEngine.callStatus, callEngine.isIncomingCall]);

  const finalAvatarUrl = avatarError || !agent?.photoUrl ? '/default-avatar.png' : agent.photoUrl;

  return (
    <UserCallContext.Provider value={{ ...callEngine, socket, userData, agent, setUserData, setAgent, messagesEndRef }}>
      {children}
      
      {/* LIVEKIT PIPELINE BRIDGING ENGINE */}
      {callEngine.lkToken && (
        <LiveKitRoom
          video={false}
          audio={true}
          token={callEngine.lkToken}
          serverUrl={import.meta.env.VITE_LIVEKIT_URL || "wss://zingconnect-livekit-url"}
          connect={true}
          onConnected={() => {
            console.log("⚡ [User Context] LiveKit Room Bridged Successfully.");
            if (ringtoneRef.current) {
              ringtoneRef.current.pause();
              ringtoneRef.current.currentTime = 0;
            }
          }}
          onDisconnected={() => callEngine.handleEndCall()}
        >
          <RoomAudioRenderer />
          <LocalMicController isMuted={callEngine.isMuted} />
        </LiveKitRoom>
      )}

      {/* 4. GLOBAL INCOMING CALL HUD OVERLAY */}
      {callEngine.callStatus === 'ringing' && callEngine.isIncomingCall && (
        <div className="fixed inset-0 z-[9999] bg-black/70 backdrop-blur-md flex flex-col items-center justify-center text-white animate-in fade-in duration-200">
          <div className="text-center space-y-5 max-w-sm px-6 w-full">
            <div className="relative">
              <img 
                src={finalAvatarUrl} 
                alt="Agent Avatar" 
                className="w-28 h-28 rounded-full mx-auto object-cover border-4 border-blue-500 shadow-2xl"
                onError={() => setAvatarError(true)}
              />
              <span className="absolute bottom-1 right-[38%] block h-4 w-4 rounded-full bg-green-400 ring-2 ring-[#0b141a] animate-ping" />
            </div>
            
            <div>
              <h3 className="text-xl font-black tracking-wide">
                {agent ? `${agent.firstName} ${agent.lastName}` : 'ZingConnect Agent'}
              </h3>
              <p className="text-xs text-blue-400 uppercase tracking-[0.2em] font-bold mt-1 animate-pulse">
                Incoming Voice Call...
              </p>
            </div>

            <div className="flex items-center justify-center gap-10 pt-6">
              <button 
                onClick={callEngine.handleRejectCall}
                className="w-16 h-16 bg-red-600 rounded-full flex items-center justify-center shadow-xl hover:bg-red-700 transition-transform active:scale-90 cursor-pointer"
              >
                <span className="transform rotate-[135deg] text-xl text-white">📞</span>
              </button>

              <button 
                onClick={callEngine.handleAcceptCall}
                className="w-16 h-16 bg-green-500 rounded-full flex items-center justify-center shadow-xl hover:bg-green-600 transition-transform active:scale-90 animate-bounce cursor-pointer"
              >
                <span className="text-xl text-white">📞</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 5. ACTIVE LINE CALL SCREEN HUD */}
      {callEngine.callStatus !== 'idle' && callEngine.callStatus !== 'ringing' && callEngine.showFullScreenCall && (
        <div className="fixed inset-0 z-[9998] bg-[#0b141a] text-white flex flex-col justify-between py-16 px-6 animate-in fade-in duration-300">
          <div className="text-center space-y-2 mt-8">
            <h2 className="text-2xl font-black tracking-tight">
              {agent ? `${agent.firstName} ${agent.lastName}` : "Secure Call"}
            </h2>
            <p className="text-xs text-blue-400 font-bold uppercase tracking-[0.25em]">
              {callEngine.callStatus === 'connected' ? `Encrypted Line • ${callEngine.formatTime(callEngine.callTime)}` : 'Connecting Peer Mesh...'}
            </p>
          </div>

          <div className="flex justify-center my-auto">
            <div className="w-36 h-36 rounded-full bg-slate-800 flex items-center justify-center border border-white/10 shadow-2xl relative">
              <img 
                src={finalAvatarUrl} 
                className="w-full h-full rounded-full object-cover" 
                alt="Agent Active Session Avatar" 
                onError={() => setAvatarError(true)}
              />
            </div>
          </div>

          <div className="bg-[#111b21] rounded-3xl p-5 flex justify-around items-center max-w-sm mx-auto w-full border border-white/5 shadow-xl">
            <button 
              onClick={() => callEngine.setIsMuted(!callEngine.isMuted)}
              className={`p-4 rounded-full transition-colors cursor-pointer ${callEngine.isMuted ? 'bg-red-500 text-white' : 'bg-white/5 text-slate-300 hover:bg-white/10'}`}
            >
              <span className="text-lg">{callEngine.isMuted ? '🔇' : '🎙️'}</span>
            </button>
            
            <button 
              onClick={callEngine.handleEndCall}
              className="p-4 bg-red-500 hover:bg-red-600 rounded-full text-white font-bold transition-transform active:scale-95 flex items-center justify-center gap-2 px-6 shadow-md cursor-pointer"
            >
              <span className="transform rotate-[135deg]">📞</span>
              <span className="text-xs uppercase tracking-wider font-bold">End</span>
            </button>
          </div>
        </div>
      )}
    </UserCallContext.Provider>
  );
};

// RUNTIME MICROPHONE TRACKER COMPONENT (Matches Agent Side Pipeline Logic)
const LocalMicController = ({ isMuted }) => {
  const { localParticipant } = useLocalParticipant();
  const room = useRoomContext();

  useEffect(() => {
    if (!localParticipant || !room || room.state !== 'connected') return;
    
    localParticipant.setMicrophoneEnabled(!isMuted)
      .catch(err => console.error("[User Mic Sync] Failure:", err));
  }, [isMuted, localParticipant, room]);

  return null;
};

export const useGlobalCall = () => {
  const context = useContext(UserCallContext);
  if (!context) throw new Error("useGlobalCall must be run within a UserCallProvider tree context.");
  return context;
};