import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Context } from './runtime.mjs';
import { apply, UPSTREAM_SHA } from '../src/index.ts';


test('real Cordis mounts the independent Host and disposes the exact route', async () => {
  const ctx = new Context();
  const routes = new Map();
  const errors = [];
  ctx.logger.exporter({ export(message) { if (message.type === 'error') errors.push(message.args.map(String).join(' ')); } });
  const dependencies = ctx.plugin(child => {
    child.provide('connection', { fetch: { register(route) {
      assert.ok(!routes.has(route.path));
      routes.set(route.path, route);
      return async () => { routes.delete(route.path); };
    } } });
    child.provide('workspaceRegistry', { list: () => [{ id: 'w1', title: 'Sample', path: 'C:/private/not-exposed' }] });
    child.provide('sessionController', { selectSessionModel() {} });
  });
  await dependencies.await();
  const plugin = ctx.plugin({ name: 'easyview', inject: ['connection'], apply });
  try {
    await plugin.await();
    await new Promise(resolve => setImmediate(resolve));
    const route = routes.get('/api/easyview/v1/bootstrap');
    assert.ok(route, errors.join('\n'));
    assert.deepEqual(route.methods, ['GET']);
    const response = await route.fetch(new Request('http://localhost/api/easyview/v1/bootstrap'));
    const body = await response.json();
    assert.equal(body.apiVersion, 1);
    assert.equal(body.upstreamSha, UPSTREAM_SHA);
    assert.equal(body.capabilities.save, false);
    assert.equal(body.capabilities.ai, false);
    assert.equal(body.capabilities.sessionModelSelection, true);
    assert.deepEqual(body.workspaces, [{ id: 'w1', title: 'Sample' }]);
    assert.equal(ctx.get('easyview').bootstrap().apiVersion, 1);
    assert.deepEqual(errors, []);
  } finally {
    await plugin.dispose();
    assert.equal(routes.size, 0);
    assert.equal(ctx.get('easyview'), undefined);
    await dependencies.dispose();
  }
});

test('an older target never pretends that global selectModel is session-local', async () => {
  const ctx = new Context();
  const routes = new Map();
  let globalSelections = 0;
  const dependencies = ctx.plugin(child => {
    child.provide('connection', { fetch: { register(route) { routes.set(route.path, route); return async () => routes.delete(route.path); } } });
    child.provide('sessionController', { selectModel() { globalSelections++; } });
  });
  await dependencies.await();
  const plugin = ctx.plugin({ name: 'easyview', inject: ['connection'], apply });
  try {
    await plugin.await();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(ctx.get('easyview').bootstrap().capabilities.sessionModelSelection, false);
    assert.equal(globalSelections, 0);
  } finally { await plugin.dispose(); await dependencies.dispose(); }
});
