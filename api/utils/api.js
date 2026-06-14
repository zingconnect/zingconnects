// utils/api.js
const BASE_URL = import.meta.env.VITE_API_URL || 'https://www.zingconnect.chat';

/**
 * Enhanced secureFetch
 * Automatically manages Content-Type, credentials, and URL construction.
 */
export const secureFetch = async (endpoint, options = {}) => {
  // 🛡️ SMART URL GUARD
  const isAbsolute = endpoint.startsWith('http://') || endpoint.startsWith('https://');
  const url = isAbsolute ? endpoint : `${BASE_URL}${endpoint.startsWith('/') ? '' : '/'}${endpoint}`;

  // Use the Headers API to manage headers dynamically
  const headers = new Headers(options.headers || {});

  // Automatically set Content-Type to JSON only if:
  // 1. No Content-Type has been manually provided
  // 2. The body is not FormData (which requires automatic boundary injection)
  if (!headers.has('Content-Type') && !(options.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }

  const config = {
    ...options,
    headers,
    redirect: 'manual',
    credentials: 'include' // Required for cookie-based authentication
  };

  const response = await fetch(url, config);

  // 🛡️ SECURITY GUARD: Block redirects (e.g., 302 to login pages)
  // This prevents unexpected UI behavior during authenticated requests
  if (response.type === 'opaqueredirect' || response.status === 302) {
    console.error("🚫 Blocked: Server attempted an unauthorized redirect.");
    return new Response(
      JSON.stringify({ success: false, message: "Unauthorized: Redirect blocked." }), 
      { 
        status: 401, 
        headers: { 'Content-Type': 'application/json' } 
      }
    );
  }

  return response;
};