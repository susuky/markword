"""Shared local workspace, persisted in SQLite independently of the browser."""

from __future__ import annotations

import base64
import binascii
import hashlib
import json
import os
import sqlite3
import time
import uuid
from contextlib import contextmanager
from pathlib import Path
from threading import Lock
from typing import Literal

from fastapi import APIRouter, HTTPException, Query, Response
from pydantic import BaseModel, Field


router = APIRouter(prefix="/api/workspace", tags=["workspace"])
DEFAULT_DATABASE = Path(__file__).resolve().parent.parent / "data" / "markword.sqlite3"
Metadata = dict[str, str | int | float | bool | None]
MAX_REVISIONS = 120
_database_initialization_lock = Lock()
_initialized_databases: set[Path] = set()


class SaveDraft(BaseModel):
    content: str
    metadata: Metadata = Field(default_factory=dict)
    expectedVersion: int | None = Field(ge=0)


class ImportedDraft(BaseModel):
    id: str = Field(min_length=1, max_length=200)
    version: int = Field(default=0, ge=0)
    content: str
    metadata: Metadata = Field(default_factory=dict)
    createdAt: int = Field(ge=0)
    updatedAt: int = Field(ge=0)
    trashedAt: int | None = Field(default=None, ge=0)


class Revision(BaseModel):
    id: str = Field(min_length=1, max_length=200)
    documentId: str = Field(min_length=1, max_length=200)
    content: str
    metadata: Metadata = Field(default_factory=dict)
    createdAt: int = Field(ge=0)
    reason: Literal["auto", "manual", "pre-restore", "pre-open"]


class ImportedAsset(BaseModel):
    id: str = Field(min_length=1, max_length=200)
    path: str = Field(min_length=1, max_length=4096)
    name: str
    type: str
    kind: Literal["image", "video", "audio", "file"]
    size: int = Field(ge=0, le=200 * 1024 * 1024)
    createdAt: int = Field(ge=0)
    updatedAt: int = Field(ge=0)
    data: str


class ImportWorkspace(BaseModel):
    drafts: list[ImportedDraft] = Field(default_factory=list)
    revisions: list[Revision] = Field(default_factory=list)
    assets: list[ImportedAsset] = Field(default_factory=list)


class TrashDraft(BaseModel):
    trashed: bool
    expectedVersion: int = Field(ge=0)


class RestoreRevision(BaseModel):
    revisionId: str
    currentContent: str
    currentMetadata: Metadata = Field(default_factory=dict)
    expectedVersion: int = Field(ge=0)
    documentId: str


def initialize_database(path: Path) -> None:
    if path in _initialized_databases:
        return
    with _database_initialization_lock:
        if path in _initialized_databases:
            return
        path.parent.mkdir(parents=True, exist_ok=True)
        connection = sqlite3.connect(path, timeout=15)
        try:
            connection.execute("PRAGMA journal_mode=WAL")
            connection.executescript("""
            CREATE TABLE IF NOT EXISTS drafts (
                id TEXT PRIMARY KEY, version INTEGER NOT NULL,
                content TEXT NOT NULL, metadata TEXT NOT NULL,
                created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
                trashed_at INTEGER
            );
            CREATE TABLE IF NOT EXISTS revisions (
                id TEXT PRIMARY KEY, document_id TEXT NOT NULL,
                content TEXT NOT NULL, metadata TEXT NOT NULL,
                created_at INTEGER NOT NULL, reason TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS revisions_document
                ON revisions(document_id, created_at DESC);
            CREATE TABLE IF NOT EXISTS assets (
                id TEXT PRIMARY KEY, path TEXT NOT NULL UNIQUE,
                name TEXT NOT NULL, type TEXT NOT NULL, kind TEXT NOT NULL,
                size INTEGER NOT NULL, blob BLOB NOT NULL,
                created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS imported_drafts (
                fingerprint TEXT PRIMARY KEY, document_id TEXT NOT NULL
            );
            """)
        finally:
            connection.close()
        _initialized_databases.add(path)


@contextmanager
def database(*, write: bool = False):
    path = Path(os.getenv("MARKWORD_DATABASE_PATH", str(DEFAULT_DATABASE))).expanduser().resolve()
    initialize_database(path)
    connection = sqlite3.connect(path, timeout=15)
    connection.row_factory = sqlite3.Row
    try:
        connection.execute("BEGIN IMMEDIATE" if write else "BEGIN")
        yield connection
        connection.commit()
    except BaseException:
        connection.rollback()
        raise
    finally:
        connection.close()


def encoded(value) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False)


def now() -> int:
    return time.time_ns() // 1_000_000


def draft_record(row: sqlite3.Row | None) -> dict | None:
    if row is None:
        return None
    return {
        "id": row["id"], "version": row["version"], "content": row["content"],
        "metadata": json.loads(row["metadata"]), "createdAt": row["created_at"],
        "updatedAt": row["updated_at"], "trashedAt": row["trashed_at"],
    }


def revision_record(row: sqlite3.Row) -> dict:
    return {
        "id": row["id"], "documentId": row["document_id"], "content": row["content"],
        "metadata": json.loads(row["metadata"]), "createdAt": row["created_at"],
        "reason": row["reason"],
    }


def asset_record(row: sqlite3.Row) -> dict:
    return {
        "id": row["id"], "path": row["path"], "name": row["name"],
        "type": row["type"], "kind": row["kind"], "size": row["size"],
        "createdAt": row["created_at"], "updatedAt": row["updated_at"],
    }


def find_draft(connection: sqlite3.Connection, document_id: str) -> dict | None:
    return draft_record(connection.execute("SELECT * FROM drafts WHERE id = ?", (document_id,)).fetchone())


def put_draft(connection: sqlite3.Connection, draft: dict) -> None:
    connection.execute(
        """INSERT OR REPLACE INTO drafts
           (id, version, content, metadata, created_at, updated_at, trashed_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)""",
        (draft["id"], draft["version"], draft["content"], encoded(draft["metadata"]),
         draft["createdAt"], draft["updatedAt"], draft.get("trashedAt")),
    )


def require_version(draft: dict | None, expected_version: int | None) -> None:
    if (draft["version"] if draft else None) != expected_version:
        raise HTTPException(409, "Document changed. Save a copy or reload the current version.")


def save_draft(connection: sqlite3.Connection, document_id: str, payload: SaveDraft) -> dict:
    previous = find_draft(connection, document_id)
    if previous and previous["trashedAt"] is not None:
        raise HTTPException(409, "Document is in the trash.")
    if previous and previous["content"] == payload.content and previous["metadata"] == payload.metadata:
        return previous
    require_version(previous, payload.expectedVersion)
    timestamp = now()
    draft = {
        "id": document_id, "version": previous["version"] + 1 if previous else 1,
        "content": payload.content, "metadata": payload.metadata,
        "createdAt": previous["createdAt"] if previous else timestamp,
        "updatedAt": timestamp, "trashedAt": None,
    }
    put_draft(connection, draft)
    return draft


def put_revision(connection: sqlite3.Connection, revision: dict, *, prune: bool = True) -> None:
    existing = connection.execute("SELECT * FROM revisions WHERE id = ?", (revision["id"],)).fetchone()
    if existing:
        if revision_record(existing) == revision:
            return
        raise HTTPException(409, "Revision ID already exists.")
    connection.execute(
        """INSERT INTO revisions (id, document_id, content, metadata, created_at, reason)
           VALUES (?, ?, ?, ?, ?, ?)""",
        (revision["id"], revision["documentId"], revision["content"],
         encoded(revision["metadata"]), revision["createdAt"], revision["reason"]),
    )
    if prune:
        connection.execute(
            """DELETE FROM revisions WHERE id IN (
                SELECT id FROM revisions WHERE document_id = ?
                ORDER BY created_at DESC, rowid DESC LIMIT -1 OFFSET ?
            )""", (revision["documentId"], MAX_REVISIONS),
        )


def decoded_asset(asset: ImportedAsset) -> bytes:
    try:
        blob = base64.b64decode(asset.data, validate=True)
    except (ValueError, binascii.Error) as exc:
        raise HTTPException(422, f"Invalid asset data: {asset.path}") from exc
    if len(blob) != asset.size:
        raise HTTPException(422, f"Asset size does not match data: {asset.path}")
    return blob


def put_asset(connection: sqlite3.Connection, asset: dict, blob: bytes) -> None:
    same_path = connection.execute("SELECT id FROM assets WHERE path = ?", (asset["path"],)).fetchone()
    if same_path and same_path["id"] != asset["id"]:
        raise HTTPException(409, {"message": "Asset path already exists.", "paths": [asset["path"]]})
    connection.execute(
        """INSERT INTO assets (id, path, name, type, kind, size, blob, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET path=excluded.path, name=excluded.name,
           type=excluded.type, kind=excluded.kind, size=excluded.size,
           blob=excluded.blob, updated_at=excluded.updated_at""",
        (asset["id"], asset["path"], asset["name"], asset["type"], asset["kind"],
         len(blob), blob, asset["createdAt"], asset["updatedAt"]),
    )


@router.get("")
def get_workspace() -> dict:
    with database() as connection:
        return {
            "drafts": [draft_record(row) for row in connection.execute("SELECT * FROM drafts ORDER BY updated_at DESC")],
            "revisions": [revision_record(row) for row in connection.execute("SELECT * FROM revisions ORDER BY created_at DESC")],
            "assets": [asset_record(row) for row in connection.execute(
                "SELECT id, path, name, type, kind, size, created_at, updated_at FROM assets ORDER BY created_at"
            )],
        }


@router.get("/drafts/{document_id}")
def get_draft(document_id: str) -> dict:
    with database() as connection:
        draft = find_draft(connection, document_id)
        if draft is None:
            raise HTTPException(404, "Document not found.")
        return draft


@router.get("/drafts")
def list_drafts() -> list[dict]:
    with database() as connection:
        return [draft_record(row) for row in connection.execute("SELECT * FROM drafts ORDER BY updated_at DESC")]


@router.post("/drafts/{document_id}")
def update_draft(document_id: str, payload: SaveDraft) -> dict:
    with database(write=True) as connection:
        return save_draft(connection, document_id, payload)


@router.post("/drafts/{document_id}/trash")
def trash_draft(document_id: str, payload: TrashDraft) -> dict:
    with database(write=True) as connection:
        draft = find_draft(connection, document_id)
        if draft is None:
            raise HTTPException(404, "Document not found.")
        require_version(draft, payload.expectedVersion)
        draft.update(version=draft["version"] + 1, trashedAt=now() if payload.trashed else None)
        put_draft(connection, draft)
        return draft


@router.get("/revisions")
def list_revisions(documentId: str | None = None) -> list[dict]:
    with database() as connection:
        if documentId is None:
            rows = connection.execute("SELECT * FROM revisions ORDER BY created_at DESC, rowid DESC")
        else:
            rows = connection.execute(
                "SELECT * FROM revisions WHERE document_id = ? ORDER BY created_at DESC, rowid DESC", (documentId,),
            )
        return [revision_record(row) for row in rows]


@router.post("/revisions")
def create_revision(payload: Revision) -> dict:
    revision = payload.model_dump()
    with database(write=True) as connection:
        if find_draft(connection, payload.documentId) is None:
            raise HTTPException(404, "Document not found.")
        put_revision(connection, revision)
    return revision


@router.delete("/revisions/{revision_id}")
def delete_revision(revision_id: str, documentId: str = Query(...)) -> dict:
    with database(write=True) as connection:
        result = connection.execute("DELETE FROM revisions WHERE id = ? AND document_id = ?", (revision_id, documentId))
        if not result.rowcount:
            raise HTTPException(404, "Revision not found.")
    return {}


@router.post("/restore")
def restore_revision(payload: RestoreRevision) -> dict:
    with database(write=True) as connection:
        previous = find_draft(connection, payload.documentId)
        if previous is None:
            raise HTTPException(404, "Document not found.")
        require_version(previous, payload.expectedVersion)
        if previous["trashedAt"] is not None:
            raise HTTPException(409, "Document is in the trash.")
        row = connection.execute(
            "SELECT * FROM revisions WHERE id = ? AND document_id = ?",
            (payload.revisionId, payload.documentId),
        ).fetchone()
        if row is None:
            raise HTTPException(404, "Revision not found.")
        revision = revision_record(row)
        put_revision(connection, {
            "id": str(uuid.uuid4()), "documentId": payload.documentId,
            "content": payload.currentContent, "metadata": payload.currentMetadata,
            "createdAt": now(), "reason": "pre-restore",
        })
        draft = save_draft(connection, payload.documentId, SaveDraft(
            content=revision["content"], metadata=revision["metadata"], expectedVersion=payload.expectedVersion,
        ))
        return {"draft": draft, "revision": revision}


@router.post("/import")
def import_workspace(payload: ImportWorkspace) -> dict:
    document_ids: dict[str, str] = {}
    with database(write=True) as connection:
        for imported in payload.assets:
            blob = decoded_asset(imported)
            existing = connection.execute("SELECT * FROM assets WHERE path = ?", (imported.path,)).fetchone()
            if existing:
                if existing["blob"] != blob:
                    raise HTTPException(409, {"message": "Assets contain different data at the same path.", "paths": [imported.path]})
                continue
            asset = imported.model_dump(exclude={"data"})
            if connection.execute("SELECT id FROM assets WHERE id = ?", (imported.id,)).fetchone():
                asset["id"] = "asset-import-" + hashlib.sha256(encoded(asset).encode() + blob).hexdigest()[:32]
            put_asset(connection, asset, blob)

        for imported in payload.drafts:
            draft = imported.model_dump()
            fingerprint = hashlib.sha256(encoded({
                key: draft[key] for key in ("id", "content", "metadata", "trashedAt")
            }).encode()).hexdigest()
            migrated = connection.execute(
                "SELECT document_id FROM imported_drafts WHERE fingerprint = ?", (fingerprint,),
            ).fetchone()
            if migrated:
                document_ids[imported.id] = migrated["document_id"]
                continue
            existing = find_draft(connection, imported.id)
            if existing and any(existing[key] != draft[key] for key in ("content", "metadata", "trashedAt")):
                draft["id"] = "doc-import-" + fingerprint[:32]
                existing = find_draft(connection, draft["id"])
            if existing is None:
                draft["version"] = max(1, draft["version"])
                put_draft(connection, draft)
            document_ids[imported.id] = draft["id"]
            connection.execute("INSERT INTO imported_drafts VALUES (?, ?)", (fingerprint, draft["id"]))

        for imported in payload.revisions:
            revision = imported.model_dump()
            revision["documentId"] = document_ids.get(imported.documentId, imported.documentId)
            existing = connection.execute("SELECT * FROM revisions WHERE id = ?", (revision["id"],)).fetchone()
            if existing and revision_record(existing) != revision:
                revision["id"] = "import-" + hashlib.sha256(encoded(revision).encode()).hexdigest()[:40]
            put_revision(connection, revision, prune=False)
    return {"documentIds": document_ids}


@router.post("/assets")
def update_assets(payload: list[ImportedAsset]) -> dict:
    with database(write=True) as connection:
        for asset in payload:
            put_asset(connection, asset.model_dump(exclude={"data"}), decoded_asset(asset))
    return {}


@router.get("/assets")
def list_assets() -> list[dict]:
    with database() as connection:
        return [asset_record(row) for row in connection.execute(
            "SELECT id, path, name, type, kind, size, created_at, updated_at FROM assets ORDER BY created_at"
        )]


@router.get("/assets/{asset_id}")
def get_asset(asset_id: str) -> Response:
    with database() as connection:
        row = connection.execute("SELECT blob, type FROM assets WHERE id = ?", (asset_id,)).fetchone()
        if row is None:
            raise HTTPException(404, "Asset not found.")
        return Response(content=row["blob"], media_type=row["type"] or "application/octet-stream")


@router.delete("/assets/{asset_id}")
def delete_asset(asset_id: str) -> dict:
    with database(write=True) as connection:
        connection.execute("DELETE FROM assets WHERE id = ?", (asset_id,))
    return {}
