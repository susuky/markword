import base64
import html
import json
import re
import tempfile
import urllib.parse
import urllib.request

from bs4 import BeautifulSoup, NavigableString
from docx import Document
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Inches, Pt, RGBColor
import gradio as gr
import markdown as md
from weasyprint import HTML


# ---------------------------------------------------------------------------
# Word count logic
# ---------------------------------------------------------------------------

def analyze_text(text: str) -> tuple[int, int, int, int, int, int, int]:
    '''
    Analyze input text and calculate character and word count metrics.

    Args:
        text: The input string pasted or typed by the user.

    Returns:
        A tuple containing:
            - total_chars: Total length including spaces and newlines.
            - chars_no_spaces: Total characters excluding whitespace.
            - cjk_count: Count of CJK Chinese ideographs.
            - cjk_punct_count: Count of Chinese full-width punctuation.
            - english_words: Count of English words.
            - digit_count: Count of numeric digits.
            - line_count: Count of lines.
    '''
    if not text:
        return 0, 0, 0, 0, 0, 0, 0

    total_chars = len(text)
    chars_no_spaces = len(re.sub(r'\s+', '', text))

    # CJK Chinese Character matching
    cjk_pattern = re.compile(r'[\u4e00-\u9fff\u3400-\u4dbf\U00020000-\U0002a6df]')
    cjk_count = len(cjk_pattern.findall(text))

    # CJK / Full-width Punctuation matching
    cjk_punct_pattern = re.compile(r'[\u3000-\u303f\uff00-\uffef]')
    cjk_punct_count = len(cjk_punct_pattern.findall(text))

    # English word matching
    english_pattern = re.compile(r'\b[a-zA-Z]+(?:-[a-zA-Z]+)?\b')
    english_words = len(english_pattern.findall(text))

    # Digit matching
    digit_pattern = re.compile(r'\d')
    digit_count = len(digit_pattern.findall(text))

    # Line counting
    line_count = len(text.splitlines()) if text else 0

    return (
        total_chars,
        chars_no_spaces,
        cjk_count,
        cjk_punct_count,
        english_words,
        digit_count,
        line_count,
    )


def clear_input() -> tuple[str, int, int, int, int, int, int, int]:
    '''
    Reset the input text and all statistics counters to initial state.

    Returns:
        A tuple with empty string and 0 for all metrics.
    '''
    return '', 0, 0, 0, 0, 0, 0, 0


# ---------------------------------------------------------------------------
# Markdown preview & Mermaid rendering logic
# ---------------------------------------------------------------------------

_MERMAID_BLOCK_RE = re.compile(
    r'```mermaid\s*\n(.*?)```',
    re.DOTALL,
)

_MD_EXTENSIONS = [
    'tables',
    'fenced_code',
    'toc',
    'sane_lists',
    'smarty',
]

_PREVIEW_CSS = '''
body {
    font-family: "Noto Sans CJK TC", "Noto Sans CJK SC", "WenQuanYi Micro Hei",
                 "Microsoft JhengHei", "PingFang TC", sans-serif;
    line-height: 1.8;
    color: #1e293b;
    max-width: 800px;
    margin: 0 auto;
    padding: 1.5rem;
    background: #fff;
}
h1 { color: #1e3a5f; border-bottom: 2px solid #6366f1; padding-bottom: .3em; }
h2 { color: #334155; border-bottom: 1px solid #e2e8f0; padding-bottom: .2em; }
h3 { color: #475569; }
code {
    background: #eef2ff;
    color: #4338ca;
    padding: 0.15em 0.4em;
    border-radius: 4px;
    font-size: 0.9em;
    font-family: "JetBrains Mono", "Fira Code", "Noto Sans Mono CJK TC", monospace;
}
pre {
    background: #f8fafc;
    border: 1px solid #e2e8f0;
    padding: 1em;
    border-radius: 8px;
    overflow-x: auto;
}
pre code {
    background: transparent;
    color: #334155;
    padding: 0;
}
blockquote {
    border-left: 4px solid #6366f1;
    margin: 1em 0;
    padding: 0.5em 1em;
    background: #f8fafc;
    color: #475569;
}
table {
    border-collapse: collapse;
    width: 100%;
    margin: 1em 0;
}
th, td {
    border: 1px solid #cbd5e1;
    padding: 0.6em 1em;
    text-align: left;
}
th {
    background: #f1f5f9;
    font-weight: 600;
}
tr:nth-child(even) { background: #f8fafc; }
img { max-width: 100%; height: auto; }
a { color: #6366f1; text-decoration: none; }
a:hover { text-decoration: underline; }
hr { border: none; border-top: 1px solid #e2e8f0; margin: 2em 0; }
span.chk {
    color: #10b981;
    font-weight: bold;
    font-size: 1.1em;
}
span.crs {
    color: #ef4444;
    font-weight: bold;
    font-size: 1.1em;
}
.mermaid {
    display: flex;
    justify-content: center;
    margin: 1.5em 0;
    background: #f8fafc;
    padding: 1em;
    border-radius: 8px;
}
.mermaid-img {
    text-align: center;
    margin: 1.5em 0;
}
.mermaid-img img {
    max-width: 100%;
    height: auto;
    border-radius: 8px;
    border: 1px solid #e2e8f0;
    padding: 8px;
    background: #fff;
}
'''


def _fetch_mermaid_png(code: str) -> bytes | None:
    '''
    Fetch rendered PNG bytes for a Mermaid diagram from mermaid.ink API.

    Args:
        code: Mermaid diagram source string.

    Returns:
        PNG image bytes, or None if fetching fails.
    '''
    try:
        payload = json.dumps({'code': code})
        b64_str = base64.urlsafe_b64encode(payload.encode('utf-8')).decode('utf-8')
        url = f'https://mermaid.ink/img/{b64_str}'
        req = urllib.request.Request(
            url,
            headers={'User-Agent': 'Mozilla/5.0'}
        )
        with urllib.request.urlopen(req, timeout=8) as response:
            if response.status == 200:
                return response.read()
    except Exception:
        pass
    return None


def _sanitize_emojis_for_export(text: str) -> str:
    '''
    Replace color emojis with clean HTML / Unicode symbols for PDF export.

    Args:
        text: Markdown or HTML text containing color emojis.

    Returns:
        Sanitized text with standard web symbols.
    '''
    text = text.replace('✅', '<span class="chk">✓</span>')
    text = text.replace('❌', '<span class="crs">✗</span>')
    return text


def _replace_mermaid_blocks(md_text: str) -> tuple[str, bool]:
    '''
    Extract mermaid code blocks and replace them with <div class="mermaid">
    placeholders for client-side rendering in browser preview.

    Args:
        md_text: Raw markdown string.

    Returns:
        Tuple of (modified markdown text, whether mermaid blocks were found).
    '''
    has_mermaid = bool(_MERMAID_BLOCK_RE.search(md_text))

    def _replacer(match: re.Match) -> str:
        code = match.group(1).strip()
        return f'<div class="mermaid">\n{code}\n</div>'

    return _MERMAID_BLOCK_RE.sub(_replacer, md_text), has_mermaid


def _build_html_page(body_html: str, has_mermaid: bool = False) -> str:
    '''
    Wrap rendered HTML body in a full HTML document with CSS styling
    and optional Mermaid.js script.

    Args:
        body_html: The rendered HTML content.
        has_mermaid: Whether to include mermaid.js script tag.

    Returns:
        Complete HTML document string.
    '''
    mermaid_script = ''
    if has_mermaid:
        mermaid_script = (
            '<script src="https://cdn.jsdelivr.net/npm/mermaid@11/dist/'
            'mermaid.min.js"></script>\n'
            '<script>mermaid.initialize({startOnLoad:true, theme:"default"});</script>'
        )

    return (
        f'<!DOCTYPE html>\n<html lang="zh-Hant">\n<head>\n'
        f'<meta charset="UTF-8">\n'
        f'<style>{_PREVIEW_CSS}</style>\n'
        f'{mermaid_script}\n'
        f'</head>\n<body>\n{body_html}\n</body>\n</html>'
    )


def render_preview(md_text: str) -> str:
    '''
    Convert markdown text to styled HTML for live preview.

    Uses an iframe with srcdoc to ensure Mermaid.js scripts execute properly
    since Gradio strips script tags from gr.HTML components.

    Args:
        md_text: Raw markdown string.

    Returns:
        An iframe HTML tag containing the rendered preview, or a placeholder
        message if input is empty.
    '''
    if not md_text or not md_text.strip():
        return (
            '<div style="color:#94a3b8;padding:2rem;text-align:center;'
            'font-size:1.1em;">請在左側輸入 Markdown 文字以預覽</div>'
        )

    processed, has_mermaid = _replace_mermaid_blocks(md_text)
    body_html = md.markdown(processed, extensions=_MD_EXTENSIONS)
    full_html = _build_html_page(body_html, has_mermaid)

    escaped = html.escape(full_html, quote=True)
    return (
        f'<iframe srcdoc="{escaped}" '
        f'style="width:100%;min-height:600px;border:1px solid #e2e8f0;'
        f'border-radius:8px;background:#fff;" '
        f'sandbox="allow-scripts allow-same-origin">'
        f'</iframe>'
    )


# ---------------------------------------------------------------------------
# Export: PDF
# ---------------------------------------------------------------------------

def _render_md_to_html_for_export(md_text: str) -> str:
    '''
    Convert markdown to a print-ready HTML document with rendered Mermaid diagrams.

    Args:
        md_text: Raw markdown string.

    Returns:
        Complete HTML string suitable for weasyprint PDF generation.
    '''
    def _mermaid_replacer(match: re.Match) -> str:
        code = match.group(1).strip()
        png_data = _fetch_mermaid_png(code)
        if png_data:
            b64_img = base64.b64encode(png_data).decode('utf-8')
            return f'<div class="mermaid-img"><img src="data:image/png;base64,{b64_img}" alt="Mermaid Diagram" /></div>'
        return f'<pre class="mermaid-fallback">[Mermaid Diagram]\n{html.escape(code)}</pre>'

    processed = _MERMAID_BLOCK_RE.sub(_mermaid_replacer, md_text)
    body_html = md.markdown(processed, extensions=_MD_EXTENSIONS)
    body_html = _sanitize_emojis_for_export(body_html)
    return _build_html_page(body_html, has_mermaid=False)


def export_pdf(md_text: str) -> str | None:
    '''
    Export markdown text to a PDF file.

    Args:
        md_text: Raw markdown string.

    Returns:
        Path to the generated PDF file, or None if input is empty.
    '''
    if not md_text or not md_text.strip():
        return None

    html_str = _render_md_to_html_for_export(md_text)
    tmp = tempfile.NamedTemporaryFile(suffix='.pdf', delete=False, prefix='md_export_')
    HTML(string=html_str).write_pdf(tmp.name)
    return tmp.name


# ---------------------------------------------------------------------------
# Export: Word (.docx)
# ---------------------------------------------------------------------------

def _set_cjk_font(run, font_name: str = 'Noto Sans CJK TC', size_pt: int = 11):
    '''
    Set font for a run supporting CJK characters.

    Args:
        run: The docx Run object.
        font_name: Font family name.
        size_pt: Font size in points.
    '''
    run.font.name = font_name
    run.font.size = Pt(size_pt)
    r = run._element
    rPr = r.get_or_add_rPr()
    rFonts = rPr.find(qn('w:rFonts'))
    if rFonts is None:
        rFonts = rPr.makeelement(qn('w:rFonts'), {})
        rPr.insert(0, rFonts)
    rFonts.set(qn('w:eastAsia'), font_name)


def _append_node_to_paragraph(
    p,
    node,
    is_bold: bool = False,
    is_italic: bool = False,
    is_code: bool = False,
) -> None:
    '''
    Recursively parse HTML DOM nodes and append formatted runs to a Word paragraph.

    Args:
        p: Word paragraph object.
        node: BeautifulSoup HTML node.
        is_bold: Whether current context is bold text.
        is_italic: Whether current context is italic text.
        is_code: Whether current context is code text.
    '''
    if isinstance(node, NavigableString):
        text = str(node)
        if text:
            run = p.add_run(text)
            _set_cjk_font(
                run,
                font_name='Noto Sans Mono CJK TC' if is_code else 'Noto Sans CJK TC',
                size_pt=9.5 if is_code else 11,
            )
            run.bold = is_bold
            run.italic = is_italic
            if is_code:
                run.font.color.rgb = RGBColor(0x43, 0x38, 0xca)
            if '✓' in text:
                run.font.color.rgb = RGBColor(0x10, 0xb9, 0x81)
                run.bold = True
            elif '✗' in text:
                run.font.color.rgb = RGBColor(0xef, 0x44, 0x44)
                run.bold = True
        return

    tag = node.name.lower() if node.name else ''
    child_bold = is_bold or tag in ('strong', 'b')
    child_italic = is_italic or tag in ('em', 'i')
    child_code = is_code or tag in ('code', 'kbd', 'samp')

    for child in node.children:
        _append_node_to_paragraph(
            p,
            child,
            is_bold=child_bold,
            is_italic=child_italic,
            is_code=child_code,
        )


def export_word(md_text: str) -> str | None:
    '''
    Export markdown text to a Word (.docx) file with CJK font support.

    Converts Markdown to HTML DOM elements and maps them into Word document
    structures (headings, formatted text runs, lists, tables, blockquotes,
    code blocks, and embedded Mermaid diagram PNGs).

    Args:
        md_text: Raw markdown string.

    Returns:
        Path to the generated .docx file, or None if input is empty.
    '''
    if not md_text or not md_text.strip():
        return None

    doc = Document()

    # Set default font for the document
    style = doc.styles['Normal']
    font = style.font
    font.name = 'Noto Sans CJK TC'
    font.size = Pt(11)
    rPr = style.element.get_or_add_rPr()
    rFonts = rPr.find(qn('w:rFonts'))
    if rFonts is None:
        rFonts = rPr.makeelement(qn('w:rFonts'), {})
        rPr.insert(0, rFonts)
    rFonts.set(qn('w:eastAsia'), 'Noto Sans CJK TC')

    # Handle Mermaid diagrams: render to PNG temp files before HTML parsing
    mermaid_images: dict[str, str] = {}

    def _mermaid_word_replacer(match: re.Match) -> str:
        code = match.group(1).strip()
        png_data = _fetch_mermaid_png(code)
        placeholder_id = f'MERMAID_IMG_PLACEHOLDER_{len(mermaid_images)}'
        if png_data:
            tmp_img = tempfile.NamedTemporaryFile(suffix='.png', delete=False, prefix='mermaid_')
            tmp_img.write(png_data)
            tmp_img.close()
            mermaid_images[placeholder_id] = tmp_img.name
            return f'<p class="mermaid-img-p">{placeholder_id}</p>'
        return f'<pre class="code-block">[Mermaid Diagram]\n{code}</pre>'

    processed_md = _MERMAID_BLOCK_RE.sub(_mermaid_word_replacer, md_text)

    # Convert Markdown to HTML
    body_html = md.markdown(processed_md, extensions=_MD_EXTENSIONS)
    body_html = body_html.replace('✅', '✓').replace('❌', '✗')

    soup = BeautifulSoup(body_html, 'html.parser')

    for element in soup.children:
        if isinstance(element, NavigableString):
            text = str(element).strip()
            if text:
                p = doc.add_paragraph()
                run = p.add_run(text)
                _set_cjk_font(run)
            continue

        tag = element.name.lower() if element.name else ''

        # Headings (h1 - h6)
        if tag in ('h1', 'h2', 'h3', 'h4', 'h5', 'h6'):
            level = int(tag[1])
            h = doc.add_heading(level=min(level, 9))
            for child in element.children:
                _append_node_to_paragraph(h, child)
            for run in h.runs:
                _set_cjk_font(run, size_pt=max(18 - level * 2, 11))
            continue

        # Paragraph
        if tag == 'p':
            p_text = element.get_text().strip()
            if p_text in mermaid_images:
                img_path = mermaid_images[p_text]
                p = doc.add_paragraph()
                p.alignment = WD_ALIGN_PARAGRAPH.CENTER
                run = p.add_run()
                run.add_picture(img_path, width=Inches(5.5))
                continue

            p = doc.add_paragraph()
            for child in element.children:
                _append_node_to_paragraph(p, child)
            continue

        # Lists (ul / ol)
        if tag in ('ul', 'ol'):
            list_style = 'List Bullet' if tag == 'ul' else 'List Number'
            for li in element.find_all('li', recursive=False):
                p = doc.add_paragraph(style=list_style)
                for child in li.children:
                    if child.name in ('ul', 'ol'):
                        continue
                    _append_node_to_paragraph(p, child)
            continue

        # Blockquote
        if tag == 'blockquote':
            p = doc.add_paragraph()
            p.paragraph_format.left_indent = Inches(0.25)
            p.add_run('│ ')
            for child in element.children:
                _append_node_to_paragraph(p, child, is_italic=True)
            for run in p.runs:
                run.font.color.rgb = RGBColor(0x47, 0x55, 0x69)
            continue

        # Code block (pre)
        if tag == 'pre':
            code_text = element.get_text()
            p = doc.add_paragraph()
            run = p.add_run(code_text)
            _set_cjk_font(run, font_name='Noto Sans Mono CJK TC', size_pt=9.5)
            run.font.color.rgb = RGBColor(0x33, 0x41, 0x55)
            pPr = p._element.get_or_add_pPr()
            shd = OxmlElement('w:shd')
            shd.set(qn('w:fill'), 'F8FAFC')
            shd.set(qn('w:val'), 'clear')
            pPr.append(shd)
            continue

        # Table
        if tag == 'table':
            rows = element.find_all('tr')
            if rows:
                num_cols = max(len(r.find_all(['th', 'td'])) for r in rows)
                table = doc.add_table(rows=len(rows), cols=num_cols)
                table.style = 'Table Grid'
                for ri, tr in enumerate(rows):
                    cells = tr.find_all(['th', 'td'])
                    for ci, cell_el in enumerate(cells):
                        if ci < num_cols:
                            cell = table.cell(ri, ci)
                            cell.text = ''
                            p = cell.paragraphs[0]
                            for child in cell_el.children:
                                _append_node_to_paragraph(p, child, is_bold=(ri == 0))
                            for run in p.runs:
                                _set_cjk_font(run, size_pt=10)
            continue

        # Horizontal rule
        if tag == 'hr':
            p = doc.add_paragraph()
            p.add_run('─' * 50)
            continue

    tmp = tempfile.NamedTemporaryFile(suffix='.docx', delete=False, prefix='md_export_')
    doc.save(tmp.name)
    return tmp.name


# ---------------------------------------------------------------------------
# Gradio UI
# ---------------------------------------------------------------------------

_SAMPLE_MD = '''# Markdown 預覽範例

這是一個 **Markdown 預覽器**，支援 *中文* 與各種格式。

## 功能列表

- ✅ 標題 (h1 ~ h6)
- ✅ **粗體**、*斜體*、`行內程式碼`
- ✅ 清單 (有序 / 無序)
- ✅ 表格
- ✅ 引言區塊
- ✅ 程式碼區塊
- ✅ Mermaid 流程圖

## 表格範例

| 功能 | 狀態 | 備註 |
|------|------|------|
| 中文支援 | ✅ | 完整 CJK 支援 |
| Mermaid | ✅ | 流程圖、序列圖等 |
| 匯出 PDF | ✅ | 支援中文字型 |
| 匯出 Word | ✅ | .docx 格式 |

## 程式碼區塊

```python
def hello():
    print('你好世界！')
```

> 這是一段引言，支援中文排版。

## Mermaid 流程圖

```mermaid
graph TD
    A[開始] --> B{是否有資料?}
    B -->|有| C[處理資料]
    B -->|無| D[等待輸入]
    C --> E[輸出結果]
    D --> B
```

---

*感謝使用本工具！*
'''

_GRADIO_CUSTOM_CSS = '''
.gradio-container {
    max-width: 100% !important;
}
.tabs > .tab-content {
    width: 100% !important;
}
.tabitem {
    width: 100% !important;
}
'''


def create_app() -> gr.Blocks:
    '''
    Construct the Gradio UI blocks application with tabs for word counting
    and markdown preview with export capabilities.

    Returns:
        gr.Blocks instance with two tabs: word count and markdown preview.
    '''
    theme = gr.themes.Soft(
        primary_hue='indigo',
        secondary_hue='slate',
    )

    with gr.Blocks(
        theme=theme,
        title='文字工具箱 - 字數統計 & Markdown 預覽',
        css=_GRADIO_CUSTOM_CSS,
    ) as demo:
        gr.Markdown(
            '''
            # 📝 文字工具箱
            字數統計 · Markdown 即時預覽 · 匯出 PDF / Word
            '''
        )

        with gr.Tabs():
            # =============== Tab 1: Word Count ===============
            with gr.Tab('📊 字數統計'):
                with gr.Row(equal_height=False):
                    with gr.Column(scale=3, min_width=400):
                        text_input = gr.Textbox(
                            label='請貼上或輸入文字',
                            placeholder='在此處貼上文字...',
                            lines=14,
                            max_lines=30,
                            autofocus=True,
                        )
                        with gr.Row():
                            clear_btn = gr.Button(
                                '清空內容', variant='secondary',
                            )

                    with gr.Column(scale=2, min_width=300):
                        gr.Markdown('### 📊 統計結果')
                        with gr.Row():
                            total_chars_num = gr.Number(
                                label='總字數 (含空格/換行)',
                                value=0, precision=0, interactive=False,
                            )
                            chars_no_spaces_num = gr.Number(
                                label='不含空格/換行字數',
                                value=0, precision=0, interactive=False,
                            )
                        with gr.Row():
                            cjk_count_num = gr.Number(
                                label='中文字數 (漢字)',
                                value=0, precision=0, interactive=False,
                            )
                            cjk_punct_num = gr.Number(
                                label='全形/中文標點',
                                value=0, precision=0, interactive=False,
                            )
                        with gr.Row():
                            english_words_num = gr.Number(
                                label='英文字數 (Words)',
                                value=0, precision=0, interactive=False,
                            )
                            digit_count_num = gr.Number(
                                label='數字個數',
                                value=0, precision=0, interactive=False,
                            )
                        with gr.Row():
                            line_count_num = gr.Number(
                                label='總行數',
                                value=0, precision=0, interactive=False,
                            )

                count_outputs = [
                    total_chars_num, chars_no_spaces_num,
                    cjk_count_num, cjk_punct_num,
                    english_words_num, digit_count_num, line_count_num,
                ]

                text_input.change(
                    fn=analyze_text,
                    inputs=[text_input],
                    outputs=count_outputs,
                )

                clear_btn.click(
                    fn=clear_input,
                    inputs=[],
                    outputs=[text_input] + count_outputs,
                )

            # =============== Tab 2: Markdown Preview ===============
            with gr.Tab('🔍 Markdown 預覽'):
                with gr.Row(equal_height=False):
                    with gr.Column(scale=1, min_width=400):
                        md_input = gr.Textbox(
                            label='Markdown 原始碼',
                            placeholder='在此輸入 Markdown 文字...',
                            lines=28,
                            max_lines=50,
                            value=_SAMPLE_MD,
                        )
                        with gr.Row():
                            export_pdf_btn = gr.Button(
                                '📄 匯出 PDF', variant='primary',
                            )
                            export_word_btn = gr.Button(
                                '📝 匯出 Word', variant='primary',
                            )
                        pdf_download = gr.File(
                            label='PDF 下載', visible=False,
                        )
                        word_download = gr.File(
                            label='Word 下載', visible=False,
                        )

                    with gr.Column(scale=1, min_width=400):
                        gr.Markdown('### 👁️ 即時預覽')
                        preview_html = gr.HTML(
                            value=render_preview(_SAMPLE_MD),
                        )

                # Live preview
                md_input.change(
                    fn=render_preview,
                    inputs=[md_input],
                    outputs=[preview_html],
                )

                # PDF export
                def _do_export_pdf(md_text: str):
                    '''
                    Handle PDF export button click.
                    '''
                    path = export_pdf(md_text)
                    if path:
                        return gr.update(value=path, visible=True)
                    return gr.update(visible=False)

                export_pdf_btn.click(
                    fn=_do_export_pdf,
                    inputs=[md_input],
                    outputs=[pdf_download],
                )

                # Word export
                def _do_export_word(md_text: str):
                    '''
                    Handle Word export button click.
                    '''
                    path = export_word(md_text)
                    if path:
                        return gr.update(value=path, visible=True)
                    return gr.update(visible=False)

                export_word_btn.click(
                    fn=_do_export_word,
                    inputs=[md_input],
                    outputs=[word_download],
                )

    return demo


if __name__ == '__main__':
    app = create_app()
    app.launch(
        server_name='0.0.0.0',
        server_port=27860,
        share=False,
    )
