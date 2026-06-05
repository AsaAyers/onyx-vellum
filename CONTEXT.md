# Domain Glossary

- **incomplete task alert**: the alert-mode view of task files, used to decide whether a file should trigger a nudge.
- **alertIf**: optional frontmatter filter on the current file. The value is a compact comparison expression with no spaces, using `<=`, `>=`, or `==`.
- **alertThreshold**: optional frontmatter number on the current file that controls how many qualifying tasks are required before the file triggers an alert. If omitted, it defaults to `1`.
- **qualifying task**: an unchecked task that matches the file's alert conditions and is counted toward `alertThreshold`.
- **priority**: a separate frontmatter concern that affects alert presentation, not whether the file triggers at all.
