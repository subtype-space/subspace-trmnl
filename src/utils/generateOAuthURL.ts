import { logger } from "./logger.js";

export function createOAuthURLs() {
    const authBaseURL = new URL(
        `http://${process.env.AUTH_SERVER_URL}/realms/${process.env.AUTH_REALM}/`
    )

    return {
        issuer: authBaseURL.toString(),
        introspection_endpoint: new URL(
            "protocol/openid-connect/token/introspect",
            authBaseURL,
        ).toString(),
        authorization_endpoint: new URL(
            "protocol/openid-connect/auth",
            authBaseURL,
        ).toString(),
        token_endpoint: new URL(
            "protocol/openid-connect/token",
            authBaseURL,
        ).toString()
    }
}