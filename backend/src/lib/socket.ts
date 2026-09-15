import { Server } from 'socket.io';
import type { Server as HttpServer } from 'http';

let io: Server | null = null;

/**
 * Inicializa el servidor Socket.IO vinculado al servidor HTTP.
 * Debe llamarse UNA sola vez desde index.ts.
 */
export function initSocket(httpServer: HttpServer): Server {
  if (io) return io;

  io = new Server(httpServer, {
    cors: {
      origin: (origin, callback) => {
        // En desarrollo o cuando se accede por IP local (LAN), permitir el origen
        callback(null, true);
      },
      credentials: true,
    },
    // Configuración de transporte y reconexión del lado del servidor
    pingTimeout:  20000,
    pingInterval: 10000,
  });

  return io;
}

/**
 * Retorna la instancia activa de Socket.IO.
 * Lanza si no ha sido inicializada (uso incorrecto).
 */
export function getIO(): Server {
  if (!io) {
    throw new Error('[Socket] getIO() llamado antes de initSocket().');
  }
  return io;
}

/**
 * Resetea el singleton. SOLO para uso en tests.
 */
export function resetSocket(): void {
  io = null;
}
