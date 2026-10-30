import { Body, Controller, Delete, Get, Param, ParseEnumPipe, ParseUUIDPipe, Put, UseGuards } from '@nestjs/common';
import { IsBoolean, IsIn, IsISO8601, IsOptional } from 'class-validator';
import type { AuthUser } from '@acca-cbt/shared';
import { JwtAuthGuard } from './jwt-auth.guard';
import { RolesGuard } from './roles.guard';
import { Roles } from './roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { CollaborationService } from './collaboration.service';
import type { CollaborativeResource } from '../common/collaboration-access';

const RESOURCE = { bank: 'bank', exam: 'exam', period: 'period' };
class GrantDto {
    @IsIn(['viewer', 'editor', 'manager']) permission!: 'viewer' | 'editor' | 'manager';
    @IsOptional() @IsBoolean() can_reset?: boolean;
    @IsOptional() @IsISO8601() expires_at?: string | null;
}

@Controller('collaboration')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN', 'PROKTOR', 'GURU')
export class CollaborationController {
    constructor(private readonly collaboration: CollaborationService) {}
    @Get(':type/:id')
    list(@CurrentUser() user: AuthUser, @Param('type', new ParseEnumPipe(RESOURCE)) type: CollaborativeResource, @Param('id', ParseUUIDPipe) id: string) {
        return this.collaboration.list(user, type, id);
    }
    @Get(':type/:id/candidates')
    async candidates(@CurrentUser() user: AuthUser, @Param('type', new ParseEnumPipe(RESOURCE)) type: CollaborativeResource, @Param('id', ParseUUIDPipe) id: string) {
        return { candidates: await this.collaboration.candidates(user, type, id) };
    }
    @Put(':type/:id/:userId')
    save(@CurrentUser() user: AuthUser, @Param('type', new ParseEnumPipe(RESOURCE)) type: CollaborativeResource, @Param('id', ParseUUIDPipe) id: string,
        @Param('userId', ParseUUIDPipe) userId: string, @Body() input: GrantDto) {
        return this.collaboration.save(user, type, id, userId, input);
    }
    @Delete(':type/:id/:userId')
    revoke(@CurrentUser() user: AuthUser, @Param('type', new ParseEnumPipe(RESOURCE)) type: CollaborativeResource, @Param('id', ParseUUIDPipe) id: string, @Param('userId', ParseUUIDPipe) userId: string) {
        return this.collaboration.revoke(user, type, id, userId);
    }
}
