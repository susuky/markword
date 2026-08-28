import type { Locale } from './i18n'
import { IS_STATIC_DEPLOYMENT } from './deployment'

const SAMPLE_MARKDOWN_ZH_TW = `# Markword使用指南

歡迎使用 **Markword**，這是一個專為 Markdown 寫作而生的線上工具。
它能即時預覽、統計字數，並支援程式碼、清單與圖表。

## 主要功能

- 即時預覽 Markdown 內容
- 字數與行數統計
- 支援 Mermaid 圖表
${IS_STATIC_DEPLOYMENT ? '- 匯出 Markdown、專案 ZIP 與可攜 HTML' : '- 匯出 Markdown、HTML、PDF 與 Word 文件'}

## 程式碼範例

\`\`\`javascript
function greet(name) {
  return \`你好，\${name}！\`;
}

console.log(greet('Markword'));
\`\`\`

## Mermaid 圖表示例

\`\`\`mermaid
graph LR
  A[開始] --> B[撰寫 Markdown]
  B --> C{預覽內容}
  C -->|滿意| D[匯出文件]
  C -->|調整| B
\`\`\`

> 專注寫作，即時預覽，讓想法更清晰！
`

const SAMPLE_MARKDOWN_EN = `# Markword Guide

Welcome to **Markword**, an online workspace made for Markdown writing.
It provides live preview, document statistics, code highlighting, lists, and diagrams.

## Key features

- Live Markdown preview
- Character, word, and line statistics
- Mermaid diagram support
${IS_STATIC_DEPLOYMENT ? '- Markdown, project ZIP, and portable HTML export' : '- Markdown, HTML, PDF, and Word export'}

## Code example

\`\`\`javascript
function greet(name) {
  return \`Hello, \${name}!\`;
}

console.log(greet('Markword'));
\`\`\`

## Mermaid example

\`\`\`mermaid
graph LR
  A[Start] --> B[Write Markdown]
  B --> C{Preview content}
  C -->|Looks good| D[Export document]
  C -->|Revise| B
\`\`\`

> Focus on writing, preview instantly, and make every idea clearer.
`

export const SAMPLE_MARKDOWN: Record<Locale, string> = {
  en: SAMPLE_MARKDOWN_EN,
  'zh-TW': SAMPLE_MARKDOWN_ZH_TW,
}
