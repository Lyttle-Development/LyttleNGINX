-- CreateEnum
CREATE TYPE "ProxyType" AS ENUM ('REDIRECT', 'PROXY');

-- CreateTable
CREATE TABLE "ProxyEntry" (
    "id" SERIAL NOT NULL,
    "proxy_pass_host" TEXT NOT NULL,
    "domains" TEXT NOT NULL,
    "nginx_custom_code" TEXT,
    "type" "ProxyType" NOT NULL DEFAULT 'PROXY',

    CONSTRAINT "ProxyEntry_pkey" PRIMARY KEY ("id")
);
