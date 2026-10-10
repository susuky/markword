# Markword

**繁體中文** | [English](README.md)

Markword 是在瀏覽器中使用的 Markdown 與 HTML 編輯器。Markdown 可以直接在預覽中寫作、透過區塊選單新增內容，也可以開啟雙欄，同時查看原始碼。獨立的 HTML 編輯頁則能開啟網頁、修改文字與連結，不必先學 HTML 語法。

![Markword 寫作介面](assets/markword_preview.png)

## 主要功能

- **單頁寫作**：直接修改文字，按 Enter 繼續寫；用 `/` 或「新增內容」插入標題、清單、引用、程式碼、表格與分隔線。
- **雙欄編輯**：原始碼與預覽同步捲動，搭配文件大綱與搜尋；兩種視圖編輯同一份文件，共用復原與重做記錄。
- **HTML 編輯**：開啟或貼上 HTML，點選文字與連結修改，再下載保留原有樣式的頁面。
- **圖文與程式碼**：可編輯並上色的程式碼區塊、待辦勾選、表格編輯器，以及 Mermaid 圖表與數學公式。
- **匯入與匯出**：開啟 Markdown、純文字、Mermaid、HTML、Word（`.docx`）及專案 ZIP；匯出 Markdown、可攜 HTML 或專案 ZIP，完整版另支援 PDF 與 Word。
- **草稿與備份**：瀏覽器自動保存草稿、Markdown 版本記錄，以及包含引用附件的專案備份。
- **工作區調整**：可收合工具列、八種預覽主題、專注模式、字數統計、手機版面與繁體中文／英文介面。

## 快速開始

需要 Git、Docker 與 Docker Compose。本儲存庫僅供檢視與評估；執行或部署前須取得作者的事先書面許可。

```bash
git clone https://github.com/susuky/markword.git
cd markword
docker compose up --build -d
```

建置完成後，開啟 [http://localhost:27860](http://localhost:27860) 即可使用。第一次啟動會下載並安裝所需套件；停止服務可執行 `docker compose down`。

不使用 Docker 時，請參閱[本機安裝與部署](docs/development.md)。

### 完整版與 Pages 版

| 功能 | 本機完整版 | Pages 版 |
| --- | --- | --- |
| 單頁／雙欄編輯、圖表與公式 | 支援 | 支援 |
| HTML 原始碼與點選編輯 | 支援 | 支援 |
| 瀏覽器草稿、版本記錄與附件 | 支援 | 支援 |
| Markdown、可攜 HTML 與專案 ZIP | 支援 | 支援 |
| 直接匯出 PDF／Word | 支援 | 不提供 |

Pages 版可以先下載可攜 HTML，再透過瀏覽器列印成 PDF；需要直接匯出 PDF 或 Word 時，請使用本機完整版。Pages 的設定與發布方式請參閱[部署文件](docs/development.md#github-pages-建置)。

## 寫作與編輯

### Markdown：單頁或雙欄編輯

點選「開啟」、將文件拖入工作區，或直接開始寫作。在這個工作區開啟 HTML／Word 會轉成 Markdown，複雜版面可能改變，請檢查轉換結果。

預覽預設就能編輯。桌面點選「單頁編輯」可隱藏原始碼，點選「雙欄編輯」則重新顯示；手機可切換「編輯／預覽」分頁。「匯出」旁的工具列按鈕可展開或收合工作區工具，並記住上次選擇。

![單頁寫作與新增內容選單](assets/markword-block-editor.png)

| 想做什麼 | 在預覽中的操作 |
| --- | --- |
| 寫作或修改文字 | 點選段落或標題後輸入；空白文件也能直接開始寫 |
| 繼續往下寫 | 按 `Enter` 新增段落或接續清單；空白清單項目再按 `Enter` 即可退出清單 |
| 插入區塊 | 空白行輸入 `/`，或按預覽上方的「＋」開啟「新增內容」選單 |
| 在內容之間插入 | 按區塊旁的「＋」在它後方插入；頁尾的「新增內容」可繼續寫下去 |
| 修改程式碼 | 點選程式碼區塊，可輸入或貼上多行內容；按 `Escape` 或 `Ctrl/Cmd+Enter` 完成 |
| 修改連結、待辦或表格 | 選取連結可改網址、待辦可直接勾選；「編輯表格」可修改儲存格、列與欄 |
| 復原或重做 | 開啟預覽上方的「⋯」工具選單 |

區塊選單提供段落、三級標題、項目／編號／待辦清單、引用、程式碼、表格與分隔線。圖片與附件可貼上或拖入工作區。

修改會同步到同一份原始碼與瀏覽器草稿；離開程式碼區塊後會恢復語法上色。含公式、註腳標記或媒體的區塊仍需從原始碼編輯。預覽中的修改可能調整該區塊的 Markdown 寫法，例如清單縮排、強調符號或參照連結；其他區塊保留原始文字。

### 不寫語法也能修改 HTML

在雙欄模式下，從原始碼上方的「Markdown」選單選擇「HTML 編輯器」，或在應用網址後加上 `#/html`。此頁有獨立草稿，不會取代 Markdown 工作區的文件。

1. **開啟頁面**：選擇 `.html`／`.htm` 檔，或用「貼上 HTML」貼入完整頁面或片段，也可以貼上 AI 對話產生的 HTML。
2. **在預覽中修改**：點選文字後輸入，按 `Enter` 完成；選取連結後可修改網址。原始碼會同步更新；桌面可隱藏原始碼，手機可切換分頁。
3. **下載修改結果**：可用「復原／重做」調整修改，再按「下載」或 `Ctrl/Cmd+S` 取得 HTML 檔。

![HTML 原始碼與可直接修改的頁面預覽](assets/markword-html-editor.png)

原有樣式與腳本保存在下載檔中，編輯預覽不執行腳本。目前可修改靜態文字與既有連結，尚不提供拖曳排版、圖片替換或動態圖表編輯。

相對路徑的外部檔案不會隨 HTML 一起匯入；請使用內嵌資源或完整網址。視覺修改後，HTML 的空白與引號等寫法可能由瀏覽器調整。

Markdown 工作區的 HTML 匯入用途是轉成 Markdown；要保留網頁格式，請先切換至 HTML 編輯器再開啟檔案。

## 儲存與匯出

在 Markdown 工作區使用「儲存」或 `Ctrl/Cmd+S` 保存原始檔。支援直接存檔的瀏覽器可存回已開啟的原檔，或選擇新檔名與位置；其他瀏覽器會下載原始檔。從「匯出」可選擇下列格式。

| 格式 | 適合用途 |
| --- | --- |
| Markdown／純文字／Mermaid | 保留可編輯原文；不包含本機附件 |
| 專案 ZIP | 備份目前文件及引用的本機附件，之後可重新開啟編輯 |
| 可攜 HTML | 分享可離線閱讀的文件，內含原文與引用的本機附件 |
| PDF／Word | 列印、交付報告或文件；Word 使用固定版型 |

### 常用快捷鍵

| 快捷鍵 | 操作 |
| --- | --- |
| `Ctrl/Cmd+S` | 儲存 Markdown 原始檔，或下載目前的 HTML 頁面 |
| `Ctrl/Cmd+F` | 在 Markdown 工作區搜尋與取代 |
| `Ctrl/Cmd+K` | 開啟 Markdown 工作區的命令選單 |

### 草稿與備份

草稿保存在目前瀏覽器，自動保存草稿不等於存回電腦檔案。更換裝置或清除網站資料前，請依工作區備份：

- **Markdown**：匯出專案 ZIP，保留目前文件及引用的本機附件；ZIP 不包含版本記錄或其他文件。
- **HTML**：從 HTML 編輯器下載頁面；此頁的獨立草稿不包含在 Markdown 專案 ZIP 中。

匯入與編輯在瀏覽器內完成；匯出 PDF／Word 時，文件與支援的本機圖片會送到你正在使用的 Markword 服務。本機部署可讓這些處理留在自己的電腦。

## 進一步了解

本機開發、部署設定、API 與匯出限制請參閱[開發與部署文件](docs/development.md)。

## 問題回報與功能建議

本專案只透過 [GitHub Issues](https://github.com/susuky/markword/issues) 接受問題回報與功能建議，不接受外部 Pull request。是否修正、何時處理及是否採納建議，由維護者決定；程式碼由維護者維護與提交。回報方式請參閱[問題回報指南](CONTRIBUTING.md)。

## 權利聲明

第三方相依套件維持各自的授權條款。

```less
Copyright © 2026 Hao-Ping Lin (@susuky). All rights reserved.

This repository is publicly accessible for viewing and evaluation only.
No license is granted to use, copy, modify, redistribute, sublicense, or use this software commercially without prior written permission.
```
