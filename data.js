const { getStore } = require("@netlify/blobs");

const HEADERS = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: HEADERS, body: "" };
  }

  const store = getStore("icc-dashboard");

  try {
    if (event.httpMethod === "GET") {
      const data = await store.get("state", { type: "json" });
      return { statusCode: 200, headers: HEADERS, body: JSON.stringify(data || {}) };
    }

    if (event.httpMethod === "POST") {
      const incoming = JSON.parse(event.body || "{}");
      // incoming shape: { [itemKey]: { status_cat, status_raw, pending, dept, est, contractor, editedAt } }
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
