const http = require('http');
const { spawn, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PORT = 3100;

function findClaudeExecutable() {
  // 1. Try running which command to find it in the environment path
  try {
    const whichPath = execSync('which claude', { encoding: 'utf8', stdio: [] }).trim();
    if (whichPath && fs.existsSync(whichPath)) {
      return whichPath;
    }
  } catch (e) {}

  // 2. Search typical paths
  const home = os.homedir();
  const candidates = [
    path.join(home, '.local/bin/claude'),
    path.join(home, '.npm-global/bin/claude'),
    '/usr/local/bin/claude',
    '/opt/homebrew/bin/claude',
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  // 3. Fallback to just "claude", hoping it's in process PATH
  return null;
}

function findExecutable(name) {
  try {
    const whichPath = execSync(`which ${name}`, { encoding: 'utf8', stdio: [] }).trim();
    if (whichPath && fs.existsSync(whichPath)) {
      return whichPath;
    }
  } catch (e) {}

  const home = os.homedir();
  const candidates = [
    path.join(home, `.local/bin/${name}`),
    path.join(home, `.npm-global/bin/${name}`),
    `/usr/local/bin/${name}`,
    `/opt/homebrew/bin/${name}`,
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

function getExecutableVersion(execPath, versionFlag = '--version') {
  try {
    const out = execSync(`"${execPath}" ${versionFlag}`, { encoding: 'utf8', timeout: 3000, stdio: [] }).trim();
    // Extract first line that looks like a version number
    const match = out.match(/[\d]+\.[\d]+\.?[\d]*/);
    return match ? match[0] : out.split('\n')[0].trim();
  } catch (e) {
    return null;
  }
}

function detectLocalAgents() {
  const results = [];

  // 1. Claude Code CLI (Anthropic)
  const claudePath = findExecutable('claude') || findClaudeExecutable();
  if (claudePath) {
    const version = getExecutableVersion(claudePath);
    results.push({
      id: 'claude-agent',
      label: 'Claude Code',
      subLabel: 'Anthropic CLI Agent',
      type: 'local',
      available: true,
      executablePath: claudePath,
      version: version || 'unknown'
    });
  } else {
    results.push({ id: 'claude-agent', label: 'Claude Code', subLabel: 'Anthropic CLI Agent', type: 'local', available: false, executablePath: null, version: null });
  }

  // 2. OpenAI Codex CLI
  const codexPath = findExecutable('codex');
  if (codexPath) {
    const version = getExecutableVersion(codexPath);
    results.push({
      id: 'codex-agent',
      label: 'Codex CLI',
      subLabel: 'OpenAI CLI Agent',
      type: 'local',
      available: true,
      executablePath: codexPath,
      version: version || 'unknown'
    });
  } else {
    results.push({ id: 'codex-agent', label: 'Codex CLI', subLabel: 'OpenAI CLI Agent', type: 'local', available: false, executablePath: null, version: null });
  }

  // 3. Gemini CLI (google-gemini-cli)
  const geminiPath = findExecutable('gemini');
  if (geminiPath) {
    const version = getExecutableVersion(geminiPath);
    results.push({
      id: 'gemini-agent',
      label: 'Gemini CLI',
      subLabel: 'Google CLI Agent',
      type: 'local',
      available: true,
      executablePath: geminiPath,
      version: version || 'unknown'
    });
  } else {
    results.push({ id: 'gemini-agent', label: 'Gemini CLI', subLabel: 'Google CLI Agent', type: 'local', available: false, executablePath: null, version: null });
  }

  return results;
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



class LineBuffer {
  constructor(onLine) {
    this.buffer = '';
    this.onLine = onLine;
  }

  append(chunk) {
    this.buffer += chunk;
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop();
    for (const line of lines) {
      this.onLine(line);
    }
  }

  flush() {
    if (this.buffer) {
      this.onLine(this.buffer);
      this.buffer = '';
    }
  }
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
        const { prompt, cwd, claudePath, agentId } = JSON.parse(body);

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

        let executablePath = claudePath;
        let agentName = "Claude Code";
        if (!executablePath) {
          if (agentId === 'codex-agent') {
            executablePath = findExecutable('codex');
            agentName = "Codex CLI";
          } else if (agentId === 'gemini-agent') {
            executablePath = findExecutable('gemini');
            agentName = "Gemini CLI";
          } else {
            executablePath = findClaudeExecutable();
            agentName = "Claude Code CLI";
          }
        } else {
           if (agentId === 'codex-agent') agentName = "Codex CLI";
           else if (agentId === 'gemini-agent') agentName = "Gemini CLI";
        }
        
        const runCwd = (typeof cwd === 'string' && cwd.trim()) ? cwd.trim() : os.homedir();
        console.log(`🤖 [ContextLens Bridge] Spawning ${agentName} in CWD: ${runCwd}`);
        console.log(`🤖 [ContextLens Bridge] Executable: ${executablePath}`);

        // Build args based on agent type — each CLI has its own interface
        let spawnArgs;
        if (agentId === 'codex-agent') {
          // Codex CLI: codex exec --json --dangerously-bypass-approvals-and-sandbox -C <dir> <prompt>
          spawnArgs = [
            'exec',
            '--json',
            '--dangerously-bypass-approvals-and-sandbox',
            '-C', runCwd,
            prompt
          ];
        } else if (agentId === 'gemini-agent') {
          // Gemini CLI: gemini --output-format=stream-json --yolo <prompt>
          spawnArgs = [
            '--output-format', 'stream-json',
            '--yolo',
            prompt
          ];
        } else {
          // Claude Code CLI
          spawnArgs = [
            '-p', prompt,
            '--print',
            '--output-format=stream-json',
            '--include-hook-events',
            '--dangerously-skip-permissions',
            '--verbose'
          ];
        }

        // Spawn child process with stdin redirected via pipe to ensure clean immediate EOF closure
        const child = spawn(
          executablePath,
          spawnArgs,
          {
            cwd: runCwd,
            stdio: ['pipe', 'pipe', 'pipe'],
            env: {
              ...process.env,
              FORCE_COLOR: '0',
              TERM: 'dumb' // disable ANSI escape colors/interactive characters
            }
          }
        );

        if (child.stdin) {
          child.stdin.end();
        }

        // Track process exit to avoid multiple response writes
        let finished = false;
        let hasStreamedAssistantText = false;

        const sendSystemLog = (text) => {
          if (finished) return;
          res.write(`data: ${JSON.stringify({ text, type: 'system' })}\n\n`);
        };

        const sendText = (text) => {
          if (finished) return;
          if (typeof text === 'string' && text.length > 0) {
            hasStreamedAssistantText = true;
          }
          res.write(`data: ${JSON.stringify({ text, type: 'text' })}\n\n`);
        };

        const processCodexStdoutLine = (line) => {
          const trimmed = line.trim();
          if (!trimmed) return;

          if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
            try {
              const json = JSON.parse(trimmed);

              // Codex JSONL event types
              const type = json.type || '';

              // Codex item-based events
              if (type === 'item.started' && json.item) {
                const item = json.item;
                if (item.type === 'command_execution') {
                  sendSystemLog(`🔧 执行命令: ${item.command || ''}\n\n`);
                  return;
                }
                if (item.type === 'reasoning' || item.type === 'agent_thinking' || item.type === 'thinking') {
                  const text = item.text || item.content || item.value || '';
                  if (text) sendSystemLog(`💭 思考过程:\n${text}\n\n`);
                  return;
                }
              }

              if (type === 'item.completed' && json.item) {
                const item = json.item;
                if (item.type === 'agent_message') {
                  const text = item.text || item.content || item.value || '';
                  if (text) sendText(text);
                  return;
                }
                if (item.type === 'command_execution') {
                  const exitCode = item.exit_code;
                  const isError = exitCode !== null && exitCode !== 0;
                  const statusIcon = isError ? '❌' : '➡️';
                  const statusText = isError ? `命令执行失败 (退出码: ${exitCode})` : '命令执行成功';
                  let displayContent = item.aggregated_output || '';
                  if (typeof displayContent === 'string' && displayContent.length > 800) {
                    displayContent = displayContent.substring(0, 800) + '\n... [已截断，共 ' + displayContent.length + ' 字符]';
                  }
                  sendSystemLog(`${statusIcon} ${statusText}:\n${displayContent}\n`);
                  return;
                }
                if (item.type === 'reasoning' || item.type === 'agent_thinking' || item.type === 'thinking') {
                  const text = item.text || item.content || item.value || '';
                  if (text) sendSystemLog(`💭 思考过程:\n${text}\n\n`);
                  return;
                }
              }

              if (type === 'thread.started') {
                sendSystemLog(`⚙️ [初始化] 本地 Codex CLI 会话已启动\n`);
                return;
              }

              if (type === 'task_started' || type === 'session_started') {
                sendSystemLog(`⚙️ [初始化] 本地 ${agentName} 工作目录: ${json.cwd || cwd || '默认'}\n`);
                return;
              }
              if (type === 'agent_reasoning' || type === 'reasoning') {
                const text = json.content || json.value || json.text || '';
                if (text) sendSystemLog(`💭 思考过程:\n${text}\n\n`);
                return;
              }
              if (type === 'agent_message' || type === 'message') {
                const text = json.content || json.value || json.text || '';
                if (text) sendText(text);
                return;
              }
              if (type === 'tool_call' || type === 'function_call') {
                const toolName = json.name || json.function || '';
                const toolInput = json.input || json.arguments || {};
                const inputStr = typeof toolInput === 'object'
                  ? JSON.stringify(toolInput, null, 2)
                  : String(toolInput);
                sendSystemLog(`🔧 调用工具: ${toolName}\n参数:\n${inputStr}\n\n`);
                return;
              }
              if (type === 'tool_result' || type === 'function_result') {
                const isError = json.is_error || json.error || false;
                const statusIcon = isError ? '❌' : '➡️';
                const statusText = isError ? '工具执行失败' : '工具执行结果';
                let displayContent = json.output || json.content || json.value || '';
                if (typeof displayContent === 'string' && displayContent.length > 500) {
                  displayContent = displayContent.substring(0, 500) + '\n... [已截断，共 ' + displayContent.length + ' 字符]';
                }
                sendSystemLog(`${statusIcon} ${statusText}:\n${displayContent}\n\n`);
                return;
              }
              if (type === 'task_complete' || type === 'session_complete') {
                const text = json.output || json.content || json.value || '';
                if (text) sendText(text);
                return;
              }
              if (type === 'error') {
                const msg = json.message || json.value || json.content || String(json);
                sendSystemLog(`❌ 错误: ${msg}\n`);
                return;
              }

              // Generic fallback: only surface assistant/model-authored text
              const role = String(json.role || json.author || '').toLowerCase();
              const isAssistantRole = role === 'assistant' || role === 'model' || role === 'ai';
              if (isAssistantRole) {
                const text = json.content || json.value || json.text || json.message || '';
                if (text && typeof text === 'string') sendText(text);
              }
              return;
            } catch (err) {
              // JSON parse error, treat as raw text
            }
          }

          sendText(line + '\n');
        };

        const processGeminiStdoutLine = (line) => {
          const trimmed = line.trim();
          if (!trimmed) return;

          if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
            try {
              const json = JSON.parse(trimmed);
              const type = json.type || '';

              // Gemini stream-json event types
              if (type === 'content' || type === 'text') {
                const text = json.value || json.text || json.content || '';
                if (text) sendText(text);
                return;
              }
              if (type === 'tool_call' || type === 'functionCall') {
                const toolName = json.name || json.function || (json.functionCall && json.functionCall.name) || '';
                const toolInput = json.input || json.args || (json.functionCall && json.functionCall.args) || {};
                const inputStr = typeof toolInput === 'object'
                  ? JSON.stringify(toolInput, null, 2)
                  : String(toolInput);
                sendSystemLog(`🔧 调用工具: ${toolName}\n参数:\n${inputStr}\n\n`);
                return;
              }
              if (type === 'tool_result' || type === 'functionResponse') {
                const isError = json.is_error || json.error || false;
                const statusIcon = isError ? '❌' : '➡️';
                const statusText = isError ? '工具执行失败' : '工具执行结果';
                let displayContent = json.output || json.content || json.value ||
                  (json.functionResponse && json.functionResponse.response) || '';
                if (typeof displayContent === 'object') displayContent = JSON.stringify(displayContent);
                if (typeof displayContent === 'string' && displayContent.length > 500) {
                  displayContent = displayContent.substring(0, 500) + '\n... [已截断，共 ' + displayContent.length + ' 字符]';
                }
                sendSystemLog(`${statusIcon} ${statusText}:\n${displayContent}\n\n`);
                return;
              }
              if (type === 'error') {
                const msg = json.message || json.value || json.content || String(json);
                sendSystemLog(`❌ 错误: ${msg}\n`);
                return;
              }

              // Generic fallback: only surface assistant/model-authored text
              const role = String(json.role || json.author || '').toLowerCase();
              const isAssistantRole = role === 'assistant' || role === 'model' || role === 'ai';
              if (isAssistantRole) {
                const text = json.content || json.value || json.text || json.message || '';
                if (text && typeof text === 'string') sendText(text);
              }
              return;
            } catch (err) {
              // JSON parse error, treat as raw text
            }
          }

          sendText(line + '\n');
        };

        const processStdoutLine = (line) => {
          // Route to the correct parser based on agent type
          if (agentId === 'codex-agent') {
            processCodexStdoutLine(line);
            return;
          }
          if (agentId === 'gemini-agent') {
            processGeminiStdoutLine(line);
            return;
          }

          const trimmed = line.trim();
          if (!trimmed) return;

          // Attempt to parse line as structured JSON (Claude Code / Gemini format)
          if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
            try {
              const json = JSON.parse(trimmed);

              // 1. System/initialization events
              if (json.type === 'system') {
                if (json.subtype === 'init') {
                  sendSystemLog(`⚙️ [初始化] 本地 ${agentName} 工作目录: ${json.cwd || '默认'}\n`);
                  return;
                }
                if (json.subtype === 'hook_started') {
                  sendSystemLog(`⏱️ [钩子开始] ${json.hook_name || ''}\n`);
                  return;
                }
                if (json.subtype === 'hook_response') {
                  sendSystemLog(`✅ [钩子完成] ${json.hook_name || ''}\n`);
                  return;
                }
              }

              // 2. Assistant events (thinking, tool_use, final text stream)
              if (json.type === 'assistant' && json.message && Array.isArray(json.message.content)) {
                for (const content of json.message.content) {
                  if (content.type === 'thinking') {
                    if (content.thinking) {
                      sendSystemLog(`💭 思考过程:\n${content.thinking}\n\n`);
                    }
                  } else if (content.type === 'tool_use') {
                    const toolName = content.name;
                    const toolInput = content.input && typeof content.input === 'object'
                      ? JSON.stringify(content.input, null, 2)
                      : (content.input || '');
                    sendSystemLog(`🔧 调用工具: ${toolName}\n参数:\n${toolInput}\n\n`);
                  } else if (content.type === 'text') {
                    if (content.text) {
                      sendText(content.text);
                    }
                  }
                }
                return;
              }

              // 3. User events (tool_result)
              if (json.type === 'user' && json.message && Array.isArray(json.message.content)) {
                for (const content of json.message.content) {
                  if (content.type === 'tool_result') {
                    const isError = content.is_error;
                    const statusIcon = isError ? '❌' : '➡️';
                    const statusText = isError ? '工具执行失败' : '工具执行结果';
                    let displayContent = content.content || '';
                    
                    if (typeof displayContent === 'string' && displayContent.length > 500) {
                      displayContent = displayContent.substring(0, 500) + '\n... [已截断，共 ' + displayContent.length + ' 字符]';
                    }
                    sendSystemLog(`${statusIcon} ${statusText}:\n${displayContent}\n\n`);
                  }
                }
                return;
              }

              // 4. Final CLI execution results
              if (json.type === 'result') {
                const resText = json.result || json.content || json.value || '';
                // Claude may emit streamed assistant text and then a final result summary with the same content.
                // Only emit result when no assistant text has been streamed yet.
                if (resText && !hasStreamedAssistantText) {
                  sendText(resText);
                }
                return;
              }

              // 5. Error events
              if (json.type === 'error') {
                const msg = json.message || json.value || json.content || String(json);
                sendSystemLog(`❌ 错误: ${msg}\n`);
                return;
              }

              // Other JSON messages we skip or log if relevant
              return;
            } catch (err) {
              // JSON parse error, treat as raw text
            }
          }

          // Fallback if not JSON
          if (trimmed.includes('Warning: no stdin data received')) return;
          sendText(line + '\n');
        };

        const processStderrLine = (line) => {
          const trimmed = line.trim();
          if (!trimmed) return;
          if (trimmed.includes('Warning: no stdin data received')) return;

          // Attempt to parse as JSON just in case
          if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
            try {
              JSON.parse(trimmed);
              processStdoutLine(line);
              return;
            } catch (err) {}
          }

          sendSystemLog(line + '\n');
        };

        const stdoutBuffer = new LineBuffer(processStdoutLine);
        const stderrBuffer = new LineBuffer(processStderrLine);

        // Stream stdout (parsed JSON line-by-line)
        child.stdout.on('data', (data) => {
          if (finished) return;
          stdoutBuffer.append(data.toString());
        });

        // Stream stderr (progress and system logs)
        child.stderr.on('data', (data) => {
          if (finished) return;
          stderrBuffer.append(data.toString());
        });

        // Process finished
        child.on('close', (code) => {
          if (finished) return;
          finished = true;
          
          stdoutBuffer.flush();
          stderrBuffer.flush();

          console.log(`🤖 [ContextLens Bridge] ${agentName} exited with code: ${code}`);
          res.write(`data: [DONE]\n\n`);
          res.end();
        });

        // Spawning error
        child.on('error', (err) => {
          if (finished) return;
          finished = true;
          console.error('🤖 [Claude Bridge] Spawning error:', err);
          res.write(`data: ${JSON.stringify({ text: `\n⚠️ Spawning error: ${err.message}\n`, type: 'error' })}\n\n`);
          res.write(`data: [DONE]\n\n`);
          res.end();
        });

      } catch (err) {
        console.error('🤖 [Claude Bridge] Request error:', err);
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
