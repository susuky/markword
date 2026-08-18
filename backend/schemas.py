"""Request and response models for the Markword API."""

from pydantic import BaseModel, Field, field_validator

from themes import THEMES


MAX_TEXT_LENGTH = 5_000_000


class AnalyzeRequest(BaseModel):
    text: str = Field(default="", max_length=MAX_TEXT_LENGTH)


class AnalyzeResponse(BaseModel):
    total_chars: int
    chars_no_spaces: int
    cjk_count: int
    cjk_punct_count: int
    english_words: int
    digit_count: int
    line_count: int


class ExportRequest(BaseModel):
    markdown: str = Field(min_length=1, max_length=MAX_TEXT_LENGTH)
    theme: str = "Light"

    @field_validator("markdown")
    @classmethod
    def markdown_must_not_be_blank(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("markdown must not be blank")
        return value

    @field_validator("theme")
    @classmethod
    def theme_must_exist(cls, value: str) -> str:
        if value not in THEMES:
            allowed = ", ".join(THEMES)
            raise ValueError(f"unknown theme; expected one of: {allowed}")
        return value


class ThemeResponse(BaseModel):
    name: str
    body_bg: str
    body_color: str
    mermaid_theme: str
    css: str


class ThemesResponse(BaseModel):
    themes: list[ThemeResponse]
    default_theme: str = "Light"
