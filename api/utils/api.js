// utils/api.js
const BASE_URL = import.meta.env.VITE_API_URL || 'https://www.zingconnect.chat';

// utils/api.js
export const secureFetch = async (endpoint, options = {}) => {
  const config = {
    ...options,
    redirect: 'manual', // 👈 STOP automatic redirects
    credentials: 'include',
    headers: {
      ...(!options.body || !(options.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers,
    },
  };

  const response = await fetch(`${BASE_URL}${endpoint}`, config);

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