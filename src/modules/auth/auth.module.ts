import { Module }        from '@nestjs/common';
import { JwtModule }     from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { HttpModule }    from '@nestjs/axios';

import { AuthController } from './auth.controller';   // ← must be here
import { AuthService }    from './auth.service';
import { JwtStrategy }    from './strategies/jwt.strategy';
import { EmailService }   from '../../shared/services/email.service';
import { PrismaService }  from '../../shared/prisma/prisma.service';

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
  controllers: [AuthController],   // ← must be here
  providers:   [AuthService, JwtStrategy, EmailService, PrismaService],
  exports:     [AuthService, JwtModule, PassportModule],
})
export class AuthModule {}
