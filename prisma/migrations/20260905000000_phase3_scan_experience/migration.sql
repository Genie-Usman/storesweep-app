-- AlterTable
ALTER TABLE "Shop" ADD COLUMN "lastThemePublishAt" DATETIME;

-- AlterTable
ALTER TABLE "ScanFinding" ADD COLUMN "isNew" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "CleanOperation" ADD COLUMN "themeId" TEXT;

-- CreateTable
CREATE TABLE "IgnoredApp" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "appName" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "IgnoredApp_shop_fkey" FOREIGN KEY ("shop") REFERENCES "Shop" ("shop") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "IgnoredApp_shop_appName_key" ON "IgnoredApp"("shop", "appName");

-- CreateIndex
CREATE INDEX "IgnoredApp_shop_idx" ON "IgnoredApp"("shop");
