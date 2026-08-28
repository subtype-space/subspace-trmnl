import { RequestHandler } from 'express'
import escapeHtml from 'escape-html'
import { logger } from '../../../utils/logger.js'
import { getSettingsByUuid, upsertSettings } from '../../../utils/dbConnector.js'
import { wrapSettingsPage } from '../../../utils/settingsLayout.js'

// This controller is integrated with html markup - use send() over json()

const ALL_LINES = ['RD', 'BL', 'OR', 'SV', 'GR', 'YL'] as const
type Line = (typeof ALL_LINES)[number]

const LINE_META: Record<Line, { label: string; color: string }> = {
  RD: { label: 'Red', color: '#BF0D3E' },
  BL: { label: 'Blue', color: '#009CDE' },
  OR: { label: 'Orange', color: '#ED8B00' },
  SV: { label: 'Silver', color: '#919D9D' },
  GR: { label: 'Green', color: '#00B140' },
  YL: { label: 'Yellow', color: '#FFD100' },
}

function renderPage(opts: {
  uuid: string
  jwt: string
  primary: string
  lines: Set<string>
  crass: boolean
  pluginSettingId?: number | null
  saved?: boolean
}): string {
  const safeUuid = escapeHtml(opts.uuid)
  const safeJwt = escapeHtml(opts.jwt)

  const successHtml = opts.saved
    ? `<p class="success">Settings saved.</p>`
    : ''

  const primaryRadios = ALL_LINES.map((l) => {
    const meta = LINE_META[l]
    const checked = opts.primary === l ? 'checked' : ''
    return `
      <label class="option-item">
        <input type="radio" name="primaryLine" value="${l}" ${checked}/>
        <span class="dot" style="background:${meta.color};"></span>
        <span>${meta.label} <span style="opacity:0.5;font-size:12px;">${l}</span></span>
      </label>`
  }).join('')

  const watchCheckboxes = ALL_LINES.map((l) => {
    const meta = LINE_META[l]
    const isPrimary = l === opts.primary
    const checked = !isPrimary && opts.lines.has(l) ? 'checked' : ''
    const disabled = isPrimary ? 'disabled' : ''
    return `
      <label class="option-item${isPrimary ? ' disabled' : ''}" data-watch-item="${l}">
        <input type="checkbox" name="lines" value="${l}" ${checked} ${disabled}/>
        <span class="dot" style="background:${meta.color};"></span>
        <span data-line-label="${l}">${meta.label} <span style="opacity:0.5;font-size:12px;">${l}</span>${isPrimary ? ' <span class="badge">Primary</span>' : ''}</span>
      </label>`
  }).join('')

  const backLink = opts.pluginSettingId
    ? `<a class="back-link" href="https://trmnl.com/plugin_settings/${opts.pluginSettingId}/edit?force_refresh=true">← Back to TRMNL</a>`
    : ''

  const body = `
    <form method="POST" action="/v1/trmnl/metro/manage">
      <input type="hidden" name="uuid" value="${safeUuid}"/>
      <input type="hidden" name="jwt" value="${safeJwt}"/>

      ${successHtml}

      <div class="card">
        <div class="field-label">Primary line to monitor</div>
        <div class="option-list">${primaryRadios}</div>
      </div>

      <div class="card">
        <div class="field-label">Also show status for</div>
        <div class="option-list" id="watch-list">${watchCheckboxes}</div>
      </div>

      <div class="card">
        <div class="field-label">Language</div>
        <label class="option-item">
          <input type="checkbox" name="crass" value="1" ${opts.crass ? 'checked' : ''}/>
          <span>Crass mode — <em style="font-style:normal;opacity:0.7;">"you're f***ed"</em> vs <em style="font-style:normal;opacity:0.7;">"you're screwed"</em></span>
        </label>
      </div>

      <button class="submit-btn" type="submit">Save settings</button>
    </form>

    ${backLink}
  `

  const script = `(function () {
    function sync() {
      var primary = document.querySelector('input[name="primaryLine"]:checked')?.value;

      document.querySelectorAll('[data-watch-item]').forEach(function(item) {
        var line = item.getAttribute('data-watch-item');
        var cb = item.querySelector('input[type="checkbox"]');
        var labelSpan = item.querySelector('[data-line-label]');
        var isPrimary = line === primary;

        if (isPrimary) {
          cb.checked = false;
          cb.disabled = true;
          item.classList.add('disabled');
        } else {
          cb.disabled = false;
          item.classList.remove('disabled');
        }

        // rebuild label text preserving the short code span
        var meta = ${JSON.stringify(Object.fromEntries(ALL_LINES.map((l) => [l, LINE_META[l].label])))};
        labelSpan.innerHTML = meta[line] + ' <span style="opacity:0.5;font-size:12px;">' + line + '</span>' + (isPrimary ? ' <span class="badge">Primary</span>' : '');
      });
    }

    document.querySelectorAll('input[name="primaryLine"]').forEach(function(r) {
      r.addEventListener('change', sync);
    });

    sync();
  })()`

  return wrapSettingsPage('DC Metro Settings', body, script)
}

export const trmnlManageGetController: RequestHandler = async (req, res) => {
  const uuid = req.query.uuid as string | undefined
  const jwt = req.query.jwt as string | undefined
  if (!uuid) {
    logger.warn('[TRML] Missing UUID in request for settings page')
    res.status(400).send('Bad Request - missing UUID')
    return
  }

  logger.info('[TRML] Displaying plugin settings page')
  const settings = await getSettingsByUuid(uuid)
  const primary = (settings as any)?.primary_line ?? 'RD'
  const lines = new Set(settings?.lines ? settings.lines.split(',').filter(Boolean) : ALL_LINES.filter((l) => l !== primary))
  const crass = (settings?.crass_level ?? 0) === 1

  res.type('text/html').send(
    renderPage({
      uuid,
      jwt: jwt ?? '',
      primary,
      lines,
      crass,
      pluginSettingId: settings?.plugin_setting_id,
      saved: req.query.saved === '1',
    })
  )
}

// Post is internal
export const trmnlManagePostController: RequestHandler = async (req, res) => {
  const uuid = req.body?.uuid
  if (typeof uuid !== 'string' || !uuid) {
    res.status(400).json({ error: 'Bad Request', message: 'missing uuid' })
    return
  }

  logger.info('[TRML] Saving user settings')
  const rawLines = req.body?.lines
  const primaryLine = req.body?.primaryLine
  if (typeof primaryLine !== 'string' || !ALL_LINES.includes(primaryLine as Line)) {
    res.status(400).json({ error: 'Bad Request', message: 'missing/invalid primaryLine' })
    return
  }
  const linesArr = Array.isArray(rawLines) ? rawLines : typeof rawLines === 'string' ? [rawLines] : []
  const filtered = linesArr.map((s) => s.trim().toUpperCase()).filter((l) => l && l !== primaryLine)
  const lines = filtered.join(',')
  const crassLevel = req.body?.crass === '1' ? 1 : 0
  logger.debug(`[TRML] ${uuid} updated user settings to ${primaryLine} - ${lines} - ${crassLevel ? 'enabled' : 'disabled'}`)

  await upsertSettings({ user_uuid: uuid, primary_line: primaryLine, lines, crass_level: crassLevel })

  const settings = await getSettingsByUuid(uuid)
  const pluginSettingId = settings?.plugin_setting_id

  if (pluginSettingId) {
    res.redirect(`https://trmnl.com/plugin_settings/${pluginSettingId}/edit?force_refresh=true`)
    return
  }

  const jwt = req.body?.jwt
  const jwtParam = typeof jwt === 'string' && jwt ? `&jwt=${encodeURIComponent(jwt)}` : ''
  res.redirect(`/v1/trmnl/metro/manage?uuid=${encodeURIComponent(uuid)}${jwtParam}&saved=1`)
}
