"""Render with the installed Mermaid bundle in an isolated, offline browser."""

import asyncio
from pathlib import Path

from playwright.async_api import async_playwright

from themes import Theme


MERMAID_BUNDLE = Path(__file__).resolve().parent / 'frontend/node_modules/mermaid/dist/mermaid.min.js'


async def _draw_diagram(browser, code: str, theme: Theme) -> bytes | None:
    context = await browser.new_context(
        offline=True, service_workers='block', device_scale_factor=2,
        viewport={'width': 1200, 'height': 900},
    )
    await context.route('**/*', lambda route: route.abort())
    page = await context.new_page()
    page.set_default_timeout(15_000)
    # The only script comes from our installed bundle. CSP also blocks file URLs,
    # remote fonts/images and connections introduced through diagram directives.
    await page.set_content('''<!doctype html><html><head>
        <meta http-equiv="Content-Security-Policy" content="default-src 'none';
          script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:;
          font-src 'none'; connect-src 'none'; base-uri 'none'; form-action 'none'">
        <style>body { margin: 0; } #output { display: inline-block; padding: 16px; }</style>
        </head><body><div id="output"></div></body></html>''')
    await page.add_script_tag(path=str(MERMAID_BUNDLE))
    rendered = await page.evaluate('''async ({code, variables, background}) => {
        mermaid.initialize({
            startOnLoad: false, securityLevel: 'strict', suppressErrorRendering: true,
            theme: 'base', themeVariables: variables, fontFamily: 'Noto Sans CJK TC, sans-serif',
            maxTextSize: 50000, maxEdges: 500,
            secure: ['secure', 'securityLevel', 'startOnLoad', 'suppressErrorRendering',
                     'maxTextSize', 'maxEdges'],
        });
        document.body.style.background = background;
        const output = document.getElementById('output');
        try {
            const {svg} = await mermaid.render('diagram', code);
            output.innerHTML = svg;
        } catch {
            return false;
        }
        const svg = output.querySelector('svg');
        const box = svg.viewBox.baseVal;
        if (!Number.isFinite(box.width) || !Number.isFinite(box.height) ||
            box.width <= 0 || box.height <= 0 || box.width > 4096 || box.height > 4096) {
            return false;
        }
        svg.style.maxWidth = 'none';
        svg.style.width = `${box.width}px`;
        svg.style.height = `${box.height}px`;
        await document.fonts.ready;
        return true;
    }''', {'code': code, 'variables': theme.mermaid_variables, 'background': theme.body_bg})
    if not rendered:
        return None
    return await page.locator('#output').screenshot(type='png')


async def _render_diagram(code: str, theme: Theme) -> bytes | None:
    async with async_playwright() as playwright:
        # Each render gets a fresh browser, with no shared document state or cache.
        browser = await playwright.chromium.launch(timeout=15_000)
        try:
            return await asyncio.wait_for(_draw_diagram(browser, code, theme), timeout=30)
        finally:
            await browser.close()


def render_mermaid_png(code: str, theme: Theme) -> bytes | None:
    """Return a local PNG, or None for invalid/oversized Mermaid source.

    Missing runtime files and renderer failures propagate; never use a remote
    renderer as a fallback. Browser execution is bounded even if JS stalls.
    """
    if len(code) > 50_000:
        return None
    if not MERMAID_BUNDLE.is_file():
        raise RuntimeError('Local Mermaid bundle missing; run npm ci in frontend')
    return asyncio.run(_render_diagram(code, theme))
