# Update Check Protocol

> Shared protocol for all `/jlu:*` skills. Run after resolving the plugin root.

## Instructions

After resolving the plugin root directory, run:

```bash
UPDATE_RESULT=$(<plugin-root>/bin/check-update.sh 2>/dev/null || echo "SKIPPED")
```

- If the output starts with `UPDATE_AVAILABLE`: print a single line to the user:

  `[jlu] v<remote> available (you have v<local>). Run: /plugin update jlu@jelou-spec-plugin`

  Do NOT use AskUserQuestion. Do NOT ask the user to decide. Just print the line and continue.

- If the output starts with `UP_TO_DATE` or `SKIPPED`: continue silently.

## Error Handling

- If `check-update.sh` does not exist: skip silently.
- If the script fails: skip silently. Never block the workflow.
