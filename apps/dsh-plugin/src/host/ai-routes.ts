import { DocumentError } from './documents';
import type { DshAiAdapter } from './ai-adapter';
import type { EasyViewHostContext } from '../shared/contracts';
import { readBounded } from './draft-routes';
type Route = Parameters<EasyViewHostContext['connection']['fetch']['register']>[0];
export function installAiRoutes(register: (route: Route) => void, ai: DshAiAdapter) {
  for (const action of ['state', 'send', 'cancel', 'ack', 'models', 'clear', 'office-decision'] as const) register({
    path: `/api/easyview/v1/ai-${action}`, methods: ['POST'], requestBody: 'streaming',
    fetch: async request => {
      try {
        const body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await readBounded(request, 512 * 1024)));
        if (!body || typeof body !== 'object' || !body.address || typeof body.address !== 'object') throw new DocumentError('INVALID_ARGUMENT', '无效的 AI 请求。');
        const value = action === 'models' ? await ai.models() : action === 'state' ? await ai.state(body.address)
          : action === 'send' ? await ai.send(body.address, body.input) : action === 'office-decision' ? await ai.decideOffice(body.address, body.input) : action === 'clear' ? await ai.clear(body.address, body.requestId) : action === 'cancel' ? await ai.cancel(body.address, body.requestId)
            : await ai.acknowledge(body.address, body.requestId, body.operationId, body.error);
        return Response.json({ ok: true, value: value ?? null }, { headers: { 'cache-control': 'no-store' } });
      } catch (error) {
        return Response.json({ ok: false, code: error instanceof DocumentError ? error.code : 'DEPENDENCY_MISSING',
          message: error instanceof DocumentError ? error.message : 'DSH AI 会话或模型不可用，请检查 DSH 配置。' },
        { status: error instanceof DocumentError && error.code === 'PERMISSION_DENIED' ? 403 : 409, headers: { 'cache-control': 'no-store' } });
      }
    },
  });
}
