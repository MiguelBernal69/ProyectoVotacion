import 'dotenv/config';
import { createServer } from 'http';
import { app } from './app';
import { prisma } from './lib/prisma';
import { initSocket } from './lib/socket';
import { registerVotingNamespace } from './socket/votingNamespace';

const PORT = process.env.PORT ?? '4000';

async function bootstrap() {
  try {
    // 1. Verificar conexión a la base de datos
    await prisma.$connect();
    console.log('✅ PostgreSQL conectado correctamente.');

    // 2. Crear servidor HTTP (necesario para adjuntar Socket.IO sobre el mismo puerto)
    const httpServer = createServer(app);

    // 3. Inicializar Socket.IO y registrar el namespace /voting
    const io = initSocket(httpServer);
    registerVotingNamespace(io);
    console.log('✅ Socket.IO inicializado — namespace /voting registrado.');

    // 4. Iniciar el servidor
    httpServer.listen(Number(PORT), () => {
      console.log(`🚀 Backend escuchando en http://localhost:${PORT}`);
      console.log(`🔌 WebSocket disponible en ws://localhost:${PORT}/voting`);
      console.log(`📡 Entorno: ${process.env.NODE_ENV ?? 'development'}`);
    });
  } catch (error) {
    console.error('❌ Error al iniciar el servidor:', error);
    await prisma.$disconnect();
    process.exit(1);
  }
}

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
