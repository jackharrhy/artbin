# Authentication and administration

## Sub-features

4orm OAuth login/callback, sessions, logout, development administrator provisioning, authorization guards, settings, and admin navigation.

## How to get to it (user POV)

Open a protected page while logged out to reach login, authenticate through 4orm, then use the account and Admin links in the header.

## Driving it with Playwright

The managed runner uses development auth only for product-flow isolation. For OAuth changes, separately drive the real redirect/callback against a non-production configured 4orm client, assert cookie persistence, revisit a protected page, and log out.

## Gotchas

Development auth does not verify OAuth interoperability. Redirect URI, secure-cookie, proxy-origin, and state-cookie behavior differ in production. Never record credentials, session cookies, OAuth codes, or secrets in evidence.
