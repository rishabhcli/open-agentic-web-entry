// Worker half of the coded-tool sandbox. Classic worker script (not a module).
// 1) keep one reference to postMessage, 2) remove network/storage globals, 3) load the verified bundle.
(function () {
  const post = self.postMessage.bind(self);
  let tools = null;
  const BLOCK = ['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'WebTransport', 'indexedDB', 'caches', 'BroadcastChannel', 'SharedWorker', 'Worker', 'RTCPeerConnection', 'localStorage', 'sessionStorage'];
  const load = self.importScripts.bind(self);
  self.onmessage = (ev) => {
    const m = ev.data;
    if (m.type === 'init') {
      try {
        for (const k of BLOCK) { try { Object.defineProperty(self, k, { value: undefined, configurable: false, writable: false }); } catch (_) { /* ignore */ } }
        try { Object.defineProperty(self.navigator, 'sendBeacon', { value: undefined }); } catch (_) { /* ignore */ }
        const url = URL.createObjectURL(new Blob([m.code], { type: 'text/javascript' }));
        load(url);
        URL.revokeObjectURL(url);
        try { Object.defineProperty(self, 'importScripts', { value: undefined, configurable: false, writable: false }); } catch (_) { /* ignore */ }
        if (!self.agenticTools || typeof self.agenticTools.tools !== 'object') throw new Error('bundle did not define agenticTools');
        tools = self.agenticTools;
        post({ type: 'ready', schemas: tools.schemas || {} });
      } catch (e) { post({ type: 'init-error', message: String(e && e.message || e) }); }
    } else if (m.type === 'call') {
      try {
        const fn = tools && tools.tools[m.name];
        if (typeof fn !== 'function') throw new Error(`no tool "${m.name}"`);
        Promise.resolve(fn(m.args, m.ctx)).then((value) => post({ type: 'result', id: m.id, value }), (e) => post({ type: 'result', id: m.id, error: String(e && e.message || e) }));
      } catch (e) { post({ type: 'result', id: m.id, error: String(e && e.message || e) }); }
    }
  };
})();
