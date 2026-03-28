// src/modules/auth/auth.module.ts
import { Module }        from '@nestjs/common';
import { JwtModule }     from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { HttpModule }    from '@nestjs/axios';

import { AuthController }  from './auth.controller';
import { AuthService }     from './auth.service';
import { JwtStrategy }     from './strategies/jwt.strategy';
import { EmailService }    from '../shared/services/email.service';

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
  providers:   [AuthService, JwtStrategy, EmailService],
  exports:     [AuthService, JwtModule, PassportModule],
})
export class AuthModule {}
