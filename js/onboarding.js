/* はじめかた checklist and tour step logic. Pure: no DOM. */

/**
 * Steps of the getting-started checklist, evaluated from real data.
 * Sample rows (example: true) never count.
 */
export function onboardingSteps({ companies = [], lastBackupAt = "", ios = false, standalone = false } = {}) {
  const own = companies.filter((c) => !c.example);
  return [
    { id: "add", done: own.length > 0 },
    { id: "event", done: own.some((c) => (c.events || []).length > 0) },
    { id: "advance", done: own.some((c) => (c.history || []).length >= 2) },
    { id: "protect", done: !!lastBackupAt, installHint: ios && !standalone },
  ];
}
export function onboardingProgress(steps) {
  const done = steps.filter((s) => s.done).length;
  return { done, total: steps.length, all: done === steps.length, ratio: steps.length ? done / steps.length : 0 };
}
/**
 * Whether the checklist card is shown.
 * - forced: reopened from the menu (shown even when finished or closed)
 * - dismissed: the user closed it
 * - doneSeen: it was already shown once in the finished state (then it goes away)
 */
export function checklistVisible({ all, dismissed = false, doneSeen = false, forced = false }) {
  if (forced) return true;
  if (dismissed) return false;
  return !(all && doneSeen);
}
/** The own company the 予定 step should open: the most recently updated one. */
export function latestOwnCompany(companies = []) {
  return companies.filter((c) => !c.example)
    .slice().sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")))[0] || null;
}
/** Tour steps whose target exists on the page; steps without a target always stay. */
export function tourStepsFor(steps, exists) {
  return steps.filter((s) => !s.target || exists(s.target));
}
