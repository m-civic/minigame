import { execFileSync } from 'node:child_process';
import { writeFile, appendFile, access } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

export function validateDeployEnvironment(env) {
  if (env.GITHUB_EVENT_NAME !== 'push' || env.GITHUB_REF !== 'refs/heads/main') {
    throw new Error('Deploy je dovoljen samo ob pushu na main.');
  }
  for (const key of ['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_PAGES_PROJECT',
    'RENDER_API_KEY', 'RENDER_OWNER_ID', 'RENDER_SERVICE_NAME', 'GHCR_IMAGE', 'GHCR_USERNAME', 'GHCR_READ_TOKEN']) {
    if (!env[key]) throw new Error(`Manjka production nastavitev: ${key}`);
  }
}

export async function deploy({ env = process.env, fetchImpl = fetch, wait = sleep,
  frontendDirectory = path.resolve('deploy/frontend'),
  publishFrontend = directory => execFileSync('npx', ['--yes', 'wrangler@4.168.0', 'pages', 'deploy', directory,
    '--project-name', env.CLOUDFLARE_PAGES_PROJECT, '--branch', 'main'], { env, stdio: 'pipe' }) } = {}) {
  validateDeployEnvironment(env);
  if (!env.DEPLOY_IMAGE?.startsWith(`${env.GHCR_IMAGE}@sha256:`)) {
    throw new Error('Manjka preverjeni digest backend slike.');
  }
  await access(path.join(frontendDirectory, 'index.html'));

  async function request(base, token, route, method = 'GET', body) {
    const response = await fetchImpl(base + route, {
      method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(30000)
    });
    // Odgovori lahko vsebujejo skrivnosti. V napako vključimo le status in pot.
    if (!response.ok) throw new Error(`API ${method} ${route.split('?')[0]}: HTTP ${response.status}`);
    return response.status === 204 ? null : response.json();
  }
  const cf = (route, method, body) => request('https://api.cloudflare.com/client/v4',
    env.CLOUDFLARE_API_TOKEN, route, method, body);
  const render = (route, method, body) => request('https://api.render.com/v1', env.RENDER_API_KEY, route, method, body);

  const project = await cf(`/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/pages/projects/${env.CLOUDFLARE_PAGES_PROJECT}`);
  if (!project.success || project.result.source || project.result.production_branch !== 'main' ||
      !project.result.subdomain?.endsWith('.pages.dev')) {
    throw new Error('Cloudflare projekt mora biti Direct Upload s produkcijsko vejo main.');
  }
  const frontendUrl = `https://${project.result.subdomain}`;
  const envVars = [
    { key: 'NODE_ENV', value: 'production' }, { key: 'PORT', value: '10000' },
    { key: 'CORS_ORIGIN', value: frontendUrl }
  ];
  // Supabase ni potreben za gostujoči deploy. Brez njega prijava varno vrne 503.
  const services = await render(`/services?ownerId=${encodeURIComponent(env.RENDER_OWNER_ID)}&name=${encodeURIComponent(env.RENDER_SERVICE_NAME)}&limit=100`);
  let service = services.map(item => item.service).find(item => item.name === env.RENDER_SERVICE_NAME);
  let deployId;
  if (!service) {
    const credentials = await render(`/registrycredentials?ownerId=${encodeURIComponent(env.RENDER_OWNER_ID)}&limit=100`);
    let credential = credentials.map(item => item.registryCredential).find(item =>
      item.name === 'minigame-ghcr' && item.username === env.GHCR_USERNAME);
    if (!credential) {
      credential = await render('/registrycredentials', 'POST', {
        ownerId: env.RENDER_OWNER_ID, name: 'minigame-ghcr', registry: 'GITHUB',
        username: env.GHCR_USERNAME, authToken: env.GHCR_READ_TOKEN
      });
    }
    // Ustvarjanje storitve začne prvi deploy, zato se izvaja samo v tem gatesovanem jobu.
    const created = await render('/services', 'POST', {
      type: 'web_service', name: env.RENDER_SERVICE_NAME, ownerId: env.RENDER_OWNER_ID,
      autoDeployTrigger: 'off', envVars,
      image: { ownerId: env.RENDER_OWNER_ID, imagePath: env.DEPLOY_IMAGE, registryCredentialId: credential.id },
      serviceDetails: { runtime: 'image', plan: 'free', numInstances: 1,
        region: env.RENDER_REGION || 'frankfurt', healthCheckPath: '/api/health' }
    });
    service = created.service;
    deployId = created.deployId;
  } else {
    if (service.type !== 'web_service' || service.serviceDetails?.runtime !== 'image' ||
        service.serviceDetails?.plan !== 'free') {
      throw new Error('Obstoječa Render storitev mora uporabljati brezplačen image runtime.');
    }
    await render(`/services/${service.id}`, 'PATCH', { autoDeployTrigger: 'off' });
    for (const variable of envVars) {
      await render(`/services/${service.id}/env-vars/${variable.key}`, 'PUT', { value: variable.value });
    }
    const started = await render(`/services/${service.id}/deploys`, 'POST', { imageUrl: env.DEPLOY_IMAGE });
    deployId = started.id;
  }
  if (!service?.id || !deployId) throw new Error('Render ni vrnil identifikatorja storitve in deploya.');
  let live = false;
  for (let attempt = 0; attempt < 120; attempt++) {
    const current = await render(`/services/${service.id}/deploys/${deployId}`);
    if (current.status === 'live') { live = true; break; }
    if (['build_failed', 'update_failed', 'pre_deploy_failed', 'canceled', 'deactivated'].includes(current.status)) {
      throw new Error(`Render deploy ni uspel: ${current.status}`);
    }
    await wait(5000);
  }
  if (!live) throw new Error('Render deploy ni zaključen v dovoljenem času.');
  service = await render(`/services/${service.id}`);
  const backendUrl = service.serviceDetails?.url;
  if (!backendUrl?.startsWith('https://')) throw new Error('Render ni vrnil javnega HTTPS naslova.');
  const health = await fetchImpl(`${backendUrl}/api/health`, {
    headers: { Origin: frontendUrl }, signal: AbortSignal.timeout(60000)
  });
  if (!health.ok || (await health.json()).status !== 'ok' ||
      health.headers.get('access-control-allow-origin') !== frontendUrl) {
    throw new Error('Backend health check ali CORS povezava ni uspela.');
  }

  // Samo zapis javne runtime konfiguracije; JavaScript aplikacije se ne gradi ponovno.
  env.VITE_API_BASE_URL = `${backendUrl}/api`;
  await writeFile(path.join(frontendDirectory, 'runtime-config.js'),
    `window.__MINIGAME_CONFIG__ = ${JSON.stringify({ apiBaseUrl: env.VITE_API_BASE_URL })};\n`);
  // Konfiguracije ne predpomnimo, da po deployu ne ostane naslov starega backenda.
  await writeFile(path.join(frontendDirectory, '_headers'), '/runtime-config.js\n  Cache-Control: no-store\n');
  try { publishFrontend(frontendDirectory); }
  catch { throw new Error('Cloudflare Pages upload ni uspel. Preveri produkcijske dostope.'); }
  let frontendReady = false;
  for (let attempt = 0; attempt < 12; attempt++) {
    const response = await fetchImpl(`${frontendUrl}/runtime-config.js?v=${env.GITHUB_SHA}`, {
      signal: AbortSignal.timeout(30000)
    });
    if (response.ok && (await response.text()).includes(backendUrl)) { frontendReady = true; break; }
    await wait(5000);
  }
  if (!frontendReady) throw new Error('Javna frontend API konfiguracija ni dosegljiva ali je zastarela.');
  const page = await fetchImpl(frontendUrl, { signal: AbortSignal.timeout(30000) });
  if (!page.ok) throw new Error('Frontend ni javno dosegljiv.');
  return { frontendUrl, backendUrl, serviceId: service.id };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    validateDeployEnvironment(process.env);
    if (process.argv.includes('--check')) {
      console.log('Obvezne production nastavitve so prisotne.');
    } else {
      const result = await deploy();
      console.log(`Frontend: ${result.frontendUrl}\nBackend: ${result.backendUrl}\nRender: ${result.serviceId}`);
      if (process.env.GITHUB_STEP_SUMMARY) {
        await appendFile(process.env.GITHUB_STEP_SUMMARY,
          `Frontend: ${result.frontendUrl}\n\nBackend: ${result.backendUrl}\n\nRender: ${result.serviceId}\n`);
      }
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Deploy ni uspel.');
    process.exitCode = 1;
  }
}
