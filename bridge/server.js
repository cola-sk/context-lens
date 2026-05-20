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

        // Spawn child process with stdin redirected to prevent block
        const child = spawn(
          executablePath,
          ['-p', prompt, '--print', '--dangerously-skip-permissions'],
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

        // Stream stdout (text content)
        child.stdout.on('data', (data) => {
          if (finished) return;
          const text = data.toString();
          res.write(`data: ${JSON.stringify({ text, type: 'text' })}\n\n`);
        });

        // Stream stderr (tool executions/progress logs)
        child.stderr.on('data', (data) => {
          if (finished) return;
          const text = data.toString();
          // Filter out generic interactive stdin warning to keep it clean
          if (text.includes('Warning: no stdin data received')) return;
          res.write(`data: ${JSON.stringify({ text, type: 'system' })}\n\n`);
        });

        // Process finished
        child.on('close', (code) => {
          if (finished) return;
          finished = true;
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
