/*
  Warnings:

  - Added the required column `amount` to the `Enrollment` table without a default value. This is not possible if the table is not empty.
  - Added the required column `modality` to the `Enrollment` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE `enrollment` ADD COLUMN `amount` DOUBLE NOT NULL,
    ADD COLUMN `modality` VARCHAR(191) NOT NULL,
    ADD COLUMN `paymentId` VARCHAR(191) NULL,
    ADD COLUMN `status` VARCHAR(191) NOT NULL DEFAULT 'PENDING';
