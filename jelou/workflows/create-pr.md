# Workflow: create-pr (DEPRECATED alias)

> This is the DEPRECATED `/jlu-create-pr` alias. Real logic lives in `jelou/workflows/ship.md`.

---

## Step 1 — Print deprecation notice

Print exactly:

⚠️ /jlu-create-pr is deprecated and now runs /jlu-ship. Please use /jlu-ship going forward.

## Step 2 — Delegate to ship

Resolve and execute `jelou/workflows/ship.md` using the same lookup order the caller used for this file (global install first, then project-local) — passing through the same argument, plugin root, and cwd.
