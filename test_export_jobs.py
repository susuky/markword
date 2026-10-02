import asyncio
from pathlib import Path
import sys

from fastapi import HTTPException
import pytest

import app
from backend import export_jobs as jobs
from backend.schemas import ExportRequest


@pytest.fixture
def anyio_backend():
    return 'asyncio'


@pytest.mark.anyio
async def test_timeout_rejects_excess_jobs_keeps_health_responsive_and_recovers(monkeypatch, tmp_path):
    import httpx
    from backend.main import app as api

    monkeypatch.setattr(app, 'EXPORT_DIR', str(tmp_path))
    monkeypatch.setattr(jobs, 'MAX_CONCURRENT_EXPORTS', 1)
    monkeypatch.setattr(jobs, 'EXPORT_TIMEOUT_SECONDS', 1)
    monkeypatch.setattr(jobs, 'WORKER_COMMAND', (sys.executable, '-c', 'import time; time.sleep(30)'))
    transport = httpx.ASGITransport(app=api)
    async with httpx.AsyncClient(transport=transport, base_url='http://test') as client:
        first = asyncio.create_task(client.post('/api/export/pdf', json={'markdown': '# Slow'}))
        while not jobs._active_jobs:
            await asyncio.sleep(.01)
        assert (await client.get('/api/health')).status_code == 200
        assert (await client.post('/api/export/docx', json={'markdown': '# Busy'})).status_code == 503
        assert (await first).status_code == 504
        assert not list(tmp_path.iterdir())
        monkeypatch.setattr(jobs, 'WORKER_COMMAND', (sys.executable, '-m', 'backend.export_worker'))
        monkeypatch.setattr(jobs, 'EXPORT_TIMEOUT_SECONDS', 60)
        assert (await client.post('/api/export/docx', json={'markdown': '# Recovered'})).status_code == 200
        assert not list(tmp_path.iterdir())


@pytest.mark.anyio
async def test_live_browser_is_reaped_on_timeout(monkeypatch, tmp_path):
    monkeypatch.setattr(app, 'EXPORT_DIR', str(tmp_path))
    monkeypatch.setattr(jobs, 'EXPORT_TIMEOUT_SECONDS', 5)
    monkeypatch.setattr(jobs, 'WORKER_COMMAND', (sys.executable, '-c', '''
from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page()
    page.evaluate('while (true) {}')
'''))
    tracked = {}
    process_tree = jobs._process_tree
    def track(root, known):
        result = process_tree(root, known)
        tracked.update(result)
        return result
    monkeypatch.setattr(jobs, '_process_tree', track)
    with pytest.raises(HTTPException) as error:
        await jobs.run_export(ExportRequest(markdown='# Slow diagram'), 'pdf')
    assert error.value.status_code in (422, 504)  # CPU or wall-clock budget
    assert len(tracked) >= 4  # real Python + driver + Chromium descendants
    for _ in range(100):
        alive = []
        for pid in tracked:
            try:
                fields = Path(f'/proc/{pid}/stat').read_text().rsplit(')', 1)[1].split()
                if int(fields[19]) == tracked[pid][1] and fields[0] != 'Z':
                    alive.append(pid)
            except FileNotFoundError:
                pass
        if not alive:
            break
        await asyncio.sleep(.02)
    assert not alive
    assert not list(tmp_path.iterdir())
    assert jobs._active_jobs == 0


@pytest.mark.anyio
async def test_memory_budget_and_cancellation_clean_up(monkeypatch, tmp_path):
    monkeypatch.setattr(app, 'EXPORT_DIR', str(tmp_path))
    monkeypatch.setattr(jobs, 'EXPORT_MEMORY_BYTES', 25 * 1024 * 1024)
    monkeypatch.setattr(jobs, 'WORKER_COMMAND', (sys.executable, '-c', 'import time; data = bytearray(40 * 1024 * 1024); time.sleep(30)'))
    with pytest.raises(HTTPException) as error:
        await jobs.run_export(ExportRequest(markdown='# Memory'), 'pdf')
    assert error.value.status_code == 422
    assert not list(tmp_path.iterdir())

    monkeypatch.setattr(jobs, 'EXPORT_MEMORY_BYTES', 1024 * 1024 * 1024)
    task = asyncio.create_task(jobs.run_export(ExportRequest(markdown='# Cancel'), 'pdf'))
    while not list(tmp_path.iterdir()):
        await asyncio.sleep(.01)
    await asyncio.sleep(.1)
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert not list(tmp_path.iterdir())
    assert jobs._active_jobs == 0


@pytest.mark.anyio
async def test_crashed_worker_reaps_detached_child_before_first_sample(monkeypatch, tmp_path):
    monkeypatch.setattr(app, 'EXPORT_DIR', str(tmp_path))
    pid_file = tmp_path / 'detached.pid'
    monkeypatch.setattr(jobs, 'WORKER_COMMAND', (sys.executable, '-c', '''
import os, subprocess, sys
from pathlib import Path
child = subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(30)'], start_new_session=True)
Path(sys.argv[1]).write_text(str(child.pid))
os._exit(1)
''', str(pid_file)))
    # Force the case that process-tree polling never observes the short-lived
    # worker or its detached child. Cleanup must rely on OS parentage instead.
    monkeypatch.setattr(jobs, '_process_tree', lambda *_: {})
    with pytest.raises(RuntimeError, match='Export worker failed'):
        await asyncio.wait_for(jobs.run_export(ExportRequest(markdown='# Crash'), 'pdf'), timeout=5)
    child_pid = int(pid_file.read_text())
    assert not Path(f'/proc/{child_pid}').exists()
    assert not list(tmp_path.glob('job_*'))
    assert jobs._active_jobs == 0
