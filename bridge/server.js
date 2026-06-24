const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { detectCliAgents, runCliAgent } = require('@sking7/agent-cli-unified');

const PORT = 3100;

function detectLocalAgents() {
  const agents = detectCliAgents();
  const idMap = {
    'claude': 'claude-agent',
    'codex': 'codex-agent',
    'antigravity': 'antigravity-agent',
    'copilot': 'copilot-agent'
  };
  const seen = new Set();
  return agents
    .filter(a => idMap[a.id])
    .map(a => ({
      id: idMap[a.id],
      label: a.label,
      subLabel: a.subLabel,
      type: a.type,
      available: a.available,
      executablePath: a.executablePath,
      version: a.version || 'unknown'
    }))
    .filter(a => {
      if (seen.has(a.id)) return false;
      seen.add(a.id);
      return true;
    });
}

// Cache: detect agents once at startup in background (non-blocking)
let cachedAgents = null;
let agentDetectionReady = false;

function warmupAgentDetection() {
  // Run detection in a setImmediate to not block server startup
  setImmediate(() => {
    try {
      console.log('[ContextLens Bridge] Detecting local agents in background...');
      cachedAgents = detectLocalAgents();
      agentDetectionReady = true;
      const available = cachedAgents.filter(a => a.available).map(a => a.label);
      console.log(`[ContextLens Bridge] Detected: ${available.length > 0 ? available.join(', ') : 'none'}`);
    } catch (e) {
      cachedAgents = [];
      agentDetectionReady = true;
      console.warn('[ContextLens Bridge] Agent detection failed:', e.message);
    }
  });
}

const server = http.createServer((req, res) => {
  // Add CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // Parse URL to handle trailing slashes and potential host inclusion
  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = parsedUrl.pathname.replace(/\/+$/, '') || '/';

  console.log(`[ContextLens Bridge] ${req.method} ${req.url} -> matched path: ${pathname}`);

  // Handle preflight OPTIONS request
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // Root endpoint for status check
  if (req.method === 'GET' && (pathname === '/' || pathname === '')) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'running', service: 'ContextLens Bridge' }));
    return;
  }

  // API Route: Chat with Local Claude Agent
  if (req.method === 'POST' && pathname === '/api/chat') {
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
    });

    req.on('end', () => {
      try {
        const { prompt, cwd, commandPath, claudePath, agentId, attachments } = JSON.parse(body);

        if (!prompt) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Prompt is required' }));
          return;
        }

        // Set up SSE headers
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive'
        });

        let agentType = 'claude-code';
        if (agentId === 'codex-agent') {
          agentType = 'codex';
        } else if (agentId === 'antigravity-agent') {
          agentType = 'antigravity';
        } else if (agentId === 'copilot-agent') {
          agentType = 'copilot';
        }

        const resolvedCommandPath =
          (typeof commandPath === 'string' && commandPath.trim()) ||
          (typeof claudePath === 'string' && claudePath.trim()) ||
          undefined;

        let finished = false;
        const toolMap = new Map();

        const sendSystemLog = (text) => {
          if (finished) return;
          res.write(`data: ${JSON.stringify({ text, type: 'system' })}\n\n`);
        };

        const sendText = (text) => {
          if (finished) return;
          if (!text) return;
          res.write(`data: ${JSON.stringify({ text, type: 'text' })}\n\n`);
        };

        const antigravitySystemPrompt = [
          'You are running inside ContextLens as a local coding assistant.',
          'The prompt contains the user request and, when available, the local workspace path.',
          'If the request asks for code or project changes, inspect and edit the workspace files directly.',
          'Do not replace implementation work with general research or an explanation of CLI flags.',
          'After acting, report what changed, what files were touched, and any verification results.'
        ].join('\n');

        runCliAgent({
          agent: agentType,
          prompt,
          systemPrompt: agentType === 'antigravity' ? antigravitySystemPrompt : undefined,
          cwd,
          commandPath: resolvedCommandPath,
          attachments,
          onEvent: (event) => {
            if (finished) return;
            if (event.type === 'text') {
              sendText(event.text);
            } else if (event.type === 'thinking') {
              sendSystemLog(`💭 Thinking Process:\n${event.text}\n\n`);
            } else if (event.type === 'tool_use') {
              if (event.toolUseId) {
                const toolNameOrCmd = event.name === 'command_execution' ? (event.input.command || event.name) : event.name;
                toolMap.set(event.toolUseId, toolNameOrCmd);
              }
              const inputStr = typeof event.input === 'object'
                ? JSON.stringify(event.input, null, 2)
                : String(event.input);
              sendSystemLog(`🔧 Tool Call: ${event.name}\nParameters:\n${inputStr}\n\n`);
            } else if (event.type === 'tool_result') {
              const isError = event.isError;
              const statusIcon = isError ? '❌' : '➡️';
              const statusText = isError ? 'Tool Failed' : 'Tool Result';
              let displayContent = event.content || '';
              if (typeof displayContent === 'object') displayContent = JSON.stringify(displayContent);

              const toolName = event.toolUseId ? toolMap.get(event.toolUseId) : '';
              let toolDesc = '';
              if (toolName) {
                toolDesc = toolName.includes(' ') ? `[Command: ${toolName}]\n` : `[Tool: ${toolName}]\n`;
              }

              if (typeof displayContent === 'string' && displayContent.length > 500) {
                displayContent = displayContent.substring(0, 500) + '\n... [Truncated, total ' + displayContent.length + ' chars]';
              }
              sendSystemLog(`${statusIcon} ${statusText}:\n${toolDesc}${displayContent}\n\n`);
            } else if (event.type === 'system') {
              sendSystemLog(event.text);
            } else if (event.type === 'error') {
              sendSystemLog(`❌ Error: ${event.text}\n`);
            } else if (event.type === 'json') {
              const json = event.payload || {};
              const role = String(json.role || json.author || '').toLowerCase();
              const isAssistantRole = role === 'assistant' || role === 'model' || role === 'ai';
              if (isAssistantRole) {
                const text = json.content || json.value || json.text || json.message || '';
                if (text && typeof text === 'string') sendText(text);
              }
            }
          },
          onStderr: (line) => {
            if (finished) return;
            const trimmed = line.trim();
            if (!trimmed) return;
            if (trimmed.includes('Warning: no stdin data received')) return;

            if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
              try {
                JSON.parse(trimmed);
                return; // JSON lines on stderr are handled by parseAgentEvent -> onEvent
              } catch (e) {}
            }
            sendSystemLog(line + '\n');
          }
        }).then((result) => {
          if (finished) return;
          finished = true;
          console.log(`🤖 [ContextLens Bridge] Agent exited with code: ${result.exitCode}`);
          res.write(`data: [DONE]\n\n`);
          res.end();
        }).catch((err) => {
          if (finished) return;
          finished = true;
          console.error('🤖 [ContextLens Bridge] Runtime error:', err);
          res.write(`data: ${JSON.stringify({ text: `\n⚠️ Runtime error: ${err.message}\n`, type: 'error' })}\n\n`);
          res.write(`data: [DONE]\n\n`);
          res.end();
        });

      } catch (err) {
        console.error('🤖 [ContextLens Bridge] Request error:', err);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // Health check endpoint
  if (req.method === 'GET' && pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', service: 'ContextLens Bridge', version: '1.1.0' }));
    return;
  }

  // Local Agent Discovery endpoint
  if (req.method === 'GET' && pathname === '/api/agents') {
    // Return cached results if ready; if not yet ready, run synchronously as fallback
    const agents = agentDetectionReady ? cachedAgents : detectLocalAgents();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ agents: agents || [], bridgeVersion: '1.1.0' }));
    return;
  }

  // Fallback 404
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not Found' }));
});

server.listen(PORT, () => {
  console.log(`🚀 [Claude Bridge] Server listening on http://localhost:${PORT}`);
  // Start agent detection in background immediately after server starts
  warmupAgentDetection();
});
