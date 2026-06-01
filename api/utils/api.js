// src/utils/api.js
export const secureFetch = async (url, token, options = {}) => {
const config = {
  ...options,
  credentials: 'include',
  headers: {
    'Content-Type': 'application/json',
    ...(token && !options.headers?.Authorization ? { 'Authorization': `Bearer ${token}` } : {}),
    ...options.headers, // Spreading last ensures user-defined headers take precedence
  },
};

  const response = await fetch(url, config);

  if (response.status === 401 || response.status === 403) {
    throw new Error('Unauthorized');
  }

  return response;
};