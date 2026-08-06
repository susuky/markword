import unittest

from app import analyze_text, render_preview


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


class TestRenderPreview(unittest.TestCase):
    '''
    Test cases for markdown preview rendering.
    '''

    def test_empty_input(self):
        '''
        Test rendering empty input shows placeholder message.
        '''
        result = render_preview('')
        self.assertIn('請在左側輸入', result)

    def test_heading_render(self):
        '''
        Test that markdown heading is rendered to HTML h1 tag.
        '''
        result = render_preview('# 測試標題')
        self.assertIn('<h1', result)
        self.assertIn('測試標題', result)

    def test_mermaid_block(self):
        '''
        Test that mermaid code blocks are replaced with mermaid div.
        '''
        md_text = '```mermaid\ngraph TD\n    A-->B\n```'
        result = render_preview(md_text)
        self.assertIn('class="mermaid"', result)
        self.assertIn('mermaid.min.js', result)

    def test_table_render(self):
        '''
        Test that markdown table is rendered to HTML table tag.
        '''
        md_text = '| 欄位 | 值 |\n|------|----|\n| 中文 | OK |'
        result = render_preview(md_text)
        self.assertIn('<table', result)
        self.assertIn('中文', result)


if __name__ == '__main__':
    unittest.main()
