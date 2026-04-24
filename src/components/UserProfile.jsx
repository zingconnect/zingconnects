import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { BsChevronLeft, BsCameraFill, BsShieldCheck, BsPencilSquare, BsCheckLg } from 'react-icons/bs';

export const UserProfile = () => {
  const navigate = useNavigate();
  const fileInputRef = useRef(null);
  
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [isEditing, setIsEditing] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);

  // Form State
  const [formData, setFormData] = useState({
    firstName: '',
    lastName: '',
    phone: '',
    dob: '',
    gender: '',
    city: '',
    state: ''
  });
  const [selectedFile, setSelectedFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);

  useEffect(() => {
    fetchProfile();
  }, []);

  const fetchProfile = async () => {
    try {
      const token = localStorage.getItem('userToken');
      const res = await fetch('/api/users/me', { 
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await res.json();
      if (res.ok) {
        setProfile(data.user);
        // Sync form data with fetched profile
        setFormData({
          firstName: data.user.firstName || '',
          lastName: data.user.lastName || '',
          phone: data.user.phone || '',
          dob: data.user.dob || '',
          gender: data.user.gender || '',
          city: data.user.city || '',
          state: data.user.state || ''
        });
      }
    } catch (err) {
      console.error("Failed to fetch profile:", err);
    } finally {
      setLoading(false);
    }
  };

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
    const token = localStorage.getItem('userToken');
    const data = new FormData();

    // Append text fields
    Object.keys(formData).forEach(key => data.append(key, formData[key]));
    // Append photo if changed
    if (selectedFile) data.append('photo', selectedFile);

    try {
      const res = await fetch('/api/users/update-profile', { // Ensure this matches your route
        method: 'PUT',
        headers: { 'Authorization': `Bearer ${token}` },
        body: data
      });

      if (res.ok) {
        const result = await res.json();
        setProfile(result.user);
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

  if (loading) return <div className="flex h-screen items-center justify-center bg-white">Loading...</div>;

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Header */}
      <div className="bg-white p-4 flex justify-between items-center border-b border-gray-100 shadow-sm">
        <div className="flex items-center gap-4">
          <BsChevronLeft 
            className="cursor-pointer text-gray-600" 
            size={20} 
            onClick={() => navigate('/user/dashboard')} 
          />
          <h1 className="text-lg font-black text-blue-900 uppercase">My Profile</h1>
        </div>
        
        <button 
          onClick={() => isEditing ? handleUpdate() : setIsEditing(true)}
          disabled={isUpdating}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-widest transition-all ${
            isEditing ? 'bg-green-600 text-white shadow-green-100' : 'bg-blue-50 text-blue-600'
          }`}
        >
          {isUpdating ? (
             <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
          ) : isEditing ? (
            <><BsCheckLg size={14}/> Save Changes</>
          ) : (
            <><BsPencilSquare size={14}/> Edit Profile</>
          )}
        </button>
      </div>

      <div className="p-4 max-w-md mx-auto w-full space-y-6">
        {/* Photo Section */}
        <div className="flex flex-col items-center py-6">
          <div 
            className={`w-28 h-28 rounded-full border-4 border-white shadow-md overflow-hidden relative group ${isEditing ? 'cursor-pointer' : ''}`}
            onClick={() => isEditing && fileInputRef.current.click()}
          >
            <img 
              src={previewUrl || profile?.photoUrl || '/default-avatar.png'} 
              alt="User" 
              className="w-full h-full object-cover" 
            />
            {isEditing && (
              <div className="absolute inset-0 bg-black/40 flex items-center justify-center text-white opacity-0 group-hover:opacity-100 transition-opacity">
                <BsCameraFill size={24} />
              </div>
            )}
          </div>
          <input type="file" ref={fileInputRef} hidden onChange={handleFileChange} accept="image/*" />
          
          {!isEditing && (
            <>
              <h2 className="mt-3 text-xl font-bold text-gray-800">{profile?.firstName} {profile?.lastName}</h2>
              <div className="flex items-center gap-1 text-green-500 text-[10px] font-bold uppercase tracking-widest mt-1">
                <BsShieldCheck size={12} /> Verified Profile
              </div>
            </>
          )}
        </div>

        {/* Form Container */}
        <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100 space-y-4">
          <EditableItem 
            label="First Name" 
            name="firstName" 
            value={formData.firstName} 
            isEditing={isEditing} 
            onChange={handleInputChange} 
          />
          <EditableItem 
            label="Last Name" 
            name="lastName" 
            value={formData.lastName} 
            isEditing={isEditing} 
            onChange={handleInputChange} 
          />
          <EditableItem 
            label="Phone Number" 
            name="phone" 
            value={formData.phone} 
            isEditing={isEditing} 
            onChange={handleInputChange} 
          />
          <EditableItem 
            label="Date of Birth" 
            name="dob" 
            type="date"
            value={formData.dob} 
            isEditing={isEditing} 
            onChange={handleInputChange} 
          />
          
          <div className="border-b border-gray-50 pb-3 last:border-0 last:pb-0">
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-tighter mb-1">Gender</p>
            {isEditing ? (
              <select 
                name="gender" 
                value={formData.gender} 
                onChange={handleInputChange}
                className="w-full text-sm font-semibold bg-gray-50 border-none rounded-lg p-2 outline-blue-500"
              >
                <option value="">Select Gender</option>
                <option value="male">Male</option>
                <option value="female">Female</option>
                <option value="other">Other</option>
              </select>
            ) : (
              <p className="text-sm font-semibold text-gray-700 capitalize">{profile?.gender || '—'}</p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <EditableItem label="City" name="city" value={formData.city} isEditing={isEditing} onChange={handleInputChange} />
            <EditableItem label="State" name="state" value={formData.state} isEditing={isEditing} onChange={handleInputChange} />
          </div>
        </div>

        {isEditing && (
          <button 
            onClick={() => { setIsEditing(false); setPreviewUrl(null); }}
            className="w-full text-gray-500 font-bold text-xs uppercase tracking-widest py-2"
          >
            Cancel Changes
          </button>
        )}
      </div>
    </div>
  );
};

const EditableItem = ({ label, name, value, isEditing, onChange, type = "text" }) => (
  <div className="border-b border-gray-50 pb-3 last:border-0 last:pb-0">
    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-tighter mb-1">{label}</p>
    {isEditing ? (
      <input
        type={type}
        name={name}
        value={value}
        onChange={onChange}
        className="w-full text-sm font-semibold bg-gray-50 border-none rounded-lg p-2 outline-blue-500"
      />
    ) : (
      <p className="text-sm font-semibold text-gray-700">{value || '—'}</p>
    )}
  </div>
);