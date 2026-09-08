# Notelets

**Turn Obsidian notes into interactive mini-apps.**

<img src="https://raw.githubusercontent.com/monapdx/Notelets/refs/heads/main/banner.png">

Notelets is an Obsidian plugin for creating and importing small frontend applications directly into your vault. A Notelet is still an ordinary Markdown note, but its embedded HTML, CSS, and JavaScript can render as a working interactive interface inside Obsidian.

Import a self-contained HTML file, import an entire frontend project folder, or start from a blank Notelet template and build directly in Obsidian.

## Features

- **Create blank Notelets** with a ready-to-edit HTML/CSS/JavaScript starter template.
- **Import standalone HTML files** as interactive Obsidian notes.
- **Import frontend app folders** and preserve their local dependencies.
- **Inline local CSS and JavaScript** into the resulting Notelet.
- **Preserve interactive JavaScript behavior** including buttons, forms, drag-and-drop interfaces, dialogs, and other client-side functionality.
- **Persist `localStorage` data** through a Notelets storage bridge, so compatible mini-apps can keep their state between sessions.
- **Import referenced assets** such as GIFs, images, audio, video, and fonts into the vault.
- **Support dynamically referenced assets** such as JavaScript that later assigns `icon.src = "chores.gif"`.
- **Keep large binary assets out of Markdown.** Imported media is stored as normal vault files instead of being converted to giant base64 strings.
- **Keep the source editable.** Switch the note to Source mode whenever you want to edit the embedded application code.

## What is a Notelet?

A Notelet is a Markdown note containing a fenced `notelet` block:

````markdown
---
notelet: true
notelet-version: 1
---

```notelet
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <style>
    body {
      font-family: system-ui, sans-serif;
    }
  </style>
</head>
<body>
  <button id="hello">Click me</button>

  <script>
    document.querySelector("#hello").addEventListener("click", () => {
      alert("Hello from a Notelet!");
    });
  </script>
</body>
</html>
```
````

In Reading mode, Notelets renders that block as an interactive iframe. In Source mode, the underlying HTML, CSS, and JavaScript remain directly editable inside the note.

## Commands

Notelets currently adds three commands to Obsidian:

- **Notelets: Create new Notelet** — creates a blank starter Notelet in the `Notelets` folder and opens it in Source mode.
- **Notelets: Import HTML as Notelet** — imports a single self-contained `.html` or `.htm` file.
- **Notelets: Import app folder as Notelet** — imports a frontend app directory, bundles local text dependencies, and copies referenced binary assets into the vault.

A ribbon button is also available for importing an HTML file as a Notelet.

## Importing an app folder

Folder import is intended for small frontend projects such as:

```text
my-app/
├── index.html
├── styles.css
├── script.js
└── images/
    ├── icon.gif
    └── background.png
```

When imported, Notelets will:

1. Find the app's HTML entry file, preferring `index.html` when present.
2. Inline referenced local stylesheets into the Notelet.
3. Inline referenced local JavaScript files into the Notelet.
4. Detect referenced binary assets in HTML, CSS, and JavaScript.
5. Copy those assets into a managed vault folder.
6. Rewrite their references so they resolve correctly when the Notelet is rendered.

The result looks roughly like this:

```text
Your Vault/
└── Notelets/
    ├── my-app.md
    └── _assets/
        └── my-app/
            ├── icon.gif
            └── background.png
```

The original source folder is no longer required after a successful import.

## Asset handling

Large images and media files are **not** embedded into the Markdown as base64 data. Instead, Notelets copies referenced assets into `Notelets/_assets/` and stores lightweight internal references in the Notelet source.

When the note renders, those references are resolved to Obsidian resource paths for the iframe.

Supported asset types currently include common:

- Images: PNG, JPEG, GIF, WebP, AVIF, SVG, ICO, BMP, APNG
- Audio: MP3, WAV, OGG, M4A, AAC, FLAC
- Video: MP4, WebM, OGV, MOV
- Fonts: WOFF, WOFF2, TTF, OTF

Filename matching also supports JavaScript-driven interfaces where an asset name is stored in data and assigned later, for example:

```js
const activities = [
  { label: "Chores", icon: "chores.gif" },
  { label: "Creative", icon: "creative.gif" }
];

const image = document.createElement("img");
image.src = activities[0].icon;
```

If the selected folder contains exactly one matching `chores.gif`, Notelets can import and resolve it automatically.

## Persistent state

Many small frontend apps use `localStorage` for persistence. Sandboxed Notelets use a storage bridge so compatible apps can continue using familiar code such as:

```js
localStorage.setItem("my-app-state", JSON.stringify(state));
const saved = localStorage.getItem("my-app-state");
```

Notelets stores that data through the plugin so it can be restored when the Notelet is opened again.

## Installation

Notelets is currently installed manually.

Create this folder inside your vault:

```text
.obsidian/plugins/notelets/
```

Place the plugin files inside it:

```text
notelets/
├── main.js
├── manifest.json
└── styles.css
```

Then:

1. Open **Obsidian → Settings → Community plugins**.
2. Reload or refresh the installed plugin list if necessary.
3. Enable **Notelets**.

## Security

> [!WARNING]
> **Only import or run Notelets from sources you trust.**

Notelets is intentionally designed to execute frontend JavaScript. Its iframe currently uses both `allow-scripts` and `allow-same-origin` so imported applications can function correctly and access copied vault assets.

That means a Notelet should be treated as **executable content**, not as passive Markdown. Do not import unknown or untrusted HTML projects simply to inspect them.

## Current limitations

- Notelets is intended for **frontend-only** applications. It does not provide a backend server.
- Apps that depend on remote APIs, browser features restricted by Electron, authentication flows, or special origin/security requirements may not behave exactly as they do in a normal browser.
- Folder import focuses on common local HTML/CSS/JavaScript and asset-reference patterns rather than acting as a full production web bundler.
- Ambiguous duplicate asset filenames may require explicit relative paths in the source project.
- External resources remain external unless they are part of the selected local project and can be resolved during import.

## Why Notelets?

Obsidian notes are usually documents. Notelets makes them capable of being tools.

A Notelet can be a kanban board, tracker, calculator, generator, recorder, form, dashboard, visualizer, or any other small interface that can run entirely in frontend HTML, CSS, and JavaScript—while remaining part of the vault alongside ordinary notes.

The goal is not to make Obsidian imitate a browser. It is to make **interactive mini-apps a native-feeling kind of note**.
