// src/utils/api.js
export const secureFetch = async (url, token, options = {}) => {
  if (!token) throw new Error('No token provided');

  const config = {
    ...options,
    headers: {
      ...options.headers,
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  };

  const response = await fetch(url, config);

  // Centralized Error Handling
  if (response.status === 401 || response.status === 403) {
    throw new Error('Unauthorized');
  }

  return response;
};