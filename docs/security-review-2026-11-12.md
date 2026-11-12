# Markword 安全檢查與修正

日期：2026-11-12

附件可以透過兩個入口在 Markword 的來源下執行腳本。兩個入口均已修正；套件更新後，後端 112 個測試及附件相關 5 個瀏覽器測試通過。

## 附件腳本可讀取整個工作區

### 已重現的行為

`GET /api/workspace/assets/{id}` 原先直接使用匯入資料提供的 MIME 回傳附件。匯入 `text/html` 附件後，只要在瀏覽器開啟這個網址，附件內的腳本就能使用 Markword 的來源存取 `/api/workspace`。

檢查時使用暫存 SQLite 與獨立 Chromium：先建立一份測試文件，再開啟 HTML 附件。附件腳本成功取得另一份文件的內容。

Markdown 預覽的附件連結原先指向原始 MIME 的 Blob URL。一般點擊會下載；從新分頁直接開啟 HTML 或 SVG 的 Blob URL 時，瀏覽器仍可將它當成同源文件執行。

### 修改

- [backend/workspace.py](../backend/workspace.py)：附件回應帶 `Content-Disposition: attachment`、CSP `sandbox; default-src 'none'` 與 `X-Content-Type-Options: nosniff`。檔名使用 UTF-8 編碼，保留中文並處理換行字元。原 MIME 與內容位元組保留給既有 fetch 消費端。
- [PreviewPane.tsx](../frontend/src/components/PreviewPane.tsx)：附件連結使用 `application/octet-stream` 的下載 Blob URL，並指定檔名。圖片、影音仍使用原 MIME 的 URL。

## 服務的存取範圍

檢查時，既有 `markword.service` 監聽 `0.0.0.0:27860`。[工作區 API](../backend/workspace.py) 沒有登入驗證；能連上此連接埠的裝置可讀寫共用文件、版本與附件。

這個設定適用於可信裝置共用的網路。若提供外網或不受信任的網路存取，入口應透過具登入驗證的反向代理並限制來源。只在該電腦使用時，可將 `MARKWORD_HOST` 設為 `127.0.0.1`。專案的[部署說明](development.md) 已描述這項存取條件。

## 匯出預覽的鍵盤修正

匯出預覽的 iframe 取得焦點後，Escape 原先無法傳回外層視窗。現在由父頁在已載入的預覽文件安裝鍵盤監聽器；該 iframe 使用 `sandbox="allow-same-origin"`，腳本執行仍被禁止。輸入法組字期間的 Escape 保留給輸入法。

這個預覽由 Markdown 渲染與清理後的內容產生，原始 HTML 腳本及巢狀 iframe 顯示為文字。回歸測試另外確認新增可執行 script 會被瀏覽器 sandbox 阻擋、預覽可選字與捲動、跨來源導向不會造成父頁例外。這次修改的檔案是 [ExportPreview.tsx](../frontend/src/components/ExportPreview.tsx)。

## 套件更新

### 前端

更新相容修補版本與 lockfile，包含：

| 套件 | 修補後版本 |
| --- | --- |
| DOMPurify | 3.4.17 |
| markdown-it | 14.3.3 |
| Vite | 6.4.6 |
| js-yaml | 4.3.2 |
| source-map-js | 1.2.2 |

`package.json` 同步提高 DOMPurify、markdown-it、Vite 的最低版本。

`npm audit` 修補前列出 15 個相依節點：1 critical、5 high、7 moderate、2 low。修補後為 9 個相依節點：0 critical、0 high、7 moderate、2 low，分屬兩條相依鏈：

| 相依鏈 | 公告與觸發條件 | 目前版本狀況 |
| --- | --- | --- |
| typescript-eslint → minimatch | [GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249)：特製 glob 輸入放大計算量。這條相依用於開發工具。 | npm 最新 typescript-eslint 8.72.2 仍使用 minimatch 10；修補版 minimatch 為 11.0.1。 |
| Mermaid → KaTeX | [GHSA-238p-pmpm-9mq7](https://github.com/advisories/GHSA-238p-pmpm-9mq7)：環境已存在原型污染時可繞過 trust 限制。 | Mermaid 11 的最新 11.17.2 仍依賴 KaTeX 0.16；目前保留既有 Mermaid 11.16.1。根層 KaTeX 0.18.4 已修補。 |

上述 9 是 npm 將受影響套件及其上層相依分別計數的結果。

### Python

專案虛擬環境原有 6 個套件被 `pip-audit` 列為已知漏洞版本，已更新：

| 套件 | 修補後版本 |
| --- | --- |
| Pillow | 13.0.0 |
| WeasyPrint | 70.0 |
| Brotli | 1.2.1 |
| certifi | 2026.10.23 |
| filelock | 4.2.10 |
| pip | 26.3 |

[requirements.txt](../requirements.txt) 與 [pyproject.toml](../pyproject.toml) 提高 Pillow、WeasyPrint 最低版本，並指定 CPython 使用 Brotli 1.2.1 以上。Brotli 是 PDF 字型處理的實際相依。

更新後稽核專案環境共 71 個套件，`pip-audit` 回傳 0，沒有列出已知漏洞。

相關公告：[Brotli](https://github.com/advisories/GHSA-9v8h-qqgm-4m35)、[WeasyPrint URL fetcher](https://github.com/advisories/GHSA-jf6q-chmf-3h3v)、[WeasyPrint 圖片格式](https://github.com/advisories/GHSA-r543-q48m-4c9j)、[Pillow 圖片解碼](https://github.com/advisories/GHSA-4558-3h8r-v8xp)。

## 驗證

| 檢查 | 結果 |
| --- | --- |
| 全套 `pytest -q` | 112 passed，33.78 秒 |
| `assets-export.spec.ts` | 4 passed |
| `attachment-security.spec.ts` | 1 passed |
| `pip-audit --path .venv/lib/python3.12/site-packages` | 0 個有公告的套件 |
| `npm audit` | 0 critical / 0 high / 7 moderate / 2 low |
| 修改檔案 `git diff --check` | 通過 |

新的瀏覽器測試同時驗證 HTML/SVG 附件經 API URL 與 Blob URL 開新頁會下載、腳本未執行，SVG 圖片仍正常顯示。後端測試另驗證檔名編碼與回應內容。

後端與瀏覽器測試沿用這個專案既有的 SQLite 3.53.3 動態函式庫：

```bash
LD_PRELOAD=/home/nvidia/ping/markword/.venv/lib/libsqlite3.so.3.53.3 .venv/bin/python -m pytest -q
```
