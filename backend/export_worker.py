"""One Linux export job, with limits applied before importing the renderers."""

import ctypes
import json
import os
from pathlib import Path
import resource
import signal
import subprocess
import sys


def supervise(command):
    # Keep detached Chromium descendants under a live parent even when the
    # converter crashes before the API's first resource sample.
    if ctypes.CDLL(None, use_errno=True).prctl(36, 1, 0, 0, 0) != 0:  # PR_SET_CHILD_SUBREAPER
        raise OSError(ctypes.get_errno(), 'Unable to supervise export processes')

    def terminate(_signum, _frame):
        raise SystemExit(1)

    signal.signal(signal.SIGTERM, terminate)
    try:
        return subprocess.Popen(command).wait()
    finally:
        children_file = Path(f'/proc/self/task/{os.getpid()}/children')
        while children := children_file.read_text().split():
            for child in children:
                try:
                    os.kill(int(child), signal.SIGKILL)
                except ProcessLookupError:
                    pass
            for child in children:
                try:
                    os.waitpid(int(child), 0)
                except ChildProcessError:
                    pass


def main():
    seconds = max(1, int(os.getenv('MARKWORD_EXPORT_TIMEOUT_SECONDS', '60')))
    memory = max(1, int(os.getenv('MARKWORD_EXPORT_MEMORY_MB', '1024'))) * 1024 * 1024
    resource.setrlimit(resource.RLIMIT_CPU, (seconds, seconds))
    # RLIMIT_AS prevents V8 from reserving its virtual address space. DATA caps
    # allocations instead; the parent also measures the entire job's RSS.
    resource.setrlimit(resource.RLIMIT_DATA, (memory, memory))
    resource.setrlimit(resource.RLIMIT_FSIZE, (128 * 1024 * 1024, 128 * 1024 * 1024))
    from app import export_pdf, export_word
    from weasyprint.urls import FatalURLFetchingError

    payload = json.load(sys.stdin)
    exporter = export_pdf if sys.argv[1] == 'pdf' else export_word
    try:
        path = exporter(payload['markdown'], payload['theme'], payload['style'])
    except FatalURLFetchingError:
        sys.exit(3)
    if not path:
        sys.exit(1)
    directory = Path(os.environ['MARKWORD_EXPORT_DIR'])
    (directory / 'result.json').write_text(json.dumps(str(Path(path).relative_to(directory))), encoding='utf-8')


if __name__ == '__main__':
    if sys.argv[1] == '--supervise':
        sys.exit(supervise(sys.argv[2:]))
    else:
        main()
