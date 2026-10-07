"""Render a document's formulas with local KaTeX in one offline browser."""

import asyncio
import base64
from pathlib import Path
import re

from playwright.async_api import async_playwright


KATEX_DIST = Path(__file__).resolve().parent / 'frontend/node_modules/katex/dist'
MAX_FORMULAS = 200
MAX_FORMULA_CHARS = 10_000


async def _render_formulas(formulas, color):
    # Fonts are installed assets, embedded before the document enters Chromium.
    css = (KATEX_DIST / 'katex.min.css').read_text(encoding='utf-8')
    def embed_font(match):
        path = KATEX_DIST / match.group(1)
        return 'url(data:font/woff2;base64,' + base64.b64encode(path.read_bytes()).decode() + ')'
    css = re.sub(r'url\((fonts/[^)]+\.woff2)\)', embed_font, css)
    async with async_playwright() as playwright:
        browser = await playwright.chromium.launch(timeout=15_000)
        try:
            context = await browser.new_context(offline=True, service_workers='block', device_scale_factor=2,
                                               viewport={'width': 1200, 'height': 900})
            await context.route('**/*', lambda route: route.abort())
            page = await context.new_page()
            page.set_default_timeout(15_000)
            await page.set_content("""<!doctype html><html><head>
              <meta http-equiv="Content-Security-Policy" content="default-src 'none';
                script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:;
                font-src data:; connect-src 'none'; base-uri 'none'; form-action 'none'">
              </head><body><span id="output"><span id="formula"></span><span id="baseline"></span></span></body></html>""")
            await page.add_style_tag(content=css + """
              body { margin: 0; background: transparent; color: #202124; font-size: 11pt; }
              #output { display: inline-block; white-space: nowrap; }
              #baseline { display: inline-block; width: 0; height: 0; }
              .katex-display { margin: 0; }
            """)
            await page.add_script_tag(path=str(KATEX_DIST / 'katex.min.js'))
            await page.evaluate('(color) => { document.body.style.color = color; }', color)
            results = []
            for source, display in formulas:
                metrics = await page.evaluate("""({source, display}) => {
                    const formula = document.getElementById('formula');
                    try {
                        katex.render(source, formula, {displayMode: display, throwOnError: true,
                            trust: false, strict: 'warn', maxExpand: 1000, maxSize: 20,
                            output: 'htmlAndMathml'});
                    } catch { return null; }
                    return document.fonts.ready.then(() => {
                        const box = document.getElementById('output').getBoundingClientRect();
                        const baseline = document.getElementById('baseline').getBoundingClientRect().top;
                        if (box.width <= 0 || box.height <= 0 || box.width > 4096 || box.height > 2048) return null;
                        return {width: box.width, height: box.height, descent: Math.max(0, box.bottom - baseline)};
                    });
                }""", {'source': source, 'display': display})
                if metrics is None:
                    results.append(None)
                    continue
                data = await page.locator('#output').screenshot(type='png', omit_background=True)
                results.append((data, metrics))
            return results
        finally:
            await browser.close()


def render_math_pngs(formulas, color='#202124'):
    """Return PNGs and CSS-pixel metrics; invalid or over-budget formulas stay text."""
    if not formulas:
        return []
    if not (KATEX_DIST / 'katex.min.js').is_file() or not (KATEX_DIST / 'katex.min.css').is_file():
        raise RuntimeError('Local KaTeX bundle missing; run npm ci in frontend')
    allowed = [(source, display) for source, display in formulas[:MAX_FORMULAS] if len(source) <= MAX_FORMULA_CHARS]
    async def bounded():
        return await asyncio.wait_for(_render_formulas(allowed, color), timeout=45)
    rendered = iter(asyncio.run(bounded())) if allowed else iter(())
    return [next(rendered) if index < MAX_FORMULAS and len(source) <= MAX_FORMULA_CHARS else None
            for index, (source, _) in enumerate(formulas)]
