import { logger } from '../../utils/logger.js'

// Prob best to move to eventual utils folder since MCP does not directly interact with this
// but uses it as helper methods.
const NWS_API_BASE = 'https://api.weather.gov'
const USER_AGENT = 'weather-app/1.0'

async function makeNWSRequest<T>(url: string): Promise<T | null> {
  const headers = {
    'User-Agent': USER_AGENT,
    Accept: 'application/geo+json',
  }

  logger.debug('Requesting url:', url)
  try {
    const response = await fetch(url, { headers })
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`)
    }
    return (await response.json()) as T
  } catch (error) {
    logger.error('Error making NWS request:', error)
    logger.error(url)
    return null
  }
}

interface AlertFeature {
  properties: {
    event?: string
    areaDesc?: string
    severity?: string
    status?: string
    headline?: string
  }
}

// Format alert data
function formatAlert(feature: AlertFeature): string {
  const props = feature.properties
  return [
    `Event: ${props.event || 'Unknown'}`,
    `Area: ${props.areaDesc || 'Unknown'}`,
    `Severity: ${props.severity || 'Unknown'}`,
    `Status: ${props.status || 'Unknown'}`,
    `Headline: ${props.headline || 'No headline'}`,
    '---',
  ].join('\n')
}

interface ForecastPeriod {
  name?: string
  temperature?: number
  temperatureUnit?: string
  windSpeed?: string
  windDirection?: string
  shortForecast?: string
}

interface AlertsResponse {
  features: AlertFeature[]
}

interface PointsResponse {
  properties: {
    forecast?: string
  }
}

interface ForecastResponse {
  properties: {
    periods: ForecastPeriod[]
  }
}

export async function getAlerts({ state }: { state: string }) {
  logger.info(`[MCP] - weather.ts - weather tool called, getting alerts for ${state}`)
  const stateCode = state.toUpperCase()
  const alertsUrl = `${NWS_API_BASE}/alerts?area=${stateCode}`
  const alertsData = await makeNWSRequest<AlertsResponse>(alertsUrl)

  if (!alertsData) {
    return 'Failed to retrieve alerts data'
  }

  const features = alertsData.features || []
  if (features.length === 0) {
    return `No active alerts for ${stateCode}`
  }

  const formattedAlerts = features.map(formatAlert)
  const alertsText = `Active alerts for ${stateCode}:\n\n${formattedAlerts.join('\n')}`

  return alertsText
}

export async function getForecast({ latitude, longitude }: { latitude: Number; longitude: Number }) {
  logger.info('[MCP] - weather.ts - weather tool called, getting forecast')
  const pointsUrl = `${NWS_API_BASE}/points/${latitude.toFixed(4)},${longitude.toFixed(4)}`
  const pointsData = await makeNWSRequest<PointsResponse>(pointsUrl)

  if (!pointsData) {
    return `Failed to retrieve grid point data for coordinates: ${latitude}, ${longitude}. This location may not be supported by the NWS API (only US locations are supported).`
  }

  const forecastUrl = pointsData.properties?.forecast
  if (!forecastUrl) {
    return 'Failed to get forecast URL from grid point data'
  }

  // Get forecast data
  const forecastData = await makeNWSRequest<ForecastResponse>(forecastUrl)
  if (!forecastData) {
    return 'Failed to retrieve forecast data'
  }

  const periods = forecastData.properties?.periods || []
  if (periods.length === 0) {
    return 'No forecast periods available'
  }

  // Format forecast periods
  const formattedForecast = periods.map((period: ForecastPeriod) =>
    [
      `${period.name || 'Unknown'}:`,
      `Temperature: ${period.temperature || 'Unknown'}°${period.temperatureUnit || 'F'}`,
      `Wind: ${period.windSpeed || 'Unknown'} ${period.windDirection || ''}`,
      `${period.shortForecast || 'No forecast available'}`,
      '---',
    ].join('\n')
  )

  const forecastText = `Forecast for ${latitude}, ${longitude}:\n\n${formattedForecast.join('\n')}`
  return forecastText
}
