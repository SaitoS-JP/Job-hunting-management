import test from "node:test";
import assert from "node:assert/strict";
import {
  encryptBackup, decryptBackup, isEncryptedEnvelope, checkEnvelope, bytesToBase64, base64ToBytes,
  passwordStrength, headerText, MIN_ITERATIONS, MAX_ITERATIONS, ITERATIONS,
} from "../js/crypto-backup.js";

const FAST = { iterations: MIN_ITERATIONS }; // keep tests quick; the app uses 600000
const PLAIN = JSON.stringify({ app: "shukatsu-board", version: 6, companies: [{ name: "サンプル商事", memo: "𠮷野家👍" }] });

test("roundtrip with the default iteration count", async () => {
  const env = await encryptBackup(PLAIN, "correct horse 9!");
  assert.equal(env.kdf.iterations, ITERATIONS);
  assert.equal(await decryptBackup(env, "correct horse 9!"), PLAIN);
});
test("envelope carries no plaintext data", async () => {
  const env = await encryptBackup(PLAIN, "password-123", FAST);
  const text = JSON.stringify(env);
  assert.ok(isEncryptedEnvelope(env));
  assert.ok(!text.includes("サンプル商事") && !text.includes("companies") && !text.includes("exportedAt"));
  assert.deepEqual(Object.keys(env).sort(), ["app", "cipher", "data", "format", "kdf", "version"]);
  assert.equal(base64ToBytes(env.kdf.salt).length, 16);
  assert.equal(base64ToBytes(env.cipher.iv).length, 12);
  const again = await encryptBackup(PLAIN, "password-123", FAST);
  assert.notEqual(again.kdf.salt, env.kdf.salt); // fresh salt and IV each time
  assert.notEqual(again.data, env.data);
});
test("wrong password fails", async () => {
  const env = await encryptBackup(PLAIN, "password-123", FAST);
  await assert.rejects(decryptBackup(env, "password-124"), (e) => e.code === "wrong-password");
});
test("tampered data, iv or header fails", async () => {
  const env = await encryptBackup(PLAIN, "password-123", FAST);
  const d = base64ToBytes(env.data); d[5] ^= 1;
  await assert.rejects(decryptBackup({ ...env, data: bytesToBase64(d) }, "password-123"), (e) => e.code === "wrong-password");
  const iv = base64ToBytes(env.cipher.iv); iv[0] ^= 1;
  await assert.rejects(decryptBackup({ ...env, cipher: { ...env.cipher, iv: bytesToBase64(iv) } }, "password-123"), (e) => e.code === "wrong-password");
  // the header is authenticated: a different (still valid) iteration count is rejected too
  await assert.rejects(decryptBackup({ ...env, version: 1, kdf: { ...env.kdf, iterations: MIN_ITERATIONS + 1 } }, "password-123"), (e) => e.code === "wrong-password");
  assert.notEqual(headerText(env), headerText({ ...env, kdf: { ...env.kdf, iterations: 1 } }));
});
test("envelope detection and bounds checks before deriving keys", async () => {
  assert.equal(isEncryptedEnvelope({ app: "shukatsu-board", version: 6, companies: [] }), false);
  assert.equal(isEncryptedEnvelope(null), false);
  const env = await encryptBackup(PLAIN, "password-123", FAST);
  assert.deepEqual(checkEnvelope(env), []);
  assert.match(checkEnvelope({ ...env, kdf: { ...env.kdf, iterations: MAX_ITERATIONS + 1 } })[0], /範囲外/);
  assert.match(checkEnvelope({ ...env, kdf: { ...env.kdf, iterations: 1000 } })[0], /範囲外/);
  assert.ok(checkEnvelope({ ...env, cipher: { name: "AES-CBC", iv: env.cipher.iv } }).length);
  assert.ok(checkEnvelope({ ...env, kdf: { ...env.kdf, salt: "!!!" } }).length);
  assert.ok(checkEnvelope({ ...env, data: "" }).length);
  assert.ok(checkEnvelope({ ...env, version: 2 }).length);
  await assert.rejects(decryptBackup({ ...env, kdf: { ...env.kdf, iterations: 5e9 } }, "x"), (e) => e.code === "bad-envelope");
  await assert.rejects(encryptBackup(PLAIN, "short"), (e) => e.code === "weak-password");
});
test("base64 helpers handle large data without stack overflow", () => {
  const big = new Uint8Array(5 * 1024 * 1024);
  for (let i = 0; i < big.length; i += 997) big[i] = i & 255;
  const b64 = bytesToBase64(big);
  assert.equal(b64, Buffer.from(big).toString("base64"));
  assert.deepEqual(base64ToBytes(b64).subarray(0, 4000), big.subarray(0, 4000));
  assert.equal(base64ToBytes(b64).length, big.length);
  assert.throws(() => base64ToBytes("abc"), (e) => e.code === "bad-envelope");
});
test("password strength hint", () => {
  assert.equal(passwordStrength("abc").ok, false);
  assert.equal(passwordStrength("abcdefgh").level, 1);
  assert.equal(passwordStrength("abcdefgh1234").level, 2);
  assert.equal(passwordStrength("Abcdefgh123!").level, 3);
  assert.equal(passwordStrength("あいうえおかきくけこさしすせそた").level, 1); // one kind only
});
