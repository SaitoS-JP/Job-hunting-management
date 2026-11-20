/* Header panels: stage template and backup. */
import { $ } from "./html.js";
import { defineEditor, renderEditor, editorOp } from "./stage-editor.js";
import { DEFAULT_STAGES, cloneStages, checkStages, normalize } from "../model.js";
import { fmtFull, ymd } from "../dates.js";
import { serializeBackup, validateBackup, planImport, MAX_FILE_BYTES } from "../backup.js";
import { getIconBlob } from "../store.js";
import { encryptBackup, decryptBackup, isEncryptedEnvelope, checkEnvelope, passwordStrength, MIN_PASSWORD } from "../crypto-backup.js";

export function initTemplatePanel(app) {
  const { S } = app;
  defineEditor("tpl", { box: "tpl-editor", err: "tpl-err", get: () => S.tplDraft, set: (a) => { S.tplDraft = a; } });
  function open(show) {
    $("tpl-panel").hidden = !show;
    $("btn-tpl").setAttribute("aria-expanded", String(show));
    $("tpl-err").textContent = ""; $("tpl-msg").textContent = "";
    if (show) { S.tplDraft = cloneStages(S.template); renderEditor("tpl"); $("tpl-panel").scrollIntoView({ block: "nearest" }); }
  }
  $("btn-tpl").addEventListener("click", () => open($("tpl-panel").hidden));
  $("btn-tpl-close").addEventListener("click", () => { open(false); $("btn-tpl").focus(); });
  $("btn-tpl-add").addEventListener("click", () => editorOp("tpl", "add", 0));
  $("btn-tpl-reset").addEventListener("click", () => {
    S.tplDraft = cloneStages(DEFAULT_STAGES); renderEditor("tpl");
    $("tpl-err").textContent = ""; $("tpl-msg").textContent = "初期状態の8段階に戻しました。「保存」で確定します。";
  });
  $("btn-tpl-save").addEventListener("click", async () => {
    const r = checkStages(S.tplDraft);
    if (r.error) { $("tpl-err").textContent = r.error; return; }
    try {
      await app.serial(() => app.store().putSetting("template", { stages: r.stages }));
      S.template = r.stages; S.tplDraft = cloneStages(r.stages);
      renderEditor("tpl"); app.notifyOthers(); app.render();
      $("tpl-msg").textContent = "保存しました。これから追加する企業に使われます。";
    } catch (e) { $("tpl-err").textContent = app.errText(e); }
  });
}

function blobToDataURL(b) {
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error); r.readAsDataURL(b); });
}

export function initBackupPanel(app) {
  const { S } = app;
  const msg = (t) => { $("backup-msg").textContent = t; };
  const showErrors = (list) => {
    const ul = $("backup-errors");
    ul.replaceChildren(...list.slice(0, 8).map((t) => Object.assign(document.createElement("li"), { textContent: t })));
    if (list.length > 8) ul.append(Object.assign(document.createElement("li"), { textContent: `ほか ${list.length - 8} 件` }));
    ul.hidden = !list.length;
  };
  function resetUnlock() { S.pendingEnvelope = null; $("bk-unlock").hidden = true; $("bk-unlock-pw").value = ""; $("bk-unlock-msg").textContent = ""; }
  function resetImport() { S.pendingImport = null; $("import-confirm").hidden = true; $("backup-file").value = ""; resetUnlock(); }

  /* ---- password protection (optional) ---- */
  const locked = () => $("bk-lock").checked;
  function clearPasswords() { $("bk-pw").value = ""; $("bk-pw2").value = ""; $("bk-pw-strength").textContent = ""; }
  $("bk-lock").addEventListener("change", () => {
    $("bk-lock-box").hidden = !locked();
    if (locked()) $("bk-pw").focus(); else clearPasswords();
  });
  $("bk-pw2").addEventListener("input", () => msg(""));
  $("bk-pw").addEventListener("input", () => {
    msg("");
    const st = passwordStrength($("bk-pw").value);
    const el = $("bk-pw-strength");
    el.textContent = $("bk-pw").value ? `強さ：${st.text}` : "";
    el.dataset.level = String(st.level);
  });
  $("bk-pw-show").addEventListener("click", () => {
    const show = $("bk-pw-show").getAttribute("aria-pressed") !== "true";
    for (const id of ["bk-pw", "bk-pw2"]) $(id).type = show ? "text" : "password";
    $("bk-pw-show").setAttribute("aria-pressed", String(show));
    $("bk-pw-show").textContent = show ? "隠す" : "表示";
  });

  let exporting = false;
  async function exportBackup() {
    if (exporting) return;
    let password = "";
    if (locked()) {
      password = $("bk-pw").value;
      if (password.length < MIN_PASSWORD) { msg(`パスワードは${MIN_PASSWORD}文字以上にしてください。`); $("bk-pw").focus(); return; }
      if (password !== $("bk-pw2").value) { msg("確認用のパスワードが一致しません。"); $("bk-pw2").focus(); return; }
    }
    const btns = ["btn-export", "btn-import-export"].map($);
    exporting = true; btns.forEach((b) => { b.disabled = true; });
    try {
      const store = app.store();
      const companies = (await store.all()).map((r) => normalize(r, r.id));
      const icons = {};
      for (const c of companies) {
        if (!c.iconId) continue;
        const b = await getIconBlob(store, c.iconId).catch(() => null);
        if (b) icons[c.iconId] = await blobToDataURL(b);
      }
      const payload = serializeBackup({ companies, template: S.template, icons });
      let text = JSON.stringify(payload, null, 1);
      let name = `shukatsu-backup-${ymd(new Date())}.json`;
      if (password) {
        msg("暗号化しています…（数秒かかることがあります）");
        await new Promise((r) => setTimeout(r, 30)); // let the message paint first
        text = JSON.stringify(await encryptBackup(JSON.stringify(payload), password));
        name = `shukatsu-backup-${ymd(new Date())}-locked.json`;
        password = ""; clearPasswords();
      }
      const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
      const a = document.createElement("a");
      a.href = url; a.download = name;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      msg(`${companies.length} 社分を${name.includes("-locked") ? "パスワード付きで" : ""}書き出しました。`);
      const at = new Date().toISOString();
      await app.store().putSetting("lastBackupAt", at).catch(() => {});
      S.lastBackupAt = at; app.render();
    } catch (e) { msg("書き出しに失敗しました。" + (e && e.code === "no-crypto" ? e.message : "")); }
    finally { exporting = false; btns.forEach((b) => { b.disabled = false; }); }
  }

  async function readBackup(file) {
    resetImport(); showErrors([]);
    if (file.size > MAX_FILE_BYTES) { msg("ファイルが大きすぎます。"); return; }
    let text;
    try { text = await file.text(); } catch (e) { msg("ファイルを読めませんでした。"); return; }
    let parsed = null;
    try { parsed = JSON.parse(text); } catch (e) { parsed = null; }
    if (isEncryptedEnvelope(parsed)) {
      const errs = checkEnvelope(parsed);
      if (errs.length) { msg("このファイルは読み込めません。データは変更していません。"); showErrors(errs); $("backup-file").value = ""; return; }
      S.pendingEnvelope = parsed;
      // avoid two password areas on screen: fold the export-side password fields
      if ($("bk-lock").checked) { $("bk-lock").checked = false; $("bk-lock-box").hidden = true; clearPasswords(); }
      $("bk-unlock").hidden = false;
      msg("パスワード付きのファイルです。下の欄にパスワードを入れて「開く」を押してください。");
      // iOS does not scroll to a field focused after the file picker closes
      $("bk-unlock").scrollIntoView({ block: "center", behavior: "auto" });
      $("bk-unlock-pw").focus({ preventScroll: true });
      return;
    }
    continueImport(text);
  }

  /* decrypted (or plain) text -> the usual validate -> 追加する/置き換える flow */
  function continueImport(text) {
    const v = validateBackup(text);
    if (!v.ok) {
      msg("このファイルは読み込めません。データは変更していません。");
      showErrors(v.errors);
      $("backup-file").value = "";
      return;
    }
    S.pendingImport = v;
    $("import-summary").textContent = `${v.companies.length} 社（アイコン ${v.iconCount} 件）${v.exportedAt ? `・${fmtFull(v.exportedAt)} 書き出し` : ""} のデータを読み込みます。今のデータ：${S.docs.length} 社。${v.template ? "「置き換え」では段階テンプレートもファイルの内容になります。" : ""}`;
    $("import-confirm").hidden = false; msg("");
    $("btn-import-merge").focus();
  }

  async function applyImport(mode) {
    const v = S.pendingImport; if (!v) return;
    const btns = ["btn-import-merge", "btn-import-replace", "btn-import-export"].map($);
    btns.forEach((b) => { b.disabled = true; });
    try {
      // everything (icons included) is decoded already; one transaction applies it
      const plan = planImport(v, mode, S.docs.map((c) => c.id));
      await app.serial(() => app.store().applyImport(plan));
      msg(`${plan.companies.length} 社を${mode === "replace" ? "置き換えて" : "追加して"}読み込みました。`);
      resetImport(); app.notifyOthers();
      await app.reload();
    } catch (e) {
      msg("読み込みに失敗しました。今のデータは変更されていません。" + (e && e.name === "QuotaExceededError" ? "（端末の保存容量が足りません）" : ""));
    } finally { btns.forEach((b) => { b.disabled = false; }); }
  }

  $("btn-backup").addEventListener("click", () => {
    const p = $("backup-panel"); p.hidden = !p.hidden;
    $("btn-backup").setAttribute("aria-expanded", String(!p.hidden));
    if (!p.hidden) $("btn-export").focus();
  });
  app.exportBackup = exportBackup;
  $("btn-export").addEventListener("click", exportBackup);
  $("btn-import-export").addEventListener("click", exportBackup);
  $("backup-file").addEventListener("change", (e) => { const f = e.target.files && e.target.files[0]; if (f) readBackup(f); });
  $("btn-import-merge").addEventListener("click", () => applyImport("add"));
  $("btn-import-replace").addEventListener("click", () => applyImport("replace"));
  $("btn-import-cancel").addEventListener("click", () => { resetImport(); msg(""); });
  $("bk-unlock").addEventListener("submit", async (e) => {
    e.preventDefault();
    const env = S.pendingEnvelope; if (!env) return;
    const input = $("bk-unlock-pw");
    if (!input.value) { $("bk-unlock-msg").textContent = "パスワードを入力してください。"; input.focus(); return; }
    const btn = $("btn-unlock"); btn.disabled = true;
    $("bk-unlock-msg").textContent = "パスワードを確認しています…（数秒かかることがあります）";
    await new Promise((r) => setTimeout(r, 30));
    try {
      const text = await decryptBackup(env, input.value);
      input.value = "";
      resetUnlock();
      continueImport(text);
    } catch (err) {
      input.value = "";
      $("bk-unlock-msg").textContent = err && err.code === "wrong-password" ? "パスワードが違うか、ファイルが壊れています。データは変更していません。" : (err && err.message) || "開けませんでした。";
      input.focus();
    } finally { btn.disabled = false; }
  });
  $("btn-unlock-cancel").addEventListener("click", () => { resetImport(); msg(""); });
}
