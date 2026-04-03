// src/modules/auth/providers/keycloak-token.provider.stub.ts
//
// ─────────────────────────────────────────────────────────────────────────────
// KEYCLOAK MIGRATION GUIDE
// ─────────────────────────────────────────────────────────────────────────────
//
// When you are ready to switch to Keycloak, set AUTH_PROVIDER=keycloak in
// your environment.  AuthModule will inject THIS class instead of
// LocalTokenProvider.  AuthService, guards, and all controllers need zero
// changes — they only know the ITokenProvider interface.
//
// What Keycloak provides:
//   • Identity & login UI  (no more /login endpoint needed in this app)
//   • MFA / OTP            (configured in Keycloak admin console)
//   • Social login         (Google, GitHub, etc.)
//   • User federation      (LDAP / Active Directory)
//   • Refresh token endpoint: POST {realm}/protocol/openid-connect/token
//   • Token revoke endpoint: POST {realm}/protocol/openid-connect/revoke
//   • JWKS endpoint for JWT verification: GET {realm}/protocol/openid-connect/certs
//
// Environment variables needed:
//   KEYCLOAK_URL          e.g. https://sso.yourdomain.com
//   KEYCLOAK_REALM        e.g. textile-erp
//   KEYCLOAK_CLIENT_ID    e.g. backend-api
//   KEYCLOAK_CLIENT_SECRET  (confidential client)
//
// Migration steps:
//   1. Stand up Keycloak (Docker or managed service)
//   2. Create realm  →  client  →  import roles (OWNER, MERCHANDISER, …)
//   3. Set AUTH_PROVIDER=keycloak  →  this provider becomes active
//   4. JwtStrategy: change secretOrKey → jwksUri so tokens are verified
//      against Keycloak's public keys (see note in validate() below)
//   5. On first login via Keycloak, JIT-provision a local User row if one
//      does not exist (see jitProvisionUser() note below)
//   6. Keep UserRole table — Keycloak roles map to local roles on login
//   7. users.passwordHash can be left null (not used)
//   8. Retire /login, /register, /forgot-password, /reset-password endpoints
//      OR keep them pointing at Keycloak Admin REST API
//
// ─────────────────────────────────────────────────────────────────────────────

import { Injectable, NotImplementedException, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { PrismaService } from '../../../shared/prisma/prisma.service';
import {
  ITokenProvider, TokenResponse, TOKEN_PROVIDER,
} from './token-provider.interface';

@Injectable()
export class KeycloakTokenProvider implements ITokenProvider {
  readonly providerName = 'keycloak';
  private readonly logger = new Logger(KeycloakTokenProvider.name);

  constructor(
    private readonly http:    HttpService,
    private readonly config:  ConfigService,
    private readonly prisma:  PrismaService,
  ) {}

  // ── issueTokens ────────────────────────────────────────────────────────
  //
  // With Keycloak, this app never issues tokens directly.  The flow is:
  //
  //   Browser → Keycloak login UI → Authorization Code → /auth/callback
  //   → exchange code for token at Keycloak token endpoint
  //   → JIT-provision local User row if needed
  //   → return Keycloak's access + refresh tokens to the client
  //
  // This method is called after the code exchange (handleCallback) and
  // maps the Keycloak token response into the shared TokenResponse shape.

  async issueTokens(_user: any, _ip?: string): Promise<TokenResponse> {
    // TODO: implement when Keycloak is configured
    //
    // Steps:
    //   1. Receive the Keycloak access_token (already validated by JwtStrategy)
    //   2. Decode and extract sub (Keycloak user ID), email, realm_access.roles
    //   3. Upsert local User row (jitProvisionUser)
    //   4. Sync UserRole rows from Keycloak roles
    //   5. Return { accessToken, refreshToken } from Keycloak
    //
    // NOTE: Do NOT re-sign the Keycloak token — return it as-is.
    //       The refresh token also comes from Keycloak and must be stored
    //       securely (httpOnly cookie recommended for SPAs).

    throw new NotImplementedException(
      'Keycloak provider is not yet configured. ' +
      'Set up Keycloak and implement this method — see stub comments.',
    );
  }

  // ── refreshTokens ──────────────────────────────────────────────────────
  //
  // Proxy the refresh request to Keycloak's token endpoint.
  // Do NOT maintain a separate refresh_tokens table — Keycloak owns this.

  async refreshTokens(rawRefreshToken: string, _ip?: string): Promise<TokenResponse> {
    // TODO: implement when Keycloak is configured
    //
    // const url = `${this.keycloakBaseUrl}/protocol/openid-connect/token`;
    // const body = new URLSearchParams({
    //   grant_type:    'refresh_token',
    //   client_id:     this.config.get('KEYCLOAK_CLIENT_ID'),
    //   client_secret: this.config.get('KEYCLOAK_CLIENT_SECRET'),
    //   refresh_token: rawRefreshToken,
    // });
    // const response = await firstValueFrom(
    //   this.http.post(url, body.toString(), {
    //     headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    //   }),
    // );
    // return this.mapKeycloakResponse(response.data);

    throw new NotImplementedException('Keycloak provider: refreshTokens not yet implemented');
  }

  // ── revokeTokens ───────────────────────────────────────────────────────
  //
  // Call Keycloak's revoke endpoint and optionally end the user's session.

  async revokeTokens(_userId: string, refreshToken?: string): Promise<void> {
    // TODO: implement when Keycloak is configured
    //
    // if (refreshToken) {
    //   const url = `${this.keycloakBaseUrl}/protocol/openid-connect/revoke`;
    //   await firstValueFrom(this.http.post(url, new URLSearchParams({
    //     token:         refreshToken,
    //     token_type_hint: 'refresh_token',
    //     client_id:     this.config.get('KEYCLOAK_CLIENT_ID'),
    //     client_secret: this.config.get('KEYCLOAK_CLIENT_SECRET'),
    //   }).toString(), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }));
    // } else {
    //   // Logout all sessions via Admin REST API:
    //   // DELETE /admin/realms/{realm}/users/{keycloak-user-id}/sessions
    // }

    throw new NotImplementedException('Keycloak provider: revokeTokens not yet implemented');
  }

  // ── JwtStrategy change note ────────────────────────────────────────────
  //
  // When AUTH_PROVIDER=keycloak, update JwtStrategy constructor to:
  //
  //   super({
  //     jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
  //     secretOrKeyProvider: passportJwtSecret({
  //       cache: true,
  //       rateLimit: true,
  //       jwksRequestsPerMinute: 5,
  //       jwksUri: `${keycloakUrl}/protocol/openid-connect/certs`,
  //     }),
  //   });
  //
  // Install: npm i jwks-rsa @types/jwks-rsa

  // ── JIT user provisioning note ─────────────────────────────────────────
  //
  // private async jitProvisionUser(keycloakSub: string, email: string, name: string, tenantId: string) {
  //   return this.prisma.user.upsert({
  //     where:  { tenantId_email: { tenantId, email } },
  //     create: { id: keycloakSub, tenantId, email, name, passwordHash: '', roles: [] },
  //     update: { name, lastLoginAt: new Date() },
  //   });
  // }

  private get keycloakBaseUrl(): string {
    const url   = this.config.get<string>('KEYCLOAK_URL');
    const realm = this.config.get<string>('KEYCLOAK_REALM');
    return `${url}/realms/${realm}`;
  }
}
