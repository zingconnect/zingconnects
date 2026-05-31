// src/utils/api.js
export const secureFetch = async (url, token, options = {}) => {
  const config = {
    ...options,
    // CRITICAL: This allows the browser to send cookies (like your 'token' cookie)
    credentials: 'include', 
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
      // Only include Bearer token if it exists; otherwise rely on cookies
      ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
    },
  };

  const response = await fetch(url, config);

  if (response.status === 401 || response.status === 403) {
    throw new Error('Unauthorized');
  }

  return response;
};