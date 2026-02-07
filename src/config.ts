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
        activeVersion:  process.env.ACTIVE_VERSION || 'v1'
    },
    auth: {
        // These configs are keycloak focused
        // mcpServerUrl dictates what the MCP backend should be listening for, hostname-wise
        mcpServerUrl:   required('MCP_SERVER_URL'),
        // In order to perform token introspection, you need to integrate into an IdP of your choice
        authServerUrl:  required('AUTH_SERVER_URL'),
        realm:          required('AUTH_REALM'),
        // This API server should have it's own OpenID client
        clientId:       required('API_CLIENT_ID'),
        clientSecret:   required('API_CLIENT_SECRET')
    },
    trmnl: {
        // Bypass checking the TRMNL worker IP address
        bypassIPCheck:  process.env.TRMNL_IP_ALLOW_PRIVATE || 'false',
        dbPath:         process.env.TRMNL_DB_PATH || './trmnl.sqlite',
        // These clientID and secret are provided by TRMNL, this is not the same as the ones in auth
        clientId:       required('TRMNL_CLIENT_ID'),
        clientSecret:   required('TRMNL_CLIENT_SECRET')
    },
    wmata: {
        apiKey:         required('WMATA_PRIMARY_KEY')
    }

}