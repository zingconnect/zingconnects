import { createContext, useState, useContext, useEffect } from 'react';

const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
  const [token, setTokenState] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

  // 1. Eagerly hydrate from the SPECIFIC active slug
  useEffect(() => {
    const activeSlug = localStorage.getItem('zing_active_slug');
    if (activeSlug) {
      const savedToken = localStorage.getItem(`zing_token_${activeSlug}`);
      setTokenState(savedToken);
    }
    setIsLoading(false);
  }, []);

  // 2. Listen for cross-tab updates
  useEffect(() => {
    const handleStorageChange = (e) => {
      // Only react if the active slug or the active token changed
      if (e.key === 'zing_active_slug' || e.key === `zing_token_${localStorage.getItem('zing_active_slug')}`) {
        setTokenState(localStorage.getItem(`zing_token_${localStorage.getItem('zing_active_slug')}`));
      }
    };
    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, []);

  // 3. Updated setToken to manage the pointer
  const setToken = (newToken, slug = 'default') => {
    if (newToken) {
      localStorage.setItem('zing_active_slug', slug);
      localStorage.setItem(`zing_token_${slug}`, newToken);
      setTokenState(newToken);
    } else {
      // Clear specific session
      const activeSlug = localStorage.getItem('zing_active_slug');
      if (activeSlug) localStorage.removeItem(`zing_token_${activeSlug}`);
      localStorage.removeItem('zing_active_slug');
      setTokenState(null);
    }
  };

  return (
    <AuthContext.Provider value={{ token, setToken, isLoading }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);