# 開發與部署

[產品介紹與簡易用法](../README.zh-TW.md) · [English](../README.md)

本文件供已取得作者事先書面許可的開發與部署使用者參考。一般使用者可先閱讀 README 的快速開始。

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
sudo -u markword npm ci
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
cd /opt/markword/frontend && sudo -u markword npm ci && sudo -u markword npm run build
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

先安裝後端依賴與本機 Chromium，並安裝前端依賴以提供 Mermaid 與 KaTeX 套件：

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
npm ci
npm run dev
```

開發介面以 Vite 顯示的網址為準（預設 `http://localhost:5173`）。`/api` 請求會由 Vite proxy 轉送到 `http://127.0.0.1:27860`，不需要另外設定 CORS。

若只需要測試 API，可開啟 `http://127.0.0.1:27860/docs`。

### 本機正式版建置

先建置前端，再由 FastAPI 同時提供 API 與靜態檔：

```bash
cd frontend
npm ci
npm run build
cd ..
uv run uvicorn backend.main:app --host 127.0.0.1 --port 27860
```

瀏覽器開啟 `http://localhost:27860`。重新部署前端變更時，須再次執行 `npm run build`。

圖表匯出會讀取 `frontend/node_modules/mermaid/dist/mermaid.min.js`；公式匯出會讀取 `frontend/node_modules/katex/dist/` 的 JavaScript、CSS 與字型，正式版部署也要保留。Docker 建置會自動複製這些套件檔並安裝 Chromium；手動部署若只複製 `frontend/dist`，需一併補齊上述檔案與 Playwright 瀏覽器。

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

`.github/workflows/deploy-pages.yml` 提供手動發布，不會因推送程式而自動部署。先在 **Settings → Pages → Build and deployment → Source** 選擇 **GitHub Actions**，再到 **Actions → Deploy GitHub Pages → Run workflow** 選擇要發布的分支。部署網址以 workflow 的 `github-pages` environment 顯示結果為準；尚未成功部署前，不代表已有可用的線上版本。

Pages 使用獨立的 `pages` build mode；一般的 `npm run build` 與 FastAPI 完整版部署不受影響。本機可用以下指令驗證 Pages 產物：

```bash
cd frontend
npm ci
npm run build:pages
```

產物位於 `frontend/dist-pages`，使用 `/markword/` 作為網站路徑。本機預覽可執行 `npm run preview -- --mode pages`，再開啟 Vite 顯示網址下的 `/markword/`；若部署到其他儲存庫名稱或自訂網域根目錄，請同步調整 `frontend/vite.config.ts` 的 Pages `base`。

Pages 版在瀏覽器內處理編輯、匯入、草稿、版本記錄、附件與文字統計，可下載 Markdown、專案 ZIP 及可攜 HTML。不提供直接匯出 PDF／Word；PDF 可由可攜 HTML 透過瀏覽器列印，直接 PDF／Word 匯出請使用本機完整版。

### 測試與檢查

```bash
uv pip install pytest httpx
uv run pytest
cd frontend
npm run lint
npm run build
npm run build:pages
npm run test:ui
```

介面測試會視需要啟動本機預覽，驗證草稿復原、版本還原、下載、鍵盤操作與手機版面；需先備妥 Playwright Chromium 瀏覽器（`npx playwright install chromium`）。

若 `5173` 已被其他專案使用，可設定 `MARKWORD_TEST_PORT=5183` 執行測試。使用既有 Chromium 時，可用 `PLAYWRIGHT_CHROMIUM_EXECUTABLE` 指定執行檔。`.github/workflows/test.yml` 會在 `main` 推送或手動觸發時執行後端測試、兩種前端建置、lint 與 Playwright 測試。

## 匯出處理與資源限制

- PDF／Word 的 Mermaid 圖表與 KaTeX 公式使用已安裝的套件與本機 Chromium 產生 PNG，不會將原文傳給第三方服務。公式保留 LaTeX 替代文字，但不是可編輯的 Word 原生方程式；每份文件最多繪製 200 個公式，每式最多 10,000 個字元，無效或超限公式會保留來源並提示。React 預覽仍在瀏覽器內繪製圖表與公式。
- PDF／Word 支援待辦核取方塊、腳註與 CommonMark 程式碼圍欄（含波浪號與較長的反引號）。Word 的腳註以文中上標與文件末尾的編號段落呈現，不是 Word 原生腳註。
- 匯出用 Chromium 在處理圖表前就停用網路，並限制圖片、字型與樣式的載入。無法繪製圖表時，文件會保留原始碼並標示無法繪圖；缺少渲染器或執行逾時會讓匯出失敗，不會轉送外部服務。
- PDF 的資源讀取只接受內嵌的 `data:` 內容。圖片、CSS、字型、SVG 巢狀引用或附件若要求讀取網路或 `file://` 檔案，匯出會中止，API 回傳 `422`，並清除未完成的檔案。Word 也不讀取外部圖片；一般 `http`／`https`／`mailto` 超連結仍會保留。
- Linux API 每份匯出使用獨立工作程序，預設同時最多兩份，不另行排隊；滿載時回傳 `503`。每份工作的時間與累計 CPU 預算為 60 秒，記憶體預算為 1,024 MiB。系統每 100 ms 檢查包含 Chromium 的程序樹 CPU 與 RSS，另對轉換程序及其子程序設定 CPU、資料記憶體及 128 MiB 單檔寫入上限。超限、取消或轉換程序崩潰時，會回收子程序並清理該次暫存目錄；成功成品在下載回應結束後清除。
- 這些限制以單個 API 程序為範圍，RSS 是定期檢查而非容器層級硬上限。多個 Uvicorn worker 各有自己的併發額度；對外部署仍需另設整體容器資源與存取限制。
- 匯出 PDF／Word 時，瀏覽器會將目前文件引用的 PNG、JPEG、GIF、WebP、BMP 本機圖片嵌入請求，傳給所連線的 Markword API。每張圖片上限為 3 MiB、最長邊 8,192 像素及 1,600 萬像素；含圖片的請求內容仍受 500 萬字元上限限制。GIF／WebP 只保留第一格；SVG、AVIF、影音及其他附件不會嵌入，請使用可攜 HTML 或專案 ZIP 保留。
- 安裝套件與瀏覽器時需要下載依賴；安裝完成後，這兩種匯出不需要連上網際網路。文件會送至你所連線的 Markword API，因此要讓文件留在自己的電腦，請在該電腦執行服務。Markdown 內直接引用的遠端圖片仍可能由一般瀏覽器預覽載入。
