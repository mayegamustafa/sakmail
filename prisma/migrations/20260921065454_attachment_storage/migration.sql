-- AlterTable
ALTER TABLE "mail_attachments" ADD COLUMN     "storageKey" TEXT,
ADD COLUMN     "uploadedById" TEXT,
ALTER COLUMN "messageId" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "mail_attachments" ADD CONSTRAINT "mail_attachments_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
