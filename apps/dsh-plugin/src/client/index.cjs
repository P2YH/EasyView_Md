const { createElement, useEffect, useState, useRef } = require('react');

/** Public workbench Factory; the Office platform owns its navigation entry. */
function Workbench({ apiVersion = 1, presentation = 'standalone', hostTheme, workspaceId, openIntentId, onReady, openHostFolder }) {
  const [state, setState] = useState(null);
  const [error, setError] = useState('');
  const [workbenchId] = useState(() => {
    const key = `easyview:workbench:${presentation}`;
    let id = sessionStorage.getItem(key);
    if (!id || !/^[a-f0-9-]{36}$/.test(id)) { id = crypto.randomUUID(); sessionStorage.setItem(key, id); }
    return id;
  });
  const [channel] = useState(() => crypto.randomUUID());
  const frameRef = useRef(null);
  const readyCallback = useRef(onReady); readyCallback.current = onReady;
  useEffect(() => {
    const frameWindow = frameRef.current?.contentWindow;
    if (!frameWindow) return;
    const pending = new Map();
    let alive = true, folderBusy = false;
    const send = (command, argument) => new Promise((resolve, reject) => {
      const requestId = crypto.randomUUID();
      const timer = setTimeout(() => { pending.delete(requestId); reject(new Error('文档工作台响应超时')); }, 60_000);
      pending.set(requestId, { resolve, reject, timer });
      frameWindow.postMessage({ protocol: 'easyview.workbench.v1', channel, workbenchId, command, requestId, argument }, window.location.origin);
    });
    const receive = event => {
      const value = event.data;
      if (event.origin !== window.location.origin || event.source !== frameWindow || !value || value.protocol !== 'easyview.workbench.v1'
        || value.channel !== channel || value.workbenchId !== workbenchId) return;
      if (value.type === 'host-request' && value.command === 'openFolder'
        && typeof value.requestId === 'string' && /^[a-f0-9-]{36}$/.test(value.requestId)) {
        if (folderBusy) return;
        folderBusy = true;
        const reply = result => { if (alive) frameWindow.postMessage({ protocol: 'easyview.workbench.v1', channel, workbenchId,
          type: 'host-result', requestId: value.requestId, ...result }, window.location.origin); };
        Promise.resolve().then(() => openHostFolder()).then(id => reply({ ok: true, value: id }), () => reply({ ok: false }))
          .finally(() => { folderBusy = false; });
      } else if (value.type === 'ready') {
        readyCallback.current?.({ openDocument: path => send('openDocument', path), flush: () => send('flush'), requestClose: () => send('requestClose'),
          suspend: () => send('suspend'), resume: () => send('resume'), dispose: () => send('dispose') });
      } else if (value.type === 'result') {
        const request = pending.get(value.requestId); if (!request) return;
        pending.delete(value.requestId); clearTimeout(request.timer);
        if (value.ok) request.resolve(value.value); else request.reject(new Error(value.error || '文档工作台操作失败'));
      }
    };
    window.addEventListener('message', receive);
    return () => {
      alive = false;
      window.removeEventListener('message', receive);
      frameWindow.postMessage({ protocol: 'easyview.workbench.v1', channel, workbenchId, command: 'dispose', requestId: crypto.randomUUID() }, window.location.origin);
      for (const request of pending.values()) { clearTimeout(request.timer); request.reject(new Error('文档工作台已卸载')); }
      pending.clear();
    };
  }, [state?.frameUrl, channel, workbenchId]);
  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/easyview/v1/bootstrap', { credentials: 'same-origin', signal: controller.signal })
      .then(async response => { if (!response.ok) throw new Error(`EasyView Host HTTP ${response.status}`); return response.json(); })
      .then(value => {
        if (value.apiVersion !== apiVersion) throw new Error('EasyView 协议版本不兼容');
        setState(value);
      })
      .catch(failure => { if (!controller.signal.aborted) setError(failure.message); });
    return () => controller.abort();
  }, [apiVersion]);
  if (error || !state?.frameUrl) return createElement('div', { role: 'status', style: { padding: 24 } },
    error || (state ? 'EasyView 原工作台尚未构建完成。当前开发包仅提供宿主注册与兼容探测。' : '正在连接文档工作台…'));
  const url = new URL(state.frameUrl, window.location.origin);
  if (workspaceId) url.searchParams.set('workspaceId', workspaceId);
  if (openIntentId) url.searchParams.set('openIntentId', openIntentId);
  url.searchParams.set('presentation', presentation);
  if (hostTheme === 'office') url.searchParams.set('hostTheme', 'office');
  url.searchParams.set('workbenchId', workbenchId);
  url.searchParams.set('channel', channel);
  return createElement('iframe', { ref: frameRef, title: 'EasyView 文档工作台', src: url.href,
    style: { width: '100%', height: '100%', border: 0 }, sandbox: 'allow-scripts allow-same-origin allow-downloads allow-modals' });
}

module.exports = {
  inject: ['slots'],
  apply(ctx) {
    const openHostFolder = async () => {
      const workspaces = ctx.get('workspaces');
      if (typeof workspaces?.create !== 'function') throw new Error('DSH 工作区服务不可用。');
      // Same public desktop chooser and Workspace service used by DSH's own sidebar.
      const desktop = globalThis.__DSH_DIRECTORY_PICKER__;
      const ui = ctx.get('uiWorkspace');
      const path = typeof desktop?.pick === 'function' ? await desktop.pick()
        : typeof ui?.pickDirectory === 'function' ? await ui.pickDirectory() : undefined;
      if (path === null) return null;
      if (typeof path !== 'string' || !path) throw new Error('DSH 目录选择器不可用。');
      const workspace = await workspaces.create({ path });
      return String(workspace.workspaceId);
    };
    ctx.slots.registerFactory({ name: 'easyview.workbench', scope: 'root' }, props => createElement(Workbench, { ...props, openHostFolder }));
  },
};
