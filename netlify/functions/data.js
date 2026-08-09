const { getStore } = require("@netlify/blobs");

const HEADERS = {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
};

function getBlobStore() {
      // Prefer explicit siteID/token (set as BLOBS_SITE_ID / BLOBS_TOKEN env vars)
  // because automatic environment configuration has been unreliable on this site.
  if (process.env.BLOBS_SITE_ID && process.env.BLOBS_TOKEN) {
          return getStore({
                    name: "icc-dashboard",
                    siteID: process.env.BLOBS_SITE_ID,
                    token: process.env.BLOBS_TOKEN,
          });
  }
      return getStore("icc-dashboard");
}

exports.handler = async (event) => {
      if (event.httpMethod === "OPTIONS") {
              return { statusCode: 204, headers: HEADERS, body: "" };
      }

      try {
              const store = getBlobStore();

        if (event.httpMethod === "GET") {
                  const data = await store.get("state", { type: "json" });
                  return { statusCode: 200, headers: HEADERS, body: JSON.stringify(data || {}) };
        }

        if (event.httpMethod === "POST") {
                  const incoming = JSON.parse(event.body || "{}");
                  const current = (await store.get("state", { type: "json" })) || {};
                  const merged = { ...current, ...incoming };
                  await store.setJSON("state", merged);
                  return {
                              statusCode: 200,
                              headers: HEADERS,
                              body: JSON.stringify({ ok: true, totalEditedItems: Object.keys(merged).length }),
                  };
        }

        return { statusCode: 405, headers: HEADERS, body: JSON.stringify({ ok: false, error: "Method not allowed" }) };
      } catch (err) {
              return { statusCode: 500, headers: HEADERS, body: JSON.stringify({ ok: false, error: err.message }) };
      }
};
