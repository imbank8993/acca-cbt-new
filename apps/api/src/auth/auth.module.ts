import { Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AuthUsersRepository } from './auth-users.repository';
import { AuthorizationService } from './authorization.service';
import { CbtRolesService } from './cbt-roles.service';
import { JwtStrategy } from './jwt.strategy';
import { SingleSchoolService } from './single-school.service';

@Global()
@Module({
  imports: [
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('JWT_SECRET'),
        signOptions: { expiresIn: config.get<string>('JWT_EXPIRES_IN') || '12h' },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    AuthUsersRepository,
    AuthorizationService,
    CbtRolesService,
    SingleSchoolService,
    JwtStrategy,
  ],
  exports: [AuthService, AuthUsersRepository, AuthorizationService, CbtRolesService, SingleSchoolService],
})
export class AuthModule {}
