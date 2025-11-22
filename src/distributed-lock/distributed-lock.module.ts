import { Global, Module } from '@nestjs/common';
import { DistributedLockService } from './distributed-lock.service';
import { ClusterHeartbeatService } from './cluster-heartbeat.service';
import { ClusterController } from './cluster.controller';
import { PrismaModule } from '../prisma/prisma.module';

@Global()
@Module({
  imports: [PrismaModule],
  controllers: [ClusterController],
  providers: [DistributedLockService, ClusterHeartbeatService],
  exports: [DistributedLockService, ClusterHeartbeatService],
})
export class DistributedLockModule {}
