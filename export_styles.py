"""Reusable document layouts layered on top of a Markword color theme."""

EXPORT_STYLES: dict[str, str] = {
    "Classic": """
@page { size: A4; margin: 18mm 17mm 20mm; }
body { max-width: 850px; font-size: 11pt; line-height: 1.78; }
h1 { font-size: 28pt; margin-top: .2em; }
h2 { font-size: 19pt; margin-top: 1.5em; }
h3 { font-size: 14pt; }
p, li { orphans: 3; widows: 3; }
h1, h2, h3, pre, table, blockquote, .mermaid-img { break-inside: avoid; }
""",
    "Editorial": """
@page { size: A4; margin: 22mm 20mm 24mm; }
body { max-width: 760px; font-family: "Noto Serif CJK TC", "Source Han Serif TC", "Songti TC", serif; font-size: 11.5pt; line-height: 1.95; }
h1, h2, h3 { font-family: "Noto Sans CJK TC", "Microsoft JhengHei", sans-serif; letter-spacing: .02em; }
h1 { margin: .1em 0 1.2em; padding: 0 0 .55em; border-bottom-width: 3px; font-size: 30pt; }
h2 { margin-top: 1.8em; font-size: 19pt; }
p { text-align: justify; text-justify: inter-ideograph; }
blockquote { margin: 1.7em 1em; padding: .9em 1.3em; font-style: italic; }
table { font-family: "Noto Sans CJK TC", "Microsoft JhengHei", sans-serif; font-size: 9.5pt; }
h1, h2, h3, figure, pre, table, blockquote, .mermaid-img { break-inside: avoid; }
""",
    "Report": """
@page { size: A4; margin: 16mm 15mm 18mm; @bottom-right { content: counter(page); font-size: 8pt; color: #7b8799; } }
body { max-width: 900px; font-size: 10.5pt; line-height: 1.68; }
h1 { padding: .55em .65em; border: 0; border-left: 6px solid currentColor; font-size: 25pt; }
h2 { margin-top: 1.45em; padding-bottom: .35em; font-size: 17pt; }
h3 { font-size: 13pt; }
table { font-size: 9pt; }
th, td { padding: .48em .7em; }
pre { font-size: 8.5pt; }
h1, h2, h3, pre, table, blockquote, .mermaid-img { break-inside: avoid; }
""",
    "Compact": """
@page { size: A4; margin: 12mm 13mm 14mm; }
body { max-width: 960px; padding: .5rem; font-size: 9.5pt; line-height: 1.52; }
h1 { margin: .2em 0 .65em; font-size: 22pt; }
h2 { margin-top: 1.1em; font-size: 15pt; }
h3 { margin-top: .9em; font-size: 11.5pt; }
p, ul, ol { margin-top: .48em; margin-bottom: .48em; }
pre { padding: .8em; font-size: 8pt; }
th, td { padding: .36em .55em; }
h1, h2, h3, pre, table, .mermaid-img { break-inside: avoid; }
""",
}
