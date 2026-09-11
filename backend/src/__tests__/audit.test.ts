import { prisma } from '../lib/prisma';
import { createAuditLog, verifyAuditChain } from '../lib/audit';

describe('Audit Integrity Chain Tests', () => {
  beforeAll(async () => {
    // Limpiar tabla antes de empezar
    await prisma.auditLog.deleteMany();
  });

  afterAll(async () => {
    // Limpiar tabla al final
    await prisma.auditLog.deleteMany();
  });

  it('Debe generar una cadena válida para múltiples eventos secuenciales', async () => {
    await createAuditLog({ action: 'TEST_EVENT_1', details: { msg: 'first' } });
    await createAuditLog({ action: 'TEST_EVENT_2', details: { msg: 'second' } });
    await createAuditLog({ action: 'TEST_EVENT_3', details: { msg: 'third' } });

    const result = await verifyAuditChain();
    expect(result.valid).toBe(true);
    expect(result.totalEvents).toBe(3);
  });

  it('Debe detectar manipulación directa en los detalles de un log (corrupción en BD)', async () => {
    // Obtener los eventos
    const events = await prisma.auditLog.findMany({ orderBy: { createdAt: 'asc' } });
    const targetEvent = events[1]; // Modificar el segundo evento

    // Modificar un campo SIN actualizar el hash nativamente en la BD
    await prisma.$executeRaw`UPDATE "audit_logs" SET details = '{"msg":"HACKED"}' WHERE id = ${targetEvent.id}`;

    const result = await verifyAuditChain();
    
    // La cadena debe ser inválida
    expect(result.valid).toBe(false);
    expect(result.firstCorruptedId).toBe(targetEvent.id);
    expect(result.message).toContain('Los datos fueron modificados');

    // Restaurar manualmente borrando todo
    await prisma.auditLog.deleteMany();
  });

  it('Debe detectar cuando se rompe la cadena (eliminación de un evento intermedio)', async () => {
    // Crear nuevos eventos
    await createAuditLog({ action: 'CHAIN_1', details: {} });
    await createAuditLog({ action: 'CHAIN_2', details: {} });
    await createAuditLog({ action: 'CHAIN_3', details: {} });

    const events = await prisma.auditLog.findMany({ orderBy: { createdAt: 'asc' } });
    const eventToDelete = events[1];

    // Eliminar el evento intermedio directamente en la BD
    await prisma.$executeRaw`DELETE FROM "audit_logs" WHERE id = ${eventToDelete.id}`;

    const result = await verifyAuditChain();
    
    expect(result.valid).toBe(false);
    // El evento 3 (índice 1 tras el borrado) tendrá un previousHash que ya no coincide con el hash del evento 1.
    expect(result.firstCorruptedIndex).toBe(1);
    expect(result.message).toContain('El previousHash no coincide');
  });
});
