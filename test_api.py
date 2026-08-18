import os
from pathlib import Path

import httpx
import pytest

import backend.main as main


@pytest.fixture
def anyio_backend():
    return "asyncio"


@pytest.fixture
async def client():
    transport = httpx.ASGITransport(app=main.app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as api_client:
        yield api_client


@pytest.mark.anyio
async def test_health(client):
    response = await client.get("/api/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


@pytest.mark.anyio
async def test_analyze_mixed_text(client):
    response = await client.post("/api/analyze", json={"text": "Hello 台灣 123\n第二行"})
    assert response.status_code == 200
    assert response.json() == {
        "total_chars": 16,
        "chars_no_spaces": 13,
        "cjk_count": 5,
        "cjk_punct_count": 0,
        "english_words": 1,
        "digit_count": 3,
        "line_count": 2,
    }


@pytest.mark.anyio
async def test_themes(client):
    response = await client.get("/api/themes")
    assert response.status_code == 200
    payload = response.json()
    assert payload["default_theme"] == "Light"
    assert {theme["name"] for theme in payload["themes"]} == {
        "Light",
        "Dark",
        "Nord",
        "Dracula",
    }


@pytest.mark.anyio
async def test_export_rejects_blank_markdown(client):
    response = await client.post(
        "/api/export/pdf",
        json={"markdown": "   ", "theme": "Light"},
    )
    assert response.status_code == 422


@pytest.mark.anyio
async def test_export_rejects_unknown_theme(client):
    response = await client.post(
        "/api/export/docx",
        json={"markdown": "# Test", "theme": "Missing"},
    )
    assert response.status_code == 422


@pytest.mark.anyio
async def test_pdf_export_download_and_cleanup(client, monkeypatch, tmp_path):
    export_dir = tmp_path / "pdf_request"
    export_dir.mkdir()
    export_path = export_dir / "測試文件.pdf"
    export_path.write_bytes(b"%PDF-test")

    monkeypatch.setattr(main, "export_pdf", lambda markdown, theme: str(export_path))
    response = await client.post(
        "/api/export/pdf",
        json={"markdown": "# 測試文件", "theme": "Light"},
    )

    assert response.status_code == 200
    assert response.content == b"%PDF-test"
    assert response.headers["content-type"] == "application/pdf"
    assert "filename*=utf-8''" in response.headers["content-disposition"].lower()
    assert not export_dir.exists()


@pytest.mark.anyio
async def test_spa_fallback(client, monkeypatch, tmp_path):
    (tmp_path / "index.html").write_text("<main>Markword</main>", encoding="utf-8")
    monkeypatch.setattr(main, "FRONTEND_DIR", Path(tmp_path))

    response = await client.get("/editor/document-1")
    assert response.status_code == 200
    assert "Markword" in response.text


@pytest.mark.anyio
async def test_unknown_api_route_stays_json_404(client):
    response = await client.get("/api/not-a-route")
    assert response.status_code == 404
    assert response.json() == {"detail": "Not Found"}
