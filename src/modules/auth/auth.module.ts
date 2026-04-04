// src/modules/auth/auth.module.ts
//
// TOKEN_PROVIDER factory:
//   AUTH_PROVIDER=local    → LocalTokenProvider   (default — JWT + DB refresh tokens)
//   AUTH_PROVIDER=keycloak → KeycloakTokenProvider (stub — implement when Keycloak is ready)
//
// To switch providers change one env var; no code changes needed in AuthService.

import { Module, Logger }      from '@nestjs/common';
import { JwtModule }            from '@nestjs/jwt';
import { PassportModule }       from '@nestjs/passport';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { HttpModule }           from '@nestjs/axios';

import { AuthController }               from './auth.controller';
import { AuthService }                  from './auth.service';
import { JwtStrategy }                  from './strategies/jwt.strategy';
import { LocalTokenProvider }           from './providers/local-token.provider';
import { KeycloakTokenProvider }        from './providers/keycloak-token.provider.stub';
import { TOKEN_PROVIDER, ITokenProvider } from './providers/token-provider.interface';
import { EmailService }                 from '../../shared/services/email.service';
import { PrismaService }                from '../../shared/prisma/prisma.service';

const logger = new Logger('AuthModule');

@Module({
  imports: [
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      imports:    [ConfigModule],
      inject:     [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret:      config.get<string>('JWT_SECRET'),
        signOptions: { expiresIn: config.get('JWT_EXPIRES_IN', '15m') },
      }),
    }),
    HttpModule,
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    JwtStrategy,
    EmailService,
    PrismaService,
    LocalTokenProvider,
    KeycloakTokenProvider,

    // ── Dynamic provider selection ─────────────────────────────────────
    // Inject the right ITokenProvider based on AUTH_PROVIDER env var.
    // Both concrete classes are declared above so NestJS can resolve their
    // own dependencies (PrismaService, JwtService, etc.) before factory runs.
    {
      provide:  TOKEN_PROVIDER,
      inject:   [ConfigService, LocalTokenProvider, KeycloakTokenProvider],
      useFactory: (
        config:    ConfigService,
        local:     LocalTokenProvider,
        keycloak:  KeycloakTokenProvider,
      ): ITokenProvider => {
        const provider = config.get<string>('AUTH_PROVIDER', 'local');
        logger.log(`Auth provider: ${provider}`);

        if (provider === 'keycloak') return keycloak;
        return local;
      },
    },
  ],
  exports: [AuthService, JwtModule, PassportModule, TOKEN_PROVIDER],
})
export class AuthModule {}
