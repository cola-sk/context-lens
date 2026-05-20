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
  return 'claude';
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

  // Handle preflight OPTIONS request
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // API Route: Chat with Local Claude Agent
  if (req.method === 'POST' && req.url === '/api/chat') {
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
    });

    req.on('end', () => {
      try {
        const { prompt, cwd, claudePath } = JSON.parse(body);

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

        // Default local Claude CLI path
        const executablePath = claudePath || findClaudeExecutable();
        
        console.log(`🤖 [Claude Bridge] Spawning Claude Code in CWD: ${cwd || process.cwd()}`);
        console.log(`🤖 [Claude Bridge] Executable: ${executablePath}`);

        // Spawn child process with stdin redirected to prevent block, using structured json stream verbose format
        const child = spawn(
          executablePath,
          [
            '-p', prompt,
            '--print',
            '--output-format=stream-json',
            '--include-hook-events',
            '--dangerously-skip-permissions',
            '--verbose'
          ],
          {
            cwd: cwd || process.cwd(),
            stdio: ['ignore', 'pipe', 'pipe'],
            env: {
              ...process.env,
              FORCE_COLOR: '0',
              TERM: 'dumb' // disable ANSI escape colors/interactive characters
            }
          }
        );

        // Track process exit to avoid multiple response writes
        let finished = false;

        const sendSystemLog = (text) => {
          if (finished) return;
          res.write(`data: ${JSON.stringify({ text, type: 'system' })}\n\n`);
        };

        const sendText = (text) => {
          if (finished) return;
          res.write(`data: ${JSON.stringify({ text, type: 'text' })}\n\n`);
        };

        const processStdoutLine = (line) => {
          const trimmed = line.trim();
          if (!trimmed) return;

          // Attempt to parse line as structured JSON
          if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
            try {
              const json = JSON.parse(trimmed);

              // 1. System/initialization events
              if (json.type === 'system') {
                if (json.subtype === 'init') {
                  sendSystemLog(`⚙️ [初始化] 本地 Claude Code 工作目录: ${json.cwd || '默认'}\n`);
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

          console.log(`🤖 [Claude Bridge] Claude Code exited with code: ${code}`);
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
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', service: 'Claude Code Bridge' }));
    return;
  }

  // Fallback 404
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not Found' }));
});

server.listen(PORT, () => {
  console.log(`🚀 [Claude Bridge] Server listening on http://localhost:${PORT}`);
});
