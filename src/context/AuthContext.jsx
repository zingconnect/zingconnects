import { createContext, useState, useContext, useEffect } from 'react';

const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
  const [token, setTokenState] = useState(() => {
    const activeSlug = localStorage.getItem('zing_active_slug');
    return activeSlug ? localStorage.getItem(`zing_token_${activeSlug}`) : null;
  });

  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    const handleStorageChange = (e) => {
      const activeSlug = localStorage.getItem('zing_active_slug');
      if (e.key === 'zing_active_slug' || e.key === `zing_token_${activeSlug}`) {
        setTokenState(localStorage.getItem(`zing_token_${activeSlug}`));
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