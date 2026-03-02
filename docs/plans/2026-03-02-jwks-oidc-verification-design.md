# JWKS OIDC Token Verification

## Problem

The backend's `AuthPlugin.extractUser()` decodes JWT payloads via raw base64 without verifying the signature. Any crafted JWT payload is accepted. This must be replaced with proper JWKS-based verification before production.

## Design

### Library: `jose`

Zero-dependency, Web Crypto API-based JWT/JWKS library. Works natively in Bun. `createRemoteJWKSet()` handles JWKS fetching, caching, and key rotation automatically.

### Environment Configuration

Two new env vars in `apps/backend/.env`:

```
OIDC_ISSUER_URL=http://localhost:4000
OIDC_AUDIENCE=8607c60d3a841de6d51e24cfffdf3e51
```

The JWKS URI is auto-discovered from `{OIDC_ISSUER_URL}/.well-known/openid-configuration`.

### AuthPlugin Changes

- `init()`: Discover JWKS endpoint from the OIDC provider's `.well-known/openid-configuration` and create a `RemoteJWKSet` via `jose.createRemoteJWKSet()`.
- `extractUser()`: Replace base64 decode with `jose.jwtVerify()`, which verifies signature and validates `iss`, `aud`, `exp`, `nbf` claims.
- On failure → return `null`.

### Request Rejection

The `setGraphQLContextFactory` in `App.ts` will throw an authentication error when:
- No `Authorization` header is present
- Token verification fails (invalid signature, expired, wrong issuer/audience)

All GraphQL operations require a valid token.

### Error Handling

- JWKS endpoint unreachable → fail closed (reject request)
- Token expired → reject
- Invalid signature → reject
- Missing required claims → reject

### Decisions

- **Approach:** `jose` library over `jsonwebtoken`+`jwks-rsa` (Bun compatibility, zero deps, built-in JWKS cache)
- **Auth policy:** Reject all unauthenticated/invalid-token requests at the GraphQL context layer
- **Claim validation:** Full — verify `iss`, `aud`, `exp`, `nbf`
- **JWKS discovery:** Auto-discover from `.well-known/openid-configuration` rather than hardcoding JWKS URL
