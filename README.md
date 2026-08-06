# Gradio 線上文字字數統計 & Markdown 預覽服務

Gradio 文字字數統計與 Markdown 即時預覽工具，支援 Mermaid 流程圖渲染以及 PDF / Word 格式匯出。

## 🌟 功能特點

- **即時字數統計**：貼上或修改文字時自動動態更新統計結果。
  - 總字數 (含/不含空格與換行)
  - 中文字數 (漢字) & 全形標點
  - 英文字數 (Words) & 數字個數
  - 總行數
- **Markdown 即時預覽**：
  - **4 種主題切換**：`Light` (明亮)、`Dark` (暗黑)、`Nord` (極地)、`Dracula` (德古拉)
  - **Pygments 語法高亮**：程式碼區塊關鍵字、字串、數字、註解自動上色
  - **Mermaid 流程圖**：即時繪製流程圖與結構圖
- **匯出功能**：
  - **📄 匯出 PDF**：帶有選定主題配色與 Pygments 語法高亮，Mermaid 自動轉為圖檔
  - **📝 匯出 Word (.docx)**：標題主題配色、程式碼區塊語法高亮、表格與 Mermaid 圖片

---

## 🚀 快速開始 (使用 `uv`)

### 1. 建立虛擬環境與安裝依賴

```bash
uv venv
uv pip install -r requirements.txt
```

### 2. 啟動 Gradio 伺服器

```bash
uv run python app.py
```

瀏覽器造訪：`http://localhost:27860` 或 `http://<伺服器IP>:27860` 即可使用。

---

## ⚙️ systemctl (Systemd) 服務設定

專案目錄下已包含 `wordcount.service` 檔：

```bash
# 1. 複製服務檔
sudo cp wordcount.service /etc/systemd/system/wordcount.service

# 2. 載入並啟動服務
sudo systemctl daemon-reload
sudo systemctl enable --now wordcount

# 3. 查看服務狀態
sudo systemctl status wordcount
```

---

## 🧪 單元測試

```bash
.venv/bin/python -m unittest test_app.py -v
```
