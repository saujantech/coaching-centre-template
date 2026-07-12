// Shared helper for server-side Supabase REST calls using the service_role
// key. Never import this from anything that ships to the browser.

const centreConfig = require("../public/centre.config");

const SUPABASE_URL = centreConfig.supabaseUrl;
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

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Supabase ${options.method || "GET"} ${path} failed: ${res.status} ${text}`);
  }

  return text ? JSON.parse(text) : null;
}

module.exports = { supabaseRequest };
