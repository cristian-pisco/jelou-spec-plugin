# Workflow: production-like (DEPRECATED alias)

> This is the DEPRECATED `/jlu-production-like` alias. Real logic lives in `jelou/workflows/goal.md`.

---

## Step 1 — Print deprecation notice

Print exactly:

⚠️ `/jlu-production-like` is deprecated and now runs `/jlu-goal`. Please use `/jlu-goal` going forward.

## Step 2 — Delegate to goal

Resolve and execute `jelou/workflows/goal.md` using the same lookup order the caller used for this file (global install first, then project-local) — passing through the same argument, plugin root, and cwd.
