import { SetMetadata } from '@nestjs/common';

export const ROLES_KEY = 'roles';

/**
 * Batasi endpoint ke daftar peran tertentu, dipakai bersama `RolesGuard`.
 *
 * Nama peran ditulis huruf besar, sama seperti keluaran `CbtRolesService`:
 *
 *   @UseGuards(JwtAuthGuard, RolesGuard)
 *   @Roles('ADMIN', 'PROKTOR')
 */
export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);
