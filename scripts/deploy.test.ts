import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, test, vi } from 'vitest';
import { deploy, validateDeployEnvironment } from './deploy.mjs';

const environment = () => ({
  GITHUB_EVENT_NAME: 'push', GITHUB_REF: 'refs/heads/main', GITHUB_SHA: 'a'.repeat(40),
  CLOUDFLARE_API_TOKEN: 'test-cloudflare', CLOUDFLARE_ACCOUNT_ID: 'test-account', CLOUDFLARE_PAGES_PROJECT: 'minigame-rirs',
  RENDER_API_KEY: 'test-render', RENDER_OWNER_ID: 'test-owner', RENDER_SERVICE_NAME: 'minigame-api',
  GHCR_IMAGE: 'ghcr.io/m-civic/minigame-backend', GHCR_USERNAME: 'm-civic', GHCR_READ_TOKEN: 'test-read-only',
  DEPLOY_IMAGE: `ghcr.io/m-civic/minigame-backend@sha256:${'f'.repeat(64)}`
});
const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true });
});

test.each([
  ['pull_request', 'refs/heads/main'], ['push', 'refs/heads/feature/deploy'], ['workflow_dispatch', 'refs/heads/main']
])('deploy zavrne dogodek %s in vejo %s', (event, ref) => {
  expect(() => validateDeployEnvironment({ ...environment(), GITHUB_EVENT_NAME: event, GITHUB_REF: ref })).toThrow('samo ob pushu na main');
});

test('manjkajoča skrivnost ustavi deploy pred omrežnimi klici', async () => {
  const fetchImpl = vi.fn();
  await expect(deploy({ env: { ...environment(), RENDER_API_KEY: '' }, fetchImpl })).rejects.toThrow('RENDER_API_KEY');
  expect(fetchImpl).not.toHaveBeenCalled();
});

test('deploy zavrne spremenljiv image tag namesto preverjenega digesta', async () => {
  const fetchImpl = vi.fn();
  await expect(deploy({ env: { ...environment(), DEPLOY_IMAGE: 'ghcr.io/m-civic/minigame-backend:latest' }, fetchImpl })).rejects.toThrow('digest');
  expect(fetchImpl).not.toHaveBeenCalled();
});

async function fixture(existingPlan?: string, failedStatus?: string) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'minigame-deploy-test-'));
  directories.push(directory);
  await writeFile(path.join(directory, 'index.html'), '<div id="root"></div>');
  const mutations: Array<{ url: string; method: string; body: Record<string, unknown> }> = [];
  const service = { id: 'srv-test', name: 'minigame-api', type: 'web_service',
    serviceDetails: { runtime: 'image', plan: existingPlan || 'free', url: 'https://api.example.test' } };
  const fetchImpl = vi.fn(async (input: string, init: RequestInit = {}) => {
    const url = new URL(input);
    const method = init.method || 'GET';
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    if (method !== 'GET') mutations.push({ url: input, method, body });
    if (url.host === 'api.cloudflare.com') return Response.json({ success: true,
      result: { production_branch: 'main', subdomain: 'minigame-rirs.pages.dev' } });
    if (url.host === 'api.render.com') {
      if (url.pathname === '/v1/services' && method === 'GET') return Response.json(existingPlan ? [{ service }] : []);
      if (url.pathname === '/v1/registrycredentials' && method === 'GET') return Response.json([]);
      if (url.pathname === '/v1/registrycredentials' && method === 'POST') return Response.json({ id: 'cred-test' });
      if (url.pathname === '/v1/services' && method === 'POST') return Response.json({ service, deployId: 'dep-test' });
      if (url.pathname.endsWith('/deploys') && method === 'POST') return Response.json({ id: 'dep-test' });
      if (url.pathname.endsWith('/deploys/dep-test')) return Response.json({ status: failedStatus || 'live' });
      if (url.pathname === '/v1/services/srv-test' && method === 'GET') return Response.json(service);
      return Response.json({});
    }
    if (url.host === 'api.example.test') return Response.json({ status: 'ok' }, {
      headers: { 'Access-Control-Allow-Origin': 'https://minigame-rirs.pages.dev' }
    });
    if (url.pathname === '/runtime-config.js') return new Response(await readFile(path.join(directory, 'runtime-config.js'), 'utf8'));
    if (url.host === 'minigame-rirs.pages.dev') return new Response('<div id="root"></div>');
    throw new Error('Nepričakovan omrežni klic v testu.');
  });
  const publishFrontend = vi.fn();
  const options = { env: environment(), frontendDirectory: directory, fetchImpl, publishFrontend, wait: async () => {} };
  return { options, mutations, directory, publishFrontend };
}

test('prvi deploy ustvari free image storitev in prenese javni API URL brez ponovne gradnje', async () => {
  const setup = await fixture();
  const result = await deploy(setup.options);
  const creation = setup.mutations.find(call => call.url.endsWith('/services') && call.method === 'POST')!;
  expect(creation.body.serviceDetails).toMatchObject({ runtime: 'image', plan: 'free', numInstances: 1 });
  expect(creation.body.autoDeployTrigger).toBe('off');
  expect(creation.body.image).toMatchObject({ imagePath: setup.options.env.DEPLOY_IMAGE });
  expect(creation.body.envVars).toContainEqual({ key: 'CORS_ORIGIN', value: 'https://minigame-rirs.pages.dev' });
  expect(await readFile(path.join(setup.directory, 'runtime-config.js'), 'utf8')).toContain('https://api.example.test/api');
  expect(await readFile(path.join(setup.directory, 'runtime-config.js'), 'utf8')).not.toContain('test-render');
  expect(setup.publishFrontend).toHaveBeenCalledOnce();
  expect(result.backendUrl).toBe('https://api.example.test');
});

test('ponovni deploy uporablja obstoječo storitev in točen image digest', async () => {
  const setup = await fixture('free');
  await deploy(setup.options);
  expect(setup.mutations.some(call => call.url.endsWith('/registrycredentials'))).toBe(false);
  const start = setup.mutations.find(call => call.url.endsWith('/deploys'))!;
  expect(start.body).toEqual({ imageUrl: setup.options.env.DEPLOY_IMAGE });
});

test('deploy ne spreminja ali uporablja obstoječe plačljive storitve', async () => {
  const setup = await fixture('starter');
  await expect(deploy(setup.options)).rejects.toThrow('brezplačen');
  expect(setup.mutations).toHaveLength(0);
  expect(setup.publishFrontend).not.toHaveBeenCalled();
});

test('napaka Render deploya prepreči objavo frontenda', async () => {
  const setup = await fixture(undefined, 'update_failed');
  await expect(deploy(setup.options)).rejects.toThrow('update_failed');
  expect(setup.publishFrontend).not.toHaveBeenCalled();
});
