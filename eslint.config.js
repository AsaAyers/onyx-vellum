// @ts-check
import tseslint from "typescript-eslint";

export default tseslint.config(
  // Base TypeScript rules
  ...tseslint.configs.recommended,

  {
    files: ["src/**/*.ts", "tests/**/*.ts"],
    rules: {
      // Block barrel re-exports: developers must import directly from the
      // source file rather than going through an index.ts re-export layer.
      "no-restricted-syntax": [
        "error",
        {
          selector: "ExportAllDeclaration",
          message:
            "Barrel re-exports (export * from) are not allowed. Import directly from the source file.",
        },
        {
          selector: "ExportNamedDeclaration[source!=null]",
          message:
            "Barrel re-exports (export { X } from) are not allowed. Import directly from the source file.",
        },
      ],
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
        },
      ],
      "@typescript-eslint/no-this-alias": ["off"],
    },
  },

  {
    // Exclude compiled output and dependencies
    ignores: ["dist/**", "node_modules/**"],
  },
);
