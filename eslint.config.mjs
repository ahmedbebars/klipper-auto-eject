// ESLint for the web page and the test runner. No build and no packages of
// our own: CI runs `npx eslint@10.13.0`. The rules are ESLint's recommended
// set, written out so nothing else needs installing.

const recommended = Object.fromEntries([
  "constructor-super", "for-direction", "getter-return", "no-async-promise-executor", "no-case-declarations",
  "no-class-assign", "no-compare-neg-zero", "no-cond-assign", "no-const-assign", "no-constant-binary-expression",
  "no-constant-condition", "no-control-regex", "no-debugger", "no-delete-var", "no-dupe-args", "no-dupe-class-members",
  "no-dupe-else-if", "no-dupe-keys", "no-duplicate-case", "no-empty", "no-empty-character-class", "no-empty-pattern",
  "no-empty-static-block", "no-ex-assign", "no-extra-boolean-cast", "no-fallthrough", "no-func-assign", "no-global-assign",
  "no-import-assign", "no-invalid-regexp", "no-irregular-whitespace", "no-loss-of-precision", "no-misleading-character-class",
  "no-new-native-nonconstructor", "no-nonoctal-decimal-escape", "no-obj-calls", "no-octal", "no-prototype-builtins",
  "no-redeclare", "no-regex-spaces", "no-self-assign", "no-setter-return", "no-shadow-restricted-names", "no-sparse-arrays",
  "no-this-before-super", "no-undef", "no-unexpected-multiline", "no-unreachable", "no-unsafe-finally", "no-unsafe-negation",
  "no-unsafe-optional-chaining", "no-unused-labels", "no-unused-private-class-members", "no-useless-backreference",
  "no-useless-catch", "no-useless-escape", "no-with", "require-yield", "use-isnan", "valid-typeof",
].map((rule) => [rule, "error"]));

const readonly = (names) => Object.fromEntries(names.map((n) => [n, "readonly"]));

// what a page has in a browser
const browser = readonly([
  "window", "document", "navigator", "location", "history", "console", "localStorage", "sessionStorage",
  "fetch", "setTimeout", "clearTimeout", "setInterval", "clearInterval", "requestAnimationFrame",
  "URL", "URLSearchParams", "Blob", "Image", "Node", "HTMLImageElement", "IntersectionObserver", "Notification",
  "WebSocket", "XMLHttpRequest", "AbortController", "TextEncoder", "TextDecoder", "atob", "btoa", "crypto",
  "getComputedStyle", "innerHeight", "innerWidth", "matchMedia", "performance", "self",
  // model.js and qr.js also load in Node for the tests (`typeof module`)
  "module",
  // the languages, from lang/*.js
  "AE_TEXT", "AE_LANGS",
]);

export default [
  {
    files: ["web/**/*.js"],
    languageOptions: { ecmaVersion: 2022, sourceType: "script", globals: browser },
    rules: { ...recommended, "no-unused-vars": ["error", { args: "none", caughtErrors: "none" }] },
  },
  {
    // the app itself is modules: each file imports what it uses from the others
    files: ["web/app.js", "web/app/**/*.js"],
    languageOptions: { sourceType: "module" },
  },
  {
    files: ["web/sw.js"],
    languageOptions: { globals: { ...browser, ...readonly(["caches", "clients", "registration", "Response"]) } },
  },
  {
    // the layout sweep: Node, and the function it sends into the page
    files: ["tests/**/*.mjs"],
    languageOptions: { ecmaVersion: 2022, sourceType: "module", globals: { ...browser, ...readonly(["process", "Buffer"]) } },
    rules: { ...recommended, "no-unused-vars": ["error", { args: "none", caughtErrors: "none" }] },
  },
  {
    files: ["tests/**/*.js"],
    languageOptions: { ecmaVersion: 2022, sourceType: "commonjs", globals: readonly(["require", "module", "process", "console", "__dirname"]) },
    rules: { ...recommended, "no-unused-vars": ["error", { args: "none", caughtErrors: "none" }] },
  },
];
