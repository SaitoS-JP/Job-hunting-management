/*
 * Password-protected backups: PBKDF2-SHA-256 → AES-GCM-256 via Web Crypto
 * (globalThis.crypto.subtle; works in browsers and Node 22). Pure: no DOM.
 *
 * Envelope (JSON):
 *   {app, format:"encrypted", version:1,
 *    kdf:{name:"PBKDF2", hash:"SHA-256", iterations, salt}, cipher:{name:"AES-GCM", iv}, data}
 * No plaintext metadata (not even the export date). The header (everything
 * but `data`) is passed to AES-GCM as additional authenticated data, so
 * changing the iteration count, salt or IV makes decryption fail.
 */
export const ENVELOPE_APP = "shukatsu-board";
export const ITERATIONS = 600000;
export const MIN_ITERATIONS = 100000;
export const MAX_ITERATIONS = 2000000;
export const MIN_PASSWORD = 8;
const SALT_BYTES = 16, IV_BYTES = 12;
const MAX_DATA_B64 = 90 * 1024 * 1024;

const subtle = () => {
  const s = globalThis.crypto && globalThis.crypto.subtle;
  if (!s) throw codeError("no-crypto", "この環境では暗号化を使えません。");
  return s;
};
function codeError(code, message) { const e = new Error(message); e.code = code; return e; }

/** base64 without building huge argument lists (chunked). */
export function bytesToBase64(u8) {
  let s = "";
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return btoa(s);
}
export function base64ToBytes(b64) {
  if (typeof b64 !== "string" || !/^[A-Za-z0-9+/]*={0,2}$/.test(b64) || b64.length % 4) throw codeError("bad-envelope", "base64 が正しくありません");
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export const isEncryptedEnvelope = (o) => !!o && typeof o === "object" && o.app === ENVELOPE_APP && o.format === "encrypted";

/** Canonical header text used as AAD (fixed key order). */
export function headerText(env) {
  return JSON.stringify({
    app: env.app, format: env.format, version: env.version,
    kdf: { name: env.kdf.name, hash: env.kdf.hash, iterations: env.kdf.iterations, salt: env.kdf.salt },
    cipher: { name: env.cipher.name, iv: env.cipher.iv },
  });
}

/** Structural checks before any expensive work; returns error strings. */
export function checkEnvelope(env) {
  const errs = [];
  if (!isEncryptedEnvelope(env)) return ["パスワード付きのバックアップファイルではありません。"];
  if (env.version !== 1) errs.push("対応していない形式のファイルです。アプリを最新にしてください。");
  const k = env.kdf || {}, c = env.cipher || {};
  if (k.name !== "PBKDF2" || k.hash !== "SHA-256") errs.push("鍵の作り方が対応していない形式です。");
  if (!Number.isInteger(k.iterations) || k.iterations < MIN_ITERATIONS || k.iterations > MAX_ITERATIONS) errs.push("鍵の設定（繰り返し回数）が範囲外です。");
  if (c.name !== "AES-GCM") errs.push("暗号の方式が対応していない形式です。");
  try { if (base64ToBytes(k.salt).length !== SALT_BYTES) errs.push("ファイルが壊れています（salt）。"); } catch (e) { errs.push("ファイルが壊れています（salt）。"); }
  try { if (base64ToBytes(c.iv).length !== IV_BYTES) errs.push("ファイルが壊れています（iv）。"); } catch (e) { errs.push("ファイルが壊れています（iv）。"); }
  if (typeof env.data !== "string" || !env.data || env.data.length > MAX_DATA_B64) errs.push("ファイルが壊れています（データ）。");
  return errs;
}

async function deriveKey(password, salt, iterations, usage) {
  const s = subtle();
  const base = await s.importKey("raw", new TextEncoder().encode(String(password)), "PBKDF2", false, ["deriveKey"]);
  return s.deriveKey({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, base, { name: "AES-GCM", length: 256 }, false, [usage]);
}

/** Encrypt the backup JSON text. Options are for tests (fixed salt/iv, fewer iterations). */
export async function encryptBackup(plainText, password, { iterations = ITERATIONS, salt, iv } = {}) {
  if (String(password || "").length < MIN_PASSWORD) throw codeError("weak-password", `パスワードは${MIN_PASSWORD}文字以上にしてください。`);
  const rnd = (n) => globalThis.crypto.getRandomValues(new Uint8Array(n));
  salt = salt || rnd(SALT_BYTES); iv = iv || rnd(IV_BYTES);
  const env = {
    app: ENVELOPE_APP, format: "encrypted", version: 1,
    kdf: { name: "PBKDF2", hash: "SHA-256", iterations, salt: bytesToBase64(salt) },
    cipher: { name: "AES-GCM", iv: bytesToBase64(iv) },
  };
  const key = await deriveKey(password, salt, iterations, "encrypt");
  const ct = await subtle().encrypt({ name: "AES-GCM", iv, additionalData: new TextEncoder().encode(headerText(env)) }, key, new TextEncoder().encode(plainText));
  return { ...env, data: bytesToBase64(new Uint8Array(ct)) };
}

/** Decrypt; throws {code:"bad-envelope"} for structural problems and {code:"wrong-password"} otherwise. */
export async function decryptBackup(env, password) {
  const errs = checkEnvelope(env);
  if (errs.length) throw codeError("bad-envelope", errs[0]);
  const salt = base64ToBytes(env.kdf.salt), iv = base64ToBytes(env.cipher.iv), data = base64ToBytes(env.data);
  const key = await deriveKey(password, salt, env.kdf.iterations, "decrypt");
  try {
    const pt = await subtle().decrypt({ name: "AES-GCM", iv, additionalData: new TextEncoder().encode(headerText(env)) }, key, data);
    return new TextDecoder("utf-8", { fatal: true }).decode(pt);
  } catch (e) {
    throw codeError("wrong-password", "パスワードが違うか、ファイルが壊れています。");
  }
}

/** Rough strength hint from length and character variety (no word lists). */
export function passwordStrength(pw) {
  const s = String(pw || "");
  const len = Array.from(s).length;
  const kinds = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((re) => re.test(s)).length;
  if (len < MIN_PASSWORD) return { ok: false, level: 0, text: `${MIN_PASSWORD}文字以上にしてください（いま ${len}文字）` };
  let level = 1;
  if (len >= 12 && kinds >= 2) level = 2;
  if ((len >= 16 && kinds >= 2) || (len >= 12 && kinds >= 3)) level = 3;
  const text = ["", "弱め：12文字以上にして、英大文字・小文字・数字・記号をまぜると強くなります", "ふつう：もう少し長くするか、文字の種類を増やすとより安心です", "強い"][level];
  return { ok: true, level, text };
}
