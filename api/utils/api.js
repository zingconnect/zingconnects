// utils/api.js
const BASE_URL = import.meta.env.VITE_API_URL || 'https://www.zingconnect.chat';

export const secureFetch = async (endpoint, options = {}) => {
  // Check if the body is an instance of FormData
  const isMultipart = options.body instanceof FormData;

  const config = {
    ...options,
    headers: {
      // Only set JSON header if it's NOT a multipart request
      ...(!isMultipart && { 'Content-Type': 'application/json' }),
      ...options.headers,
    },
    credentials: 'include',
  };

  const response = await fetch(`${BASE_URL}${endpoint}`, config);

  if (response.status === 403) {
    console.warn('Session expired or forbidden.');
  }

  return response;
};