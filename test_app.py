import unittest

from app import analyze_text


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


if __name__ == '__main__':
    unittest.main()
