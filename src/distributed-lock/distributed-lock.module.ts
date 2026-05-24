import { Global, Module } from '@nestjs/common';
import { DistributedLockService } from './distributed-lock.service';
import { ClusterHeartbeatService } from './cluster-heartbeat.service';
import { ClusterOperationsService } from './cluster-operations.service';
import { ClusterController } from './cluster.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { ReloaderModule } from '../reloader/reloader.module';
import { AuthModule } from '../auth/auth.module';

@Global()
@Module({
  imports: [PrismaModule, ReloaderModule, AuthModule],
  controllers: [ClusterController],
  providers: [
    DistributedLockService,
    ClusterHeartbeatService,
    ClusterOperationsService,
  ],
  exports: [
    DistributedLockService,
    ClusterHeartbeatService,
    ClusterOperationsService,
  ],
})
export class DistributedLockModule {}
