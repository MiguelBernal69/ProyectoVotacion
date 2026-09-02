import request from 'supertest';
import bcrypt from 'bcryptjs';
import { app } from '../app';
import { prisma } from '../lib/prisma';
import { Role } from '@prisma/client';

// ─── Usuarios de prueba (se crean antes de los tests y se eliminan al final) ─
const testUsers = {
  admin:       { identifier: '__test_admin__',       password: 'testAdmin123',    role: Role.ADMIN },
  president:   { identifier: '__test_president__',   password: 'testPresi123',    role: Role.PRESIDENT },
  auditor:     { identifier: '__test_auditor__',     password: 'testAudit123',    role: Role.AUDITOR },
  participant: { identifier: '__test_participant__', password: 'testPart123',     role: Role.PARTICIPANT },
  inactive:    { identifier: '__test_inactive__',    password: 'testInactive123', role: Role.PARTICIPANT },
};

// Función auxiliar: hace login y retorna la cookie del JWT
async function loginAndGetCookie(identifier: string, password: string): Promise<string> {
  const res = await request(app)
    .post('/api/auth/login')
    .send({ identifier, password });

  const setCookie = res.headers['set-cookie'] as string[] | string | undefined;
  if (!setCookie) throw new Error(`Login falló para ${identifier}: status ${res.status}, body: ${JSON.stringify(res.body)}`);
  const cookieArray = Array.isArray(setCookie) ? setCookie : [setCookie];
  return cookieArray[0].split(';')[0]; // Extrae solo 'token=<valor>'
}

// ─── Setup y Teardown ──────────────────────────────────────────────────────────

beforeAll(async () => {
  // Crear usuarios de prueba en la BD
  for (const [key, data] of Object.entries(testUsers)) {
    await prisma.user.upsert({
      where: { identifier: data.identifier },
      update: {},
      create: {
        identifier: data.identifier,
        name: `Test User ${key}`,
        passwordHash: await bcrypt.hash(data.password, 10),
        role: data.role,
        isActive: key !== 'inactive',
      },
    });
  }
});

afterAll(async () => {
  // Limpiar usuarios de prueba y sus logs de auditoría
  const userIds = await prisma.user.findMany({
    where: { identifier: { in: Object.values(testUsers).map(u => u.identifier) } },
    select: { id: true },
  });
  const ids = userIds.map(u => u.id);

  await prisma.auditLog.deleteMany({ where: { userId: { in: ids } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
  await prisma.$disconnect();
});

// ═══════════════════════════════════════════════════════════════════════════════
// SUITE 1: Login
// ═══════════════════════════════════════════════════════════════════════════════

describe('POST /api/auth/login', () => {
  test('✅ 1. Login correcto → 200 OK y cookie JWT establecida', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ identifier: testUsers.admin.identifier, password: testUsers.admin.password });

    expect(res.status).toBe(200);
    expect(res.body.user).toBeDefined();
    expect(res.body.user.role).toBe(Role.ADMIN);
    expect(res.body.user.passwordHash).toBeUndefined(); // No exponer el hash
    const cookies = res.headers['set-cookie'] as string[] | string | undefined;
    expect(cookies).toBeDefined();
    const cookieStr = Array.isArray(cookies) ? cookies.join(';') : (cookies ?? '');
    expect(cookieStr).toContain('token=');
    expect(cookieStr).toContain('HttpOnly');
  });

  test('❌ 2. Contraseña incorrecta → 401 Unauthorized', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ identifier: testUsers.admin.identifier, password: 'contraseña_incorrecta' });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Credenciales incorrectas.');
  });

  test('❌ 3. Usuario no existe → 401 (mismo mensaje que contraseña incorrecta)', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ identifier: 'usuario_que_no_existe', password: 'cualquier_cosa' });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Credenciales incorrectas.');
  });

  test('🚫 4. Usuario inactivo → 403 Forbidden', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ identifier: testUsers.inactive.identifier, password: testUsers.inactive.password });

    expect(res.status).toBe(403);
    expect(res.body.error).toContain('desactivada');
  });

  test('❌ 5. Payload vacío → 400 Bad Request', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({});

    expect(res.status).toBe(400);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SUITE 2: Protección de rutas (sin autenticación)
// ═══════════════════════════════════════════════════════════════════════════════

describe('Acceso sin autenticación', () => {
  test('❌ 6. GET /api/auth/me sin cookie → 401', async () => {
    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(401);
  });

  test('❌ 7. GET /api/admin/test sin cookie → 401', async () => {
    const res = await request(app).get('/api/admin/test');
    expect(res.status).toBe(401);
  });

  test('❌ 8. POST /api/auth/logout sin cookie → 401', async () => {
    const res = await request(app).post('/api/auth/logout');
    expect(res.status).toBe(401);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SUITE 3: Control de acceso por rol (RBAC)
// ═══════════════════════════════════════════════════════════════════════════════

describe('Control de acceso por rol (RBAC)', () => {
  test('🚫 9. PARTICIPANT intenta acceder al panel admin → 403', async () => {
    const cookie = await loginAndGetCookie(testUsers.participant.identifier, testUsers.participant.password);

    const res = await request(app)
      .get('/api/admin/test')
      .set('Cookie', cookie);

    expect(res.status).toBe(403);
    expect(res.body.error).toContain('Acceso denegado');
  });

  test('🚫 10. AUDITOR intenta modificar datos → 403', async () => {
    const cookie = await loginAndGetCookie(testUsers.auditor.identifier, testUsers.auditor.password);

    const res = await request(app)
      .post('/api/admin/data')
      .set('Cookie', cookie)
      .send({ data: 'algo' });

    expect(res.status).toBe(403);
  });

  test('✅ 11. AUDITOR puede leer el registro de auditoría → 200', async () => {
    const cookie = await loginAndGetCookie(testUsers.auditor.identifier, testUsers.auditor.password);

    const res = await request(app)
      .get('/api/admin/audit')
      .set('Cookie', cookie);

    expect(res.status).toBe(200);
  });

  test('✅ 12. ADMIN accede a panel administrativo → 200', async () => {
    const cookie = await loginAndGetCookie(testUsers.admin.identifier, testUsers.admin.password);

    const res = await request(app)
      .get('/api/admin/test')
      .set('Cookie', cookie);

    expect(res.status).toBe(200);
    expect(res.body.message).toContain('administrativo');
  });

  test('✅ 13. ADMIN puede modificar datos → 200', async () => {
    const cookie = await loginAndGetCookie(testUsers.admin.identifier, testUsers.admin.password);

    const res = await request(app)
      .post('/api/admin/data')
      .set('Cookie', cookie)
      .send({ data: 'algo' });

    expect(res.status).toBe(200);
  });

  test('✅ 14. GET /api/auth/me devuelve datos del usuario → 200', async () => {
    const cookie = await loginAndGetCookie(testUsers.participant.identifier, testUsers.participant.password);

    const res = await request(app)
      .get('/api/auth/me')
      .set('Cookie', cookie);

    expect(res.status).toBe(200);
    expect(res.body.user.role).toBe(Role.PARTICIPANT);
    expect(res.body.user.passwordHash).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SUITE 4: Logout
// ═══════════════════════════════════════════════════════════════════════════════

describe('POST /api/auth/logout', () => {
  test('✅ 15. Logout limpia la cookie → 200', async () => {
    const cookie = await loginAndGetCookie(testUsers.participant.identifier, testUsers.participant.password);

    const res = await request(app)
      .post('/api/auth/logout')
      .set('Cookie', cookie);

    expect(res.status).toBe(200);
    const cookies = res.headers['set-cookie'] as string[] | string | undefined;
    const cookieStr = Array.isArray(cookies) ? cookies.join(';') : (cookies ?? '');
    // La cookie debe ser limpiada (max-age=0 o expires pasado)
    expect(cookieStr).toContain('token=');
  });
});
