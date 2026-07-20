-- Кабинет менеджера по клиентам: новая роль MANAGER

ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'MANAGER';
