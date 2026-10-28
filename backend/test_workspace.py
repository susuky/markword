import base64
import sqlite3
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.main import app
from backend.workspace import router


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("MARKWORD_DATABASE_PATH", str(tmp_path / "workspace.sqlite3"))
    return TestClient(app)


def save(client, document_id, content, version=None, metadata=None):
    return client.post(f"/api/workspace/drafts/{document_id}", json={
        "content": content, "metadata": metadata or {}, "expectedVersion": version,
    })


def imported_draft(document_id, content):
    return {
        "id": document_id, "content": content, "metadata": {"mode": "markdown"},
        "version": 3, "createdAt": 100, "updatedAt": 200,
    }


def revision(document_id="current", revision_id="revision-1", content="earlier"):
    return {
        "id": revision_id, "documentId": document_id, "content": content,
        "metadata": {"mode": "markdown"}, "createdAt": 200, "reason": "manual",
    }


def asset(asset_id="asset-1", path="assets/note.txt", content=b"attachment"):
    return {
        "id": asset_id, "path": path, "name": path.split("/")[-1],
        "type": "text/plain", "kind": "file", "size": len(content),
        "createdAt": 100, "updatedAt": 200,
        "data": base64.b64encode(content).decode(),
    }


def test_concurrent_first_reads_and_writes_initialize_empty_databases(tmp_path, monkeypatch):
    for attempt in range(8):
        path = tmp_path / f"first-start-{attempt}.sqlite3"
        sqlite3.connect(path).close()
        monkeypatch.setenv("MARKWORD_DATABASE_PATH", str(path))
        barrier = Barrier(16)

        def first_request(index):
            with TestClient(app, raise_server_exceptions=False) as api:
                barrier.wait(timeout=10)
                if index % 2:
                    return save(api, f"doc-{index}", f"Capture {index}")
                return api.get("/api/workspace/drafts")

        with ThreadPoolExecutor(max_workers=16) as executor:
            responses = list(executor.map(first_request, range(16)))
        assert [response.status_code for response in responses] == [200] * 16, [response.text for response in responses]
        assert len(TestClient(app).get("/api/workspace/drafts").json()) == 8


def test_shared_clients_save_versions_and_reject_stale_writes(client):
    other = TestClient(app)
    first = save(client, "current", "# First", metadata={"enabled": True})
    assert first.status_code == 200
    assert first.json()["version"] == 1
    assert other.get("/api/workspace/drafts/current").json() == first.json()

    unchanged = save(other, "current", "# First", version=0, metadata={"enabled": True})
    assert unchanged.json() == first.json()
    responses = list(ThreadPoolExecutor(max_workers=2).map(
        lambda text: save(TestClient(app), "current", text, version=1), ["# Second", "# Third"],
    ))
    assert sorted(response.status_code for response in responses) == [200, 409]
    current = other.get("/api/workspace/drafts/current").json()
    assert current["version"] == 2
    assert current["content"] in {"# Second", "# Third"}
    assert save(client, "current", "stale", version=1).status_code == 409

    trash = client.post("/api/workspace/drafts/current/trash", json={"trashed": True, "expectedVersion": 2})
    assert trash.status_code == 200
    assert trash.json()["trashedAt"] > 0
    assert save(other, "current", current["content"], version=2).status_code == 409
    assert client.post("/api/workspace/drafts/current/trash", json={"trashed": False, "expectedVersion": 2}).status_code == 409
    restored = client.post("/api/workspace/drafts/current/trash", json={"trashed": False, "expectedVersion": 3})
    assert restored.json()["trashedAt"] is None
    assert restored.json()["version"] == 4


def test_browser_import_keeps_both_documents_and_is_idempotent_after_server_edits(client):
    assert save(client, "current", "# Shared note").status_code == 200
    payload = {
        "drafts": [imported_draft("current", "# Browser note"), imported_draft("doc-another", "# Another")],
        "revisions": [revision()], "assets": [asset()],
    }
    response = client.post("/api/workspace/import", json=payload)
    assert response.status_code == 200
    copied_id = response.json()["documentIds"]["current"]
    assert copied_id.startswith("doc-import-")
    drafts = client.get("/api/workspace/drafts").json()
    assert len(drafts) == 3
    assert {draft["content"] for draft in drafts} == {"# Shared note", "# Browser note", "# Another"}
    assert client.get("/api/workspace/revisions", params={"documentId": copied_id}).json()[0]["documentId"] == copied_id
    assert client.get("/api/workspace/revisions", params={"documentId": "current"}).json() == []

    assert save(client, copied_id, "# Changed on server", version=3).status_code == 200
    repeated = client.post("/api/workspace/import", json=payload)
    assert repeated.json() == response.json()
    assert len(client.get("/api/workspace/drafts").json()) == 3
    assert client.get(f"/api/workspace/drafts/{copied_id}").json()["content"] == "# Changed on server"
    assert len(client.get("/api/workspace/revisions").json()) == 1
    assert len(client.get("/api/workspace/assets").json()) == 1

    restarted = FastAPI()
    restarted.include_router(router)
    with TestClient(restarted) as after_restart:
        workspace = after_restart.get("/api/workspace").json()
        assert len(workspace["drafts"]) == 3
        assert len(workspace["revisions"]) == 1
        assert after_restart.get("/api/workspace/assets/asset-1").content == b"attachment"


def test_conflicting_revision_ids_preserve_both_histories(client):
    assert save(client, "current", "shared").status_code == 200
    assert client.post("/api/workspace/revisions", json=revision(content="original history")).status_code == 200
    payload = {"drafts": [imported_draft("current", "browser")], "revisions": [revision(content="browser history")]}
    first = client.post("/api/workspace/import", json=payload)
    assert first.status_code == 200
    assert client.post("/api/workspace/import", json=payload).json() == first.json()
    assert {item["content"] for item in client.get("/api/workspace/revisions").json()} == {"original history", "browser history"}


def test_restore_is_atomic_and_revision_ownership_is_enforced(client):
    assert save(client, "current", "current").status_code == 200
    assert client.post("/api/workspace/revisions", json=revision()).status_code == 200
    payload = {
        "revisionId": "revision-1", "currentContent": "unsaved text",
        "currentMetadata": {"mode": "markdown"}, "expectedVersion": 0, "documentId": "current",
    }
    assert client.post("/api/workspace/restore", json=payload).status_code == 409
    assert len(client.get("/api/workspace/revisions").json()) == 1
    restored = client.post("/api/workspace/restore", json={**payload, "expectedVersion": 1})
    assert restored.status_code == 200
    assert restored.json()["draft"]["content"] == "earlier"
    assert restored.json()["draft"]["version"] == 2
    assert restored.json()["revision"]["id"] == "revision-1"
    history = client.get("/api/workspace/revisions", params={"documentId": "current"}).json()
    assert len(history) == 2
    assert history[0]["reason"] == "pre-restore"
    assert history[0]["content"] == "unsaved text"

    assert client.delete("/api/workspace/revisions/revision-1", params={"documentId": "doc-other"}).status_code == 404
    assert len(client.get("/api/workspace/revisions").json()) == 2
    assert client.delete("/api/workspace/revisions/revision-1", params={"documentId": "current"}).status_code == 200
    assert len(client.get("/api/workspace/revisions").json()) == 1


def test_asset_conflicts_roll_back_whole_import_and_upload(client):
    assert client.post("/api/workspace/assets", json=[asset()]).status_code == 200
    conflicting = asset("different-id", content=b"different bytes")
    payload = {"drafts": [imported_draft("doc-import", "keep")], "assets": [asset("asset-2", "assets/second.txt"), conflicting]}
    response = client.post("/api/workspace/import", json=payload)
    assert response.status_code == 409
    assert response.json()["detail"]["paths"] == ["assets/note.txt"]
    assert client.get("/api/workspace/drafts").json() == []
    assert len(client.get("/api/workspace/assets").json()) == 1

    assert client.post("/api/workspace/assets", json=payload["assets"]).status_code == 409
    assert len(client.get("/api/workspace/assets").json()) == 1
    assert client.get("/api/workspace/assets/asset-1").content == b"attachment"
    assert client.post("/api/workspace/assets", json=[{**asset(), "size": 1}]).status_code == 422
    assert client.post("/api/workspace/assets", json=[{**asset(), "data": "not base64!"}]).status_code == 422


def test_identical_asset_paths_share_bytes_and_assets_can_be_updated_deleted(client):
    assert client.post("/api/workspace/assets", json=[asset()]).status_code == 200
    assert client.post("/api/workspace/import", json={"assets": [asset("other-id")]}).status_code == 200
    assert len(client.get("/api/workspace/assets").json()) == 1
    assert "blob" not in client.get("/api/workspace/assets").json()[0]
    assert client.post("/api/workspace/assets", json=[asset(content=b"updated")]).status_code == 200
    response = client.get("/api/workspace/assets/asset-1")
    assert response.content == b"updated"
    assert response.headers["content-type"].startswith("text/plain")
    assert client.delete("/api/workspace/assets/asset-1").status_code == 200
    assert client.get("/api/workspace/assets/asset-1").status_code == 404


def test_targeted_draft_endpoint_includes_html_and_missing_drafts_return_404(client):
    assert client.get("/api/workspace/drafts/missing").status_code == 404
    assert save(client, "html", "<h1>HTML</h1>", metadata={"mode": "html"}).status_code == 200
    assert client.get("/api/workspace/drafts").json()[0]["id"] == "html"
