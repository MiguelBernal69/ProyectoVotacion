// Carga las variables de entorno antes de ejecutar los tests
import 'dotenv/config';

// Sobreescribir variables específicas para el entorno de test
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test_jwt_secret_for_testing_only';
process.env.JWT_EXPIRES_IN = '1h';
process.env.DATABASE_URL = process.env.DATABASE_URL ?? 'postgresql://votacion_user:votacion_pass_change_me@localhost:5432/votacion_db?schema=public';
