export const secureFetch = async (url, options = {}) => {
  // 1. Headers: Removed the 'token' argument and manual Authorization header
  const headers = {
    ...options.headers,
  };

  // 2. Only add 'application/json' if the body is NOT FormData
  if (!(options.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
  } 

  // 3. Credentials: 'include' is critical.
  // This tells the browser to send cookies (your HttpOnly token) 
  // along with requests to the same origin.
  const config = {
    ...options,
    credentials: 'include',
    headers,
  };

  const response = await fetch(url, config);

  // Return the raw response so components can handle 401/403/500 errors
  return response;
};