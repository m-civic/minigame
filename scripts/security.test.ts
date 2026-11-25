import { afterAll, afterEach, beforeAll, expect, test, vi } from 'vitest';
import { once } from 'node:events';
import type { Server } from 'node:http';
import { createApp } from '../backend/src/index';
import { store, signLocalJwt } from '../backend/src/lib/store';

let server: Server;
let base: string;
beforeAll(async () => {
  server = createApp().listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Ni lokalnega HTTP naslova.');
  base = `http://127.0.0.1:${address.port}`;
});
afterAll(() => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())));
afterEach(() => vi.unstubAllEnvs());

test('produkcijska shramba nima demo uporabnikov in rezultatov, uganke pa ostanejo', async () => {
  vi.stubEnv('NODE_ENV', 'production');
  vi.resetModules();
  const { store: productionStore } = await import('../backend/src/lib/store');
  expect(productionStore.users.size).toBe(0);
  expect(productionStore.sessions.size).toBe(0);
  expect(productionStore.userStats.size).toBe(0);
  expect(productionStore.puzzles.size).toBe(5);
});

test.each(['login', 'register'])('produkcijski %s brez ponudnika prijave varno vrne 503', async route => {
  vi.stubEnv('NODE_ENV', 'production');
  const response = await fetch(`${base}/api/auth/${route}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@redacted.si', username: 'admin', password: 'geslo123' })
  });
  expect(response.status).toBe(503);
  expect(await response.json()).not.toHaveProperty('token');
});

test('produkcija zavrne lokalno podpisan administratorski JWT', async () => {
  const token = signLocalJwt({ sub: '10000000-0000-4000-8000-000000000001',
    email: 'admin@redacted.si', username: 'agent_admin', role: 'ADMIN' });
  vi.stubEnv('NODE_ENV', 'production');
  const response = await fetch(`${base}/api/admin/users`, { headers: { Authorization: `Bearer ${token}` } });
  expect(response.status).toBe(401);
});

test('račun brez passwordHash in brez Supabase ne more preskočiti preverjanja gesla', async () => {
  const id = 'security-no-password';
  store.users.set(id, { id, email: 'no-password@example.test', username: 'no-password', role: 'PLAYER',
    createdAt: new Date(), updatedAt: new Date() });
  try {
    const response = await fetch(`${base}/api/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'no-password@example.test', password: 'anything' })
    });
    expect(response.status).toBe(401);
    expect(await response.json()).not.toHaveProperty('token');
  } finally { store.users.delete(id); }
});

test('izbrisan lokalni uporabnik ne obdrži pravic iz JWT', async () => {
  const token = signLocalJwt({ sub: 'deleted-user', email: 'deleted@example.test', username: 'deleted', role: 'ADMIN' });
  const response = await fetch(`${base}/api/admin/users`, { headers: { Authorization: `Bearer ${token}` } });
  expect(response.status).toBe(401);
});

test.each(['GET /today', 'GET /puzzle/1', 'POST /guess', 'POST /hint'])(
  'gost in drug prijavljen uporabnik ne moreta dostopati do tuje seje: %s', async endpoint => {
    const owner = '10000000-0000-4000-8000-000000000003';
    const other = store.users.get('10000000-0000-4000-8000-000000000002')!;
    const ownerToken = signLocalJwt({ sub: owner, email: 'igralec@redacted.si', username: 'kripto_igralec', role: 'PLAYER' });
    const ownerResponse = await fetch(`${base}/api/game/puzzle/1`, { headers: { Authorization: `Bearer ${ownerToken}` } });
    const { session, puzzle } = await ownerResponse.json();
    const before = structuredClone(store.sessions.get(session.id));
    const otherToken = signLocalJwt({ sub: other.id, email: other.email, username: other.username, role: other.role });
    const [method, route] = endpoint.split(' ');
    for (const token of [undefined, otherToken]) {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) headers.Authorization = `Bearer ${token}`;
      const response = await fetch(`${base}/api/game${route}${method === 'GET' ? `?sessionId=${session.id}` : ''}`, {
        method, headers,
        body: method === 'POST' ? JSON.stringify({ sessionId: session.id, puzzleId: puzzle.id, word: 'physics', type: 'basic' }) : undefined
      });
      expect(response.status).toBe(403);
      expect(store.sessions.get(session.id)).toEqual(before);
    }
    const restored = await fetch(`${base}/api/game/puzzle/1?sessionId=${session.id}`, {
      headers: { Authorization: `Bearer ${ownerToken}` }
    });
    expect(restored.status).toBe(200);
  }
);

test.each([
  ['napačno geslo', null, { message: 'Invalid credentials' }, 401],
  ['manjkajoča seja', null, null, 401],
  ['preverjena seja', { access_token: 'verified-supabase-token' }, null, 200]
])('produkcijska prijava prek ponudnika: %s', async (_name, session, error, status) => {
  vi.stubEnv('NODE_ENV', 'production');
  vi.resetModules();
  const user = { id: 'verified-user', email: 'verified@example.test', username: 'verified', role: 'PLAYER',
    createdAt: new Date(), updatedAt: new Date() };
  const signInWithPassword = vi.fn().mockResolvedValue({ data: { session, user: { id: user.id } }, error });
  vi.doMock('../backend/src/lib/supabase', () => ({ isSupabaseConfigured: () => true,
    supabaseAdmin: { auth: { signInWithPassword } } }));
  vi.doMock('../backend/src/lib/prisma', () => ({ isDatabaseConfigured: () => true,
    prisma: { user: { findFirst: vi.fn().mockResolvedValue(user) } } }));
  let authServer: Server | undefined;
  try {
    const { default: express } = await import('express');
    const { authRouter } = await import('../backend/src/routes/auth.routes');
    authServer = express().use(express.json()).use('/api/auth', authRouter).listen(0, '127.0.0.1');
    await once(authServer, 'listening');
    const address = authServer.address();
    if (!address || typeof address === 'string') throw new Error('Ni naslova.');
    const response = await fetch(`http://127.0.0.1:${address.port}/api/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: user.email, password: 'test-password' })
    });
    expect(response.status).toBe(status);
    const data = await response.json();
    if (status === 200) expect(data.token).toBe('verified-supabase-token');
    else expect(data).not.toHaveProperty('token');
    expect(signInWithPassword).toHaveBeenCalledWith({ email: user.email, password: 'test-password' });
  } finally {
    if (authServer) await new Promise<void>(resolve => authServer!.close(() => resolve()));
    vi.doUnmock('../backend/src/lib/supabase');
    vi.doUnmock('../backend/src/lib/prisma');
    vi.resetModules();
  }
});
