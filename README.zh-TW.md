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
- IndexedDB 草稿復原、每五分鐘自動版本、手動版本與非破壞還原
- 手機版編輯／預覽 tabs，以及可安裝的 PWA 離線 app shell
- 完整繁體中文／英文介面切換，並保存語言偏好
- Markdown、可攜 HTML、PDF 與 Word (`.docx`) 集中式匯出
- 經典、編輯排版、報告、精簡四種 HTML／PDF 成品版型
- 單一 FastAPI 程序提供 API 與正式版前端靜態檔

## 使用 Markword

### 編輯器操作

- `Ctrl/Cmd+K`：開啟命令選單；也可在空白行輸入 `/` 快速開啟插入命令。
- `Ctrl/Cmd+F`：搜尋／取代；`Ctrl/Cmd+S`：下載目前 Markdown。
- `?`：顯示快捷鍵；`Ctrl/Cmd+Shift+F`：專注模式。
- 左側大綱可跳至標題；雙擊右側預覽區塊可回到對應原始碼。
- 工具列可開啟或拖放本機 Markdown、Word（`.docx`）或 Markword 專案 ZIP；圖片、影片、音訊與其他檔案可從「資產」匯入，也可直接貼上或拖入編輯區。
- Word 匯入在瀏覽器內轉換，支援標題、段落、粗體、斜體、刪除線、清單、連結、基本表格與內嵌圖片。表格第一列會成為 Markdown 表頭；頁首頁尾、分頁、合併儲存格及精確版面不保證保留，請檢查轉換結果。Markdown／Word 單檔上限為 15 MiB（15,728,640 位元組），Word 解壓後內容上限為 50 MB；舊版 `.doc` 請先另存為 `.docx`。
- Word 圖片會存入本機資產庫；如需連同圖片備份，請匯出專案 ZIP 或可攜 HTML。只下載 Markdown 不會包含圖片檔。GitHub Pages 版本也能匯入 Word，無須上傳文件。
- 「匯出」選單集中 Markdown、專案 ZIP、HTML、PDF、Word；HTML／PDF 可先選擇經典、編輯排版、報告或精簡版型。
- 主題同時控制預覽、HTML、PDF、Word 與 Mermaid 配色；可攜 HTML 會嵌入已渲染的 Mermaid SVG 與本機資產。
- 草稿存在瀏覽器 IndexedDB；內容變更後每五分鐘建立一個本機版本，最多保留 120 個。還原版本前會先備份目前內容。
- PWA 只快取編輯器／預覽所需的 app shell 與靜態資源；PDF／Word 仍由本機 FastAPI 服務產生。
- 使用頁首的語言按鈕切換英文與繁體中文；偏好會保存在本機，且不會修改文件內容。

### 本機資產與備份

- 本機資產以 Blob 儲存在瀏覽器 IndexedDB，不會上傳到 GitHub Pages 或 Markword 伺服器；單一檔案上限為 200 MB，專案內容上限為 500 MB。
- 圖片使用標準相對路徑，例如 `![photo](./assets/photo.png)`；影片與音訊使用 `@[video](./assets/demo.mp4)` 與 `@[audio](./assets/voice.mp3)`。
- 「專案 ZIP」包含 Markdown、`assets/` 與 `markword.json`，可重新由「開啟」載入，也是跨裝置與清除網站資料前的建議備份格式。
- 可攜 HTML 會把目前文件引用的本機資產轉成 data URL；大型影片會讓 HTML 檔案明顯變大，這種情況建議使用專案 ZIP。
- FastAPI 的 PDF／Word 匯出目前不會傳送瀏覽器 IndexedDB 裡的資產；需要包含資產時，請使用可攜 HTML（可再由瀏覽器列印成 PDF）或專案 ZIP。
- 瀏覽器儲存空間與保留政策依瀏覽器／裝置而異。刪除網站資料、使用不同網域或更換裝置前，請先匯出專案 ZIP。

### 文件載入與保存方式

Markword 目前採用「單一工作草稿」模型，適合在自己的電腦一次處理一份文件：

- 以「開啟」或拖放載入另一個 `.md`／`.markdown`／`.docx` 時，工作區會切換成新內容；Word 轉換失敗時保留目前文件。瀏覽器不會把原始文件加入 Git，也不會上傳到外部服務。
- 目前內容會在編輯後約 350 ms 自動寫入瀏覽器 IndexedDB。內容持續變更時，每五分鐘建立一個本機版本，最多保留 120 個；還原前會先保存當下內容。
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
| `MARKWORD_CORS_ORIGINS` | Vite 的 localhost origins | 逗號分隔的跨來源白名單 |
| `MARKWORD_HOST` | `0.0.0.0` | 使用 `python app.py` 啟動時的監聽位址 |
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
sudo systemctl restart markword
```

若要直接公開到網際網路，建議在 FastAPI 前方放置 Caddy 或 Nginx，負責 TLS、網域與請求大小限制；Uvicorn 維持監聽 loopback，再由 reverse proxy 轉送。

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

先安裝後端依賴並啟動 FastAPI：

```bash
uv venv
uv pip install -r requirements.txt
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
uv run uvicorn backend.main:app --host 0.0.0.0 --port 27860
```

瀏覽器開啟 `http://localhost:27860`。重新部署前端變更時，須再次執行 `npm run build`。

### API

| Method | Path | 用途 |
| --- | --- | --- |
| `GET` | `/api/health` | 服務健康狀態 |
| `POST` | `/api/analyze` | 文字統計 |
| `GET` | `/api/themes` | 取得預覽主題 |
| `POST` | `/api/export/pdf` | 依 `theme` 與 `style` 匯出 PDF |
| `POST` | `/api/export/docx` | 依相同的 `style` 契約匯出 Word |

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

舊版 Gradio 的畫面截圖保留於 `assets/`，僅供遷移前後對照。

## 權利聲明

第三方相依套件維持各自的授權條款。

```less
Copyright © 2026 Hao-Ping Lin (@susuky). All rights reserved.

This repository is publicly accessible for viewing and evaluation only.
No license is granted to use, copy, modify, redistribute, sublicense, or use this software commercially without prior written permission.
```
