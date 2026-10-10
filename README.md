# Markword

**English** | [繁體中文](README.zh-TW.md)

Markword is a browser-based Markdown editor for notes, documents, and reports. Read and edit in one place or use a synchronized split preview, then export your work as Markdown, HTML, PDF, or Word.

![Markword writing workspace](assets/markword_preview.png)

## Features

- **Write and preview**: single-pane live editing, synchronized split preview, document outline, and search.
- **Edit HTML directly**: a separate HTML workspace with click-to-edit text, link editing, synchronized source, and HTML downloads.
- **Rich content**: code highlighting, Mermaid diagrams, math, task lists, and a visual table editor.
- **Bring your documents**: open Markdown, text, Mermaid, HTML, Word (`.docx`), or Markword project ZIP files; paste or drop images and attachments.
- **Save and recover**: automatic browser drafts, revision history, and project backups with attachments.
- **Export and share**: Markdown, portable HTML, PDF, and Word, with four HTML/PDF layouts.
- **Make it comfortable**: eight themes, focus mode, word counts, mobile layouts, and English/Traditional Chinese interfaces.

## Get started

You need Git, Docker, and Docker Compose. This repository is available for viewing and evaluation only; obtain the author's prior written permission before running or deploying it.

```bash
git clone https://github.com/susuky/markword.git
cd markword
docker compose up --build -d
```

Once the build finishes, open [http://localhost:27860](http://localhost:27860). The first start downloads and installs the required packages. Run `docker compose down` to stop the service.

For installation without Docker, see the [local installation and deployment guide](docs/development.md) (Traditional Chinese).

### Full edition and Pages edition

| Feature | Local full edition | Pages edition |
| --- | --- | --- |
| Editing, preview, diagrams, and math | Supported | Supported |
| HTML source and visual text editing | Supported | Supported |
| Browser drafts, revisions, and attachments | Supported | Supported |
| Markdown, portable HTML, and project ZIP | Supported | Supported |
| Direct PDF / Word export | Supported | Unavailable |

In the Pages edition, download portable HTML and use your browser to print it as PDF. Use the local full edition for direct PDF or Word export. See the [deployment guide](docs/development.md#github-pages-建置) for Pages configuration and publishing.

## Basic usage

1. **Open a document**: click **Open**, drop a document into the workspace, or start writing. HTML and Word files convert to Markdown; review the result because complex layouts may change.
2. **Choose your view**: split view shows source and preview together. Click **Single-page editing** to work directly in the preview, or **Split editing** to bring the source back. The toolbar button in the top header collapses or expands the workspace tools; your choice is remembered.
3. **Add content**: paste or drop images, use the edit button beside a table to change cells, rows, and columns, or type `/` on an empty line for quick inserts.
4. **Save and export**: use **Save** or `Ctrl/Cmd+S` to save the source. Open **Export** to choose a sharing or backup format.

Browsers with direct file saving can update an opened file or let you choose a new location. Other browsers download the source instead.

### Edit Markdown without writing markup

The preview is editable by default, including writing from an empty document. Enter creates a paragraph or continues a list; Enter on an empty item exits the list. Press `/` on an empty line or use **Add content** to insert paragraphs, three heading levels, bulleted/numbered/task lists, quotes, code, tables, and dividers. The plus beside a block inserts after it; the page footer adds more content. Select links to change their addresses, toggle task checkboxes, or use **Edit table** for tables. Use the **Preview editing tools** menu for undo or redo, and **Single-page editing** to hide the source on desktop; switch between **Editor** and **Preview** on mobile. Changes share the existing source, browser draft, downloads, and undo/redo history.

Code blocks support direct editing, multiline input, and paste. Press Escape or Ctrl/Cmd+Enter to finish; syntax highlighting returns when you leave the block. Blocks containing formulas, footnote references, or media still use the source editor. A visual edit regenerates that block's Markdown, so list indentation, emphasis markers, or reference-link notation may change; other source blocks stay untouched.

### Edit HTML without writing markup

Choose **HTML editor** from the document mode menu, or append `#/html` to the app URL. Open an `.html`/`.htm` file or use **Paste HTML**, then click text in the preview to edit it. Press Enter to finish, or select a link to change its address. The source stays in sync and can be hidden on desktop; mobile provides preview and source tabs. Use **Undo**, **Redo**, and **Download** (`Ctrl/Cmd+S`) as needed.

The HTML workspace has its own browser draft, separate from Markdown. Download a copy before clearing browser data. Original styles and scripts remain in the downloaded file, but page scripts do not run in the editing preview. This version edits static text and existing links; it does not offer layout dragging, image replacement, or dynamic chart editing. Use embedded assets or full URLs for resources stored outside the HTML file. Visual edits may normalize markup whitespace and quoting.

Opening HTML in the Markdown workspace still converts it to Markdown. Switch to the HTML editor first to keep the page as HTML.

### Choose an export format

| Format | Use it for |
| --- | --- |
| Markdown / text / Mermaid | Editable source; local attachments are separate |
| Project ZIP | Back up the current document and its referenced local attachments, then reopen them for editing |
| Portable HTML | Share an offline-readable document with its source and referenced local attachments |
| PDF / Word | Print or deliver a document; Word uses a fixed layout |

### Useful shortcuts

| Shortcut | Action |
| --- | --- |
| `Ctrl/Cmd+S` | Save the document |
| `Ctrl/Cmd+F` | Search and replace |
| `Ctrl/Cmd+K` | Open the command palette |

### Drafts and backups

Drafts, revision history, and imported attachments stay in the current browser. An automatically saved draft is separate from your computer file. Export a project ZIP before changing devices or clearing site data; ZIPs do not include revision history or other documents.

Importing and editing happen in the browser. PDF/Word export sends the document and supported local images to the Markword service you are using. Run Markword on your own computer to keep that processing there.

## Learn more

See the [development and deployment guide](docs/development.md) (Traditional Chinese) for local development, configuration, API details, and export limits.

## Bug reports and feature suggestions

This project accepts bug reports and feature suggestions through [GitHub Issues](https://github.com/susuky/markword/issues) only. External pull requests are not accepted. The maintainer decides whether and when to address reports or adopt suggestions, and maintains and commits the code. See the [reporting guide](CONTRIBUTING.md) (Traditional Chinese) for details.

## Copyright

Third-party dependencies retain their respective licenses.

```less
Copyright © 2026 Hao-Ping Lin (@susuky). All rights reserved.

This repository is publicly accessible for viewing and evaluation only.
No license is granted to use, copy, modify, redistribute, sublicense, or use this software commercially without prior written permission.
```
