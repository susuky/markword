from dataclasses import dataclass, field

from docx.shared import RGBColor
from pygments.formatters import HtmlFormatter


@dataclass
class ThemeColors:
    '''
    Color definitions for Word document export styling.
    '''
    h1: RGBColor
    h2: RGBColor
    h3: RGBColor
    body: RGBColor
    link: RGBColor
    code_text: RGBColor
    quote: RGBColor
    table_header_bg: str
    code_block_bg: str


@dataclass
class Theme:
    '''
    Complete theme specification for preview, PDF, and Word export.
    '''
    name: str
    pygments_style: str
    mermaid_theme: str
    body_bg: str
    body_color: str
    css: str
    docx_colors: ThemeColors
    mermaid_variables: dict[str, str | bool] = field(default_factory=dict)


def _mermaid_variables(
    background: str,
    surface: str,
    text: str,
    muted: str,
    border: str,
    accent: str,
    dark: bool = False,
) -> dict[str, str | bool]:
    return {
        'darkMode': dark,
        'background': background,
        'primaryColor': surface,
        'primaryTextColor': text,
        'primaryBorderColor': accent,
        'secondaryColor': background,
        'secondaryTextColor': text,
        'secondaryBorderColor': border,
        'tertiaryColor': surface,
        'tertiaryTextColor': text,
        'tertiaryBorderColor': border,
        'lineColor': muted,
        'textColor': text,
        'mainBkg': surface,
        'nodeBorder': accent,
        'clusterBkg': background,
        'clusterBorder': border,
        'edgeLabelBackground': surface,
        'noteBkgColor': surface,
        'noteTextColor': text,
        'noteBorderColor': accent,
        'actorBkg': surface,
        'actorBorder': accent,
        'actorTextColor': text,
        'signalColor': muted,
        'signalTextColor': text,
        'fontFamily': 'Noto Sans CJK TC, Microsoft JhengHei, sans-serif',
        'fontSize': '14px',
    }


def _generate_theme_css(
    body_bg: str,
    body_color: str,
    h1_color: str,
    h1_border: str,
    h2_color: str,
    h2_border: str,
    h3_color: str,
    code_bg: str,
    code_color: str,
    pre_bg: str,
    pre_border: str,
    quote_border: str,
    quote_bg: str,
    quote_color: str,
    th_bg: str,
    th_color: str,
    td_border: str,
    tr_even_bg: str,
    link_color: str,
    pygments_style: str,
) -> str:
    '''
    Helper function to build clean CSS for HTML preview and PDF export.

    Args:
        body_bg: Page background color hex.
        body_color: Main body text color hex.
        h1_color: H1 header text color hex.
        h1_border: H1 bottom border color hex.
        h2_color: H2 header text color hex.
        h2_border: H2 bottom border color hex.
        h3_color: H3 header text color hex.
        code_bg: Inline code background color hex.
        code_color: Inline code text color hex.
        pre_bg: Pre block background color hex.
        pre_border: Pre block border color hex.
        quote_border: Blockquote left border color hex.
        quote_bg: Blockquote background color hex.
        quote_color: Blockquote text color hex.
        th_bg: Table header background color hex.
        th_color: Table header text color hex.
        td_border: Table cell border color hex.
        tr_even_bg: Alternate table row background color hex.
        link_color: Anchor link text color hex.
        pygments_style: Pygments style identifier for syntax highlighting.

    Returns:
        Complete CSS string.
    '''
    pygments_css = HtmlFormatter(style=pygments_style).get_style_defs('.codehilite')

    return f'''body {{
    font-family: "Noto Sans CJK TC", "Noto Sans CJK SC", "WenQuanYi Micro Hei",
                 "Microsoft JhengHei", "PingFang TC", sans-serif;
    line-height: 1.8;
    color: {body_color};
    max-width: 850px;
    margin: 0 auto;
    padding: 1.8rem;
    background: {body_bg};
}}
h1 {{ color: {h1_color}; border-bottom: 2px solid {h1_border}; padding-bottom: .3em; margin-top: 1em; }}
h2 {{ color: {h2_color}; border-bottom: 1px solid {h2_border}; padding-bottom: .2em; margin-top: 1em; }}
h3 {{ color: {h3_color}; margin-top: 0.8em; }}
code {{
    background: {code_bg};
    color: {code_color};
    padding: 0.15em 0.4em;
    border-radius: 4px;
    font-size: 0.9em;
    font-family: "JetBrains Mono", "Fira Code", "Noto Sans Mono CJK TC", monospace;
}}
pre {{
    background: {pre_bg};
    border: 1px solid {pre_border};
    padding: 1.2em;
    border-radius: 8px;
    overflow-x: auto;
    line-height: 1.5;
}}
pre code {{
    background: transparent;
    color: inherit;
    padding: 0;
}}
blockquote {{
    border-left: 4px solid {quote_border};
    margin: 1em 0;
    padding: 0.6em 1.2em;
    background: {quote_bg};
    color: {quote_color};
    border-radius: 0 8px 8px 0;
}}
table {{
    border-collapse: collapse;
    width: 100%;
    margin: 1.2em 0;
}}
th, td {{
    border: 1px solid {td_border};
    padding: 0.65em 1em;
    text-align: left;
}}
th {{
    background: {th_bg};
    color: {th_color};
    font-weight: 600;
}}
tr:nth-child(even) {{ background: {tr_even_bg}; }}
img {{ max-width: 100%; height: auto; }}
a {{ color: {link_color}; text-decoration: none; font-weight: 500; }}
a:hover {{ text-decoration: underline; }}
hr {{ border: none; border-top: 1px solid {h2_border}; margin: 2em 0; }}
span.chk {{
    color: #10b981;
    font-weight: bold;
    font-size: 1.1em;
}}
span.crs {{
    color: #ef4444;
    font-weight: bold;
    font-size: 1.1em;
}}
.mermaid {{
    display: flex;
    justify-content: center;
    margin: 1.5em 0;
    background: {pre_bg};
    padding: 1.2em;
    border-radius: 8px;
    border: 1px solid {pre_border};
}}
.mermaid-img {{
    text-align: center;
    margin: 1.5em 0;
}}
.mermaid-img img {{
    max-width: 100%;
    height: auto;
    border-radius: 8px;
    border: 1px solid {pre_border};
    padding: 8px;
    background: {body_bg};
}}

/* Pygments Syntax Highlighting Styles */
{pygments_css}
'''


THEMES: dict[str, Theme] = {
    'Light': Theme(
        name='Light',
        pygments_style='default',
        mermaid_theme='base',
        body_bg='#ffffff',
        body_color='#202b3c',
        css=_generate_theme_css(
            body_bg='#ffffff',
            body_color='#202b3c',
            h1_color='#1e3a5f',
            h1_border='#6366f1',
            h2_color='#334155',
            h2_border='#dfe5ee',
            h3_color='#475569',
            code_bg='#f5f7fb',
            code_color='#4338ca',
            pre_bg='#f5f7fb',
            pre_border='#dfe5ee',
            quote_border='#6366f1',
            quote_bg='#f8fafc',
            quote_color='#475569',
            th_bg='#f1f5f9',
            th_color='#1e293b',
            td_border='#cbd5e1',
            tr_even_bg='#f8fafc',
            link_color='#6366f1',
            pygments_style='default',
        ),
        docx_colors=ThemeColors(
            h1=RGBColor(0x1e, 0x3a, 0x5f),
            h2=RGBColor(0x33, 0x41, 0x55),
            h3=RGBColor(0x47, 0x55, 0x69),
            body=RGBColor(0x1e, 0x29, 0x3b),
            link=RGBColor(0x63, 0x66, 0xf1),
            code_text=RGBColor(0x43, 0x38, 0xca),
            quote=RGBColor(0x47, 0x55, 0x69),
            table_header_bg='F1F5F9',
            code_block_bg='F8FAFC',
        ),
        mermaid_variables=_mermaid_variables('#ffffff', '#f5f7fb', '#202b3c', '#64748b', '#dfe5ee', '#554ee8'),
    ),
    'Dark': Theme(
        name='Dark',
        pygments_style='monokai',
        mermaid_theme='base',
        body_bg='#111827',
        body_color='#e5eaf2',
        css=_generate_theme_css(
            body_bg='#111827',
            body_color='#e5eaf2',
            h1_color='#45b8e8',
            h1_border='#0284c7',
            h2_color='#7dd3fc',
            h2_border='#344155',
            h3_color='#93c5fd',
            code_bg='#1c2637',
            code_color='#45b8e8',
            pre_bg='#1c2637',
            pre_border='#344155',
            quote_border='#45b8e8',
            quote_bg='#1c2637',
            quote_color='#9aa7ba',
            th_bg='#1c2637',
            th_color='#45b8e8',
            td_border='#344155',
            tr_even_bg='#111827',
            link_color='#45b8e8',
            pygments_style='monokai',
        ),
        docx_colors=ThemeColors(
            h1=RGBColor(0x02, 0x84, 0xc7),
            h2=RGBColor(0x03, 0x69, 0xa1),
            h3=RGBColor(0x0e, 0x74, 0x90),
            body=RGBColor(0x0f, 0x17, 0x2a),
            link=RGBColor(0x02, 0x84, 0xc7),
            code_text=RGBColor(0x02, 0x84, 0xc7),
            quote=RGBColor(0x47, 0x55, 0x69),
            table_header_bg='E0F2FE',
            code_block_bg='F0F9FF',
        ),
        mermaid_variables=_mermaid_variables('#111827', '#1c2637', '#e5eaf2', '#9aa7ba', '#344155', '#45b8e8', True),
    ),
    'Nord': Theme(
        name='Nord',
        pygments_style='nord',
        mermaid_theme='base',
        body_bg='#2e3440',
        body_color='#e5e9f0',
        css=_generate_theme_css(
            body_bg='#2e3440',
            body_color='#e5e9f0',
            h1_color='#88c0d0',
            h1_border='#81a1c1',
            h2_color='#81a1c1',
            h2_border='#4c566a',
            h3_color='#5e81ac',
            code_bg='#3b4252',
            code_color='#88c0d0',
            pre_bg='#3b4252',
            pre_border='#4c566a',
            quote_border='#88c0d0',
            quote_bg='#3b4252',
            quote_color='#b7c0cf',
            th_bg='#3b4252',
            th_color='#88c0d0',
            td_border='#4c566a',
            tr_even_bg='#2e3440',
            link_color='#88c0d0',
            pygments_style='nord',
        ),
        docx_colors=ThemeColors(
            h1=RGBColor(0x5e, 0x81, 0xac),
            h2=RGBColor(0x81, 0xa1, 0xc1),
            h3=RGBColor(0x88, 0xc0, 0xd0),
            body=RGBColor(0x2e, 0x34, 0x40),
            link=RGBColor(0x5e, 0x81, 0xac),
            code_text=RGBColor(0x5e, 0x81, 0xac),
            quote=RGBColor(0x4c, 0x56, 0x6a),
            table_header_bg='E5E9F0',
            code_block_bg='ECEFF4',
        ),
        mermaid_variables=_mermaid_variables('#2e3440', '#3b4252', '#e5e9f0', '#b7c0cf', '#4c566a', '#88c0d0', True),
    ),
    'Dracula': Theme(
        name='Dracula',
        pygments_style='dracula',
        mermaid_theme='base',
        body_bg='#282a36',
        body_color='#f8f8f2',
        css=_generate_theme_css(
            body_bg='#282a36',
            body_color='#f8f8f2',
            h1_color='#ff79c6',
            h1_border='#bd93f9',
            h2_color='#bd93f9',
            h2_border='#44475a',
            h3_color='#8be9fd',
            code_bg='#44475a',
            code_color='#ff79c6',
            pre_bg='#44475a',
            pre_border='#4f5268',
            quote_border='#ff79c6',
            quote_bg='#44475a',
            quote_color='#f1fa8c',
            th_bg='#44475a',
            th_color='#ff79c6',
            td_border='#4f5268',
            tr_even_bg='#282a36',
            link_color='#8be9fd',
            pygments_style='dracula',
        ),
        docx_colors=ThemeColors(
            h1=RGBColor(0x9d, 0x4e, 0xdd),
            h2=RGBColor(0x7b, 0x2c, 0xbf),
            h3=RGBColor(0x5a, 0x18, 0x9a),
            body=RGBColor(0x28, 0x2a, 0x36),
            link=RGBColor(0x7b, 0x2c, 0xbf),
            code_text=RGBColor(0x7b, 0x2c, 0xbf),
            quote=RGBColor(0x62, 0x72, 0xa4),
            table_header_bg='F3E8FF',
            code_block_bg='FAF5FF',
        ),
        mermaid_variables=_mermaid_variables('#282a36', '#343746', '#f8f8f2', '#c4c5bf', '#4f5268', '#bd93f9', True),
    ),
    'Paper': Theme(
        name='Paper', pygments_style='tango', mermaid_theme='base', body_bg='#fbf7ef', body_color='#3d352e',
        css=_generate_theme_css(
            body_bg='#fbf7ef', body_color='#3d352e', h1_color='#713a28', h1_border='#a24d2f',
            h2_color='#59483d', h2_border='#ddd2c2', h3_color='#6d584a', code_bg='#f2eadf',
            code_color='#8c4a28', pre_bg='#f2eadf', pre_border='#d6c8b5', quote_border='#a24d2f',
            quote_bg='#f4ecdf', quote_color='#66584d', th_bg='#eadfce', th_color='#3d352e',
            td_border='#d6c8b5', tr_even_bg='#f7f1e8', link_color='#a24d2f', pygments_style='tango',
        ),
        docx_colors=ThemeColors(
            h1=RGBColor(0x71, 0x3a, 0x28), h2=RGBColor(0x59, 0x48, 0x3d),
            h3=RGBColor(0x6d, 0x58, 0x4a), body=RGBColor(0x3d, 0x35, 0x2e),
            link=RGBColor(0xa2, 0x4d, 0x2f), code_text=RGBColor(0x8c, 0x4a, 0x28),
            quote=RGBColor(0x66, 0x58, 0x4d), table_header_bg='EADFD0', code_block_bg='F4ECDF',
        ),
        mermaid_variables=_mermaid_variables('#fbf7ef', '#f2eadf', '#3d352e', '#786b60', '#ddd2c2', '#a24d2f'),
    ),
    'Sage': Theme(
        name='Sage', pygments_style='friendly', mermaid_theme='base', body_bg='#f4f7f2', body_color='#26362d',
        css=_generate_theme_css(
            body_bg='#f4f7f2', body_color='#26362d', h1_color='#285944', h1_border='#35735a',
            h2_color='#355947', h2_border='#d3ded4', h3_color='#496554', code_bg='#e8efe8',
            code_color='#347357', pre_bg='#e8efe8', pre_border='#cad8cc', quote_border='#35735a',
            quote_bg='#eaf0e8', quote_color='#50645a', th_bg='#dfe9df', th_color='#26362d',
            td_border='#cbd8cc', tr_even_bg='#eef3ec', link_color='#35735a', pygments_style='friendly',
        ),
        docx_colors=ThemeColors(
            h1=RGBColor(0x28, 0x59, 0x44), h2=RGBColor(0x35, 0x59, 0x47),
            h3=RGBColor(0x49, 0x65, 0x54), body=RGBColor(0x26, 0x36, 0x2d),
            link=RGBColor(0x35, 0x73, 0x5a), code_text=RGBColor(0x34, 0x73, 0x57),
            quote=RGBColor(0x50, 0x64, 0x5a), table_header_bg='DFE9DF', code_block_bg='E8EFE8',
        ),
        mermaid_variables=_mermaid_variables('#f4f7f2', '#e8efe8', '#26362d', '#637269', '#d3ded4', '#35735a'),
    ),
    'Ocean': Theme(
        name='Ocean', pygments_style='monokai', mermaid_theme='base', body_bg='#082f36', body_color='#d9f1ef',
        css=_generate_theme_css(
            body_bg='#082f36', body_color='#d9f1ef', h1_color='#72e2d1', h1_border='#55d6c2',
            h2_color='#9ee7dc', h2_border='#23535a', h3_color='#9fc9d6', code_bg='#103e46',
            code_color='#72e2d1', pre_bg='#103e46', pre_border='#23535a', quote_border='#55d6c2',
            quote_bg='#103e46', quote_color='#b8d8d6', th_bg='#164952', th_color='#d9f1ef',
            td_border='#23535a', tr_even_bg='#0b353c', link_color='#55d6c2', pygments_style='monokai',
        ),
        docx_colors=ThemeColors(
            h1=RGBColor(0x0f, 0x76, 0x6e), h2=RGBColor(0x11, 0x62, 0x63),
            h3=RGBColor(0x15, 0x5e, 0x75), body=RGBColor(0x08, 0x2f, 0x36),
            link=RGBColor(0x0f, 0x76, 0x6e), code_text=RGBColor(0x0f, 0x76, 0x6e),
            quote=RGBColor(0x47, 0x65, 0x69), table_header_bg='CCFBF1', code_block_bg='F0FDFA',
        ),
        mermaid_variables=_mermaid_variables('#082f36', '#103e46', '#d9f1ef', '#91b8b7', '#23535a', '#55d6c2', True),
    ),
    'Midnight': Theme(
        name='Midnight', pygments_style='monokai', mermaid_theme='base', body_bg='#111018', body_color='#eeeaf7',
        css=_generate_theme_css(
            body_bg='#111018', body_color='#eeeaf7', h1_color='#b8aaff', h1_border='#9d8cff',
            h2_color='#c7bdf5', h2_border='#373241', h3_color='#d59bf6', code_bg='#1d1a27',
            code_color='#c4b5fd', pre_bg='#1d1a27', pre_border='#373241', quote_border='#9d8cff',
            quote_bg='#1d1a27', quote_color='#c9c2d4', th_bg='#252131', th_color='#eeeaf7',
            td_border='#373241', tr_even_bg='#15131e', link_color='#b8aaff', pygments_style='monokai',
        ),
        docx_colors=ThemeColors(
            h1=RGBColor(0x6d, 0x5c, 0xc9), h2=RGBColor(0x71, 0x57, 0xa8),
            h3=RGBColor(0x80, 0x4f, 0x9c), body=RGBColor(0x21, 0x1f, 0x2b),
            link=RGBColor(0x6d, 0x5c, 0xc9), code_text=RGBColor(0x71, 0x57, 0xa8),
            quote=RGBColor(0x62, 0x5b, 0x70), table_header_bg='EDE9FE', code_block_bg='F5F3FF',
        ),
        mermaid_variables=_mermaid_variables('#111018', '#1d1a27', '#eeeaf7', '#aaa2bb', '#373241', '#9d8cff', True),
    ),
}
