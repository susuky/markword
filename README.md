# Markword

Markword 是以 FastAPI 與 React/Vite 建構的文字統計及 Markdown 編輯器。編輯器與預覽位於同一個前端應用，支援同步捲動、Mermaid、語法高亮、主題切換，以及 PDF / Word 匯出。

## 功能

- 即時統計總字數、中文字、英文單字、數字、全形標點與行數
- Markdown 即時預覽與編輯器／預覽雙向同步捲動
- Light、Dark、Nord、Dracula 四種主題
- 程式碼語法高亮與 Mermaid 圖表
- 匯出 PDF 與 Word (`.docx`)
- 單一 FastAPI 程序提供 API 與正式版前端靜態檔

## 專案結構

```text
backend/             FastAPI API、統計與匯出邏輯
frontend/            React + TypeScript + Vite 前端
frontend/dist/       npm run build 的正式版產物（不提交 Git）
exports/             匯出檔案（不提交 Git）
Dockerfile           前後端 multi-stage production image
docker-compose.yml   單機容器部署範例
```

## 本機開發

需求：Python 3.10+、Node.js 20+，以及 npm。Python 套件可使用 `uv` 或 `pip` 安裝。

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

## 本機 production 模式

先建置前端，再由 FastAPI 同時提供 API 與靜態檔：

```bash
cd frontend
npm install
npm run build
cd ..
uv run uvicorn backend.main:app --host 0.0.0.0 --port 27860
```

瀏覽器開啟 `http://localhost:27860`。重新部署前端變更時，須再次執行 `npm run build`。

可用以下環境變數覆寫預設路徑：

| 變數 | 預設值 | 用途 |
| --- | --- | --- |
| `MARKWORD_FRONTEND_DIR` | `frontend/dist` | 前端正式版靜態檔目錄 |
| `MARKWORD_EXPORT_DIR` | `exports` | PDF / Word 匯出檔目錄 |
| `MARKWORD_CORS_ORIGINS` | Vite 的 localhost origins | 逗號分隔的跨來源白名單 |
| `MARKWORD_HOST` | `0.0.0.0` | 使用 `python app.py` 啟動時的監聽位址 |
| `MARKWORD_PORT` | `27860` | 使用 `python app.py` 啟動時的監聽埠 |

主要 API：

| Method | Path | 用途 |
| --- | --- | --- |
| `GET` | `/api/health` | 服務健康狀態 |
| `POST` | `/api/analyze` | 文字統計 |
| `GET` | `/api/themes` | 取得預覽主題 |
| `POST` | `/api/export/pdf` | 匯出 PDF |
| `POST` | `/api/export/docx` | 匯出 Word |

完整 request / response schema 可在 `/docs` 查看。為了讓既有啟動腳本容易遷移，`python app.py` 仍可使用，但新的部署設定建議直接指定 `backend.main:app`。

## Docker Compose 部署

```bash
docker compose up --build -d
docker compose logs -f markword
```

服務會在 `http://localhost:27860` 提供。`markword-exports` named volume 保存匯出結果；更新映像時可保留此 volume。

停止服務：

```bash
docker compose down
```

若確定不再需要匯出檔，才使用 `docker compose down -v` 一併刪除 volume。

## systemd 部署

systemd 範例假設專案已部署到 `/opt/markword`，執行帳號為 `markword`。Debian / Ubuntu 主機先安裝 Node.js、Python、`uv`，以及 WeasyPrint 所需的系統字型與函式庫，接著建立服務帳號和可寫的匯出目錄：

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

## 測試與檢查

```bash
pytest
cd frontend
npm run lint
npm run build
```

舊版 Gradio 的畫面截圖保留於 `assets/`，僅供遷移前後對照。

## License

[MIT](LICENSE)
