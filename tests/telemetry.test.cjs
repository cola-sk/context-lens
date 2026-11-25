const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const { webcrypto } = require('node:crypto');

test('anonymous events are queued, retried and reuse the installation ID', async () => {
  const data = {};
  const requests = [];
  let online = false;
  const context = vm.createContext({
    crypto: webcrypto, Date, AbortSignal,
    chrome: {
      runtime: { onStartup: { addListener() {} } },
      storage: { local: {
        async get(keys) { return Object.fromEntries((Array.isArray(keys) ? keys : [keys]).filter(k => k in data).map(k => [k, data[k]])); },
        async set(values) { Object.assign(data, structuredClone(values)); }
      } }
    },
    fetch: async (_url, options) => {
      requests.push(JSON.parse(options.body));
      return { ok: online };
    }
  });
  vm.runInContext(fs.readFileSync('telemetry.js', 'utf8'), context);
  await vm.runInContext('recordTelemetry("install")', context);
  assert.equal(data.telemetryQueue.length, 1);
  online = true;
  await vm.runInContext('recordTelemetry("chat_send")', context);
  assert.equal(data.telemetryQueue.length, 0);
  assert.equal(requests.length, 3);
  assert.equal(requests[0].eventId, requests[1].eventId);
  assert.equal(requests[0].anonymousId, requests[2].anonymousId);
  assert.deepEqual(Object.keys(requests[2]).sort(), ['anonymousId', 'eventId', 'eventType', 'occurredAt']);
});
