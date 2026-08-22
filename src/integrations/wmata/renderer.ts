import { MetroMarkup } from '../../types/wmata/types.js'
import { MarkupVariant } from '../../types/trmnl/types.js'
import escapeHtml from 'escape-html'

export function renderMarkup(m: MetroMarkup, variant: MarkupVariant): string {
  const bigText = variant === 'full' ? '92px' : variant === 'quadrant' ? '36px' : '48px'
  const showSubtitle = variant === 'full' || variant === 'half_vertical'
  const subtitleSize = variant === 'half_vertical' ? '24px' : '28px' // subtitle size needs to be modified on half vertical, not shown on hori or quad
  const offset = Number(m.utcOffset) || 0
  const dots = m.selectedLines
    .map((l) => {
      const b = m.disruption[l] ?? 0
      const h = m.alert[l] ?? 0
      if (b === 0 && h === 0) return ''

      const isBad = b > 0
      const symbol = isBad ? '‼' : '!'
      const cls = isBad ? 'alert-bad' : 'alert-warn'

      return `
      <div class="line-dot line-${l}">
        ${escapeHtml(l)}
        <span class="alert ${cls}">${escapeHtml(symbol)}</span>
      </div>
    `.trim()
    })
    .filter(Boolean)
    .join('')

  // Only for half vert set the title to refresh time, otherwise set total amount of alerts across the system
  const bottomTitleBarTitle =
    variant === 'half_vertical' || variant === 'quadrant'
      ? `{{ "alert" | pluralize: ${escapeHtml(String(m.totalIncidents))}  }} • ${escapeHtml(m.displayLine)}`
      : m.totalIncidents === 0
        ? escapeHtml(m.instanceName)
        : `{{ "alert" | pluralize: ${escapeHtml(String(m.totalIncidents))}  }} across WMATA`

  // Dont set this for half vert
  const bottomTitleBarInstance =
    variant === 'half_vertical' || variant === 'quadrant'
      ? `<span class="instance">{{ 'now' | date: '%s' | plus: ${offset} | date: '%H:%M' }}</span>`
      : `<span class="instance">Refreshed at {{ 'now' | date: '%s' | plus: ${offset} | date: '%H:%M' }}</span>`

  return `
<style>
  .content-element { --s: 1; font-family: "Inter Variable", Inter, "Helvetica Neue", Arial, sans-serif; }
  .screen--lg .content-element { --s: 1.3; }

  .big-status { font-size: calc(${bigText} * var(--s, 1)); font-weight: 700; letter-spacing: 2px; }

  .line-indicators {
      display: flex;
      gap: calc(12px * var(--s, 1));
  }

  /* line colors */
  .line-GR { background: #6B7280; }
  .line-RD { background: #6B7280; }
  .line-BL { background: #6B7280; }
  .line-OR { background: #6B7280; }
  .line-YL { background: #6B7280; }
  .line-SV { background: #6B7280; }

  .line-dot {
      position: relative;
      width: calc(64px * var(--s, 1));
      height: calc(64px * var(--s, 1));
      border-radius: 999px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 700;
      font-size: calc(28px * var(--s, 1));
      color: white;
  }

  /* alert overlay */
  .alert {
      position: absolute;
      bottom: -4px;
      right: -4px;
      width: calc(24px * var(--s, 1));
      height: calc(24px * var(--s, 1));
      border-radius: 999px;
      background: white;
      color: black;
      font-size: calc(18px * var(--s, 1));
      font-weight: 900;
      display: flex;
      align-items: center;
      justify-content: center;
  }

  .alert-warn {
      background: white;
      color: black;
      border: 2px solid black;
  }

  .alert-bad {
      background: black;
      color: white;
  }
</style>
<div class="view view--${variant}">
  <div class="layout">
    <div class="columns">
      <div class="column">
        <div class="markdown gap--large" style="text-align:center;">
          ${variant !== 'quadrant' ? `<span class="title">${escapeHtml(m.instanceName)} • ${escapeHtml(m.displayLine)}</span>` : ``}
          <div class="content-element" style="display: flex;flex-direction: column;align-items: center;justify-content: center;${variant === 'full' || variant === 'half_vertical' ? `gap: 12px;` : ``}">
          <div class="big-status">${escapeHtml(m.status)}</div>
          ${showSubtitle ? `<div class="label mt-2" style="font-size: calc(${subtitleSize} * var(--s, 1));">${escapeHtml(m.subtitleFinal)}</div>` : ``}
          ${dots ? `<div class="line-indicators" style="margin-top:24px;margin-bottom:20px;">${dots}</div>` : ``}
          </div>
        </div>
      </div>
    </div>
  </div>
</div>

<div class="title_bar">
  <img class="image" src="https://upload.wikimedia.org/wikipedia/commons/0/0a/WMATA_Metro_Logo_small.svg" />
  <span class="title">${bottomTitleBarTitle}</span>
  ${bottomTitleBarInstance}
</div>
`.trim()
}
