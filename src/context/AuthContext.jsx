import { createContext, useState, useContext, useEffect } from 'react';

const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
  // 1. Start as null so we know we are in the "loading" phase
  const [token, setTokenState] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

  // 2. Eagerly hydrate from localStorage on mount
  useEffect(() => {
    let foundToken = null;
    
    // Scan for any token key
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith('zing_token_')) {
        foundToken = localStorage.getItem(key);
        break;
      }
    }
    
    setTokenState(foundToken);
    setIsLoading(false); // Signal that check is complete
  }, []);

  const setToken = (newToken, slug = 'default') => {
    setTokenState(newToken);
    if (newToken) {
      localStorage.setItem(`zing_token_${slug}`, newToken);
    } else {
      // Clear all zing_tokens on logout
      Object.keys(localStorage).forEach(key => {
        if (key.startsWith('zing_token_')) localStorage.removeItem(key);
      });
    }
  };

  return (
    <AuthContext.Provider value={{ token, setToken, isLoading }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);