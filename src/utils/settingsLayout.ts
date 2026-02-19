export const SETTINGS_CSS = `
  :root {
    --bg: #f8fafc;
    --surface: #ffffff;
    --border: #e2e8f0;
    --text: #111111;
    --text-muted: #64748b;
    --accent: #f8654b;
    --accent-hover: #e0523a;
    --input-bg: #ffffff;
    --radius: 8px;
  }

  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #111111;
      --surface: #1c1c1c;
      --border: #2e2e2e;
      --text: #f0f0f0;
      --text-muted: #888888;
      --input-bg: #111111;
    }
  }

  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  body {
    font-family: Arial, system-ui, sans-serif;
    background: var(--bg);
    color: var(--text);
    min-height: 100vh;
    padding: 24px 16px;
    font-size: 14px;
    line-height: 1.5;
  }

  .container { max-width: 460px; margin: 0 auto; }

  h1 {
    font-size: 18px;
    font-weight: 700;
    margin-bottom: 20px;
    letter-spacing: -0.01em;
  }

  .card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 16px;
    margin-bottom: 12px;
  }

  .field-label {
    font-size: 11px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--text-muted);
    margin-bottom: 10px;
  }

  input[type="text"] {
    width: 100%;
    padding: 9px 11px;
    font-size: 14px;
    background: var(--input-bg);
    border: 1px solid var(--border);
    border-radius: 6px;
    color: var(--text);
    font-family: inherit;
    outline: none;
    transition: border-color 0.15s;
  }

  input[type="text"]:focus { border-color: var(--accent); }

  .hint {
    font-size: 12px;
    color: var(--text-muted);
    margin-top: 8px;
    line-height: 1.5;
  }

  .error {
    font-size: 12px;
    color: #ef4444;
    font-weight: 600;
    margin-top: 6px;
    padding: 6px 10px;
    background: rgba(239,68,68,0.08);
    border-radius: 5px;
    border: 1px solid rgba(239,68,68,0.2);
  }

  .option-list { display: flex; flex-direction: column; gap: 6px; }

  .option-item {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 10px;
    border: 1px solid var(--border);
    border-radius: 6px;
    cursor: pointer;
    transition: border-color 0.15s, background 0.15s;
    user-select: none;
  }

  .option-item:hover { border-color: var(--accent); background: rgba(248,101,75,0.04); }

  .option-item input[type="radio"],
  .option-item input[type="checkbox"] {
    accent-color: var(--accent);
    width: 15px;
    height: 15px;
    cursor: pointer;
    flex-shrink: 0;
  }

  .option-item label { cursor: pointer; flex: 1; font-size: 14px; }
  .option-item.disabled { opacity: 0.45; pointer-events: none; }

  .dot {
    display: inline-block;
    width: 10px;
    height: 10px;
    border-radius: 50%;
    margin-right: 6px;
    flex-shrink: 0;
  }

  .badge {
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-muted);
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 1px 5px;
  }

  .submit-btn {
    display: block;
    width: 100%;
    padding: 11px;
    font-size: 14px;
    font-weight: 700;
    background: var(--accent);
    color: #fff;
    border: none;
    border-radius: var(--radius);
    cursor: pointer;
    font-family: inherit;
    letter-spacing: 0.02em;
    transition: background 0.15s, opacity 0.15s;
    margin-top: 4px;
  }

  .submit-btn:hover { background: var(--accent-hover); }
  .submit-btn:active { opacity: 0.85; }

  .footer {
    margin-top: 20px;
    font-size: 11px;
    color: var(--text-muted);
    line-height: 1.6;
  }

  .footer a { color: var(--text-muted); text-decoration: underline; }

  .back-link {
    display: block;
    text-align: center;
    margin-top: 14px;
    font-size: 12px;
    color: var(--accent);
    text-decoration: none;
    font-weight: 600;
  }

  .back-link:hover { text-decoration: underline; }

  .section-gap { margin-top: 8px; }
`

export function wrapSettingsPage(title: string, body: string, script?: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>${title}</title>
  <style>${SETTINGS_CSS}</style>
</head>
<body>
  <div class="container">
    <h1>${title}</h1>
    ${body}
  </div>
  ${script ? `<script>\n${script}\n</script>` : ''}
</body>
</html>`
}
