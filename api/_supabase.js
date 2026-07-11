// Shared helper for server-side Supabase REST calls using the service_role
// key. Never import this from anything that ships to the browser.

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

async function supabaseRequest(path, options = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
      Prefer: options.prefer || "return=representation",
      ...options.headers,
    },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Supabase ${options.method || "GET"} ${path} failed: ${res.status} ${body}`);
  }

  if (res.status === 204) return null;
  return res.json();
}

module.exports = { supabaseRequest };
