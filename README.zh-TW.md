# Markword

**繁體中文** | [English](README.md)


Markword 是以 FastAPI 與 React/Vite 建構的 Markdown 編輯器與文件統計工作區，支援編輯／預覽同步捲動、Mermaid、語法高亮、主題切換、本機草稿復原，以及 PDF／Word 匯出。

本儲存庫僅公開供檢視與評估。下方部署及開發指令供已取得事先書面許可的使用者參考。

## 開始使用

取得許可後，可從目前原始碼建立 Docker Compose 部署，或依下方步驟啟動本機開發環境。

### 以 Docker Compose 從原始碼部署

需求：Git、Docker 與 Docker Compose。

```bash
git clone https://github.com/susuky/markword.git
cd markword
docker compose up --build -d
```

瀏覽器開啟 `http://localhost:27860`。可用以下指令查看或停止服務：

```bash
docker compose logs -f markword
docker compose down
```

![Markword React 編輯器與即時預覽](assets/markword_preview.png)

## 功能

- 即時統計總字數、中文字、英文單字、數字、全形標點與行數
- Markdown 即時預覽與編輯器／預覽雙向同步捲動
- 可點擊文件大綱、預覽雙擊回到原始碼、同步捲動開關
- Light、Paper、Sage、Dark、Ocean、Nord、Dracula、Midnight 八種主題
- 程式碼語法高亮、Mermaid、KaTeX、task list 與 footnote
- 開啟／拖放 `.md`、Word（`.docx`）或 Markword 專案 ZIP；Word 轉成 Markdown 後可繼續編輯與下載
- IndexedDB 本機資產庫：匯入、貼上或拖放圖片、影片、音訊與附件
- CodeMirror 搜尋、摺疊、命令選單、快捷插入、專注與打字機模式
- 視覺化表格編輯：新增／刪除列欄、欄位對齊、試算表貼上與格內換行
- IndexedDB 草稿復原、每五分鐘自動版本、手動版本、文字差異比較與非破壞還原
- 支援的瀏覽器可直接存回原檔或另存新檔；其他瀏覽器保留原始檔下載
- 手機與窄平板的編輯／預覽 tabs，以及可安裝的 PWA 離線 app shell
- 完整繁體中文／英文介面切換，並保存語言偏好
- Markdown、可攜 HTML、PDF 與 Word (`.docx`) 集中式匯出
- 經典、編輯排版、報告、精簡四種 HTML／PDF 成品版型
- 單一 FastAPI 程序提供 API 與正式版前端靜態檔

## 使用 Markword

### 編輯器操作

- 編輯區標題旁可切換 Markdown、純文字與 Mermaid 模式；切換不會改寫內容或清除復原歷史，右側依模式即時預覽。模式會隨草稿、版本及專案 ZIP 保存。
- Markdown 的 `Enter` 每次只換一行：在帶有序號的那一行會新增項目並遞增後續編號；在接續內文換行則不新增序號。刪除序號或清單項目時，同一份清單中後續連號會自動遞減，保留原本不連續的編號。空白清單項目按 `Enter` 或 `Backspace` 可退出，`Ctrl/Cmd+Z` 可一併撤回刪除與編號調整。`Shift+Enter` 只換行、不延續序號。
- Markdown 與 Mermaid 可用 `Tab`／`Shift+Tab` 縮排及取消縮排；先按 `Esc` 再按 `Tab` 可將鍵盤焦點移出編輯器。
- 純文字原樣顯示，不套用 Markdown 格式或自動序號；Mermaid 模式直接輸入圖表語法，不需程式碼圍欄。可開啟及下載 `.txt`、`.mmd`／`.mermaid`，下載時依目前模式產生 `.md`、`.txt` 或 `.mmd`。

- `Ctrl/Cmd+K`：開啟命令選單；也可在空白行輸入 `/` 快速開啟插入命令。
- `Ctrl/Cmd+F`：搜尋／取代；`Ctrl/Cmd+S`：儲存目前文件。支援檔案存取的瀏覽器會存回已開啟的原檔，首次儲存會選擇檔名與位置；不支援時則下載目前模式的原始檔。
- `?`：顯示快捷鍵；`Ctrl/Cmd+Shift+F`：專注模式。
- 點選右下角的快捷鍵按鈕，可自訂命令選單、搜尋、下載、插入等操作的按鍵。點選一項再按組合鍵即可儲存，也可清除或還原預設值。重複組合與常用瀏覽器、基本編輯按鍵會顯示提示；設定僅保存在目前瀏覽器，不包含在專案 ZIP 中。
- 左側大綱可跳至標題；雙擊右側預覽區塊可回到對應原始碼。
- 按編輯區的「表格」可插入新表格；游標位於既有表格時會開啟該表格。預覽中每張表格上方另有「編輯表格」按鈕，可用滑鼠、觸控或鍵盤操作，也保留雙擊表格的方式。第一列為表頭，可增刪列欄、設定欄位對齊，或將 Excel／試算表複製的儲存格貼入。`Tab`／`Shift+Tab` 換格，`Enter` 移至下一列（末列會新增一列），`Shift+Enter` 在格內換行。按「套用變更」才會更新文件，`Ctrl/Cmd+Z` 可一次撤回；取消則保留原文。預覽操作按鈕不會包含在 HTML 匯出中。
- 表格工具最多編輯 5,000 個儲存格；較大表格仍可修改原始碼。貼上前需先取消合併儲存格。格內換行儲存為 `<br>`，預覽、可攜 HTML、PDF 與 Word 可保留換行。
- 工具列可開啟或拖放本機 Markdown、Word（`.docx`）或 Markword 專案 ZIP；圖片、影片、音訊與其他檔案可從「資產」匯入，也可直接貼上或拖入編輯區。
- Word 匯入在瀏覽器內轉換，支援標題、段落、粗體、斜體、刪除線、清單、連結、基本表格與內嵌圖片。表格第一列會成為 Markdown 表頭；頁首頁尾、分頁、合併儲存格及精確版面不保證保留，請檢查轉換結果。Markdown／Word 單檔上限為 15 MiB（15,728,640 位元組），Word 解壓後內容上限為 50 MB；舊版 `.doc` 請先另存為 `.docx`。
- Word 圖片會存入本機資產庫；如需連同圖片備份，請匯出專案 ZIP 或可攜 HTML。只下載 Markdown 不會包含圖片檔。GitHub Pages 版本也能匯入 Word，無須上傳文件。
- 「匯出」選單集中 Markdown、專案 ZIP、HTML、PDF、Word；HTML／PDF 可先選擇經典、編輯排版、報告或精簡版型。
- Word 使用固定版型並套用主題配色，保留巢狀清單的內容、縮排與編號。API 的 Word `style` 僅接受 `Classic`；其他版型回傳 `422`。
- 主題同時控制預覽、HTML、PDF、Word 與 Mermaid 配色；可攜 HTML 會固定匯出當下的文件內容，等待 Mermaid 與 KaTeX 完成，並嵌入 SVG、公式樣式、公式字型與本機資產。
- 草稿存在瀏覽器 IndexedDB；內容變更後每五分鐘建立一個本機版本，最多保留 120 個。版本記錄預設比較「選取版本 → 目前文件」，以 `−`／`+` 與顏色標示刪除／新增，可跳到上一處或下一處變更，也可切換「查看舊版全文」。比較區為唯讀，還原版本前會先備份目前內容。
- 頁首「儲存」與 `Ctrl/Cmd+S` 使用瀏覽器的 File System Access API；功能是否提供取決於瀏覽器及使用環境。透過「開啟」選取的 Markdown、純文字或 Mermaid 可存回原檔；拖放、Word 轉換、專案 ZIP 匯入的內容則需選擇新檔。切換文件模式後也會重新選擇儲存位置，以免用不同格式覆寫原檔。
- 「另存新檔」位於匯出選單與命令選單；既有下載功能仍可建立副本。儲存前會比對原檔內容，偵測到其他程式的修改便停止寫入並提示另存。取消或寫入失敗不會清除編輯內容；只有寫入完成才顯示已存回檔案，儲存途中新增的內容仍標示尚未存回。
- 瀏覽器草稿與電腦檔案會分別顯示保存狀態。檔案關聯只保留於目前頁面工作階段；重新整理後仍會復原瀏覽器草稿，但需重新開啟或選擇檔案才能寫入。只儲存原始檔不包含本機圖片與附件，需要完整備份時請匯出專案 ZIP。
- PWA 只快取編輯器／預覽所需的 app shell 與靜態資源；PDF／Word 仍由本機 FastAPI 服務產生。
- 使用頁首的語言按鈕切換英文與繁體中文；偏好會保存在本機，且不會修改文件內容。

### 本機匯出與資源限制

- PDF／Word 的 Mermaid 圖表使用已安裝的 Mermaid 套件與本機 Chromium 產生 PNG，不會將圖表原文傳給第三方服務，也沒有雲端備援。React 預覽仍由瀏覽器內的 Mermaid 套件繪圖；舊版預覽也改用本機套件。
- 匯出用 Chromium 在處理圖表前就停用網路，並限制圖片、字型與樣式的載入。無法繪製圖表時，文件會保留原始碼並標示無法繪圖；缺少渲染器或執行逾時會讓匯出失敗，不會轉送外部服務。
- PDF 的資源讀取只接受內嵌的 `data:` 內容。圖片、CSS、字型、SVG 巢狀引用或附件若要求讀取網路或 `file://` 檔案，匯出會中止，API 回傳 `422`，並清除未完成的檔案。一般可點擊的超連結仍會保留。
- Linux API 每份匯出使用獨立工作程序，預設同時最多兩份，不另行排隊；滿載時回傳 `503`。每份工作的時間與累計 CPU 預算為 60 秒，記憶體預算為 1,024 MiB。系統每 100 ms 檢查包含 Chromium 的程序樹 CPU 與 RSS，另對轉換程序及其子程序設定 CPU、資料記憶體及 128 MiB 單檔寫入上限。超限、取消或轉換程序崩潰時，會回收子程序並清理該次暫存目錄；成功成品在下載回應結束後清除。
- 這些限制以單個 API 程序為範圍，RSS 是定期檢查而非容器層級硬上限。多個 Uvicorn worker 各有自己的併發額度；對外部署仍需另設整體容器資源與存取限制。
- 瀏覽器 IndexedDB 的圖片與附件仍不會傳給 PDF／Word API。需要包含這些資產時，請匯出可攜 HTML，再由瀏覽器列印成 PDF，或使用專案 ZIP 備份。
- 安裝套件與瀏覽器時需要下載依賴；安裝完成後，這兩種匯出不需要連上網際網路。文件會送至你所連線的 Markword API，因此要讓文件留在自己的電腦，請在該電腦執行服務。Markdown 內直接引用的遠端圖片仍可能由一般瀏覽器預覽載入。

### 本機資產與備份

- 本機資產以 Blob 儲存在瀏覽器 IndexedDB，不會上傳到 GitHub Pages 或 Markword 伺服器；單一檔案上限為 200 MiB，專案展開內容上限為 500 MiB。專案 ZIP 上限為 512 MiB，最多 2,000 個項目；匯入時會先預檢，再分段計算實際解壓量，超限立即停止。Word 匯入使用同一個解壓檢查，內容上限為 50 MB。
- 圖片使用標準相對路徑，例如 `![photo](./assets/photo.png)`；影片與音訊使用 `@[video](./assets/demo.mp4)` 與 `@[audio](./assets/voice.mp3)`。
- 「專案 ZIP」包含 Markdown、`assets/` 與 `markword.json`，可重新由「開啟」載入，也是跨裝置與清除網站資料前的建議備份格式。
- 匯入專案時，與本機既有資產同名的檔案會另存新路徑，同步更新文件中的圖片、連結與影音引用；舊資產保留供原文件及版本還原使用。專案 ZIP 仍包含整個本機資產庫，分享前可在「資產」查看檔案清單。
- 可攜 HTML 會把目前文件引用的本機資產轉成 data URL；大型影片會讓 HTML 檔案明顯變大，這種情況建議使用專案 ZIP。
- FastAPI 的 PDF／Word 匯出目前不會傳送瀏覽器 IndexedDB 裡的資產；需要包含資產時，請使用可攜 HTML（可再由瀏覽器列印成 PDF）或專案 ZIP。
- 瀏覽器儲存空間與保留政策依瀏覽器／裝置而異。刪除網站資料、使用不同網域或更換裝置前，請先匯出專案 ZIP。

### 文件載入與保存方式

Markword 目前採用「單一工作草稿」模型，適合在自己的電腦一次處理一份文件：

- 以「開啟」或拖放載入另一個 `.md`／`.markdown`／`.docx` 時，工作區會切換成新內容；Word 轉換失敗時保留目前文件。瀏覽器不會把原始文件加入 Git，也不會上傳到外部服務。
- 目前內容會在編輯後約 350 ms 自動寫入瀏覽器 IndexedDB。內容持續變更時，每五分鐘建立一個本機版本，最多保留 120 個；還原前會先保存當下內容。
- 多個分頁共用草稿時，寫入會比對儲存版本；較舊分頁無法覆寫另一分頁的新內容。出現衝突提示時，先下載該分頁的內容，再重新載入以讀取已儲存的版本。
- Markdown 改變時會重新產生帶有來源起訖行的預覽區塊。表格、程式碼、圖片、Mermaid 與 KaTeX 完成排版後，預覽會重新量測高度，因此同步捲動不依賴某一份固定文件或固定行高。
- 磁碟上的原始檔若被其他程式修改，瀏覽器不會在背景持續監看；請重新開啟或拖放該檔案。若要把工作區內容寫回磁碟，使用 Markdown 下載按鈕。
- 版本記錄、目前草稿與本機資產只存在該瀏覽器的本機儲存空間；清除網站資料或更換瀏覽器前，應先下載專案 ZIP。這不是多文件資料庫，也不會把測試文件提交到 repository。

README 的畫面示範使用另寫的通用 Markdown；實際使用者文件與瀏覽器 IndexedDB 都不屬於 repository 內容。

## 部署與維運

### 環境設定

| 變數 | 預設值 | 用途 |
| --- | --- | --- |
| `MARKWORD_FRONTEND_DIR` | `frontend/dist` | 前端正式版靜態檔目錄 |
| `MARKWORD_EXPORT_DIR` | `exports` | PDF／Word 匯出檔目錄 |
| `MARKWORD_EXPORT_MAX_CONCURRENT` | `2` | 每個 API 程序的同時匯出數 |
| `MARKWORD_EXPORT_TIMEOUT_SECONDS` | `60` | 每份匯出的時間及累計 CPU 秒數預算 |
| `MARKWORD_EXPORT_MEMORY_MB` | `1024` | 每份匯出程序樹的 RSS 預算與轉換程序的資料記憶體上限，單位 MiB |
| `MARKWORD_CORS_ORIGINS` | Vite 的 localhost origins | 逗號分隔的跨來源白名單 |
| `MARKWORD_HOST` | `127.0.0.1` | 使用 `python app.py` 或 `python -m backend.main` 啟動時的監聽位址 |
| `MARKWORD_PORT` | `27860` | 使用 `python app.py` 啟動時的監聽埠 |

### systemd 部署

systemd 範例假設專案已部署到 `/opt/markword`，執行帳號為 `markword`。Debian／Ubuntu 主機先安裝 Node.js、Python、`uv`，以及 WeasyPrint 所需的系統字型與函式庫，接著建立服務帳號和可寫的匯出目錄：

```bash
sudo apt install fonts-noto-cjk libcairo2 libpango-1.0-0 libpangoft2-1.0-0 shared-mime-info
sudo useradd --system --home-dir /opt/markword --shell /usr/sbin/nologin markword
sudo chown -R markword:markword /opt/markword
sudo install -d -o markword -g markword /opt/markword/exports
```

若 `markword` 帳號已存在，略過 `useradd`。再建立 production build 與 Python 虛擬環境：

```bash
cd /opt/markword/frontend
sudo -u markword npm install
sudo -u markword npm run build
cd /opt/markword
sudo -u markword uv venv
sudo -u markword uv pip install -r requirements.txt
sudo /opt/markword/.venv/bin/python -m playwright install-deps chromium
sudo -u markword /opt/markword/.venv/bin/python -m playwright install chromium
sudo install -m 0644 markword.service.example /etc/systemd/system/markword.service
```

若路徑或帳號不同，請先修改 `/etc/systemd/system/markword.service`，然後啟用服務：

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now markword
sudo systemctl status markword
```

更新程式時重新建置前端、更新 Python 依賴，再重啟：

```bash
cd /opt/markword/frontend && sudo -u markword npm install && sudo -u markword npm run build
cd /opt/markword && sudo -u markword uv pip install -r requirements.txt
sudo -u markword /opt/markword/.venv/bin/python -m playwright install chromium
sudo systemctl restart markword
```

預設啟動方式與 Docker Compose 只讓本機連線。API 沒有內建登入驗證；若自行改成區網監聽或透過反向代理公開，需另行加入存取驗證與請求／資源限制。Docker 內部的 Uvicorn 仍監聽 `0.0.0.0`，對外範圍由 Compose 的 `127.0.0.1:27860:27860` 限制。

## 開發

需求：Python 3.10+、Node.js 20+，以及 npm。Python 套件可使用 `uv` 或 `pip` 安裝。

### 專案結構

```text
backend/             FastAPI API、統計與匯出邏輯
frontend/            React + TypeScript + Vite 前端
frontend/dist/       npm run build 的正式版產物（不提交 Git）
exports/             匯出檔案（不提交 Git）
Dockerfile           前後端 multi-stage production image
docker-compose.yml   單機容器部署範例
```

### 本機開發

先安裝後端依賴與本機 Chromium，並安裝前端依賴以提供 Mermaid 套件：

```bash
uv venv
uv pip install -r requirements.txt
uv run python -m playwright install --with-deps chromium
npm --prefix frontend ci
uv run uvicorn backend.main:app --reload --host 127.0.0.1 --port 27860
```

另開一個終端啟動前端：

```bash
cd frontend
npm install
npm run dev
```

開發介面以 Vite 顯示的網址為準（預設 `http://localhost:5173`）。`/api` 請求會由 Vite proxy 轉送到 `http://127.0.0.1:27860`，不需要另外設定 CORS。

若只需要測試 API，可開啟 `http://127.0.0.1:27860/docs`。

### 本機正式版建置

先建置前端，再由 FastAPI 同時提供 API 與靜態檔：

```bash
cd frontend
npm install
npm run build
cd ..
uv run uvicorn backend.main:app --host 127.0.0.1 --port 27860
```

瀏覽器開啟 `http://localhost:27860`。重新部署前端變更時，須再次執行 `npm run build`。

Mermaid 匯出會讀取 `frontend/node_modules/mermaid/dist/mermaid.min.js`，正式版部署也要保留此檔。Docker 建置會自動複製該套件檔並安裝 Chromium；手動部署若只複製 `frontend/dist`，需一併補齊此檔與 Playwright 瀏覽器。

### API

| Method | Path | 用途 |
| --- | --- | --- |
| `GET` | `/api/health` | 服務健康狀態 |
| `POST` | `/api/analyze` | 文字統計 |
| `GET` | `/api/themes` | 取得預覽主題 |
| `POST` | `/api/export/pdf` | 依 `theme` 與 `style` 匯出 PDF |
| `POST` | `/api/export/docx` | 依 `theme` 匯出固定版型 Word，`style` 僅接受 `Classic` |

完整 request／response schema 可在 `/docs` 查看。為了讓既有啟動腳本容易遷移，`python app.py` 仍可使用，但新的部署設定建議直接指定 `backend.main:app`。

### GitHub Pages 建置

儲存庫提供 `.github/workflows/deploy-pages.yml` 作為靜態版發布流程。若要啟用，請先在 **Settings → Pages → Build and deployment** 將來源設為 **GitHub Actions**；設定完成後，推送到 `main` 會觸發建置與部署。

Pages 使用獨立的 `pages` build mode；一般的 `npm run build` 與 FastAPI 完整版部署不受影響。本機可用以下指令驗證 Pages 產物：

```bash
cd frontend
npm ci
npm run build:pages
```

### 測試與檢查

```bash
pytest
cd frontend
npm run lint
npm run build
npm run build:pages
npm run test:ui
```

介面測試會視需要啟動本機預覽，驗證草稿復原、版本還原、下載、鍵盤操作與手機版面；需先備妥 Playwright Chromium 瀏覽器（`npx playwright install chromium`）。

若 `5173` 已被其他專案使用，可設定 `MARKWORD_TEST_PORT=5183` 執行測試。使用既有 Chromium 時，可用 `PLAYWRIGHT_CHROMIUM_EXECUTABLE` 指定執行檔。`.github/workflows/test.yml` 會在 pull request 與 `main` 推送時執行後端測試、兩種前端建置、lint 與 Playwright 測試。

舊版 Gradio 的畫面截圖保留於 `assets/`，僅供遷移前後對照。

## 權利聲明

第三方相依套件維持各自的授權條款。

```less
Copyright © 2026 Hao-Ping Lin (@susuky). All rights reserved.

This repository is publicly accessible for viewing and evaluation only.
No license is granted to use, copy, modify, redistribute, sublicense, or use this software commercially without prior written permission.
```
