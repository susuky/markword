# Gradio 線上文字字數統計服務 (Gradio Word Count Server)

極簡、高效且低依賴的 Gradio 文字字數統計工具，使用 `uv` 進行虛擬環境與套件管理，並提供完整的 `systemctl` (systemd) 服務設定檔。

## 🌟 功能特點

- **即時統計**：在輸入框貼上或修改文字時，系統會自動動態更新統計結果。
- **多維度字數分析**：
  - **總字數 (含空格/換行)**
  - **不含空格/換行字數**
  - **中文字數 (漢字)**
  - **全形 / 中文標點**
  - **英文字數 (Words)**
  - **數字個數**
  - **總行數**
- **極簡依賴**：僅依賴 `gradio` 套件，其餘統計邏輯均採用 Python 標準庫 (`re`) 實作。
- **系統服務整合**：附帶 `wordcount.service` 檔，支援透過 `systemctl` 開機自啟動與背景運行。

---

## 🚀 快速開始 (使用 `uv`)

### 1. 建立虛擬環境並安裝依賴

```bash
# 使用 uv 建立虛擬環境
uv venv

# 安裝依賴 (僅 gradio)
uv pip install -r requirements.txt
```

### 2. 啟動 Gradio 伺服器

你可以選擇使用 `uv run` 啟動：

```bash
uv run python app.py
```

或使用虛擬環境中的 Python 執行：

```bash
.venv/bin/python app.py
```

啟動後，瀏覽器造訪：`http://localhost:27860` 或 `http://<伺服器IP>:27860` 即可使用。

---

## ⚙️ systemctl (Systemd) 服務設定

專案目錄下已為您建立好 `wordcount.service` 檔：

### 1. 複製服務檔至系統目錄

```bash
sudo cp wordcount.service /etc/systemd/system/wordcount.service
```

### 2. 載入並啟動服務

```bash
# 重新載入 systemd 設定
sudo systemctl daemon-reload

# 設定開機自動啟動並立即啟動服務
sudo systemctl enable --now wordcount
```

### 3. 管理服務命令

- **查看服務狀態**：
  ```bash
  sudo systemctl status wordcount
  ```
- **停止服務**：
  ```bash
  sudo systemctl stop wordcount
  ```
- **重啟服務**：
  ```bash
  sudo systemctl restart wordcount
  ```
- **查看即時日誌**：
  ```bash
  journalctl -u wordcount -f
  ```

---

## 🧪 單元測試

若需執行單元測試驗證字數統計邏輯：

```bash
.venv/bin/python -m unittest test_app.py
```
