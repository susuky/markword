"""Bounded, independently terminable PDF/Word jobs for the API."""

import asyncio
import json
import os
from pathlib import Path
import shutil
import signal
import sys
import tempfile

from fastapi import HTTPException
from weasyprint.urls import FatalURLFetchingError

import app as exporter


MAX_CONCURRENT_EXPORTS = max(1, int(os.getenv('MARKWORD_EXPORT_MAX_CONCURRENT', '2')))
EXPORT_TIMEOUT_SECONDS = max(1, int(os.getenv('MARKWORD_EXPORT_TIMEOUT_SECONDS', '60')))
EXPORT_MEMORY_BYTES = max(1, int(os.getenv('MARKWORD_EXPORT_MEMORY_MB', '1024'))) * 1024 * 1024
WORKER_COMMAND = (sys.executable, '-m', 'backend.export_worker')
_active_jobs = 0


def _process_tree(root_pid, known):
    """Track descendants even when Chromium creates a detached process group."""
    processes = {}
    for entry in Path('/proc').iterdir():
        if not entry.name.isdigit():
            continue
        try:
            fields = (entry / 'stat').read_text().rsplit(')', 1)[1].split()
            processes[int(entry.name)] = (int(fields[1]), int(fields[19]),
                                          int(fields[11]) + int(fields[12]), int(fields[21]))
        except (OSError, ValueError, IndexError):
            continue
    selected = {pid for pid, (_, start, _, _) in processes.items()
                if pid == root_pid or known.get(pid) == start}
    while True:
        children = {pid for pid, (parent, _, _, _) in processes.items() if parent in selected}
        if children <= selected:
            break
        selected |= children
    result = {pid: processes[pid] for pid in selected}
    known.update({pid: values[1] for pid, values in result.items()})
    return result


async def run_export(payload, export_format):
    global _active_jobs
    # No unbounded queue: callers can retry when an existing job has finished.
    if _active_jobs >= MAX_CONCURRENT_EXPORTS:
        raise HTTPException(503, 'Exports are busy. Please try again shortly.')
    if not Path('/proc/self/stat').is_file():
        raise HTTPException(503, 'Document export is unavailable. Download portable HTML instead.')
    _active_jobs += 1
    directory = None
    process = None
    communication = None
    known = {}
    cpu_ticks = {}
    succeeded = False
    try:
        directory = tempfile.mkdtemp(prefix='job_', dir=exporter.EXPORT_DIR)
        process = await asyncio.create_subprocess_exec(
            sys.executable, '-m', 'backend.export_worker', '--supervise', *WORKER_COMMAND, export_format,
            cwd=Path(__file__).resolve().parent.parent,
            env={**os.environ, 'MARKWORD_EXPORT_DIR': directory, 'TMPDIR': directory,
                 'MARKWORD_EXPORT_TIMEOUT_SECONDS': str(EXPORT_TIMEOUT_SECONDS),
                 'MARKWORD_EXPORT_MEMORY_MB': str(EXPORT_MEMORY_BYTES // (1024 * 1024))},
            stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.DEVNULL, start_new_session=True,
        )
        communication = asyncio.create_task(process.communicate(payload.model_dump_json().encode()))
        deadline = asyncio.get_running_loop().time() + EXPORT_TIMEOUT_SECONDS
        while True:
            processes = _process_tree(process.pid, known)
            for pid, (_, start, ticks, _) in processes.items():
                cpu_ticks[pid, start] = ticks
            memory = sum(values[3] for values in processes.values()) * os.sysconf('SC_PAGE_SIZE')
            cpu = sum(cpu_ticks.values()) / os.sysconf('SC_CLK_TCK')
            if memory > EXPORT_MEMORY_BYTES or cpu > EXPORT_TIMEOUT_SECONDS:
                raise HTTPException(422, 'This document exceeds the export limits. Try a smaller document.')
            if asyncio.get_running_loop().time() >= deadline:
                raise HTTPException(504, 'Export took too long. Try a smaller document.')
            done, _ = await asyncio.wait({communication}, timeout=0.1)
            if done:
                await communication
                break
        if process.returncode == 3:
            raise FatalURLFetchingError('Resource unavailable for offline export')
        if process.returncode != 0:
            raise RuntimeError('Export worker failed')
        path = (Path(directory) / json.loads((Path(directory) / 'result.json').read_text())).resolve()
        path.relative_to(directory)
        if not path.is_file():
            raise RuntimeError('Export worker produced no file')
        succeeded = True
        return str(path), directory
    finally:
        if process:
            if process.returncode is None:
                try:
                    # The supervisor reaps adopted children before it exits.
                    process.terminate()
                except ProcessLookupError:
                    pass
                try:
                    await asyncio.wait_for(process.wait(), timeout=2)
                except asyncio.TimeoutError:
                    for pid in _process_tree(process.pid, known):
                        try:
                            os.kill(pid, signal.SIGKILL)
                        except ProcessLookupError:
                            pass
                    try:
                        os.killpg(process.pid, signal.SIGKILL)
                    except ProcessLookupError:
                        pass
                    await process.wait()
        if communication:
            await asyncio.gather(communication, return_exceptions=True)
        if directory and not succeeded:
            shutil.rmtree(directory, ignore_errors=True)
        _active_jobs -= 1
