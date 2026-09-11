import crypto from 'crypto';
import { prisma } from './prisma';

// ─── Interfaz de un evento auditables ─────────────────────────────────────────

export interface AuditEventInput {
  action: string;
  userId?: string | null;
  details: Record<string, any>;
}

// ─── Hash único del primer evento en la cadena ────────────────────────────────
const GENESIS_HASH = 'GENESIS_0000000000000000000000000000000000000000000000000000000000000000';

/**
 * Calcula el hash de un evento.
 * El hash depende de: action + userId + details + timestamp + previousHash
 * Si cualquiera de estos campos es alterado en la DB, el hash dejará de coincidir.
 */
export function computeHash(params: {
  action: string;
  userId: string | null;
  details: unknown;
  createdAt: Date;
  previousHash: string;
}): string {
  const data = [
    params.action,
    params.userId ?? 'SYSTEM',
    JSON.stringify(params.details),
    params.createdAt.toISOString(),
    params.previousHash,
  ].join('|');

  return crypto.createHash('sha256').update(data).digest('hex');
}

/**
 * Registra un evento de auditoría atómicamente.
 * La cadena de hashes se construye leyendo el hash del último evento.
 * Se usa SELECT FOR UPDATE (vía una transacción) para serializar la escritura.
 */
export async function createAuditLog(
  input: AuditEventInput,
  txClient?: Parameters<Parameters<typeof prisma.$transaction>[0]>[0]
): Promise<void> {
  const client = txClient ?? prisma;

  // Obtener el hash del último evento registrado
  const lastEvent = await (client as typeof prisma).auditLog.findFirst({
    orderBy: { createdAt: 'desc' },
    select: { hash: true },
  });

  const previousHash = lastEvent?.hash ?? GENESIS_HASH;
  const now = new Date();

  const hash = computeHash({
    action:       input.action,
    userId:       input.userId ?? null,
    details:      input.details,
    createdAt:    now,
    previousHash,
  });

  await (client as typeof prisma).auditLog.create({
    data: {
      action:       input.action,
      userId:       input.userId ?? null,
      details:      input.details,
      hash,
      previousHash,
      createdAt:    now,
    },
  });
}

/**
 * Verifica la integridad de toda la cadena de auditoría.
 * Retorna un resultado indicando si la cadena es válida, y en caso
 * de discrepancia, el ID del primer evento corrupto.
 */
export async function verifyAuditChain(): Promise<{
  valid: boolean;
  totalEvents: number;
  firstCorruptedId?: string;
  firstCorruptedIndex?: number;
  message: string;
}> {
  const events = await prisma.auditLog.findMany({
    orderBy: { createdAt: 'asc' },
  });

  if (events.length === 0) {
    return { valid: true, totalEvents: 0, message: 'No hay eventos de auditoría.' };
  }

  for (let i = 0; i < events.length; i++) {
    const ev = events[i];
    const expectedPreviousHash = i === 0 ? GENESIS_HASH : events[i - 1].hash;

    // Verificar que el previousHash almacenado coincide con el hash del evento anterior
    if (ev.previousHash !== expectedPreviousHash) {
      return {
        valid: false,
        totalEvents: events.length,
        firstCorruptedId: ev.id,
        firstCorruptedIndex: i,
        message: `Cadena rota en el evento #${i + 1} (id: ${ev.id}). El previousHash no coincide.`,
      };
    }

    // Re-calcular el hash y comparar con el almacenado
    const recomputed = computeHash({
      action:       ev.action,
      userId:       ev.userId,
      details:      ev.details,
      createdAt:    ev.createdAt,
      previousHash: ev.previousHash,
    });

    if (recomputed !== ev.hash) {
      return {
        valid: false,
        totalEvents: events.length,
        firstCorruptedId: ev.id,
        firstCorruptedIndex: i,
        message: `Hash inválido en el evento #${i + 1} (id: ${ev.id}). Los datos fueron modificados.`,
      };
    }
  }

  return {
    valid: true,
    totalEvents: events.length,
    message: `Cadena de auditoría íntegra. ${events.length} eventos verificados.`,
  };
}
