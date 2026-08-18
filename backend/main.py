"""FastAPI application serving the Markword API and built web client."""

from __future__ import annotations

import os
import shutil
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Literal

from fastapi import FastAPI, HTTPException
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from starlette.background import BackgroundTask

from app import (
    _cleanup_old_exports,
    analyze_text,
    export_pdf,
    export_word,
)
from backend.schemas import (
    AnalyzeRequest,
    AnalyzeResponse,
    ExportRequest,
    ThemeResponse,
    ThemesResponse,
)
from themes import THEMES


PROJECT_ROOT = Path(__file__).resolve().parent.parent
FRONTEND_DIR = Path(
    os.getenv("MARKWORD_FRONTEND_DIR", str(PROJECT_ROOT / "frontend" / "dist"))
).resolve()


@asynccontextmanager
async def lifespan(_: FastAPI):
    await run_in_threadpool(_cleanup_old_exports)
    yield
    await run_in_threadpool(_cleanup_old_exports)


app = FastAPI(
    title="Markword API",
    description="文字統計與 Markdown PDF / Word 匯出 API",
    version="0.2.0",
    lifespan=lifespan,
)

cors_origins = [
    origin.strip()
    for origin in os.getenv(
        "MARKWORD_CORS_ORIGINS",
        "http://localhost:5173,http://127.0.0.1:5173",
    ).split(",")
    if origin.strip()
]
if cors_origins:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=cors_origins,
        allow_credentials=True,
        allow_methods=["GET", "POST", "OPTIONS"],
        allow_headers=["Content-Type"],
    )


@app.get("/api/health", tags=["system"])
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/api/analyze", response_model=AnalyzeResponse, tags=["text"])
async def analyze(payload: AnalyzeRequest) -> AnalyzeResponse:
    metrics = analyze_text(payload.text)
    return AnalyzeResponse(
        total_chars=metrics[0],
        chars_no_spaces=metrics[1],
        cjk_count=metrics[2],
        cjk_punct_count=metrics[3],
        english_words=metrics[4],
        digit_count=metrics[5],
        line_count=metrics[6],
    )


@app.get("/api/themes", response_model=ThemesResponse, tags=["markdown"])
async def list_themes() -> ThemesResponse:
    return ThemesResponse(
        themes=[
            ThemeResponse(
                name=theme.name,
                body_bg=theme.body_bg,
                body_color=theme.body_color,
                mermaid_theme=theme.mermaid_theme,
                css=theme.css,
            )
            for theme in THEMES.values()
        ]
    )


def _remove_export_directory(path: str) -> None:
    """Remove the per-request directory after its response has been sent."""
    try:
        shutil.rmtree(Path(path).parent, ignore_errors=True)
    except (OSError, ValueError):
        pass


async def _export_response(
    payload: ExportRequest,
    export_format: Literal["pdf", "docx"],
) -> FileResponse:
    exporter = export_pdf if export_format == "pdf" else export_word
    media_type = (
        "application/pdf"
        if export_format == "pdf"
        else "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    )

    try:
        path = await run_in_threadpool(exporter, payload.markdown, payload.theme)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"{export_format} export failed") from exc

    if not path or not os.path.isfile(path):
        raise HTTPException(status_code=500, detail=f"{export_format} export produced no file")

    return FileResponse(
        path,
        filename=os.path.basename(path),
        media_type=media_type,
        background=BackgroundTask(_remove_export_directory, path),
    )


@app.post("/api/export/pdf", tags=["markdown"])
async def create_pdf(payload: ExportRequest) -> FileResponse:
    return await _export_response(payload, "pdf")


@app.post("/api/export/docx", tags=["markdown"])
async def create_docx(payload: ExportRequest) -> FileResponse:
    return await _export_response(payload, "docx")


@app.get("/{full_path:path}", include_in_schema=False)
async def serve_frontend(full_path: str):
    """Serve Vite output and fall back to index.html for client-side routes."""
    if full_path.startswith("api/"):
        return JSONResponse({"detail": "Not Found"}, status_code=404)

    index_path = FRONTEND_DIR / "index.html"
    if not index_path.is_file():
        return JSONResponse(
            {"detail": "Frontend build not found. Run the frontend build first."},
            status_code=404,
        )

    requested_path = (FRONTEND_DIR / full_path).resolve()
    try:
        requested_path.relative_to(FRONTEND_DIR)
    except ValueError:
        return JSONResponse({"detail": "Not Found"}, status_code=404)

    if full_path and requested_path.is_file():
        return FileResponse(requested_path)
    return FileResponse(index_path)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "backend.main:app",
        host=os.getenv("MARKWORD_HOST", "0.0.0.0"),
        port=int(os.getenv("MARKWORD_PORT", "27860")),
    )
