import { createContext, useState, useContext, useEffect } from 'react';

const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
  const [token, setTokenState] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

  // We use a custom setter to manage the token
  const setToken = (newToken, slug = 'default') => {
    setTokenState(newToken);
    if (newToken) {
      localStorage.setItem(`zing_token_${slug}`, newToken);
    } else {
      localStorage.removeItem(`zing_token_${slug}`);
    }
  };

  // On load, we try to recover the token based on the slug if we know it
  // Since we don't know the slug at the provider level, we keep the state clean
  useEffect(() => {
    setIsLoading(false);
  }, []);

  return (
    <AuthContext.Provider value={{ token, setToken, isLoading }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);