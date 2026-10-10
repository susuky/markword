import type { Locale } from './i18n'

export function htmlSample(locale: Locale) {
  const zh = locale === 'zh-TW'
  return `<!doctype html>
<html lang="${zh ? 'zh-Hant' : 'en'}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${zh ? '我的第一個頁面' : 'My first page'}</title>
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; color: #243e35; background: #f7faf8; font-family: Georgia, "Noto Serif CJK TC", serif; }
    main { max-width: 780px; margin: auto; padding: 52px 36px; }
    .label { margin: 0 0 22px; color: #557469; font: 14px/1.5 sans-serif; }
    h1 { margin: 0 0 24px; font-size: clamp(32px, 6vw, 48px); line-height: 1.3; letter-spacing: -.04em; }
    .intro { max-width: 38em; font-size: 18px; line-height: 1.9; }
    section { margin-top: 40px; padding-top: 24px; border-top: 1px solid #cadbd2; }
    h2 { font-size: 24px; }
    p, li { line-height: 1.9; }
    ul { padding-left: 24px; }
    li + li { margin-top: 10px; }
    a { color: #167469; text-underline-offset: 4px; }
    aside { margin-top: 32px; padding: 18px 22px; background: #e8f1ec; border-radius: 8px; }
    @media (max-width: 480px) { main { padding: 32px 22px; } }
  </style>
</head>
<body>
  <main>
    <p class="label">${zh ? '範例頁面' : 'Example page'}</p>
    <h1>${zh ? '把複雜的事，說清楚。' : 'Make room for a clear idea.'}</h1>
    <p class="intro">${zh ? '一份好讀的文件，從清楚的想法開始。點選這段文字，換成你想說的話，原有的排版會保留下來。' : 'A readable document starts with a clear idea. Click this paragraph and replace it with your own words. The layout stays in place.'}</p>
    <section>
      <h2>${zh ? '這一頁，想讓讀者帶走什麼？' : 'What should the reader take away?'}</h2>
      <ul>
        <li>${zh ? '先寫最重要的結論。' : 'Start with the most important point.'}</li>
        <li>${zh ? '接著放上支持想法的例子。' : 'Follow it with an example that supports your idea.'}</li>
        <li>${zh ? '最後留下清楚的下一步。' : 'Leave the reader with a clear next step.'}</li>
      </ul>
    </section>
    <aside>
      <p>${zh ? '也可以開啟既有 HTML，或貼上 AI 產生的頁面，接著修改。' : 'You can also open an existing HTML file or paste a page from an AI conversation, then keep editing.'}</p>
      <a href="https://example.com">${zh ? '選取這個連結，換成你的網址' : 'Select this link to use your own address'}</a>
    </aside>
  </main>
</body>
</html>`
}
