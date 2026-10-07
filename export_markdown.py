"""Shared PDF/Word Markdown syntax and embedded image validation."""

import base64
from io import BytesIO
import re
import warnings
from xml.etree import ElementTree as ET

from bs4 import BeautifulSoup
import markdown
from markdown.blockprocessors import BlockProcessor
from markdown.extensions import Extension
from markdown.extensions.codehilite import CodeHilite
from markdown.extensions.footnotes import FootnoteExtension
from markdown.inlinepatterns import InlineProcessor
from markdown.preprocessors import Preprocessor
from markdown.treeprocessors import Treeprocessor
from markdown.util import AtomicString
from markdown_it import MarkdownIt
from PIL import Image
from weasyprint.urls import FatalURLFetchingError

from math_renderer import render_math_pngs
from mermaid_renderer import render_mermaid_png


MAX_IMAGE_BYTES = 3 * 1024 * 1024
MAX_IMAGE_PIXELS = 16_000_000
IMAGE_MIMES = {'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/bmp'}
IMAGE_FORMATS = {'PNG', 'JPEG', 'GIF', 'WEBP', 'BMP'}


def embedded_image(source):
    """Decode only bounded raster data; never resolve a path or perform I/O."""
    try:
        header, encoded = source.split(',', 1)
        if header.lower() not in {f'data:{mime};base64' for mime in IMAGE_MIMES}:
            raise ValueError('Unsupported image type')
        if len(encoded) > (MAX_IMAGE_BYTES + 2) // 3 * 4:
            raise ValueError('Image too large')
        data = base64.b64decode(encoded, validate=True)
        if len(data) > MAX_IMAGE_BYTES:
            raise ValueError('Image too large')
        with warnings.catch_warnings():
            warnings.simplefilter('error', Image.DecompressionBombWarning)
            with Image.open(BytesIO(data)) as image:
                if image.format not in IMAGE_FORMATS or max(image.size) > 8192 or image.width * image.height > MAX_IMAGE_PIXELS:
                    raise ValueError('Image dimensions or type unsupported')
                image.verify()
            with Image.open(BytesIO(data)) as image:
                # Word does not support WebP, and static formats need a defined
                # first frame for animated GIF/WebP. Preserve PNG transparency.
                output = BytesIO()
                image.convert('RGBA').save(output, format='PNG')
                return output.getvalue(), image.width, image.height
    except Exception as exc:
        raise FatalURLFetchingError('Embedded raster image unavailable or exceeds limits') from exc


class CommonMarkFences(Preprocessor):
    def run(self, lines):
        # Let the installed CommonMark parser decide fence length, indentation,
        # nested contexts and unclosed fences; never match fenced source by regex.
        tokens = MarkdownIt('commonmark').parse('\n'.join(lines))
        for token in reversed(tokens):
            if token.type != 'fence' or token.map is None:
                continue
            start, end = token.map
            prefix = lines[start].split(token.markup, 1)[0]
            language = token.info.strip().split()[0] if token.info.strip() else ''
            if language.lower() == 'mermaid':
                element = ET.Element('pre', {'class': 'mermaid-source'})
                element.text = token.content.rstrip('\n')
                rendered = ET.tostring(element, encoding='unicode')
            else:
                rendered = CodeHilite(token.content, lang=language or None, guess_lang=False).hilite()
            placeholder = self.md.htmlStash.store(rendered)
            lines[start:end] = ['', prefix + placeholder, '']
        return lines


class ExportFootnotes(FootnoteExtension):
    def setFootnote(self, id, text):
        # The footnote parser has now removed continuation indentation. Run the
        # same fence handling on this content before the footnote tree is built.
        text = '\n'.join(self.md.preprocessors['export_fences'].run(text.split('\n')))
        super().setFootnote(id, text)


def math_element(source, display):
    element = ET.Element('p' if display else 'span', {
        'class': 'math-block' if display else 'math-inline',
        'data-math-source': source,
        'data-math-display': 'true' if display else 'false',
    })
    delimiter = '$$' if display else '$'
    element.text = AtomicString(f'{delimiter}{source}{delimiter}')
    return element


class InlineMath(InlineProcessor):
    def handleMatch(self, match, data):
        backslashes = 0
        previous = match.start() - 1
        while previous >= 0 and data[previous] == '\\':
            backslashes += 1
            previous -= 1
        if backslashes % 2:
            return None, None, None
        start = match.end()
        if start >= len(data) or data[start].isspace():
            return None, None, None
        position = start
        while position < len(data):
            if data[position] == '\n':
                break
            if data[position] == '\\':
                position += 2
                continue
            if data[position] == '$':
                if position == start or data[position - 1].isspace() or (position + 1 < len(data) and data[position + 1].isdigit()):
                    return None, None, None
                return math_element(data[start:position], False), match.start(), position + 1
            position += 1
        return None, None, None


class BlockMath(BlockProcessor):
    def test(self, parent, block):
        return bool(re.match(r'^ {0,3}\$\$', block))

    def run(self, parent, blocks):
        first = blocks[0].lstrip(' ')
        first_line, _, remainder = first.partition('\n')
        if len(first_line) > 4 and first_line.rstrip().endswith('$$'):
            parent.append(math_element(first_line.rstrip()[2:-2].strip(), True))
            blocks.pop(0)
            if remainder:
                blocks.insert(0, remainder)
            return True
        source = first[2:]
        for index in range(len(blocks)):
            if index:
                source += '\n\n' + blocks[index]
            closing = re.search(r'(?m)(?<!\\)\$\$[ \t]*(?:\n|$)', source)
            if closing:
                parent.append(math_element(source[:closing.start()].strip(), True))
                remainder = source[closing.end():]
                del blocks[:index + 1]
                if remainder:
                    blocks.insert(0, remainder)
                return True
        return False


class ExportSyntax(Extension):
    def extendMarkdown(self, md):
        md.ESCAPED_CHARS.append('$')
        md.preprocessors.register(CommonMarkFences(md), 'export_fences', 25)
        md.inlinePatterns.register(InlineMath(r'(?<!\$)\$(?!\$)', md), 'export_math', 185)
        md.parser.blockprocessors.register(BlockMath(md.parser), 'export_math', 85)
        md.treeprocessors.register(TaskLists(md), 'export_tasks', 15)


class TaskLists(Treeprocessor):
    def run(self, root):
        for item in root.iter('li'):
            first = item[0] if len(item) and item[0].tag == 'p' else item
            match = re.match(r'^\[([ xX])\]\s+', first.text or '')
            if match:
                first.text = ('☑ ' if match[1].lower() == 'x' else '☐ ') + first.text[match.end():]


def render_export_body(source, theme, math_color=None):
    body = markdown.markdown(source, extensions=[
        'tables', 'codehilite', 'toc', 'sane_lists', 'smarty',
        ExportFootnotes(USE_DEFINITION_ORDER=False), ExportSyntax(),
    ], output_format='html')
    soup = BeautifulSoup(body, 'html.parser')
    for backlink in soup.select('.footnote-backref'):
        backlink.decompose()
    # Footnotes append a backlink to the last paragraph, which can wrap a raw
    # fence placeholder. Remove that wrapper once the raw block is restored.
    for block in soup.select('.footnote pre.mermaid-source, .footnote div.codehilite'):
        if block.parent.name == 'p':
            block.parent.unwrap()

    # Validate user-supplied images before adding our own rendered diagrams.
    for image in soup.find_all('img'):
        data, width, height = embedded_image(image.get('src', ''))
        # Reserved math sizing attributes are generated only by our renderer.
        image.attrs = {key: image[key] for key in ('alt', 'title') if key in image.attrs}
        image['src'] = 'data:image/png;base64,' + base64.b64encode(data).decode()
        image['width'], image['height'] = str(width), str(height)
        image['style'] = 'max-width:100%;height:auto'

    for block in soup.select('pre.mermaid-source'):
        code = block.get_text()
        data = render_mermaid_png(code, theme)
        if data is None:
            block['class'] = ['mermaid-fallback']
            block.string = '[Mermaid diagram could not be rendered]\n' + code
        else:
            paragraph = soup.new_tag('p', attrs={'class': 'mermaid-img'})
            image = soup.new_tag('img', src='data:image/png;base64,' + base64.b64encode(data).decode(), alt='Mermaid diagram: ' + code)
            image['style'] = 'max-width:100%;height:auto'
            paragraph.append(image)
            block.replace_with(paragraph)

    blocks = soup.select('[data-math-source]')
    formulas = [(block['data-math-source'], block.get('data-math-display') == 'true') for block in blocks]
    for block, result in zip(blocks, render_math_pngs(formulas, math_color or theme.body_color)):
        del block['data-math-source']
        display = block.attrs.pop('data-math-display', 'false') == 'true'
        if result is None:
            block.insert(0, '[Formula could not be rendered] ')
            continue
        data, metrics = result
        image = soup.new_tag('img', src='data:image/png;base64,' + base64.b64encode(data).decode(), alt=block.get_text())
        image['class'] = ['math-image']
        image['width'] = f'{metrics["width"]:.2f}'
        image['height'] = f'{metrics["height"]:.2f}'
        image['data-descent'] = f'{metrics["descent"]:.2f}' if not display else '0'
        image['style'] = f'width:{metrics["width"]:.2f}px;max-width:100%;height:auto;vertical-align:-{metrics["descent"]:.2f}px'
        block.clear()
        block.append(image)
    return soup.decode(formatter='html5')
