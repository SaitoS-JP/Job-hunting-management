import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Release consistency: the version shown in the app (使い方) matches the newest
// CHANGELOG entry, so testers can report which version they used.
test("app version in index.html matches the latest CHANGELOG entry", () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const log = readFileSync(new URL("../CHANGELOG.md", import.meta.url), "utf8");
  const shown = /バージョン (\d+\.\d+\.\d+)/.exec(html);
  const latest = /^## (\d+\.\d+\.\d+)/m.exec(log);
  assert.ok(shown && latest);
  assert.equal(shown[1], latest[1]);
});
