import { createParamDecorator, ExecutionContext, ServiceUnavailableException } from '@nestjs/common';
import type { AuthUser } from '@acca-cbt/shared';

/**
 * ID sekolah instalasi yang sudah ditentukan JwtStrategy dari database.
 * Controller tidak perlu dan tidak boleh mengambil pemilih sekolah dari query
 * atau body kiriman browser.
 */
export const CurrentSchoolId = createParamDecorator(
  (_data: unknown, context: ExecutionContext): string => {
    const user = context.switchToHttp().getRequest().user as AuthUser | undefined;
    if (!user?.organizationId) {
      throw new ServiceUnavailableException('Sekolah utama belum dikonfigurasi.');
    }
    return user.organizationId;
  },
);
