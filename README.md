# Markword

**English** | [繁體中文](README.zh-TW.md)

Markword is a browser-based Markdown editor for notes, documents, and reports. Read and edit in one place or use a synchronized split preview, then export your work as Markdown, HTML, PDF, or Word.

![Markword writing workspace](assets/markword_preview.png)

## Features

- **Write and preview**: single-pane live editing, synchronized split preview, document outline, and search.
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

## Basic usage

1. **Open a document**: click **Open**, drop a document into the workspace, or start writing. HTML and Word files convert to Markdown; review the result because complex layouts may change.
2. **Choose your view**: split view shows source and preview together. Click **Live editing** for a single pane; click a block to edit its Markdown source and leave it to see the formatting again. Click the button again to return to split view.
3. **Add content**: paste or drop images, use the edit button beside a table to change cells, rows, and columns, or type `/` on an empty line for quick inserts.
4. **Save and export**: use **Save** or `Ctrl/Cmd+S` to save the source. Open **Export** to choose a sharing or backup format.

Browsers with direct file saving can update an opened file or let you choose a new location. Other browsers download the source instead.

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

## Copyright

Third-party dependencies retain their respective licenses.

```less
Copyright © 2026 Hao-Ping Lin (@susuky). All rights reserved.

This repository is publicly accessible for viewing and evaluation only.
No license is granted to use, copy, modify, redistribute, sublicense, or use this software commercially without prior written permission.
```
