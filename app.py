import re
import tempfile

import gradio as gr
import markdown as md
from docx import Document

from docx.oxml.ns import qn
from docx.shared import Pt, RGBColor
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
# Markdown preview logic
# ---------------------------------------------------------------------------

_MERMAID_BLOCK_RE = re.compile(
    r'```mermaid\s*\n(.*?)```',
    re.DOTALL,
)

_MD_EXTENSIONS = [
    'tables',
    'fenced_code',
    'codehilite',
    'toc',
    'nl2br',
    'sane_lists',
    'smarty',
]


def _replace_mermaid_blocks(md_text: str) -> tuple[str, bool]:
    '''
    Extract mermaid code blocks and replace them with <div class="mermaid">
    placeholders for client-side rendering.

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

    return f'''<!DOCTYPE html>
<html lang="zh-Hant">
<head>
<meta charset="UTF-8">
<style>
body {{
    font-family: "Noto Sans CJK TC", "Noto Sans CJK SC", "WenQuanYi Micro Hei",
                 "Microsoft JhengHei", "PingFang TC", sans-serif;
    line-height: 1.8;
    color: #1e293b;
    max-width: 800px;
    margin: 0 auto;
    padding: 2rem;
    background: #fff;
}}
h1 {{ color: #1e3a5f; border-bottom: 2px solid #6366f1; padding-bottom: .3em; }}
h2 {{ color: #334155; border-bottom: 1px solid #e2e8f0; padding-bottom: .2em; }}
h3 {{ color: #475569; }}
code {{
    background: #f1f5f9;
    padding: 0.15em 0.4em;
    border-radius: 4px;
    font-size: 0.9em;
    font-family: "JetBrains Mono", "Fira Code", "Noto Sans Mono CJK TC", monospace;
}}
pre {{
    background: #1e293b;
    color: #e2e8f0;
    padding: 1em;
    border-radius: 8px;
    overflow-x: auto;
}}
pre code {{
    background: transparent;
    color: inherit;
    padding: 0;
}}
blockquote {{
    border-left: 4px solid #6366f1;
    margin: 1em 0;
    padding: 0.5em 1em;
    background: #f8fafc;
    color: #475569;
}}
table {{
    border-collapse: collapse;
    width: 100%;
    margin: 1em 0;
}}
th, td {{
    border: 1px solid #cbd5e1;
    padding: 0.6em 1em;
    text-align: left;
}}
th {{
    background: #f1f5f9;
    font-weight: 600;
}}
tr:nth-child(even) {{ background: #f8fafc; }}
img {{ max-width: 100%; height: auto; }}
a {{ color: #6366f1; text-decoration: none; }}
a:hover {{ text-decoration: underline; }}
hr {{ border: none; border-top: 1px solid #e2e8f0; margin: 2em 0; }}
.mermaid {{
    display: flex;
    justify-content: center;
    margin: 1.5em 0;
    background: #f8fafc;
    padding: 1em;
    border-radius: 8px;
}}
</style>
{mermaid_script}
</head>
<body>
{body_html}
</body>
</html>'''


def render_preview(md_text: str) -> str:
    '''
    Convert markdown text to styled HTML for live preview.

    Handles mermaid code blocks by replacing them with <div class="mermaid">
    and loading mermaid.js from CDN.

    Args:
        md_text: Raw markdown string.

    Returns:
        Rendered HTML string wrapped in a styled document.
    '''
    if not md_text or not md_text.strip():
        return '<div style="color:#94a3b8;padding:2rem;text-align:center;">' \
               '請在左側輸入 Markdown 文字以預覽</div>'

    processed, has_mermaid = _replace_mermaid_blocks(md_text)
    body_html = md.markdown(processed, extensions=_MD_EXTENSIONS)
    return _build_html_page(body_html, has_mermaid)


# ---------------------------------------------------------------------------
# Export: PDF
# ---------------------------------------------------------------------------

def _render_md_to_html_for_export(md_text: str) -> str:
    '''
    Convert markdown to a print-ready HTML document (no mermaid.js).

    Mermaid blocks are rendered as styled <pre> blocks in the export since
    mermaid.js requires a browser runtime.

    Args:
        md_text: Raw markdown string.

    Returns:
        Complete HTML string suitable for weasyprint.
    '''
    def _mermaid_to_pre(match: re.Match) -> str:
        code = match.group(1).strip()
        return (
            f'<pre style="background:#f0f4f8;padding:1em;border-radius:8px;'
            f'border:1px solid #cbd5e1;font-size:0.85em;white-space:pre-wrap;">'
            f'[Mermaid Diagram]\n{code}</pre>'
        )

    processed = _MERMAID_BLOCK_RE.sub(_mermaid_to_pre, md_text)
    body_html = md.markdown(processed, extensions=_MD_EXTENSIONS)
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

_HEADING_RE = re.compile(r'^(#{1,6})\s+(.+)$')
_BOLD_RE = re.compile(r'\*\*(.+?)\*\*|__(.+?)__')
_ITALIC_RE = re.compile(r'(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)|(?<!_)_(?!_)(.+?)(?<!_)_(?!_)')
_CODE_INLINE_RE = re.compile(r'`([^`]+)`')
_UL_RE = re.compile(r'^[-*+]\s+(.+)$')
_OL_RE = re.compile(r'^\d+\.\s+(.+)$')
_BLOCKQUOTE_RE = re.compile(r'^>\s*(.*)$')
_HR_RE = re.compile(r'^(-{3,}|_{3,}|\*{3,})$')
_TABLE_SEP_RE = re.compile(r'^\|[\s\-:|]+\|$')
_TABLE_ROW_RE = re.compile(r'^\|(.+)\|$')
_CODE_FENCE_RE = re.compile(r'^```')


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


def _add_styled_paragraph(
    doc: Document,
    text: str,
    style: str = 'Normal',
    bold: bool = False,
    italic: bool = False,
    font_size: int = 11,
    font_color: RGBColor | None = None,
) -> None:
    '''
    Add a paragraph with CJK font support and optional styling.

    Args:
        doc: The Document to add the paragraph to.
        text: Paragraph text.
        style: Word style name.
        bold: Whether to bold the text.
        italic: Whether to italicize the text.
        font_size: Font size in points.
        font_color: Optional RGB color for text.
    '''
    p = doc.add_paragraph(style=style)
    run = p.add_run(text)
    _set_cjk_font(run, size_pt=font_size)
    run.bold = bold
    run.italic = italic
    if font_color:
        run.font.color.rgb = font_color


def export_word(md_text: str) -> str | None:
    '''
    Export markdown text to a Word (.docx) file with CJK font support.

    Parses markdown line-by-line to create structured Word document elements
    including headings, lists, code blocks, blockquotes, tables, and
    horizontal rules.

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

    lines = md_text.split('\n')
    i = 0
    while i < len(lines):
        line = lines[i]

        # Fenced code block
        if _CODE_FENCE_RE.match(line):
            lang = line.strip('`').strip()
            code_lines = []
            i += 1
            while i < len(lines) and not _CODE_FENCE_RE.match(lines[i]):
                code_lines.append(lines[i])
                i += 1
            code_text = '\n'.join(code_lines)
            label = f'[{lang}]' if lang and lang != 'mermaid' else ''
            if lang == 'mermaid':
                label = '[Mermaid Diagram]'
            p = doc.add_paragraph()
            run = p.add_run(f'{label}\n{code_text}' if label else code_text)
            _set_cjk_font(run, font_name='Noto Sans Mono CJK TC', size_pt=9)
            run.font.color.rgb = RGBColor(0x1e, 0x29, 0x3b)
            from docx.oxml import OxmlElement
            pPr = p._element.get_or_add_pPr()
            shd = OxmlElement('w:shd')
            shd.set(qn('w:fill'), 'F1F5F9')
            shd.set(qn('w:val'), 'clear')
            pPr.append(shd)
            i += 1
            continue

        # Heading
        heading_match = _HEADING_RE.match(line)
        if heading_match:
            level = len(heading_match.group(1))
            text = heading_match.group(2).strip()
            h = doc.add_heading(text, level=min(level, 9))
            for run in h.runs:
                _set_cjk_font(run, size_pt=max(18 - level * 2, 11))
            i += 1
            continue

        # Horizontal rule
        if _HR_RE.match(line.strip()):
            p = doc.add_paragraph()
            p.add_run('─' * 50)
            i += 1
            continue

        # Table
        if _TABLE_ROW_RE.match(line.strip()):
            rows_data = []
            while i < len(lines) and _TABLE_ROW_RE.match(lines[i].strip()):
                if not _TABLE_SEP_RE.match(lines[i].strip()):
                    cells = [
                        c.strip()
                        for c in lines[i].strip().strip('|').split('|')
                    ]
                    rows_data.append(cells)
                i += 1
            if rows_data:
                num_cols = max(len(r) for r in rows_data)
                table = doc.add_table(rows=len(rows_data), cols=num_cols)
                table.style = 'Table Grid'
                for ri, row_data in enumerate(rows_data):
                    for ci, cell_text in enumerate(row_data):
                        if ci < num_cols:
                            cell = table.cell(ri, ci)
                            cell.text = cell_text
                            for p in cell.paragraphs:
                                for run in p.runs:
                                    _set_cjk_font(run, size_pt=10)
                                    if ri == 0:
                                        run.bold = True
            continue

        # Blockquote
        bq_match = _BLOCKQUOTE_RE.match(line)
        if bq_match:
            text = bq_match.group(1)
            _add_styled_paragraph(
                doc, f'│ {text}',
                italic=True,
                font_color=RGBColor(0x47, 0x55, 0x69),
            )
            i += 1
            continue

        # Unordered list
        ul_match = _UL_RE.match(line)
        if ul_match:
            p = doc.add_paragraph(style='List Bullet')
            run = p.add_run(ul_match.group(1))
            _set_cjk_font(run)
            i += 1
            continue

        # Ordered list
        ol_match = _OL_RE.match(line)
        if ol_match:
            p = doc.add_paragraph(style='List Number')
            run = p.add_run(ol_match.group(1))
            _set_cjk_font(run)
            i += 1
            continue

        # Normal paragraph (skip empty lines)
        if line.strip():
            _add_styled_paragraph(doc, line)

        i += 1

    tmp = tempfile.NamedTemporaryFile(
        suffix='.docx', delete=False, prefix='md_export_',
    )
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

    with gr.Blocks(theme=theme, title='文字工具箱 - 字數統計 & Markdown 預覽') as demo:
        gr.Markdown(
            '''
            # 📝 文字工具箱
            字數統計 · Markdown 即時預覽 · 匯出 PDF / Word
            '''
        )

        with gr.Tabs():
            # =============== Tab 1: Word Count ===============
            with gr.Tab('📊 字數統計'):
                with gr.Row():
                    with gr.Column(scale=3):
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

                    with gr.Column(scale=2):
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
                with gr.Row():
                    with gr.Column(scale=1):
                        md_input = gr.Textbox(
                            label='Markdown 原始碼',
                            placeholder='在此輸入 Markdown 文字...',
                            lines=24,
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

                    with gr.Column(scale=1):
                        preview_html = gr.HTML(
                            label='即時預覽',
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
