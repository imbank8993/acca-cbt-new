import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { RelationRegistry } from './relation-registry';
import { DbService } from './prisma-db-adapter';

@Global()
@Module({
  providers: [PrismaService, RelationRegistry, DbService],
  exports: [PrismaService, RelationRegistry, DbService],
})
export class PrismaModule {}
