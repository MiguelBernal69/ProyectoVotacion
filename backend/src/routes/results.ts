import { Router, Request, Response } from 'express';
import { createHash } from 'crypto';
import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';
import { Role } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { requireAuth } from '../middlewares/requireAuth';
import { requireRoles } from '../middlewares/requireRoles';
import { createAuditLog } from '../lib/audit';


export const resultsRouter = Router();

const MANAGER_ROLES = [Role.SUPERADMIN, Role.ADMIN, Role.PRESIDENT];
const VIEWER_ROLES = [Role.SUPERADMIN, Role.ADMIN, Role.PRESIDENT, Role.AUDITOR];

// Función auxiliar para stringify determinístico
function deterministicStringify(obj: any): string {
  if (obj === null || typeof obj !== 'object') {
    return JSON.stringify(obj);
  }
  if (Array.isArray(obj)) {
    return '[' + obj.map(deterministicStringify).join(',') + ']';
  }
  const keys = Object.keys(obj).sort();
  const parts = [];
  for (const key of keys) {
    if (obj[key] !== undefined) {
      parts.push(JSON.stringify(key) + ':' + deterministicStringify(obj[key]));
    }
  }
  return '{' + parts.join(',') + '}';
}

// Función auxiliar para calcular el hash SHA-256 de un objeto JSON
function computeContentHash(data: any): string {
  const jsonString = deterministicStringify(data);
  return createHash('sha256').update(jsonString).digest('hex');
}

// ─── POST /api/polls/:pollId/results — Generar y congelar acta ────────────────
resultsRouter.post(
  '/polls/:pollId/results',
  requireAuth,
  requireRoles(MANAGER_ROLES),
  async (req: Request, res: Response): Promise<void> => {
    const { pollId } = req.params;

    try {
      const poll = await prisma.poll.findUnique({
        where: { id: pollId },
        include: { options: true, session: true },
      });

      if (!poll) {
        res.status(404).json({ error: 'Votación no encontrada.' });
        return;
      }

      if (poll.status !== 'CLOSED') {
        res.status(409).json({ error: 'La votación debe estar CERRADA para generar el acta.' });
        return;
      }

      const existingResult = await prisma.pollResult.findUnique({ where: { pollId } });
      if (existingResult) {
        res.status(409).json({ error: 'El acta oficial ya fue generada para esta votación.' });
        return;
      }

      // 1. Recopilar datos base del acta
      const baseResultInfo = {
        pollId: poll.id,
        title: poll.title,
        question: poll.question,
        type: poll.type,
        sessionTitle: poll.session.title,
        openedAt: poll.openedAt,
        closedAt: poll.closedAt,
        generatedAt: new Date().toISOString(),
      };

      let resultJson: any = { ...baseResultInfo };

      // 2. Procesar datos según tipo
      if (poll.type === 'NOMINAL') {
        const votes = await prisma.nominalVote.findMany({
          where: { pollId },
          include: {
            user: { select: { id: true, name: true, identifier: true } },
            option: { select: { id: true, text: true } },
          },
          orderBy: { createdAt: 'asc' },
        });

        const summary = poll.options.map((opt) => ({
          optionId: opt.id,
          text: opt.text,
          count: votes.filter((v) => v.optionId === opt.id).length,
          voters: votes
            .filter((v) => v.optionId === opt.id)
            .map((v) => ({
              userId: v.user.id,
              name: v.user.name,
              identifier: v.user.identifier,
              votedAt: v.updatedAt,
            })),
        }));

        resultJson.summary = summary;
        resultJson.totalVotes = votes.length;
      } else {
        // Votación SECRETA: solo conteos
        const counts = await Promise.all(
          poll.options.map(async (opt) => ({
            optionId: opt.id,
            text: opt.text,
            count: await prisma.secretVote.count({ where: { pollId, optionId: opt.id } }),
          }))
        );

        const totalVoters = await prisma.secretVoterRegistry.count({ where: { pollId } });

        resultJson.summary = counts;
        resultJson.totalVotes = totalVoters;
        resultJson.note = 'Votación secreta: la identidad de los participantes está protegida matemáticamente.';
      }

      // 3. Generar hash de contenido
      const contentHash = computeContentHash(resultJson);

      // 4. Guardar resultado oficial en transacción
      const resultRecord = await prisma.$transaction(async (tx) => {
        const record = await tx.pollResult.create({
          data: {
            pollId,
            generatedBy: req.user!.id,
            contentHash,
            resultJson,
          },
        });

        await createAuditLog({
          action: 'RESULT_GENERATED',
          userId: req.user!.id,
          details: { pollId, resultId: record.id, contentHash },
        }, tx);

        return record;
      });

      res.status(201).json({ message: 'Acta oficial generada con éxito.', data: resultRecord });
    } catch (err) {
      console.error('[RESULTS] Error generando acta:', err);
      res.status(500).json({ error: 'Error interno del servidor.' });
    }
  }
);

// ─── GET /api/polls/:pollId/results — Obtener JSON del acta oficial ──────────
resultsRouter.get(
  '/polls/:pollId/results',
  requireAuth,
  requireRoles(VIEWER_ROLES),
  async (req: Request, res: Response): Promise<void> => {
    const { pollId } = req.params;

    try {
      const result = await prisma.pollResult.findUnique({
        where: { pollId },
        include: { user: { select: { id: true, name: true, identifier: true } } },
      });

      if (!result) {
        res.status(404).json({ error: 'No se ha generado el acta oficial todavía.' });
        return;
      }

      // Verificar integridad en tiempo real
      const currentHash = computeContentHash(result.resultJson);
      const isIntact = currentHash === result.contentHash;

      res.json({
        data: result,
        integrity: {
          valid: isIntact,
          storedHash: result.contentHash,
          currentHash,
        },
      });
    } catch (err) {
      console.error('[RESULTS] Error obteniendo resultados:', err);
      res.status(500).json({ error: 'Error interno del servidor.' });
    }
  }
);

// ─── GET /api/verify/:actaId — Verificación Pública del Acta ─────────────────
// ¡Ruta sin autenticación!
resultsRouter.get(
  '/verify/:actaId',
  async (req: Request, res: Response): Promise<void> => {
    const { actaId } = req.params;

    try {
      const result = await prisma.pollResult.findUnique({
        where: { id: actaId },
        include: {
          poll: { select: { title: true, type: true } },
          user: { select: { name: true, identifier: true } },
        },
      });

      if (!result) {
        res.status(404).json({ error: 'Acta no encontrada.' });
        return;
      }

      // Recalcular hash para validar integridad
      const currentHash = computeContentHash(result.resultJson);
      const isIntact = currentHash === result.contentHash;

      // Reportar intento de acceso público en log general
      // Nota: al ser ruta pública, no hay userId, se registra como "SYSTEM" o "GUEST"
      await createAuditLog({
        action: 'PUBLIC_ACTA_VERIFIED',
        userId: null,
        details: { actaId, valid: isIntact, ip: req.ip },
      });

      res.json({
        valid: isIntact,
        acta: {
          id: result.id,
          contentHash: result.contentHash,
          generatedBy: result.user,
          generatedAt: result.generatedAt,
          resultJson: result.resultJson,
        },
        recomputedHash: currentHash,
        storedHash: result.contentHash,
      });
    } catch (err) {
      console.error('[RESULTS] Error en verificación pública:', err);
      res.status(500).json({ error: 'Error interno del servidor.' });
    }
  }
);

// ─── GET /api/polls/:pollId/results/pdf — Descargar PDF ──────────────────────
resultsRouter.get(
  '/polls/:pollId/results/pdf',
  requireAuth,
  requireRoles(VIEWER_ROLES),
  async (req: Request, res: Response): Promise<void> => {
    const { pollId } = req.params;

    try {
      const result = await prisma.pollResult.findUnique({
        where: { pollId },
        include: { user: { select: { name: true, identifier: true } } },
      });

      if (!result) {
        res.status(404).json({ error: 'No se ha generado el acta.' });
        return;
      }

      const data = result.resultJson as any;

      // 1. Generar URL pública y QR code
      const domain = process.env.PUBLIC_URL || ('http://' + req.headers.host);
      const verifyUrl = domain + '/verify/' + result.id;
      const qrImage = await QRCode.toBuffer(verifyUrl, { width: 100, margin: 2 });

      // 2. Crear documento PDF
      const doc = new PDFDocument({ margin: 50, size: 'A4' });

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader(
        'Content-Disposition',
        'attachment; filename="Acta_' + pollId.substring(0, 8) + '.pdf"'
      );


      doc.pipe(res);

      // --- ENCABEZADO ---
      doc.fontSize(18).font('Helvetica-Bold').text('SISTEMA DE VOTACIÓN INSTITUCIONAL', { align: 'center' });
      doc.moveDown(0.5);
      doc.fontSize(14).font('Helvetica-Bold').text('ACTA OFICIAL DE RESULTADOS', { align: 'center' });
      doc.moveDown(2);

      // --- DATOS GENERALES ---
      doc.fontSize(10).font('Helvetica');
      doc.text('SESIÓN: ' + data.sessionTitle);
      doc.text('VOTACIÓN: ' + data.title);
      doc.text('PREGUNTA: ' + data.question);
      doc.text('TIPO: ' + (data.type === 'NOMINAL' ? 'Pública / Nominal' : 'Secreta'));

      const openedStr = data.openedAt ? new Date(data.openedAt).toLocaleString('es-ES') : 'N/A';
      const closedStr = data.closedAt ? new Date(data.closedAt).toLocaleString('es-ES') : 'N/A';
      doc.text('APERTURA: ' + openedStr);
      doc.text('CIERRE: ' + closedStr);
      doc.moveDown(1.5);

      // --- RESULTADOS AGREGADOS ---
      doc.fontSize(12).font('Helvetica-Bold').text('RESUMEN DE RESULTADOS');
      doc.moveDown(0.5);

      doc.fontSize(10).font('Helvetica');
      let total = 0;
      data.summary.forEach((opt: any) => {
        doc.text('- ' + opt.text + ': ' + opt.count + ' votos');
        total += opt.count;
      });
      doc.moveDown(0.5);
      doc.font('Helvetica-Bold').text('TOTAL VOTOS EMITIDOS: ' + total);
      doc.moveDown(2);

      // --- DETALLE NOMINAL (si aplica) ---
      if (data.type === 'NOMINAL') {
        doc.fontSize(12).font('Helvetica-Bold').text('DETALLE DE VOTOS');
        doc.moveDown(0.5);
        doc.fontSize(9).font('Helvetica');

        data.summary.forEach((opt: any) => {
          if (opt.voters && opt.voters.length > 0) {
            doc.font('Helvetica-Bold').text('Votaron por "' + opt.text + '":');
            doc.font('Helvetica');
            opt.voters.forEach((v: any) => {
              doc.text('  \u2022 ' + v.name);
            });
            doc.moveDown(0.5);
          }
        });
      } else {
        // Nota secreta
        doc.fontSize(10).font('Helvetica-Oblique').text(data.note || 'Votación secreta: No se detallan identidades.');
      }
      doc.moveDown(3);

      // --- FIRMAS Y VALIDACIÓN ---
      doc.fontSize(10).font('Helvetica');
      doc.text('Generado por: ' + result.user.name + ' (' + result.user.identifier + ')');
      doc.text('Fecha de generación: ' + new Date(result.generatedAt).toLocaleString('es-ES'));

      // QR a la derecha
      doc.image(qrImage, doc.page.width - 150, doc.y - 30, { width: 100 });

      doc.moveDown(2);
      doc.fillColor('grey').fontSize(8).font('Courier').text('ID de Acta: ' + result.id);
      doc.text('Hash SHA-256: ' + result.contentHash);
      doc.text('Verificar integridad en: ' + verifyUrl);
      doc.fillColor('black');


      doc.end();

      // Registro en auditoría
      await createAuditLog({
        action: 'RESULT_PDF_DOWNLOADED',
        userId: req.user!.id,
        details: { pollId, resultId: result.id },
      });

    } catch (err) {
      console.error('[RESULTS] Error generando PDF:', err);
      // Solo devolver error si no se ha enviado el encabezado
      if (!res.headersSent) {
        res.status(500).json({ error: 'Error interno del servidor generando el PDF.' });
      }
    }
  }
);
