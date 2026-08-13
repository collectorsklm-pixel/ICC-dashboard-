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

// Normalizes whatever is currently stored into { edits, additions, deletions, logs }.
// Handles the OLD flat "{ [itemKey]: {fields} }" shape (what this endpoint stored
// before add/delete existed) by treating it as pure edits — no migration needed.
function normalize(raw) {
  if (!raw || typeof raw !== "object") return { edits: {}, additions: [], deletions: [], logs: [] };
  if (raw.edits || raw.additions || raw.deletions || raw.logs) {
    return {
      edits: raw.edits || {},
      additions: Array.isArray(raw.additions) ? raw.additions : [],
      deletions: Array.isArray(raw.deletions) ? raw.deletions : [],
      logs: Array.isArray(raw.logs) ? raw.logs : [],
    };
  }
  return { edits: raw, additions: [], deletions: [], logs: [] };
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
      const incoming = (rawIncoming.edits || rawIncoming.additions || rawIncoming.deletions || rawIncoming.logs)
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

      // Merge day-wise work-log entries (today's-update notes + payment ledger entries).
      // Purely additive and never edited/deleted — dedup by the entry's own id, later
      // occurrence wins (identical content in practice, this just avoids duplicates from
      // a retried POST).
      const logsMap = new Map(current.logs.map((l) => [l.id, l]));
      (incoming.logs || []).forEach((l) => { if (l && l.id) logsMap.set(l.id, l); });

      // Purge anything that's now deleted from edits and additions (but NOT from logs —
      // the day-wise log is a historical audit trail; a deleted work's past updates/payments
      // stay on the record even after the item itself is removed from the live register).
      deletionSet.forEach((key) => {
        delete edits[key];
        additionsMap.delete(key);
      });

      const merged = {
        edits,
        additions: Array.from(additionsMap.values()),
        deletions: Array.from(deletionSet),
        logs: Array.from(logsMap.values()),
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
          totalLogs: merged.logs.length,
        }),
      };
    }

    return { statusCode: 405, headers: HEADERS, body: JSON.stringify({ ok: false, error: "Method not allowed" }) };
  } catch (err) {
    return { statusCode: 500, headers: HEADERS, body: JSON.stringify({ ok: false, error: err.message }) };
  }
};
