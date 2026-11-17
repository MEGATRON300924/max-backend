ALTER TYPE "max_backend"."PendingActionStatus" ADD VALUE IF NOT EXISTS 'EXECUTING';
ALTER TYPE "max_backend"."PendingActionStatus" ADD VALUE IF NOT EXISTS 'COMPLETED';
ALTER TYPE "max_backend"."PendingActionStatus" ADD VALUE IF NOT EXISTS 'FAILED';
