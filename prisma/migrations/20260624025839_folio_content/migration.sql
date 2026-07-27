-- CreateEnum
CREATE TYPE "ContentType" AS ENUM ('page', 'post', 'case_study');

-- CreateEnum
CREATE TYPE "ContentStatus" AS ENUM ('draft', 'published', 'archived');

-- CreateTable
CREATE TABLE "content" (
    "id" TEXT NOT NULL,
    "type" "ContentType" NOT NULL DEFAULT 'page',
    "title" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "status" "ContentStatus" NOT NULL DEFAULT 'draft',
    "excerpt" TEXT,
    "cover_image" TEXT,
    "body" JSONB NOT NULL DEFAULT '{}',
    "body_format" TEXT NOT NULL DEFAULT 'canvas',
    "seo" JSONB NOT NULL DEFAULT '{}',
    "meta" JSONB NOT NULL DEFAULT '{}',
    "published_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "content_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "media_assets" (
    "id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "alt" TEXT,
    "kind" TEXT NOT NULL DEFAULT 'image',
    "width" INTEGER,
    "height" INTEGER,
    "size" INTEGER,
    "meta" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "media_assets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "content_slug_key" ON "content"("slug");

-- CreateIndex
CREATE INDEX "content_type_status_idx" ON "content"("type", "status");
