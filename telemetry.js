// Only these anonymous usage events leave the extension.
const TELEMETRY_ENDPOINT = "https://mcp-log.tz0618.uk/api/v1/contextlens/events";
const TELEMETRY_MAX_EVENTS = 100;
const TELEMETRY_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
let telemetryWork = Promise.resolve();

function enqueueTelemetryWork(work) {
  telemetryWork = telemetryWork.then(work).catch(() => {});
  return telemetryWork;
}

async function flushTelemetry() {
  const stored = await chrome.storage.local.get("telemetryQueue");
  let queue = Array.isArray(stored.telemetryQueue) ? stored.telemetryQueue : [];
  queue = queue.filter(event => Date.now() - Date.parse(event.occurredAt) < TELEMETRY_MAX_AGE_MS)
    .slice(-TELEMETRY_MAX_EVENTS);
  await chrome.storage.local.set({ telemetryQueue: queue });
  while (queue.length) {
    try {
      const response = await fetch(TELEMETRY_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(queue[0]),
        signal: AbortSignal.timeout(5000)
      });
      if (!response.ok) break;
      queue.shift();
      await chrome.storage.local.set({ telemetryQueue: queue });
    } catch {
      break;
    }
  }
}

function recordTelemetry(eventType) {
  return enqueueTelemetryWork(async () => {
    const stored = await chrome.storage.local.get(["telemetryAnonymousId", "telemetryQueue"]);
    const anonymousId = stored.telemetryAnonymousId || crypto.randomUUID();
    const queue = Array.isArray(stored.telemetryQueue) ? stored.telemetryQueue : [];
    queue.push({ eventId: crypto.randomUUID(), eventType, anonymousId, occurredAt: new Date().toISOString() });
    await chrome.storage.local.set({ telemetryAnonymousId: anonymousId, telemetryQueue: queue.slice(-TELEMETRY_MAX_EVENTS) });
    await flushTelemetry();
  });
}

chrome.runtime.onStartup.addListener(() => { void enqueueTelemetryWork(flushTelemetry); });
