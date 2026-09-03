-- CreateTable
CREATE TABLE "Shop" (
    "shop" TEXT NOT NULL PRIMARY KEY,
    "firstSeenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastActiveAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "uninstalledAt" DATETIME,
    "lastScanAt" DATETIME,
    "scanCount" INTEGER NOT NULL DEFAULT 0,
    "cleanCount" INTEGER NOT NULL DEFAULT 0
);

-- CreateTable
CREATE TABLE "Scan" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "themeId" TEXT NOT NULL,
    "themeName" TEXT,
    "status" TEXT NOT NULL DEFAULT 'completed',
    "fileCount" INTEGER NOT NULL DEFAULT 0,
    "findingCount" INTEGER NOT NULL DEFAULT 0,
    "durationMs" INTEGER,
    "fileChecksums" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Scan_shop_fkey" FOREIGN KEY ("shop") REFERENCES "Shop" ("shop") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ScanFinding" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "scanId" TEXT NOT NULL,
    "findingKey" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "appName" TEXT NOT NULL,
    "category" TEXT,
    "confidence" TEXT,
    "matchedCode" TEXT NOT NULL,
    "startLine" INTEGER NOT NULL,
    "endLine" INTEGER NOT NULL,
    CONSTRAINT "ScanFinding_scanId_fkey" FOREIGN KEY ("scanId") REFERENCES "Scan" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CleanOperation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "scanId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'completed',
    "removedCount" INTEGER NOT NULL DEFAULT 0,
    "filesChanged" INTEGER NOT NULL DEFAULT 0,
    "backups" TEXT,
    "restoredAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CleanOperation_shop_fkey" FOREIGN KEY ("shop") REFERENCES "Shop" ("shop") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "CleanOperation_scanId_fkey" FOREIGN KEY ("scanId") REFERENCES "Scan" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "detail" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AuditEvent_shop_fkey" FOREIGN KEY ("shop") REFERENCES "Shop" ("shop") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "Scan_shop_createdAt_idx" ON "Scan"("shop", "createdAt");

-- CreateIndex
CREATE INDEX "ScanFinding_scanId_idx" ON "ScanFinding"("scanId");

-- CreateIndex
CREATE INDEX "ScanFinding_findingKey_idx" ON "ScanFinding"("findingKey");

-- CreateIndex
CREATE INDEX "CleanOperation_shop_createdAt_idx" ON "CleanOperation"("shop", "createdAt");

-- CreateIndex
CREATE INDEX "AuditEvent_shop_createdAt_idx" ON "AuditEvent"("shop", "createdAt");

-- CreateTable
CREATE TABLE "IgnoredFinding" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "appName" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "IgnoredFinding_shop_fkey" FOREIGN KEY ("shop") REFERENCES "Shop" ("shop") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "IgnoredFinding_shop_filename_appName_codeHash_key" ON "IgnoredFinding"("shop", "filename", "appName", "codeHash");

-- CreateIndex
CREATE INDEX "IgnoredFinding_shop_idx" ON "IgnoredFinding"("shop");
