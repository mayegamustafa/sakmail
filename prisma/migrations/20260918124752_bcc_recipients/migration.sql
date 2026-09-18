-- AlterTable
ALTER TABLE "mail_messages" ADD COLUMN     "bccEmails" TEXT[] DEFAULT ARRAY[]::TEXT[];
