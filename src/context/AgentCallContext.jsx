import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import { io } from 'socket.io-client';
import { 
  LiveKitRoom, RoomAudioRenderer, useLocalParticipant, useRoomContext 
} from '@livekit/components-react';
import { 
  BsTelephoneFill, BsMicFill, BsMicMuteFill, BsVolumeUpFill, BsShieldLockFill, BsChevronDown 
} from 'react-icons/bs';

const AgentCallContext = createContext(null);

export const useAgentCall = () => {
  const context = useContext(AgentCallContext);
  if (!context) throw new Error('useAgentCall must be used within an AgentCallProvider');
  return context;
};

// Global Connection Signalling Socket Singleton
const socket = io(import.meta.env.VITE_API_URL);

export const AgentCallProvider = ({ children }) => {
  // --- CORE SIGNALING STATE ENGINE ---
  const [callStatus, setCallStatus] = useState('idle'); // idle, dialing, ringing, connected, connecting
  const [isIncomingCall, setIsIncomingCall] = useState(false);
  const [activeCaller, setActiveCaller] = useState(null);
  const [selectedUser, setSelectedUser] = useState(null);
  
  // --- GLOBAL UI LAYOUT CONTROL ---
  const [showFullScreenCall, setShowFullScreenCall] = useState(false);
  
  // --- AUDIO & MODIFIER CONFIGURATIONS ---
  const [isMuted, setIsMuted] = useState(false);
  const [isSpeakerOn, setIsSpeakerOn] = useState(false);
  const [isVoiceConversionActive, setIsVoiceConversionActive] = useState(false);
  const [selectedVoiceId, setSelectedVoiceId] = useState("");
  
  // --- TELEMETRY & WEBRTC PIPELINE CONFIGS ---
  const [callTime, setCallTime] = useState(0);
  const [peerConnected, setPeerConnected] = useState(false);
  const [lkToken, setLkToken] = useState(null);
  const [activeCall, setActiveCall] = useState(null);

  // --- HARDWARE & AUDIO PIPELINE REFS ---
  const timerRef = useRef(null);
  const pollingIntervalRef = useRef(null);
  const ringtoneAudio = useRef(new Audio('/sounds/ringtone.mp3'));
  const callingAudio = useRef(new Audio('/sounds/calling.wav'));

  // --- COMPONENT INITIALIZATION AUDIO CLEANUP ---
  useEffect(() => {
    ringtoneAudio.current.loop = true;
    callingAudio.current.loop = true;

    return () => {
      [ringtoneAudio, callingAudio].forEach(audioRef => {
        if (audioRef.current) {
          audioRef.current.pause();
          audioRef.current = null;
        }
      });
    };
  }, []);

  // --- AUTO-EXPAND VIEWPORTS ON EVENT TRIGGERS ---
  useEffect(() => {
    if (['ringing', 'dialing', 'connecting'].includes(callStatus)) {
      setShowFullScreenCall(true);
    }
  }, [callStatus]);

  // --- LIVE TIMER ENGINE ---
  useEffect(() => {
    if (callStatus === 'connected') {
      timerRef.current = setInterval(() => {
        setCallTime((prev) => prev + 1);
      }, 1000);
    } else {
      clearInterval(timerRef.current);
      setCallTime(0);
    }
    return () => clearInterval(timerRef.current);
  }, [callStatus]);

  // --- REMOTELY MANAGED STATUS POLLING ENGINE ---
  const startStatusPolling = (roomName) => {
    const startTime = Date.now();
    if (pollingIntervalRef.current) clearInterval(pollingIntervalRef.current);

    pollingIntervalRef.current = setInterval(async () => {
      try {
        const token = localStorage.getItem('agentToken');
        const res = await fetch(`${import.meta.env.VITE_API_URL}/api/calls/status/${roomName}`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });      
        const data = await res.json();
        const isTimeout = (Date.now() - startTime) > 45000; 
        
        if (data.success && (['ended', 'rejected', 'missed'].includes(data.status) || (isTimeout && data.status === 'calling'))) {
          console.log("🚫 Call timed out or changed state in remote polling engine.");
          handleEndCall(); 
        }
      } catch (err) {
        console.error("[CallContext] Poller Error:", err);
      }
    }, 4000);
  };

  // --- OUTBOUND CALL TRIGGER ---
  const handleStartCall = async (targetUserId, targetUserData = null) => {
    if (!targetUserId) return;
    const token = localStorage.getItem('agentToken');
    
    setCallStatus('dialing');
    setIsIncomingCall(false);
    if (targetUserData) setSelectedUser(targetUserData);
    
    try {
      if (callingAudio.current) {
        callingAudio.current.play().catch(e => console.warn("Audio playback deferred:", e));
      }

      const res = await fetch(`${import.meta.env.VITE_API_URL}/api/calls/start`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          receiverId: targetUserId,
          receiverModel: 'User',
          voiceId: selectedVoiceId || "natural" 
        } || {})
      });

      const data = await res.json();
      if (!data.success) throw new Error(data.message || "Failed to initiate call");

      const callMetadata = { 
        callId: data.callId || data.roomName, 
        roomName: data.roomName, 
        toId: targetUserId.toString()
      };

      setActiveCall(callMetadata);
      
      if (selectedVoiceId && selectedVoiceId !== "natural") {
        setIsVoiceConversionActive(true);
      }
      
      socket.emit("call-user", { 
        userToCall: targetUserId.toString(),
        roomName: data.roomName
      });
      
      setLkToken(data.lkToken);
      startStatusPolling(data.roomName);

    } catch (err) {
      console.error("❌ Outbound Connection Init Failed:", err);
      alert(`Could not start call: ${err.message}`);
      handleEndCall();
    }
  };

  // --- INCOMING ACCEPT CALL MECHANISM ---
  const handleAcceptCall = async () => {
    if (ringtoneAudio.current) {
      ringtoneAudio.current.pause();
      ringtoneAudio.current.currentTime = 0;
    }
    
    const token = localStorage.getItem('agentToken');
    const callId = activeCall?.callId || activeCaller?.callId;
    const remoteUserId = activeCaller?.fromId || activeCall?.fromId;

    if (!callId) {
      console.error("❌ Cannot accept call: Missing Call Session Identity parameters.");
      return;
    }

    try {
      setCallStatus('connecting');
      
      const res = await fetch(`${import.meta.env.VITE_API_URL}/api/calls/accept/${callId}`, {
        method: 'POST',
        headers: { 
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });
      
      if (!res.ok) throw new Error(`Server network failure status: ${res.status}`);
      
      const data = await res.json();
      if (data.success && data.lkToken) {
        setActiveCall(prev => ({ 
          ...prev,
          ...data.call, 
          callId: data.roomName, 
          roomName: data.roomName, 
          toId: remoteUserId,
          status: 'connected' 
        }));

        if (remoteUserId) {
          socket.emit("accept-call", {
            to: remoteUserId.toString(),
            roomName: data.roomName,
            callId: callId
          });
        }
        setLkToken(data.lkToken);
      } else {
        throw new Error("No secure token structure returned.");
      }
    } catch (err) {
      console.error("❌ Accept Sequence Exception:", err);
      handleEndCall(); 
    }
  };

  // --- SAFE TEARDOWN ENGINE ---
  // ✅ IMPROVED: Converted to async to securely complete database termination before breaking layout tracking states
  const handleEndCall = useCallback(async () => {
    console.log("📴 Tearing down core call channel pipelines...");
    
    // 1. INSTANTLY kill interval loops to prevent background polls during deletion routine
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current);
      pollingIntervalRef.current = null;
    }

    const currentCallId = activeCall?.roomName || activeCall?.callId || activeCaller?.callId;
    const targetId = isIncomingCall ? activeCaller?.fromId : activeCall?.toId || selectedUser?._id;

    // 2. Shut off global signals over the socket layer first
    if (targetId) {
      socket.emit("end-call", { to: String(targetId).trim(), callId: currentCallId });
    }

    // 3. Stop ringing sound assets instantly
    [ringtoneAudio, callingAudio].forEach(audioRef => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.currentTime = 0;
      }
    });
    
    // 4. ✅ BLOCKING DB CALL: Sync the ending status to MongoDB before wiping application state variables
    const token = localStorage.getItem('agentToken');
    if (currentCallId && token) {
      try {
        await fetch(`${import.meta.env.VITE_API_URL}/api/calls/end/${currentCallId}`, {
          method: 'POST',
          headers: { 
            'Authorization': `Bearer ${token}`, 
            'Content-Type': 'application/json' 
          },
          body: JSON.stringify({ callId: currentCallId }) 
        });
        console.log("✅ DB Sync completed successfully inside teardown engine pipeline.");
      } catch (e) {
        console.error("Database sync completion flag error:", e);
      }
    }

    // 5. Clean local states safely after database transaction commits
    setCallStatus('idle');
    setLkToken(null);
    setActiveCall(null);
    setActiveCaller(null);
    setIsIncomingCall(false);
    setShowFullScreenCall(false);
    setPeerConnected(false);
    setIsVoiceConversionActive(false);
    
  }, [activeCall, activeCaller, isIncomingCall, selectedUser]);

  // --- SIGNALLING WIRE LISTENER INTEGRATION ---
  useEffect(() => {
    const onCallIncoming = (data) => {
      console.log('[Global Context] Intercepted incoming call signal:', data);
      
      setActiveCaller({
        fromId: data.fromId || data.from,
        fromName: data.fromName || "Secure Client",
        photoUrl: data.photoUrl || "",
        callId: data.roomName || data.callId
      });
      
      setActiveCall({
        callId: data.roomName || data.callId,
        roomName: data.roomName || data.callId,
        fromId: data.fromId || data.from
      });

      setIsIncomingCall(true);
      setCallStatus('ringing');
      
      if (ringtoneAudio.current) {
        ringtoneAudio.current.play().catch(err => console.log("Audio deferred:", err));
      }
    };

    const onCallAccepted = (data) => {
      console.log("[Global Context] Outbound call picked up by customer.");
      if (callingAudio.current) {
        callingAudio.current.pause();
        callingAudio.current.currentTime = 0;
      }
      if (pollingIntervalRef.current) clearInterval(pollingIntervalRef.current);
      
      setCallStatus('connected');
      setPeerConnected(true);
    };

    const onCallTerminated = () => {
      console.log("[Global Context] Remote party requested link drop.");
      handleEndCall();
    };

    socket.on('call_incoming', onCallIncoming);
    socket.on('call-user-incoming', onCallIncoming);
    socket.on('call-accepted', onCallAccepted);
    socket.on('answer-call', onCallAccepted);
    socket.on('end-call', onCallTerminated);
    socket.on('call-ended', onCallTerminated);

    return () => {
      socket.off('call_incoming', onCallIncoming);
      socket.off('call-user-incoming', onCallIncoming);
      socket.off('call-accepted', onCallAccepted);
      socket.off('answer-call', onCallAccepted);
      socket.off('end-call', onCallTerminated);
      socket.off('call-ended', onCallTerminated);
    };
  }, [handleEndCall]);

  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <AgentCallContext.Provider
      value={{
        callStatus,
        setCallStatus,
        isIncomingCall,
        activeCaller,
        selectedUser,
        setSelectedUser,
        isMuted,
        setIsMuted,
        isSpeakerOn,
        setIsSpeakerOn,
        isVoiceConversionActive,
        setIsVoiceConversionActive,
        selectedVoiceId,
        setSelectedVoiceId,
        callTime,
        peerConnected,
        handleStartCall,
        activeCall,
        handleAcceptCall,
        handleEndCall,
        formatTime,
      }}
    >
      {children}

      {/* FLOATING HEADER COMPONENT */}
      {!showFullScreenCall && !['idle', 'dialing', 'ringing', 'connecting'].includes(callStatus) && (
        <div className="fixed top-0 left-0 w-full z-[99999] animate-in slide-in-from-top duration-300">
          <div className="h-[55px] md:h-[65px] flex items-center justify-between px-6 shadow-lg backdrop-blur-md transition-all bg-green-500/95 text-white">
            <div className="flex items-center gap-3">
              <div className="flex gap-1">
                <span className="w-1.5 h-1.5 bg-white rounded-full animate-bounce" />
                <span className="w-1.5 h-1.5 bg-white rounded-full animate-bounce [animation-delay:0.2s]" />
              </div>
              <div className="flex flex-col">
                <span className="text-[10px] font-black uppercase tracking-[0.15em] leading-none">Secure Link Established</span>
                <div className="flex items-center gap-1.5 mt-1">
                  <div className={`w-1.5 h-1.5 rounded-full ${isVoiceConversionActive ? 'bg-green-400 animate-pulse' : 'bg-blue-300 opacity-60'}`} />
                  <span className="text-[8px] font-black uppercase tracking-tighter opacity-90">
                    {isVoiceConversionActive ? 'AI Masking Active' : 'Natural Voice Mode'}
                  </span>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <span className="text-xs font-mono font-bold">{formatTime(callTime)}</span>
              <button onClick={() => setShowFullScreenCall(true)} className="text-[9px] font-black border border-white/40 px-3 py-1.5 rounded-lg hover:bg-white/20 transition-all uppercase tracking-widest">
                Expand
              </button>
            </div>
          </div>
        </div>
      )}

      {/* FULLSCREEN OVERLAY MODAL */}
      {(showFullScreenCall || ['ringing', 'dialing', 'connecting'].includes(callStatus)) && (
        <div className="fixed inset-0 z-[99998] bg-slate-900/95 backdrop-blur-xl flex flex-col items-center justify-center text-white animate-in fade-in zoom-in duration-300">
          
          {lkToken && (
            <LiveKitRoom
              video={false}
              audio={true}
              token={lkToken}
              serverUrl={import.meta.env.VITE_LIVEKIT_URL || "wss://zingconnect-livekit-url"}
              connect={true}
              onConnected={() => {
                console.log("⚡ [Context] LiveKit Room Bridged Successfully.");
                setCallStatus('connected');
                setPeerConnected(true);
                if (callingAudio.current) {
                  callingAudio.current.pause();
                  callingAudio.current.currentTime = 0;
                }
              }}
              onDisconnected={() => handleEndCall()}
            >
              <RoomAudioRenderer />
              <LocalMicController isMuted={isMuted} />
            </LiveKitRoom>
          )}

          <div className="flex flex-col items-center space-y-10 relative w-full max-w-lg">
            {!['ringing', 'dialing', 'connecting'].includes(callStatus) && (
              <button onClick={() => setShowFullScreenCall(false)} className="absolute -top-16 right-8 p-3 bg-white/5 hover:bg-white/10 rounded-full border border-white/10 group transition-all">
                <BsChevronDown className="text-white/50 group-hover:text-white" size={20} />
              </button>
            )}
            
            <div className="w-44 h-44 rounded-[3rem] border-4 border-blue-500/20 p-1 relative shadow-2xl">
              <img
                src={isIncomingCall ? activeCaller?.photoUrl : (selectedUser?.photoUrl || "/default-avatar.png")}
                className="w-full h-full rounded-[2.8rem] object-cover"
                alt="Caller"
                onError={(e) => {
                  e.currentTarget.onerror = null;
                  const name = isIncomingCall ? activeCaller?.fromName : selectedUser?.firstName;
                  e.currentTarget.src = `https://ui-avatars.com/api/?name=${encodeURIComponent(name || "User")}&background=0D1117&color=fff`;
                }}
              />
              {['ringing', 'dialing', 'connecting'].includes(callStatus) && (
                <div className="absolute inset-0 w-full h-full bg-blue-500 rounded-[2.8rem] animate-ping opacity-20" />
              )}
            </div>

            <div className="text-center px-6">
              <h2 className="text-3xl md:text-4xl font-black tracking-tighter mb-2">
                {isIncomingCall ? (activeCaller?.fromName || "Incoming Call") : (selectedUser ? `${selectedUser.firstName} ${selectedUser.lastName}` : "Secure Line")}
              </h2>
              
              <div className="flex flex-col items-center gap-4 mt-6">
                <p className="text-blue-400 font-black uppercase tracking-[0.5em] text-[10px] animate-pulse">
                  {callStatus === 'ringing' 
                    ? "Incoming Secure Call..." 
                    : callStatus === 'dialing' 
                      ? "Signaling Client Terminal..." 
                      : callStatus === 'connecting' 
                        ? "Encrypting Audio Tracks..." 
                        : "Connection Encrypted"}
                </p>

                {callStatus === 'connected' && (
                  <div className={`flex items-center gap-2 px-4 py-2 rounded-full border transition-all duration-500 ${isVoiceConversionActive ? 'bg-green-500/20 border-green-500/40' : 'bg-white/5 border-white/10'}`}>
                    {isVoiceConversionActive ? (
                      <>
                        <BsShieldLockFill size={12} className="text-green-500" />
                        <span className="text-[10px] font-black uppercase tracking-[0.2em] text-green-400">AI Voice Masking Active</span>
                      </>
                    ) : (
                      <>
                        <BsMicFill size={12} className="text-blue-400 opacity-80" />
                        <span className="text-[10px] font-black uppercase tracking-[0.2em] text-blue-200/70">Standard Natural Mode</span>
                      </>
                    )}
                  </div>
                )}

                {callStatus === 'connected' && (
                  <span className="text-white font-mono text-3xl font-light tracking-widest mt-2">{formatTime(callTime)}</span>
                )}
              </div>
            </div>

            <div className="flex items-center gap-8 md:gap-12 mt-12">
              {isIncomingCall && callStatus === 'ringing' ? (
                <>
                  <button onClick={handleEndCall} className="w-20 h-20 bg-red-500 rounded-2xl flex items-center justify-center shadow-2xl active:scale-90 transition-all">
                    <div className="rotate-[135deg]"><BsTelephoneFill size={32} color="white" /></div>
                  </button>
                  <button onClick={handleAcceptCall} className="w-20 h-20 bg-green-500 rounded-2xl flex items-center justify-center shadow-2xl animate-bounce active:scale-90 transition-all">
                    <BsTelephoneFill size={32} color="white" />
                  </button>
                </>
              ) : (
                <>
                  <button onClick={() => setIsMuted(!isMuted)} className={`w-16 h-16 rounded-2xl flex items-center justify-center transition-all active:scale-90 ${isMuted ? 'bg-red-500' : 'bg-white/10 hover:bg-white/20'}`}>
                    {isMuted ? <BsMicMuteFill size={24} color="white" /> : <BsMicFill size={24} color="white" />}
                  </button>
                  <button onClick={handleEndCall} className="w-20 h-20 bg-red-600 rounded-2xl flex items-center justify-center shadow-2xl active:scale-95 transition-all">
                    <div className="rotate-[135deg]"><BsTelephoneFill size={32} color="white" /></div>
                  </button>
                  <button onClick={() => setIsSpeakerOn(!isSpeakerOn)} className={`w-16 h-16 rounded-2xl flex items-center justify-center transition-all active:scale-90 ${isSpeakerOn ? 'bg-white text-slate-900' : 'bg-white/10 hover:bg-white/20'}`}>
                    <BsVolumeUpFill size={26} />
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </AgentCallContext.Provider>
  );
};

const LocalMicController = ({ isMuted }) => {
  const { localParticipant } = useLocalParticipant();
  const room = useRoomContext();

  useEffect(() => {
    if (!localParticipant || !room || room.state !== 'connected') return;
    
    localParticipant.setMicrophoneEnabled(!isMuted)
      .catch(err => console.error("[Context Mic Sync] Failure:", err));
  }, [isMuted, localParticipant, room]);

  return null;
};