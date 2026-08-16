import 'dotenv/config'

function required(name: string): string {
  const v = process.env[name]
  if (!v) {
    throw new Error(`[ENV ] Missing required env var: ${name}`)
  }
  return v
}

export const config = {
    api: {
        port:           Number(process.env.PORT) || 9595,
        logLevel:       (process.env.LOG_LEVEL || 'info').toLowerCase(),
        activeVersion:  process.env.ACTIVE_VERSION || 'v1',
        // Public origin this service is reached at, e.g. https://trmnl.subtype.space
        // Used to build absolute URLs (airline logo banners, etc.) in TRMNL markup responses
        publicBaseUrl:  required('PUBLIC_BASE_URL')
    },
    trmnl: {
        // Bypass checking the TRMNL worker IP address
        bypassIPCheck:  process.env.TRMNL_IP_ALLOW_PRIVATE || 'false',
        dbPath:         process.env.TRMNL_DB_PATH || './trmnl.sqlite',
        // These clientID and secret are provided by TRMNL, this is not the same as the ones in auth
        clientId:       required('TRMNL_CLIENT_ID'),
        clientSecret:   required('TRMNL_CLIENT_SECRET'),
        // Flights plugin (optional - only needed if running the flight tracker plugin)
        flightsClientId:     process.env.TRMNL_FLIGHTS_CLIENT_ID ?? '',
        flightsClientSecret: process.env.TRMNL_FLIGHTS_CLIENT_SECRET ?? '',
    },
    wmata: {
        apiKey:         process.env.WMATA_PRIMARY_KEY ?? '',
    },
    aerodatabox: {
        apiKey:         process.env.AERODATABOX_API_KEY ?? '',
        provider:       (process.env.AERODATABOX_PROVIDER ?? 'apimarket') as 'apimarket' | 'rapidapi',
    }
}