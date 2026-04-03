// src/modules/auth/providers/token-provider.interface.ts
//
// Abstraction over token issuance so the auth module can switch between:
//   AUTH_PROVIDER=local    → LocalTokenProvider  (JWT signed by this app)
//   AUTH_PROVIDER=keycloak → KeycloakTokenProvider (tokens issued by Keycloak)
//
// AuthService only calls this interface. Swapping providers requires no
// changes to AuthService, guards, or any other module.

// ── DI injection token ─────────────────────────────────────────────────────
export const TOKEN_PROVIDER = Symbol('ITokenProvider');

// ── Shared response shape ──────────────────────────────────────────────────
// Both providers return the same shape so the API contract never changes.

export interface UserSummary {
  id:           string;
  email:        string;
  name:         string;
  roles:        string[];        // role names  — kept for backward-compat
  permissions:  string[];        // merged permission strings
  tenantId:     string;
  isMfaEnabled: boolean;
}

export interface TokenResponse {
  requiresMfa:  false;           // always false here — MFA gating happens upstream
  accessToken:  string;
  refreshToken: string;
  expiresIn:    number;          // access token TTL in seconds
  user:         UserSummary;
}

// ── Contract ───────────────────────────────────────────────────────────────

export interface ITokenProvider {
  /** Human-readable name used in logs (e.g. "local", "keycloak"). */
  readonly providerName: string;

  /**
   * Issue a fresh access + refresh token pair for an authenticated user.
   * Called after password validation passes AND MFA (if enabled) is satisfied.
   */
  issueTokens(user: any, ip?: string): Promise<TokenResponse>;

  /**
   * Exchange a valid refresh token for a new token pair (rotation).
   * Implementations must revoke the consumed refresh token before returning.
   * Throws UnauthorizedException if the token is invalid, expired, or revoked.
   */
  refreshTokens(rawRefreshToken: string, ip?: string): Promise<TokenResponse>;

  /**
   * Revoke a specific refresh token, or all tokens for a user (logout-all).
   * @param userId       Subject of the tokens to revoke.
   * @param refreshToken If provided, only this token is revoked.
   *                     If omitted, ALL tokens for the user are revoked.
   */
  revokeTokens(userId: string, refreshToken?: string): Promise<void>;
}
