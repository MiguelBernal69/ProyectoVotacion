import 'dotenv/config';
import { app } from './app';
import { prisma } from './lib/prisma';

const PORT = process.env.PORT ?? '4000';


async function bootstrap() {
  try {
    // Verificar conexión a la base de datos antes de iniciar el servidor
    await prisma.$connect();
    console.log('✅ PostgreSQL conectado correctamente.');

    app.listen(Number(PORT), () => {
      console.log(`🚀 Backend escuchando en http://localhost:${PORT}`);
      console.log(`📡 Entorno: ${process.env.NODE_ENV ?? 'development'}`);
    });
  } catch (error) {
    console.error('❌ Error al iniciar el servidor:', error);
    await prisma.$disconnect();
    process.exit(1);
  }
}

// Cierre limpio de la conexión al detener el proceso
process.on('SIGTERM', async () => {
  console.log('SIGTERM recibido. Cerrando conexiones...');
  await prisma.$disconnect();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('SIGINT recibido. Cerrando conexiones...');
  await prisma.$disconnect();
  process.exit(0);
});

bootstrap();
