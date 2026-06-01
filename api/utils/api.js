// src/utils/api.js
export const secureFetch = async (url, token, options = {}) => {
  // 1. Create base headers
  const headers = {
    ...(token && !options.headers?.Authorization ? { 'Authorization': `Bearer ${token}` } : {}),
    ...options.headers,
  };

  // 2. Only add 'application/json' if the body is NOT FormData
  if (!(options.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
  } 
  // Note: If options.body IS FormData, we leave 'Content-Type' completely undefined.
  // This lets the browser auto-generate the correct 'multipart/form-data; boundary=...' header.

  const config = {
    ...options,
    credentials: 'include',
    headers,
  };

  const response = await fetch(url, config);

  // 🛡️ FIX: Instead of throwing an error and crashing the runtime flow,
  // we just return the raw response object. This allows components to read 
  // response.status (401, 403) and inspect custom error JSON bodies safely.
  return response;
};