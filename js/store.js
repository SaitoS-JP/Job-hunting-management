/* Persistence: IndexedDB with an in-memory fallback (e.g. private browsing).
   Both implement the same interface; applyImport() is all-or-nothing. */

const DB_NAME = "shukatsu-board";
const DB_VERSION = 2;
const clone = (o) => structuredClone(o);
const toBuf = (u8) => u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);

/** In-memory store. Imports build new maps and swap them in only on success. */
export function createMemoryStore() {
  let mem = { companies: new Map(), icons: new Map(), settings: new Map() };
  return {
    kind: "memory",
    async all() { return [...mem.companies.values()].map(clone); },
    async put(rec) { mem.companies.set(rec.id, clone(rec)); },
    async del(id) { mem.companies.delete(id); },
    async getSetting(key) { const v = mem.settings.get(key); return v === undefined ? undefined : clone(v); },
    async putSetting(key, value) { mem.settings.set(key, clone(value)); },
    async getIconRaw(id) { return mem.icons.get(id) || null; },
    async putIconRaw(id, v) { mem.icons.set(id, v); },
    async delIcon(id) { if (id) mem.icons.delete(id); },
    async applyImport(plan) {
      const next = {
        companies: plan.clear ? new Map() : new Map(mem.companies),
        icons: plan.clear ? new Map() : new Map(mem.icons),
        settings: new Map(mem.settings),
      };
      if (plan.template) next.settings.set("template", { stages: clone(plan.template) });
      for (const ic of plan.icons) next.icons.set(ic.id, { type: ic.type, data: toBuf(ic.bytes) });
      for (const c of plan.companies) next.companies.set(c.id, clone(c));
      mem = next; // swap only after every write succeeded
    },
  };
}

function openDB() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined" || !indexedDB) return reject(new Error("no indexedDB"));
    let req;
    try { req = indexedDB.open(DB_NAME, DB_VERSION); } catch (e) { return reject(e); }
    req.onupgradeneeded = () => {
      const d = req.result;
      if (!d.objectStoreNames.contains("companies")) d.createObjectStore("companies", { keyPath: "id" });
      if (!d.objectStoreNames.contains("icons")) d.createObjectStore("icons");
      if (!d.objectStoreNames.contains("settings")) d.createObjectStore("settings");
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error("blocked"));
  });
}

function createIdbStore(db) {
  /* One transaction; resolves only on "complete". If fn throws, the
     transaction is aborted so nothing it wrote is kept. */
  function run(stores, mode, fn) {
    return new Promise((resolve, reject) => {
      let t;
      try { t = db.transaction(stores, mode); } catch (e) { return reject(e); }
      let out; let failed = null;
      t.oncomplete = () => resolve(out);
      t.onerror = (ev) => { ev.preventDefault(); };
      t.onabort = () => reject(failed || t.error || new Error("aborted"));
      try {
        const r = fn(t);
        if (r && "onsuccess" in r) r.onsuccess = () => { out = r.result; };
      } catch (e) {
        failed = e;
        try { t.abort(); } catch (_) { reject(e); }
      }
    });
  }
  db.onversionchange = () => { try { db.close(); } catch (e) {} };
  return {
    kind: "idb",
    async all() { return (await run(["companies"], "readonly", (t) => t.objectStore("companies").getAll())) || []; },
    put: (rec) => run(["companies"], "readwrite", (t) => t.objectStore("companies").put(rec)),
    del: (id) => run(["companies"], "readwrite", (t) => t.objectStore("companies").delete(id)),
    getSetting: (key) => run(["settings"], "readonly", (t) => t.objectStore("settings").get(key)),
    putSetting: (key, value) => run(["settings"], "readwrite", (t) => t.objectStore("settings").put(value, key)),
    getIconRaw: (id) => run(["icons"], "readonly", (t) => t.objectStore("icons").get(id)),
    putIconRaw: (id, v) => run(["icons"], "readwrite", (t) => t.objectStore("icons").put(v, id)),
    delIcon: (id) => (id ? run(["icons"], "readwrite", (t) => t.objectStore("icons").delete(id)) : Promise.resolve()),
    /* Everything is prepared before the transaction opens: awaiting anything
       that is not an IndexedDB request would let it auto-commit half-way. */
    applyImport(plan) {
      const icons = plan.icons.map((ic) => ({ id: ic.id, v: { type: ic.type, data: toBuf(ic.bytes) } }));
      return run(["companies", "icons", "settings"], "readwrite", (t) => {
        const cs = t.objectStore("companies"), is = t.objectStore("icons"), ss = t.objectStore("settings");
        if (plan.clear) { cs.clear(); is.clear(); }
        if (plan.template) ss.put({ stages: plan.template }, "template");
        for (const ic of icons) is.put(ic.v, ic.id);
        for (const c of plan.companies) cs.put(c);
      });
    },
  };
}

/** IndexedDB when it can actually be written, otherwise memory. */
export async function openStore() {
  try {
    const db = await openDB();
    const s = createIdbStore(db);
    // probe a write so private modes that open-but-fail are caught early
    await s.putSetting("__probe", 1);
    await s.getSetting("__probe");
    await new Promise((res, rej) => { const t = db.transaction(["settings"], "readwrite"); t.objectStore("settings").delete("__probe"); t.oncomplete = res; t.onabort = () => rej(t.error); });
    return s;
  } catch (e) {
    return createMemoryStore();
  }
}

/* Icon values are stored as {type, data: ArrayBuffer} (avoids Blob-in-IndexedDB
   quirks on older Safari). */
export async function getIconBlob(store, id) {
  const v = await store.getIconRaw(id);
  if (!v) return null;
  if (typeof Blob !== "undefined" && v instanceof Blob) return v;
  return v.data ? new Blob([v.data], { type: v.type || "image/png" }) : null;
}
export async function putIconBlob(store, id, blob) {
  const data = await blob.arrayBuffer();
  await store.putIconRaw(id, { type: blob.type || "image/png", data });
}
