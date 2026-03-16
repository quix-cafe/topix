# Ollama Process Manager Setup

The comedy parser now includes automatic Ollama restart capability for when streams freeze due to context limits.

## How It Works

1. **Chunked Processing**: Each transcript is processed in 4000-character chunks
2. **Timeout Detection**: If no data is received for 45 seconds, the chunk is considered frozen
3. **Automatic Restart**: The backend server kills and restarts the Ollama process
4. **Resume Processing**: Parsing continues from the last identified bit position
5. **Minimal Context**: Only the current chunk is sent to Ollama (not the full document)

## Setup

### 1. Ensure Ollama is installed and running on Fedora

```bash
# Install Ollama (if not already installed)
curl https://ollama.ai/install.sh | sh

# Start the Ollama service
sudo systemctl start ollama

# Enable auto-start
sudo systemctl enable ollama

# Verify it's running
curl http://localhost:11434/api/tags
```

### 2. Allow the Node.js process to restart Ollama (passwordless sudo)

Edit your sudoers file to allow restarting Ollama without a password prompt:

```bash
sudo visudo
```

Add this line at the end:
```
your_username ALL=(ALL) NOPASSWD: /usr/bin/systemctl restart ollama
```

Replace `your_username` with your actual username.

**Alternative (if using user service):**
If Ollama is running as a user service (not system service), no sudo is needed.

### 3. Start the process manager server

In one terminal, start the backend server:

```bash
npm run server
```

You should see:
```
[Server] Ollama Process Manager running on http://localhost:3001
[Server] Health check: GET http://localhost:3001/api/health
[Server] Restart Ollama: POST http://localhost:3001/api/restart-ollama
```

### 4. In another terminal, start the Vite dev server

```bash
npm run dev
```

The app will be at `http://localhost:5173`

**Or run both together:**
```bash
npm run dev:full
```

## What Happens When a Stream Freezes

1. **Timeout Detected**: After 45 seconds with no data, the parser detects a frozen stream
2. **Restart Initiated**: The backend sends a restart request to Ollama
3. **Process Restart**:
   - If running as a service: `systemctl restart ollama`
   - If running as a user service: `systemctl --user restart ollama`
   - Fallback: Kills any ollama process (will auto-restart if configured)
4. **Healthcheck Loop**: Waits up to 30 seconds for Ollama to become responsive
5. **Resume**: Parsing continues from the last bit's end position with a fresh chunk

## Minimum Context Window

The parser works with models that have small context windows:
- ✅ **gemma3:4b** - 8K context
- ✅ **gemma3:2b** - 4K context
- ✅ **mistral:7b** - 8K context
- ✅ Any model with context < 10K

Large transcripts will be split across multiple chunks and resumed automatically on freeze.

## Troubleshooting

### "Ollama restart timeout - service may not be configured for auto-restart"

This means Ollama didn't come back online within 30 seconds. Check:

```bash
# Is Ollama service running?
systemctl status ollama

# Is it a user or system service?
systemctl --user status ollama

# Check Ollama logs
journalctl -u ollama -n 50
```

### "Connection refused" errors

Make sure both servers are running:

```bash
# Check backend is running on port 3001
curl http://localhost:3001/api/health

# Check Ollama is running on port 11434
curl http://localhost:11434/api/tags
```

### Stream keeps freezing immediately

- Try a smaller model (gemma3:2b instead of gemma3:4b)
- Reduce chunk size: Edit `src/comedy-parser.jsx` line 816, change `chunkSize = 4000` to `3000`
- Increase timeout: Edit same file, change `45000` (ms) to `60000`

## Development

The backend server (`server.js`) provides:

- `GET /api/health` - Check if Ollama is healthy
- `POST /api/restart-ollama` - Restart the Ollama process

The frontend (`src/utils/ollama.js`) exports:

- `checkOllamaHealth()` - Check health status
- `requestOllamaRestart()` - Request a restart
- `callOllamaStream()` - Stream parsing with auto-restart support

## Performance Notes

By sending only the current chunk (not document context), Ollama can:
- Process faster with less memory
- Work with smaller models
- Recover quickly from timeout
- Process very large transcripts that exceed context window

Trade-off: Ollama won't have full document context, but this is acceptable since:
- Each bit should be complete within a single chunk (4000 chars is ~1000 words)
- Matching between bits happens in the frontend (not dependent on Ollama context)
- Flow analysis is done separately on identified bits
