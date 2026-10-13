# Browser demo

A standalone Tiptap document-review demo with three synthetic examples, editable original/proposed drafts, rich-text formatting controls, grouped accept/reject decisions, undo, and final-document JSON download.

## Develop

Tested with Node.js 24 and pnpm 11.25.0. From the package root:

```sh
pnpm install --ignore-scripts
pnpm dev
```

Open `http://localhost:5173`.

## Build and share

```sh
pnpm build:demo
```

The output is `demo-dist/index.html`, a self-contained file with its JavaScript and CSS included. Open it directly in a browser, send it as a file, or upload it to static hosting. No backend, account, API key, CDN, or build runtime is needed by the finished demo.

For a local production preview:

```sh
pnpm preview:demo
```

## Verify

```sh
pnpm test
pnpm build
pnpm smoke
pnpm build:demo
pnpm exec playwright install chromium
pnpm test:browser
```

The browser tests run against the generated standalone build, including download contents, stale-review protection after draft edits, formatting preservation, mixed decisions, undo, scenario switching, and mobile layout.

## Behavior

The Review tab displays the real engine output. Replacements are resolved as complete decision groups; accepting one side and leaving its counterpart pending would be unsafe. The sidebar focuses and resolves those groups using the extracted transaction operations.

Changing either draft marks the current comparison as stale. Compare drafts again to start a fresh review. Download becomes available only after all groups are resolved. The JSON inspector remains available for pending change wrappers.

This demo compares draft snapshots. It uses the engine's existing editor schema and bounded-input rules. Unsupported edits show an error and leave the source drafts available for adjustment. The examples are synthetic, and edits are held in browser memory without uploads or persistence.

API references: [Tiptap vanilla JavaScript](https://tiptap.dev/docs/editor/getting-started/install/vanilla-javascript), [Vite](https://vite.dev/guide/), [Playwright tests](https://playwright.dev/docs/writing-tests).
