"""Compatibility entry point for existing Markword service commands."""

import os


if __name__ == '__main__':
    import uvicorn

    uvicorn.run(
        'backend.main:app',
        host=os.getenv('MARKWORD_HOST', '127.0.0.1'),
        port=int(os.getenv('MARKWORD_PORT', '27860')),
    )
