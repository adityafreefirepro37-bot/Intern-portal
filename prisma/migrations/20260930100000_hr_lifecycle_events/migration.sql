-- Phase 05: lifecycle timeline entries for HR operations.
ALTER TYPE "LifecycleEventType" ADD VALUE 'DOCUMENT_REVIEWED';
ALTER TYPE "LifecycleEventType" ADD VALUE 'HR_RECORD_UPDATED';
ALTER TYPE "LifecycleEventType" ADD VALUE 'OFFBOARDING_STARTED';
