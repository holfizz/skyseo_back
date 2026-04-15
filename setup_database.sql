-- Создание пользователя
CREATE USER skyseo_user WITH PASSWORD 'skyseo_password_2024';

-- Создание базы данных
CREATE DATABASE skyseo OWNER skyseo_user;

-- Подключение к базе данных skyseo
\c skyseo

-- Выдача всех прав пользователю на базу данных
GRANT ALL PRIVILEGES ON DATABASE skyseo TO skyseo_user;

-- Выдача прав на схему public
GRANT ALL ON SCHEMA public TO skyseo_user;

-- Выдача прав на все таблицы в схеме public
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO skyseo_user;

-- Выдача прав на все последовательности (sequences) в схеме public
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO skyseo_user;

-- Выдача прав на все функции в схеме public
GRANT ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA public TO skyseo_user;

-- Установка прав по умолчанию для будущих объектов
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO skyseo_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO skyseo_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO skyseo_user;

-- Проверка созданного пользователя и базы данных
\du skyseo_user
\l skyseo
