import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { BsChevronLeft, BsCameraFill, BsShieldCheck } from 'react-icons/bs';

// Note: Use a Named Export to match your App.jsx import
export const UserProfile = () => {
  const navigate = useNavigate();
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchProfile();
  }, []);

  const fetchProfile = async () => {
    try {
      const token = localStorage.getItem('userToken');
      const res = await fetch('/api/users/me', { // Adjust this endpoint to your backend route
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await res.json();
      if (res.ok) {
        setProfile(data.user);
      }
    } catch (err) {
      console.error("Failed to fetch profile:", err);
    } finally {
      setLoading(false);
    }
  };

  if (loading) return <div className="flex h-screen items-center justify-center bg-white">Loading...</div>;

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Header */}
      <div className="bg-white p-4 flex items-center gap-4 border-b border-gray-100 shadow-sm">
        <BsChevronLeft 
          className="cursor-pointer text-gray-600" 
          size={20} 
          onClick={() => navigate('/user/dashboard')} 
        />
        <h1 className="text-lg font-black text-blue-900 uppercase">My Profile</h1>
      </div>

      <div className="p-4 max-w-md mx-auto w-full space-y-6">
        {/* Photo Section */}
        <div className="flex flex-col items-center py-6">
          <div className="w-24 h-24 bg-gray-200 rounded-full border-4 border-white shadow-md overflow-hidden relative">
            {profile?.photoUrl ? (
               <img src={profile.photoUrl} alt="User" className="w-full h-full object-cover" />
            ) : (
               <div className="w-full h-full flex items-center justify-center text-gray-400">
                 <BsCameraFill size={24} />
               </div>
            )}
          </div>
          <h2 className="mt-3 text-xl font-bold text-gray-800">
            {profile?.firstName} {profile?.lastName}
          </h2>
          <div className="flex items-center gap-1 text-green-500 text-[10px] font-bold uppercase tracking-widest mt-1">
            <BsShieldCheck size={12} /> Verified Profile
          </div>
        </div>

        {/* Info Grid */}
        <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100 space-y-4">
          <InfoItem label="Email Address" value={profile?.email} />
          <InfoItem label="Phone Number" value={profile?.phone || 'Not provided'} />
          <InfoItem label="Date of Birth" value={profile?.dob} />
          <InfoItem label="Gender" value={profile?.gender} className="capitalize" />
          <InfoItem label="Location" value={`${profile?.city}, ${profile?.state}`} />
        </div>

        <button 
          onClick={() => navigate('/user/dashboard')}
          className="w-full bg-blue-600 text-white py-4 rounded-xl font-black text-xs uppercase tracking-widest shadow-lg shadow-blue-100"
        >
          Return to Dashboard
        </button>
      </div>
    </div>
  );
};

// Helper Component for cleaner code
const InfoItem = ({ label, value, className = "" }) => (
  <div className="border-b border-gray-50 pb-3 last:border-0 last:pb-0">
    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-tighter mb-1">{label}</p>
    <p className={`text-sm font-semibold text-gray-700 ${className}`}>{value || '—'}</p>
  </div>
);