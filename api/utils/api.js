// utils/api.js
const BASE_URL = import.meta.env.VITE_API_URL || 'https://www.zingconnect.chat';

export const secureFetch = async (endpoint, options = {}) => {
  // 🛡️ SMART URL GUARD: 
  // If the endpoint already starts with 'http', use it as-is.
  // Otherwise, safely join the BASE_URL and the endpoint.
  const isAbsolute = endpoint.startsWith('http://') || endpoint.startsWith('https://');
  const url = isAbsolute ? endpoint : `${BASE_URL}${endpoint.startsWith('/') ? '' : '/'}${endpoint}`;

  const config = {
    ...options,
    redirect: 'manual', 
    credentials: 'include',
    headers: {
      // Don't auto-set Content-Type if the body is FormData (browser needs to set boundary)
      ...(!(options.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers,
    },
  };

  const response = await fetch(url, config);

  // If the server tries to redirect (e.g., 302 to /pricing)
  if (response.type === 'opaqueredirect' || response.status === 302) {
    console.error("🚫 Blocked: Server attempted a redirect.");
    return new Response(JSON.stringify({ success: false, message: "Unauthorized" }), { 
        status: 401, 
        headers: { 'Content-Type': 'application/json' } 
    });
  }

  return response;
};