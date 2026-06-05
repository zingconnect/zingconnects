// utils/api.js

const BASE_URL = import.meta.env.VITE_API_URL || '';

export const secureFetch = async (endpoint, options = {}) => {
  const defaultHeaders = {
    'Content-Type': 'application/json',
  };

  const config = {
    ...options,
    headers: {
      ...defaultHeaders,
      ...options.headers,
    },
    // This is the critical part for HttpOnly cookies
    credentials: 'include',
  };

  const response = await fetch(`${BASE_URL}${endpoint}`, config);

  // If the server returns 403, it means the session is invalid or missing
  if (response.status === 403) {
    console.warn('Session expired or forbidden.');
    // Optional: Trigger a global logout or redirect here
  }

  return response;
};