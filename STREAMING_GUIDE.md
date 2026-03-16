# Streaming Output Guide - Troubleshooting & Testing

## 🔧 Streaming Fixed!

The streaming output from Ollama now displays in real-time in the WebUI. Here's how to verify and troubleshoot.

---

## ✅ What You Should See

### Streaming Panel (Bottom of Screen)

When you click "Parse All with Gemma 3:12B":

```
┌─────────────────────────────────────────────────────┐
│ ⚡ STREAMING PARSING                        5 bits found
│ ████████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ 25%     │
│                                                     │
│ 📡 Ollama Output:                                  │
│ You are a stand-up comedy analyst. You parse...   │
│ For each distinct topic, joke, or bit in the...   │
│ [streaming text updates in real-time]             │
│                                                     │
│ ✓ Found Bits:                                      │
│ ✓ Airline Food (observational, food)              │
│ ✓ Dating Problems (relationship, dating)          │
│                                                     │
└─────────────────────────────────────────────────────┘
```

---

## 🚀 Testing Streaming

### Step 1: Start Ollama
```bash
ollama serve
```
Should see:
```
listening on 127.0.0.1:11434
```

### Step 2: Start Comedy Parser
```bash
npm run dev
```
Should see:
```
➜ Local:   http://localhost:5173/
```

### Step 3: Upload & Parse

1. Go to **Upload** tab
2. Drop a comedy transcript file
3. Click **"Parse All with Gemma 3:12B"**
4. **Watch the streaming panel at the bottom**

You should see:
- ✅ "STREAMING PARSING" status
- ✅ Progress bar moving
- ✅ Bits found counter incrementing
- ✅ **Raw Ollama output appearing in real-time**
- ✅ Latest bits listed as discovered

### Step 4: Check Console

Open browser console (F12) and look for:
```
[Streaming] Starting stream...
[Stream] Received content chunk: You are a stand-up comedy...
[Stream] Found bit: Airplane Food
[Stream] Found bit: Dating Problems
...
[Streaming] Stream complete. Total bits found: 5
```

---

## 🔍 Debugging Streaming Issues

### Issue 1: No Output Appearing

**Problem:** Streaming panel shows "Waiting for streaming output" but nothing arrives

**Solutions:**
1. **Check Ollama is running:**
   ```bash
   curl http://localhost:11434/api/tags
   ```
   Should return JSON with model list

2. **Check console for errors (F12):**
   Look for red error messages starting with `[Streaming]`

3. **Restart Ollama:**
   ```bash
   # Stop current instance (Ctrl+C)
   # Start fresh:
   ollama serve
   ```

4. **Check model is installed:**
   ```bash
   ollama list
   # Should show: gemma3:12b (or similar)

   # If missing, install:
   ollama pull gemma3:12b
   ```

### Issue 2: Stream Starts Then Stops

**Problem:** Output appears for a moment then stops

**Solutions:**
1. Check browser console for errors
2. Verify Ollama isn't out of memory:
   ```bash
   # Check system memory usage
   # Gemma 3:12B needs ~8GB RAM minimum
   ```

3. Try smaller model:
   ```bash
   ollama pull mistral
   # Then modify comedy-parser.jsx line with "gemma3:12b" to "mistral"
   ```

### Issue 3: Streaming Works But Parsing Fails

**Problem:** Output shows but bits don't appear in database

**Solutions:**
1. Check console for JSON parsing errors
2. Verify JSON format in output (look for `[{` in the output)
3. Check the raw output - look for JSON array at the end

---

## 🧪 Manual Testing Steps

### Test 1: Simple Upload
1. Create test file: `test_comedy.txt`
2. Add short comedy snippet (5-10 lines)
3. Upload & parse
4. Watch streaming panel

### Test 2: Monitor Streaming
1. Open browser console (F12)
2. Go to Network tab
3. Upload & parse
4. In Network tab, find `/api/chat` request
5. Click it, go to Response tab
6. Should show streamed chunks arriving

### Test 3: Check Database Save
1. After parsing completes
2. Go to Analytics tab
3. Check "💾 Saved [timestamp]" in header
4. Database should show new items

### Test 4: Verify Bits Extracted
1. After parsing
2. Go to Database tab
3. Should see parsed bits listed
4. Each bit should show in detail panel

---

## 📊 Expected Performance

### Streaming Speed
- **Start:** Should begin within 2-3 seconds
- **Output:** Chunks arrive every 100-500ms
- **Completion:** Full response in 10-60 seconds per transcript

### Bits Found
- Small transcript (< 500 words): 2-5 bits
- Medium transcript (500-2000 words): 5-15 bits
- Large transcript (2000+ words): 15-50 bits

---

## 🔗 How Streaming Works

### The Process

```
1. User clicks "Parse All"
   ↓
2. parseAll() calls callOllamaStream()
   ↓
3. Fetch starts streaming from Ollama API
   ↓
4. Each chunk received:
   - onChunk() callback fires
   - Updates streamedText in state
   - Streaming panel refreshes
   ↓
5. JSON extracted from fullText:
   - onBitFound() fires for each bit
   - Bit counter increments
   - Latest bits list updates
   ↓
6. Stream ends:
   - Final JSON parsed
   - onComplete() fires
   - Bits added to database
   - Panel disappears
```

### Key Functions

**Streaming API:** `src/utils/ollama.js`
- `callOllamaStream()` - Main streaming function
- Accumulates text in `streamedOutput` variable
- Calls `onChunk()` with complete accumulated text
- Extracts bits with `tryParsePartialJSON()`

**UI Update:** `src/comedy-parser.jsx`
- `parseAll()` function sets up callbacks
- `onChunk` updates `streamingProgress.streamedText`
- `onBitFound` updates `foundBits` array
- UI re-renders on each state change

**Display:** `StreamingProgressPanel` component
- Shows real-time streaming text
- Updates progress bar
- Lists found bits as they arrive

---

## 🐛 Browser Console Debugging

When testing, open F12 and look for these log messages:

### Successful Stream
```
✅ [Streaming] Starting stream...
✅ [Stream] Received content chunk: You are a...
✅ [Stream] Found bit: Title Here
✅ [Streaming] Stream complete. Total bits found: 5
✅ [Streaming] Parsed result array length: 5
```

### Stream Problem
```
❌ [Streaming] Read error: ...
❌ [Stream] JSON parse failed: ...
❌ [Streaming] Stream error: ...
```

### Debug Output
```
[Stream] Received content chunk: ...first 100 chars...
[Stream] Skipped non-JSON line: ...first 50 chars...
```

---

## 📝 Sample Transcript for Testing

Create `test.txt`:
```
So I was at the grocery store, right? And I'm in the produce section.
And there's this woman picking through all the avocados.
She's got like twenty in her hands, squeezing each one.
And I'm thinking, lady, you don't need that many avocados.
Unless you're making guacamole for an army or something.

Then she looks at me and says "You looking for good ones too?"
And I'm like, "No, I just came to buy one avocado and leave."
But apparently that's not how it works.
You gotta test them all.
It's like dating, but with vegetables.

And the weird part? She follows me to the checkout.
Not like stalking weird, but like we're friends weird.
And she's complaining about the price of avocados.
Lady, you grabbed TWENTY of them!
Of course they're expensive!
```

Expected output: 3-5 bits (grocery store bit, avocado quality, complaining about price)

---

## ⚙️ Configuration

### Change Model
In `src/comedy-parser.jsx`, find this line (around line 50):
```javascript
model: "gemma3:12b",
```

Change to any model:
```javascript
model: "mistral",    // Smaller, faster
model: "llama2",     // Alternative
model: "neural-chat", // Faster inference
```

### Adjust Streaming Callbacks
In `parseAll()` function, you can customize:

```javascript
onChunk: (text) => {
  // Called with accumulated streaming text
  // Update progress.streamedText
}

onBitFound: (bit, count) => {
  // Called when bit found
  // Update bits counter
}

onComplete: (result) => {
  // Called when stream ends
  // Save to database
}

onError: (error) => {
  // Called on stream error
  // Handle error
}
```

---

## 🎯 Verification Checklist

- [ ] Ollama running (`ollama serve`)
- [ ] Browser console shows `[Streaming] Starting stream...`
- [ ] Streaming panel appears at bottom
- [ ] "📡 Ollama Output:" section shows text
- [ ] Progress bar moves smoothly
- [ ] Bits counter increments
- [ ] Latest bits list updates
- [ ] Panel disappears when done
- [ ] Bits appear in Database tab
- [ ] Database saves (✓ in header)

---

## 🆘 Still Not Working?

### Step 1: Verify Ollama
```bash
# Test direct call
curl -X POST http://localhost:11434/api/chat \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gemma3:12b",
    "stream": true,
    "messages": [{"role": "user", "content": "Hello"}]
  }' | head -20
```

Should see streaming JSON output immediately.

### Step 2: Check Network
Open DevTools → Network tab:
1. Click "Parse All"
2. Find `/api/chat` request
3. Click it
4. Go to Response tab
5. Should see multiple `{"message":{"content":"..."}}` lines

### Step 3: Inspect State
Open DevTools → React DevTools (if installed):
1. Go to Streaming panel
2. Inspect `streamingProgress` state
3. Should show `streamedText` with content

### Step 4: Try Different Transcript
Use the test transcript above to verify:
1. Shorter content parses faster
2. Easier to see if streaming working
3. Check if issue is with your transcript

### Step 5: Enable Verbose Logging
In `src/utils/ollama.js`, uncomment more logs:
```javascript
console.log("[Stream] Raw chunk:", chunk.substring(0, 100));
console.log("[Stream] Buffer state:", buffer.length);
console.log("[Stream] Accumulated text:", fullText.length);
```

Then check console for detailed output.

---

## 📞 Support

If streaming still isn't working:

1. **Check console logs** - Copy all `[Streaming]` messages
2. **Check Network tab** - Verify `/api/chat` request status
3. **Verify Ollama** - Run direct curl test above
4. **Check memory** - Ensure 8GB+ free RAM
5. **Try simpler model** - Use `mistral` instead of `gemma3:12b`

---

## 🎉 Success!

When everything works, you'll see:
- Real-time Ollama output in the panel
- Bits discovered and listed instantly
- Progress bar showing % complete
- Database auto-saves when done
- Zero console errors

Happy streaming! 🚀
