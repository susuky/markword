import unittest

from app import _get_export_filename, analyze_text, export_pdf, export_word, render_preview
from themes import THEMES


class TestAnalyzeText(unittest.TestCase):
    '''
    Test cases for text analysis metrics calculation in analyze_text function.
    '''

    def test_empty_string(self):
        '''
        Test analyzing an empty string.
        '''
        res = analyze_text('')
        self.assertEqual(res, (0, 0, 0, 0, 0, 0, 0))

    def test_chinese_text(self):
        '''
        Test analyzing pure Chinese text with punctuation.
        '''
        text = '你好世界！這是測試。'
        total, no_space, cjk, cjk_punct, eng, digits, lines = analyze_text(text)
        self.assertEqual(cjk, 8)
        self.assertEqual(cjk_punct, 2)
        self.assertEqual(eng, 0)
        self.assertEqual(lines, 1)

    def test_mixed_text(self):
        '''
        Test analyzing mixed Chinese, English, digits, and punctuation.
        '''
        text = 'Hello World 2026! 你好 123.\n第二行測試。'
        total, no_space, cjk, cjk_punct, eng, digits, lines = analyze_text(text)
        self.assertEqual(cjk, 7)
        self.assertEqual(cjk_punct, 1)
        self.assertEqual(eng, 2)
        self.assertEqual(digits, 7)
        self.assertEqual(lines, 2)


class TestExportFilename(unittest.TestCase):
    '''
    Test cases for export filename determination (_get_export_filename).
    '''

    def test_h1_header(self):
        '''
        Test that filename uses H1 header if present.
        '''
        md_text = '# 我的專案報告\n\n這是內容'
        filename = _get_export_filename(md_text, 'pdf')
        self.assertEqual(filename, '我的專案報告.pdf')

    def test_h1_with_formatting(self):
        '''
        Test H1 header with markdown formatting characters cleaned.
        '''
        md_text = '# **重點** *說明*\n\n這是內容'
        filename = _get_export_filename(md_text, 'docx')
        self.assertEqual(filename, '重點 說明.docx')

    def test_no_h1_header(self):
        '''
        Test fallback to export_{hash} when no H1 header is present.
        '''
        md_text = '## H2 標題\n沒有 H1 標題'
        filename = _get_export_filename(md_text, 'pdf')
        self.assertTrue(filename.startswith('export_'))
        self.assertTrue(filename.endswith('.pdf'))


class TestRenderPreview(unittest.TestCase):
    '''
    Test cases for markdown preview rendering and themes.
    '''

    def test_empty_input(self):
        '''
        Test rendering empty input shows placeholder message.
        '''
        result = render_preview('')
        self.assertIn('請在左側輸入', result)

    def test_heading_render(self):
        '''
        Test that markdown heading is rendered to HTML h1 tag inside iframe.
        '''
        result = render_preview('# 測試標題', 'Light')
        self.assertIn('iframe', result)
        self.assertIn('&lt;h1', result)
        self.assertIn('測試標題', result)

    def test_themes_exist(self):
        '''
        Test that all defined themes can render without error.
        '''
        for theme_name in ['Light', 'Dark', 'Nord', 'Dracula']:
            self.assertIn(theme_name, THEMES)
            result = render_preview('# 測試標題', theme_name)
            self.assertIn('iframe', result)

    def test_codehilite_syntax_highlighting(self):
        '''
        Test that code blocks produce Pygments syntax highlight spans.
        '''
        md_code = '```python\ndef foo():\n    return 42\n```'
        result = render_preview(md_code, 'Dark')
        self.assertIn('codehilite', result)

    def test_export_pdf_and_word_themes(self):
        '''
        Test PDF and Word exports with themes and custom filename.
        '''
        md_text = '# 標題\n\n```python\nprint("hello")\n```'
        for theme_name in ['Light', 'Dark']:
            pdf_path = export_pdf(md_text, theme_name)
            word_path = export_word(md_text, theme_name)
            self.assertIsNotNone(pdf_path)
            self.assertIsNotNone(word_path)
            self.assertTrue(pdf_path.endswith('標題.pdf'))
            self.assertTrue(word_path.endswith('標題.docx'))


if __name__ == '__main__':
    unittest.main()
