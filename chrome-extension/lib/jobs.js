// Job lifecycle: persist running + recently-finished annotate/reformat
// jobs in chrome.storage.local so the popup, the service worker, and
// the review page all see the same state.
//
// Lifecycle: pending → running → (validating →) done | error
// The bg worker writes status updates; popup + review.html listen
// via chrome.storage.onChanged.

const STORAGE_KEY = "jobs";
const CAP = 30;

export function newJobId() {
  return "j" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export async function saveJob(job) {
  const all = await loadAllJobs();
  const idx = all.findIndex((j) => j.id === job.id);
  if (idx >= 0) all[idx] = job;
  else all.unshift(job);
  await chrome.storage.local.set({ [STORAGE_KEY]: all.slice(0, CAP) });
}

export async function loadJob(id) {
  const all = await loadAllJobs();
  return all.find((j) => j.id === id) || null;
}

export async function loadAllJobs() {
  const got = await chrome.storage.local.get({ [STORAGE_KEY]: [] });
  return got[STORAGE_KEY] || [];
}

export async function loadActiveJobs() {
  const all = await loadAllJobs();
  return all.filter((j) => j.status === "pending" || j.status === "running" || j.status === "validating");
}
