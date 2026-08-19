import type { Locale } from './i18n'

const SAMPLE_MARKDOWN_ZH_TW = `# 文字工具箱使用指南

歡迎使用 **文字工具箱**，這是一個專為 Markdown 寫作而生的線上工具。
它能即時預覽、統計字數，並支援程式碼、清單與圖表。

## 主要功能

- 即時預覽 Markdown 內容
- 字數與行數統計
- 支援 Mermaid 圖表
- 匯出 PDF 與 Word 文件

## 程式碼範例

\`\`\`javascript
function greet(name) {
  return \`你好，\${name}！\`;
}

console.log(greet('文字工具箱'));
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
- PDF and Word export in the full server edition

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
