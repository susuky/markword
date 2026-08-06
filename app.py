import re

import gradio as gr


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


def create_app() -> gr.Blocks:
    '''
    Construct the Gradio UI blocks application.

    Returns:
        gr.Blocks instance configured for text word counting.
    '''
    theme = gr.themes.Soft(
        primary_hue='indigo',
        secondary_hue='slate',
    )

    with gr.Blocks(theme=theme, title='文字字數統計器') as demo:
        gr.Markdown(
            '''
            # 📝 線上文字字數統計器
            貼上或輸入文字，系統將自動即時統計字數、中文字數、標點、英文字數、數字與行數。
            '''
        )

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
                    clear_btn = gr.Button('清空內容', variant='secondary')

            with gr.Column(scale=2):
                gr.Markdown('### 📊 統計結果')
                with gr.Row():
                    total_chars_num = gr.Number(
                        label='總字數 (含空格/換行)',
                        value=0,
                        precision=0,
                        interactive=False,
                    )
                    chars_no_spaces_num = gr.Number(
                        label='不含空格/換行字數',
                        value=0,
                        precision=0,
                        interactive=False,
                    )
                with gr.Row():
                    cjk_count_num = gr.Number(
                        label='中文字數 (漢字)',
                        value=0,
                        precision=0,
                        interactive=False,
                    )
                    cjk_punct_num = gr.Number(
                        label='全形/中文標點',
                        value=0,
                        precision=0,
                        interactive=False,
                    )
                with gr.Row():
                    english_words_num = gr.Number(
                        label='英文字數 (Words)',
                        value=0,
                        precision=0,
                        interactive=False,
                    )
                    digit_count_num = gr.Number(
                        label='數字個數',
                        value=0,
                        precision=0,
                        interactive=False,
                    )
                with gr.Row():
                    line_count_num = gr.Number(
                        label='總行數',
                        value=0,
                        precision=0,
                        interactive=False,
                    )

        outputs = [
            total_chars_num,
            chars_no_spaces_num,
            cjk_count_num,
            cjk_punct_num,
            english_words_num,
            digit_count_num,
            line_count_num,
        ]

        text_input.change(
            fn=analyze_text,
            inputs=[text_input],
            outputs=outputs,
        )

        clear_btn.click(
            fn=clear_input,
            inputs=[],
            outputs=[text_input] + outputs,
        )

    return demo


if __name__ == '__main__':
    app = create_app()
    app.launch(
        server_name='0.0.0.0',
        server_port=27860,
        share=False,
    )
