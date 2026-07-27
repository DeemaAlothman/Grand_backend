-- CreateEnum
CREATE TYPE "ImportBatchStatus" AS ENUM ('PENDING', 'PREVIEWED', 'COMMITTED', 'FAILED');

-- CreateEnum
CREATE TYPE "ImportRowStatus" AS ENUM ('VALID', 'ERROR', 'COMMITTED', 'SKIPPED');

-- DropIndex
DROP INDEX "products_name_trgm_idx";

-- CreateTable
CREATE TABLE "import_batches" (
    "id" TEXT NOT NULL,
    "sourceFilename" TEXT NOT NULL,
    "sourceFileKey" TEXT NOT NULL,
    "uploadedById" TEXT NOT NULL,
    "status" "ImportBatchStatus" NOT NULL DEFAULT 'PENDING',
    "totalRows" INTEGER NOT NULL,
    "validRows" INTEGER NOT NULL,
    "errorRows" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "committedAt" TIMESTAMP(3),

    CONSTRAINT "import_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_rows" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "rowNumber" INTEGER NOT NULL,
    "rawData" JSONB NOT NULL,
    "status" "ImportRowStatus" NOT NULL DEFAULT 'ERROR',
    "errors" JSONB,
    "resolvedProductId" TEXT,
    "resolvedVariantId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "import_rows_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "import_rows_batchId_idx" ON "import_rows"("batchId");

-- AddForeignKey
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_rows" ADD CONSTRAINT "import_rows_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "import_batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
