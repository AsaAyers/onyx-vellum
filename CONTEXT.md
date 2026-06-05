# Domain Glossary

- **incomplete task alert**: the alert-mode view of task files, used to decide whether a file should trigger a nudge.
- **alertIf**: optional frontmatter filter on the current file. The value is a compact comparison expression with no spaces, using `<=`, `>=`, or `==`.
- **alertThreshold**: optional frontmatter number on the current file that controls how many qualifying tasks are required before the file triggers an alert. If omitted, it defaults to `1`.
- **alertSchedule**: optional frontmatter schedule for a file's alerts. In watch mode, a file with `alertSchedule` alerts only at its own times and is excluded from the global watch alert schedule.
- **qualifying task**: an unchecked task that matches the file's alert conditions and is counted toward `alertThreshold`.
- **priority**: a separate frontmatter concern that affects alert presentation, not whether the file triggers at all.
