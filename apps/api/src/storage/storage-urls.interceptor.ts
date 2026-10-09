import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { map } from 'rxjs/operators';
import { StorageService } from './storage.service';

@Injectable()
export class StorageUrlsInterceptor implements NestInterceptor {
    constructor(private readonly storage: StorageService) {}
    intercept(_context: ExecutionContext, next: CallHandler) {
        return next.handle().pipe(map(value => this.storage.protectUrls(value)));
    }
}
