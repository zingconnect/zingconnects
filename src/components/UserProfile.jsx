import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { BsChevronLeft, BsCameraFill, BsShieldCheck, BsPencilSquare, BsCheckLg } from 'react-icons/bs';
import { useGlobalCall } from '../context/UserCallContext'; 

export const UserProfile = () => {
  const navigate = useNavigate();
  const fileInputRef = useRef(null);
  
  const { userData, setUserData } = useGlobalCall(); 
  
  const [loading, setLoading] = useState(!userData);
  const [isEditing, setIsEditing] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);

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
    const fetchUserData = async () => {
      const token = localStorage.getItem('userToken');
      try {
        const res = await fetch(`${import.meta.env.VITE_API_URL}/api/users/me`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        const result = await res.json();
        if (result.success) {
          setUserData(result.user);
        }
      } catch (err) {
        console.error("Failed to fetch profile:", err);
      } finally {
        setLoading(false);
      }
    };
    
    if (!userData) {
      fetchUserData();
    } else {
      setLoading(false);
    }
  }, [userData, setUserData]);
  
  useEffect(() => {
    if (userData) {
      setFormData({
        firstName: userData.firstName || '',
        lastName: userData.lastName || '',
        phone: userData.phone || '',
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
    const token = localStorage.getItem('userToken');
    const data = new FormData();

    Object.keys(formData).forEach(key => data.append(key, formData[key]));
    if (selectedFile) data.append('photo', selectedFile);

    try {
      const res = await fetch(`${import.meta.env.VITE_API_URL}/api/users/update-profile`, { 
        method: 'PUT',
        headers: { 'Authorization': `Bearer ${token}` },
        body: data
      });

      if (res.ok) {
        const result = await res.json();
        setUserData(result.user);
        setIsEditing(false);
        setSelectedFile(null);
        alert("Profile updated successfully!");
      }
    } catch (err) {
      console.error("Update error:", err);
    } finally {
      setIsUpdating(false);
    }
  };

  if (loading) return <div className="flex h-screen items-center justify-center">Loading...</div>;

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <div className="bg-white p-4 flex justify-between items-center border-b border-gray-100 shadow-sm">
        <div className="flex items-center gap-4">
          <BsChevronLeft className="cursor-pointer text-gray-600" size={20} onClick={() => navigate('/user/dashboard')} />
          <h1 className="text-lg font-black text-blue-900 uppercase">My Profile</h1>
        </div>
        <button 
          onClick={() => isEditing ? handleUpdate() : setIsEditing(true)}
          disabled={isUpdating}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-widest transition-all ${isEditing ? 'bg-green-600 text-white' : 'bg-blue-50 text-blue-600'}`}
        >
          {isUpdating ? "Updating..." : isEditing ? <><BsCheckLg/> Save</> : <><BsPencilSquare/> Edit</>}
        </button>
      </div>

      <div className="p-4 max-w-md mx-auto w-full space-y-6">
        <div className="flex flex-col items-center py-6">
          <div className="w-28 h-28 rounded-full border-4 border-white shadow-md overflow-hidden relative group" onClick={() => isEditing && fileInputRef.current.click()}>
            <img src={previewUrl || userData?.photoUrl || '/default-avatar.png'} alt="User" className="w-full h-full object-cover" />
          </div>
          <input type="file" ref={fileInputRef} hidden onChange={handleFileChange} accept="image/*" />
          {!isEditing && <h2 className="mt-3 text-xl font-bold text-gray-800">{formData.firstName} {formData.lastName}</h2>}
        </div>

        <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100 space-y-4">
          <EditableItem label="First Name" name="firstName" value={formData.firstName} isEditing={isEditing} onChange={handleInputChange} />
          <EditableItem label="Last Name" name="lastName" value={formData.lastName} isEditing={isEditing} onChange={handleInputChange} />
          <EditableItem label="Phone Number" name="phone" value={formData.phone} isEditing={isEditing} onChange={handleInputChange} />
          <EditableItem label="Date of Birth" name="dob" type="date" value={formData.dob} isEditing={isEditing} onChange={handleInputChange} />
          <EditableItem label="Gender" name="gender" value={formData.gender} isEditing={isEditing} onChange={handleInputChange} isSelect />
          <div className="grid grid-cols-2 gap-4">
            <EditableItem label="City" name="city" value={formData.city} isEditing={isEditing} onChange={handleInputChange} />
            <EditableItem label="State" name="state" value={formData.state} isEditing={isEditing} onChange={handleInputChange} />
          </div>
        </div>
      </div>
    </div>
  );
};

const EditableItem = ({ label, name, value, isEditing, onChange, type = "text", isSelect = false }) => (
  <div className="border-b border-gray-50 pb-3 last:border-0 last:pb-0">
    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-tighter mb-1">{label}</p>
    {isEditing ? (
      isSelect ? (
        <select name={name} value={value} onChange={onChange} className="w-full text-sm font-semibold bg-gray-50 p-2 rounded-lg">
          <option value="">Select</option>
          <option value="male">Male</option>
          <option value="female">Female</option>
        </select>
      ) : (
        <input type={type} name={name} value={value} onChange={onChange} className="w-full text-sm font-semibold bg-gray-50 p-2 rounded-lg" />
      )
    ) : (
      <p className="text-sm font-semibold text-gray-700">{value && value.length > 0 ? value : '—'}</p>
    )}
  </div>
);