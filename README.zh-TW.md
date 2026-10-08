# Markword

**繁體中文** | [English](README.md)

Markword 是在瀏覽器中使用的 Markdown 編輯器，適合寫筆記、整理文件與準備報告。可以在同一處閱讀與編輯，也可以使用雙欄即時預覽；寫完後，匯出成 Markdown、HTML、PDF 或 Word。

![Markword 寫作介面](assets/markword_preview.png)

## 主要功能

- **邊寫邊看**：單欄即時編輯、雙欄同步預覽、文件大綱與搜尋。
- **完整呈現內容**：程式碼高亮、Mermaid 圖表、數學公式、待辦清單與視覺化表格編輯。
- **匯入既有文件**：開啟 Markdown、純文字、Mermaid、HTML、Word（`.docx`）或 Markword 專案 ZIP；圖片與附件可直接貼上或拖入。
- **保存與備份**：瀏覽器自動保存草稿、版本記錄，以及文件與附件的專案備份。
- **匯出與分享**：Markdown、可攜 HTML、PDF、Word；HTML／PDF 提供四種版型。
- **自在寫作**：八種主題、專注模式、字數統計、手機版面與繁體中文／英文介面。

## 快速開始

需要 Git、Docker 與 Docker Compose。本儲存庫僅供檢視與評估；執行或部署前須取得作者的事先書面許可。

```bash
git clone https://github.com/susuky/markword.git
cd markword
docker compose up --build -d
```

建置完成後，開啟 [http://localhost:27860](http://localhost:27860) 即可使用。第一次啟動會下載並安裝所需套件；停止服務可執行 `docker compose down`。

不使用 Docker 時，請參閱[本機安裝與部署](docs/development.md)。

## 簡易用法

1. **開啟文件**：點選「開啟」，或將文件拖入畫面；也可以直接編寫新內容。HTML／Word 會轉成 Markdown，複雜版面可能改變，請檢查轉換結果。
2. **選擇寫作方式**：雙欄模式同時顯示原文與預覽；點選「即時編輯」切換成單欄，點選區塊修改 Markdown 原文，離開區塊後恢復排版。再次點選可切回雙欄。
3. **加入內容**：貼上或拖入圖片；在表格旁點選編輯按鈕，可調整儲存格、列與欄。空白行輸入 `/` 可快速插入常用內容。
4. **儲存與匯出**：使用「儲存」或 `Ctrl/Cmd+S` 保存原始檔；從「匯出」選擇適合的分享或備份格式。

支援直接存檔的瀏覽器可存回已開啟的原檔，或選擇新檔名與位置；其他瀏覽器會下載原始檔。

### 選擇匯出格式

| 格式 | 適合用途 |
| --- | --- |
| Markdown／純文字／Mermaid | 保留可編輯原文；不包含本機附件 |
| 專案 ZIP | 備份目前文件及引用的本機附件，之後可重新開啟編輯 |
| 可攜 HTML | 分享可離線閱讀的文件，內含原文與引用的本機附件 |
| PDF／Word | 列印、交付報告或文件；Word 使用固定版型 |

### 常用快捷鍵

| 快捷鍵 | 操作 |
| --- | --- |
| `Ctrl/Cmd+S` | 儲存文件 |
| `Ctrl/Cmd+F` | 搜尋與取代 |
| `Ctrl/Cmd+K` | 開啟命令選單 |

### 草稿與備份

草稿、版本記錄與匯入的附件保存在目前瀏覽器。自動保存草稿不等於存回電腦檔案；更換裝置或清除網站資料前，請匯出專案 ZIP。ZIP 不包含版本記錄或其他文件。

匯入與編輯在瀏覽器內完成；匯出 PDF／Word 時，文件與支援的本機圖片會送到你正在使用的 Markword 服務。本機部署可讓這些處理留在自己的電腦。

## 進一步了解

本機開發、部署設定、API 與匯出限制請參閱[開發與部署文件](docs/development.md)。

## 權利聲明

第三方相依套件維持各自的授權條款。

```less
Copyright © 2026 Hao-Ping Lin (@susuky). All rights reserved.

This repository is publicly accessible for viewing and evaluation only.
No license is granted to use, copy, modify, redistribute, sublicense, or use this software commercially without prior written permission.
```
