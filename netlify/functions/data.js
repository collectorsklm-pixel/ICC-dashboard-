const { getStore } = require("@netlify/blobs");

const HEADERS = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function getBlobStore() {
  if (process.env.BLOBS_SITE_ID && process.env.BLOBS_TOKEN) {
    return getStore({
      name: "icc-dashboard",
      siteID: process.env.BLOBS_SITE_ID,
      token: process.env.BLOBS_TOKEN,
    });
  }
  return getStore("icc-dashboard");
}

// Normalizes whatever is currently stored into { edits, additions, deletions }.
// Handles the OLD flat "{ [itemKey]: {fields} }" shape (what this endpoint stored
// before add/delete existed) by treating it as pure edits — no migration needed.
function normalize(raw) {
  if (!raw || typeof raw !== "object") return { edits: {}, additions: [], deletions: [] };
  if (raw.edits || raw.additions || raw.deletions) {
    return {
      edits: raw.edits || {},
      additions: Array.isArray(raw.additions) ? raw.additions : [],
      deletions: Array.isArray(raw.deletions) ? raw.deletions : [],
    };
  }
  return { edits: raw, additions: [], deletions: [] };
}

function itemKeyOf(it) {
  return `${it.source || ""}|||${it.area || ""}|||${it.item || ""}`;
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
      const rawIncoming = JSON.parse(event.body || "{}");
      // Backward-compat: a stale cached page (old service-worker app-shell copy) might still
      // POST the old flat "{ [itemKey]: {fields} }" shape. Detect and treat it as pure edits.
      const incoming = (rawIncoming.edits || rawIncoming.additions || rawIncoming.deletions)
        ? rawIncoming
        : { edits: rawIncoming };
      const current = normalize(await store.get("state", { type: "json" }));

      // Merge deletions first (union of key sets).
      const deletionSet = new Set(current.deletions);
      (incoming.deletions || []).forEach((k) => deletionSet.add(k));

      // Merge additions, deduped by item key — a later addition with the same key
      // overwrites an earlier one (e.g. someone re-adding after editing locally).
      const additionsMap = new Map(current.additions.map((a) => [itemKeyOf(a), a]));
      (incoming.additions || []).forEach((a) => additionsMap.set(itemKeyOf(a), a));

      // Merge edits (simple spread — same behaviour as before).
      const edits = { ...current.edits, ...(incoming.edits || {}) };

      // Purge anything that's now deleted from both edits and additions, so a
      // delete cleanly removes the item from shared state rather than leaving
      // stale data that could resurrect it on a later pull.
      deletionSet.forEach((key) => {
        delete edits[key];
        additionsMap.delete(key);
      });

      const merged = {
        edits,
        additions: Array.from(additionsMap.values()),
        deletions: Array.from(deletionSet),
      };

      await store.setJSON("state", merged);
      return {
        statusCode: 200,
        headers: HEADERS,
        body: JSON.stringify({
          ok: true,
          totalEditedItems: Object.keys(merged.edits).length,
          totalAdditions: merged.additions.length,
          totalDeletions: merged.deletions.length,
        }),
      };
    }

    return { statusCode: 405, headers: HEADERS, body: JSON.stringify({ ok: false, error: "Method not allowed" }) };
  } catch (err) {
    return { statusCode: 500, headers: HEADERS, body: JSON.stringify({ ok: false, error: err.message }) };
  }
};
