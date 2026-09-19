-- DropIndex
DROP INDEX "StaffLocationCertification_staffId_locationId_key";

-- CreateIndex
CREATE INDEX "StaffLocationCertification_staffId_locationId_idx" ON "StaffLocationCertification"("staffId", "locationId");
