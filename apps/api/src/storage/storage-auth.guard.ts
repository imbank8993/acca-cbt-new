import { ExecutionContext, Injectable } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { fileKey, isPublicFile } from './storage-file-policy';

@Injectable()
export class StorageAuthGuard extends JwtAuthGuard {
    canActivate(context: ExecutionContext) {
        const request = context.switchToHttp().getRequest();
        if (context.getHandler().name === 'serveFile' && isPublicFile(fileKey(request.url))) return true;
        return super.canActivate(context);
    }
}
