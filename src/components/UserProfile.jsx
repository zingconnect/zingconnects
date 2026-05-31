import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, Link, useParams} from 'react-router-dom';
import { BsChevronLeft, BsCameraFill, BsPencilSquare, BsCheckLg, BsPersonBadgeFill } from 'react-icons/bs';
import PhoneInput from 'react-phone-input-2';
import 'react-phone-input-2/lib/style.css';
import { useGlobalCall } from '../context/UserCallContext'; 

export const UserProfile = () => {
  const navigate = useNavigate();
  const fileInputRef = useRef(null);
  
  const { userData, setUserData } = useGlobalCall(); 
  
  // 🛠️ CHANGED: Set initial loading state to true to let the un-cached network fetch handle initialization cleanly
  const [loading, setLoading] = useState(true);
  const [isEditing, setIsEditing] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const { agentId: slugFromUrl } = useParams();

  const [formData, setFormData] = useState({
    firstName: '',
    lastName: '',
    phone: { raw: '', formatted: '', countryCode: 'us', dialCode: '1' },
    dob: '',
    gender: '',
    city: '',
    state: ''
  });
  
  const [selectedFile, setSelectedFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);

  useEffect(() => {
    const fetchUserData = async () => {
      try {
        // Use credentials: 'include' to automatically send the HttpOnly cookie
        const res = await fetch(`${import.meta.env.VITE_API_URL}/api/users/me`, {
          method: 'GET',
          headers: { 
            'Cache-Control': 'no-cache', 
            'Pragma': 'no-cache' 
          },
          credentials: 'include' 
        });
        
        const result = await res.json();
        
        if (res.ok && result.success) {
          setUserData(result.user);
        } else {
          console.error("API Error:", result.message || "Failed to fetch user");
        }
      } catch (err) {
        console.error("Network or parsing error:", err);
      } finally {
        setLoading(false);
      }
    };

    fetchUserData();
  }, [setUserData]);

  useEffect(() => {
    if (userData) {
      setFormData({
        firstName: userData.firstName || '',
        lastName: userData.lastName || '',
        phone: userData.phone && typeof userData.phone === 'object' ? {
          raw: userData.phone.raw || '',
          formatted: userData.phone.formatted || '',
          countryCode: userData.phone.countryCode || 'us',
          dialCode: userData.phone.dialCode || '1'
        } : { raw: userData.phone || '', formatted: userData.phone || '', countryCode: 'us', dialCode: '1' },
        dob: userData.dob || '',
        gender: userData.gender || '',
        city: userData.city || '',
        state: userData.state || ''
      });
    }
  }, [userData]);

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      setSelectedFile(file);
      setPreviewUrl(URL.createObjectURL(file));
    }
  };
const handleUpdate = async () => {
  setIsUpdating(true);
  
  const data = new FormData();

  Object.keys(formData).forEach(key => {
    if (key === 'phone') {
      data.append('phone', JSON.stringify(formData.phone));
    } else {
      data.append(key, formData[key]);
    }
  });
  
  if (selectedFile) data.append('photo', selectedFile);

  try {
    // 🛡️ SECURITY FIX: Use credentials: 'include' for cookie-based auth
    // Authorization header removed to prevent token exposure
    const res = await fetch(`${import.meta.env.VITE_API_URL}/api/users/update-profile`, { 
      method: 'PUT',
      credentials: 'include',
      body: data
    });

    if (res.ok) {
      const result = await res.json();
      setUserData(result.user);
      setIsEditing(false);
      setSelectedFile(null);
      alert("Profile updated successfully!");
    } else {
      alert("Failed to update profile.");
    }
  } catch (err) {
    console.error("Update error:", err);
  } finally {
    setIsUpdating(false);
  }
};

  if (loading) return <div className="flex h-screen items-center justify-center font-bold tracking-wider text-gray-400 uppercase text-xs">Loading profile...</div>;

  return (
    <div className="min-h-screen bg-gray-100 flex flex-col pb-12">
      {/* --- FLOATING ACTION NAVIGATION HEADER --- */}
      <div className="bg-white/80 backdrop-blur-md sticky top-0 z-50 p-4 flex justify-between items-center border-b border-gray-100 shadow-sm">
        <div className="flex items-center gap-3">
          <button 
          onClick={() => navigate(`/user/dashboard/${slugFromUrl}`)}
            className="p-2 hover:bg-gray-50 rounded-full transition-colors group"
          >
            <BsChevronLeft className="text-gray-600 group-hover:text-blue-600 transition-colors" size={18} />
          </button>
          <h1 className="text-sm md:text-base font-black text-blue-900 uppercase tracking-wider">Profile Workspace</h1>
        </div>
        <button 
          onClick={() => isEditing ? handleUpdate() : setIsEditing(true)}
          disabled={isUpdating}
          className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-black uppercase tracking-widest shadow-md transition-all active:scale-95 ${
            isEditing 
              ? 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-emerald-100' 
              : 'bg-white hover:bg-gray-50 text-blue-600 border border-gray-200'
          }`}
        >
        </button>
      </div>

      {/* --- FACEBOOK STYLE HEADER HERO BANNER --- */}
      <div className="w-full max-w-4xl mx-auto bg-white shadow-sm overflow-hidden md:rounded-b-2xl border-b border-gray-200/60">
        <div className="h-36 sm:h-48 md:h-64 bg-gradient-to-r from-blue-700 via-indigo-800 to-blue-900 relative">
          <div className="absolute inset-0 opacity-20 bg-[radial-gradient(#fff_1px,transparent_1px)] [background-size:16px_16px]"></div>
        </div>

        <div className="px-4 pb-6 relative flex flex-col items-center md:items-start md:flex-row md:gap-6 md:px-8">
          <div className="-mt-16 sm:-mt-20 md:-mt-24 relative z-10">
            <div 
              onClick={() => isEditing && fileInputRef.current.click()}
              className={`w-28 h-28 sm:w-36 sm:h-36 md:w-40 md:h-40 rounded-full border-4 border-white bg-gray-100 shadow-xl overflow-hidden relative group ${isEditing ? 'cursor-pointer ring-4 ring-blue-500/20' : ''}`}
            >
              <img 
                src={previewUrl || userData?.photoUrl || `https://ui-avatars.com/api/?name=${formData.firstName || 'User'}&background=0D1117&color=fff&size=256`} 
                alt="Avatar" 
                className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" 
              />
              {isEditing && (
                <div className="absolute inset-0 bg-black/40 flex flex-col items-center justify-center text-white opacity-0 group-hover:opacity-100 transition-opacity">
                  <BsCameraFill size={22} />
                  <span className="text-[9px] font-bold uppercase mt-1 tracking-wider">Change</span>
                </div>
              )}
            </div>
            <input type="file" ref={fileInputRef} hidden onChange={handleFileChange} accept="image/*" />
          </div>

          <div className="mt-3 text-center md:text-left md:mt-4 flex-1">
            <h2 className="text-xl sm:text-2xl md:text-3xl font-black text-gray-900 leading-tight">
              {formData.firstName || '—'} {formData.lastName || ''}
            </h2>
            <p className="text-xs text-gray-400 font-bold uppercase tracking-widest mt-1">
              {userData?.email}
            </p>
          </div>
        </div>
      </div>

      {/* --- CENTRAL LAYOUT GRID CONFIGURATION --- */}
      <div className="p-4 max-w-4xl mx-auto w-full grid grid-cols-1 md:grid-cols-3 gap-6 mt-2">
        
        {/* --- LEFT HAND SIDE BAR INFO BLOCKS --- */}
        <div className="md:col-span-1 space-y-6">
          {/* Account Status Badge Card */}
          <div className="bg-white rounded-2xl p-6 border border-gray-200/60 shadow-sm h-fit space-y-4">
            <h3 className="text-xs font-black text-blue-900 uppercase tracking-widest border-b border-gray-100 pb-2">Account Badge</h3>
            <div>
              <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-wider bg-blue-50 text-blue-600">
                Role Status: {userData?.role || 'User'}
              </span>
            </div>
            <div className="text-[11px] text-gray-400 font-medium">
              Verified Account Status active since creation lifecycle tracking pipelines.
            </div>
          </div>
{/* CONNECTED AGENTS SIDEBAR CARD */}
<div className="bg-white rounded-2xl p-6 border border-gray-200/60 shadow-sm space-y-4">
  <h3 className="text-xs font-black text-blue-900 uppercase tracking-widest border-b border-gray-100 pb-2">Connected Agents</h3>
  
  {userData?.connectedAgents && userData.connectedAgents.length > 0 ? (
    <div className="space-y-3 max-h-60 overflow-y-auto pr-1">
      {userData.connectedAgents.map((agent) => {
        // 🛠️ FIX: Assemble agent display name safely
        const agentDisplayName = agent.name || `${agent.firstName || 'Agent'} ${agent.lastName || ''}`.trim();
        
        // 🛠️ FIX: If photoUrl is empty or missing, auto-generate a fallback initial avatar string 
        const fallbackAvatar = `https://ui-avatars.com/api/?name=${encodeURIComponent(agentDisplayName)}&background=0D1117&color=fff&size=128`;
        const finalPhotoUrl = agent.photoUrl && agent.photoUrl.trim() !== "" ? agent.photoUrl : fallbackAvatar;

        return (
          <Link 
            to={`/${agent.slug}`} 
            key={agent._id || agent.id || Math.random().toString()} 
            className="flex items-center gap-3 p-2.5 rounded-xl border border-gray-50 hover:border-blue-100 hover:bg-blue-50/40 transition-all group"
          >
            <div className="w-9 h-9 rounded-full bg-blue-900 flex items-center justify-center text-white text-xs font-bold shadow-sm shrink-0 overflow-hidden">
              <img 
                src={finalPhotoUrl} 
                alt={agentDisplayName} 
                className="w-full h-full object-cover rounded-full"
                onError={(e) => { 
                  // 🛠️ SAFETIED: In case a signed URL expires or breaks mid-session, intercept and swap image safely
                  e.target.onerror = null; 
                  e.target.src = fallbackAvatar; 
                }} 
              />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-bold text-gray-800 truncate group-hover:text-blue-700 transition-colors">
                {agentDisplayName}
              </p>
              <p className="text-[10px] text-gray-400 font-medium truncate">
                @{agent.slug || 'no-slug'}
              </p>
            </div>
          </Link>
        );
      })}
    </div>
  ) : (
    <div className="text-center py-4 text-gray-400 font-medium text-[11px] uppercase tracking-wider">
      No Agents Connected Yet
    </div>
  )}
</div>
        </div>

        {/* --- RIGHT HAND SIDE DATA EDITABLE CARDS --- */}
        <div className="md:col-span-2 bg-white rounded-2xl p-6 border border-gray-200/60 shadow-sm space-y-5">
          <h3 className="text-xs font-black text-blue-900 uppercase tracking-widest border-b border-gray-100 pb-2">Identity Credentials</h3>
          
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <EditableItem label="First Name" name="firstName" value={formData.firstName} isEditing={isEditing} onChange={handleInputChange} />
            <EditableItem label="Last Name" name="lastName" value={formData.lastName} isEditing={isEditing} onChange={handleInputChange} />
          </div>

          <div className="border-b border-gray-100/60 pb-4 last:border-0 last:pb-0">
            <p className="text-[10px] font-black text-gray-400 uppercase tracking-wider mb-1.5">Phone Number</p>
            {isEditing ? (
              <div className="phone-input-custom-wrapper">
                <PhoneInput
                  country={formData.phone?.countryCode || 'us'}
                  value={formData.phone?.raw || ''}
                  onChange={(value, countryData, event, formattedValue) => {
                    setFormData(prev => ({
                      ...prev,
                      phone: {
                        raw: value,
                        formatted: formattedValue,
                        countryCode: countryData.countryCode,
                        dialCode: countryData.dialCode
                      }
                    }));
                  }}
                  containerClass="w-full"
                  inputClass="!w-full !h-11 !text-sm !font-semibold !bg-gray-50 !border-0 !rounded-xl"
                  buttonClass="!bg-gray-50 !border-0 !rounded-l-xl"
                  enableSearch={true}
                />
              </div>
            ) : (
              <p className="text-sm font-semibold text-gray-800">
                {formData.phone?.formatted || formData.phone?.raw || '—'}
              </p>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <EditableItem label="Date of Birth" name="dob" type="date" value={formData.dob} isEditing={isEditing} onChange={handleInputChange} />
            <EditableItem label="Gender" name="gender" value={formData.gender} isEditing={isEditing} onChange={handleInputChange} isSelect />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <EditableItem label="City" name="city" value={formData.city} isEditing={isEditing} onChange={handleInputChange} />
            <EditableItem label="State" name="state" value={formData.state} isEditing={isEditing} onChange={handleInputChange} />
          </div>
        </div>

      </div>
    </div>
  );
};

const EditableItem = ({ label, name, value, isEditing, onChange, type = "text", isSelect = false }) => (
  <div className="border-b border-gray-100/60 pb-4 last:border-0 last:pb-0 w-full">
    <p className="text-[10px] font-black text-gray-400 uppercase tracking-wider mb-1.5">{label}</p>
    {isEditing ? (
      isSelect ? (
        <select 
          name={name} 
          value={value} 
          onChange={onChange} 
          className="w-full text-sm font-semibold bg-gray-50 p-3 h-11 rounded-xl outline-none border border-transparent focus:border-gray-200 transition-colors appearance-none"
        >
          <option value="">Select</option>
          <option value="male">Male</option>
          <option value="female">Female</option>
          <option value="other">Other</option>
        </select>
      ) : (
        <input 
          type={type} 
          name={name} 
          value={value} 
          onChange={onChange} 
          className="w-full text-sm font-semibold bg-gray-50 p-3 h-11 rounded-xl outline-none border border-transparent focus:border-gray-200 transition-colors" 
        />
      )
    ) : (
      <p className="text-sm font-semibold text-gray-800 h-6 flex items-center">{value && value.length > 0 ? value : '—'}</p>
    )}
  </div>
);