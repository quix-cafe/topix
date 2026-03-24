"""
LLM Web UI Passthrough Server

Connects to your already-running Chrome via DevTools Protocol, so there are
zero automation fingerprints — Cloudflare sees a normal browser.

Setup:
    1. Close Chrome completely, then relaunch it with remote debugging:
         google-chrome-stable --remote-debugging-port=9222

    2. Log into claude.ai and gemini.google.com in that browser normally.

    3. Start this server:
         python server.py

    4. Send requests to http://localhost:8899

API:
    POST /ask
        {"provider": "claude" | "gemini", "prompt": "Hello"}

    POST /v1/chat/completions   (OpenAI-compatible)
        {"model": "claude" | "gemini", "messages": [{"role": "user", "content": "Hello"}]}
"""

import argparse
import asyncio
import logging
import random
import shutil
import subprocess
import time
import uuid
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel
from playwright.async_api import async_playwright, Page, Browser

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("llm-passthru")

CDP_PORT = 9222
CDP_URL = f"http://127.0.0.1:{CDP_PORT}"
CHROME_BIN = "/usr/bin/google-chrome-stable"
CHROME_DEBUG_PROFILE = Path.home() / ".config" / "google-chrome-debug"
CHROME_DEFAULT_PROFILE = Path.home() / ".config" / "google-chrome"

# ---------------------------------------------------------------------------
# Browser management — launches Chrome with CDP, then connects
# ---------------------------------------------------------------------------

def _ensure_debug_profile():
    """Copy the default Chrome profile to the debug profile if it doesn't exist."""
    if not CHROME_DEBUG_PROFILE.exists():
        if CHROME_DEFAULT_PROFILE.exists():
            log.info("Copying Chrome profile to %s (one-time)...", CHROME_DEBUG_PROFILE)
            shutil.copytree(CHROME_DEFAULT_PROFILE, CHROME_DEBUG_PROFILE)
        else:
            CHROME_DEBUG_PROFILE.mkdir(parents=True)


def _launch_chrome():
    """Launch Chrome with remote debugging enabled."""
    _ensure_debug_profile()
    proc = subprocess.Popen(
        [
            CHROME_BIN,
            f"--remote-debugging-port={CDP_PORT}",
            f"--user-data-dir={CHROME_DEBUG_PROFILE}",
        ],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    log.info("Launched Chrome (pid=%d) with debug port %d", proc.pid, CDP_PORT)
    return proc


class BrowserManager:
    def __init__(self):
        self.pw = None
        self.browser: Browser | None = None
        self.chrome_proc = None
        self._locks = {"claude": asyncio.Lock(), "gemini": asyncio.Lock()}
        self._persistent_pages = {"claude": None, "gemini": None}

    async def start(self):
        self.pw = await async_playwright().start()

        # Try connecting to an already-running Chrome first
        try:
            self.browser = await self.pw.chromium.connect_over_cdp(CDP_URL)
            log.info("Connected to existing Chrome at %s", CDP_URL)
            return
        except Exception:
            pass

        # No Chrome running — launch one
        self.chrome_proc = _launch_chrome()
        # Wait for CDP to become available
        for i in range(15):
            await asyncio.sleep(1)
            try:
                self.browser = await self.pw.chromium.connect_over_cdp(CDP_URL)
                log.info("Connected to Chrome via CDP at %s", CDP_URL)
                return
            except Exception:
                if i < 14:
                    continue
        await self.pw.stop()
        raise RuntimeError(
            f"Chrome launched but CDP not available at {CDP_URL} after 15s."
        )

    async def stop(self):
        if self.browser:
            await self.browser.close()
        if self.pw:
            await self.pw.stop()
        # Don't kill Chrome — leave it running so user can interact with it

    async def new_page(self) -> Page:
        if not self.browser or not self.browser.contexts:
            # Reconnect — browser may have been restarted or contexts lost
            log.warning("No browser contexts available, reconnecting to CDP...")
            connected = False
            try:
                self.browser = await self.pw.chromium.connect_over_cdp(CDP_URL)
                connected = True
            except Exception:
                pass

            if not connected:
                # Chrome isn't running — launch it
                log.info("Chrome not reachable, launching...")
                self.chrome_proc = _launch_chrome()
                for i in range(15):
                    await asyncio.sleep(1)
                    try:
                        self.browser = await self.pw.chromium.connect_over_cdp(CDP_URL)
                        connected = True
                        break
                    except Exception:
                        if i == 14:
                            raise RuntimeError(f"Cannot connect to Chrome at {CDP_URL}")

            # Wait for at least one browser context to appear
            for i in range(10):
                if self.browser.contexts:
                    break
                log.info("Waiting for browser context... (%d/10)", i + 1)
                await asyncio.sleep(1)

            if not self.browser.contexts:
                raise RuntimeError("Chrome connected but has no browser contexts — open a Chrome window first")
        context = self.browser.contexts[0]
        return await context.new_page()


mgr = BrowserManager()


# ---------------------------------------------------------------------------
# Human-like typing helper
# ---------------------------------------------------------------------------

async def _human_type(page: Page, text: str):
    """Type text in chunks with random delays to look human."""
    # Break into chunks of 20-80 chars (like pasting from clipboard in bursts)
    i = 0
    while i < len(text):
        chunk_size = random.randint(20, 80)
        chunk = text[i:i + chunk_size]
        await page.keyboard.insert_text(chunk)
        i += chunk_size
        if i < len(text):
            await page.wait_for_timeout(random.randint(50, 200))


# ---------------------------------------------------------------------------
# Provider implementations — persistent tab reuse
# ---------------------------------------------------------------------------

async def _get_persistent_page(provider: str, url: str) -> tuple[Page, bool]:
    """Get or create a persistent page for this provider.
    Returns (page, is_new) — is_new=True means the page was freshly created/navigated."""
    page = mgr._persistent_pages.get(provider)

    # Check if existing page is still usable
    if page is not None:
        try:
            # Quick check — if the page is closed or crashed this will throw
            await page.title()
            return page, False
        except Exception:
            log.info("Persistent %s page is stale, creating new one", provider)
            mgr._persistent_pages[provider] = None
            page = None

    # Create a new page
    page = await mgr.new_page()
    await page.goto(url, wait_until="domcontentloaded", timeout=30000)
    await page.wait_for_timeout(random.randint(2000, 4000))
    mgr._persistent_pages[provider] = page
    return page, True


async def send_to_claude(prompt: str) -> str:
    """Send prompt to Claude using a persistent tab."""
    async with mgr._locks["claude"]:
        page, is_new = await _get_persistent_page("claude", "https://claude.ai/new")

        try:
            if not is_new:
                # Already have a tab — click "New chat" or navigate within the tab
                # Try the sidebar new-chat button first
                new_chat = page.locator('a[href="/new"]').first
                if await new_chat.count() > 0 and await new_chat.is_visible():
                    await new_chat.click()
                    await page.wait_for_timeout(random.randint(1500, 3000))
                else:
                    # Fallback: navigate but within the same tab
                    await page.goto("https://claude.ai/new", wait_until="domcontentloaded", timeout=30000)
                    await page.wait_for_timeout(random.randint(2000, 4000))

            # Find the input area and type the prompt
            editor = page.locator('[contenteditable="true"]').last
            await editor.wait_for(state="visible", timeout=15000)
            await editor.click()
            await page.wait_for_timeout(random.randint(300, 800))

            # Type with human-like chunking
            await _human_type(page, prompt)
            await page.wait_for_timeout(random.randint(400, 1000))

            # Press Enter or click send button
            send_btn = page.locator('button[aria-label="Send Message"]')
            if await send_btn.count() > 0 and await send_btn.is_enabled():
                await send_btn.click()
            else:
                await page.keyboard.press("Enter")

            # Wait for streaming to start
            for _ in range(30):
                streaming = page.locator('[data-is-streaming="true"]')
                if await streaming.count() > 0:
                    break
                await page.wait_for_timeout(500)

            # Wait for streaming to finish
            for _ in range(360):
                streaming = page.locator('[data-is-streaming="true"]')
                if await streaming.count() == 0:
                    stop_btn = page.locator('button[aria-label="Stop response"]')
                    if await stop_btn.count() == 0 or not await stop_btn.is_visible():
                        break
                await page.wait_for_timeout(1000)

            await page.wait_for_timeout(500)

            # Extract the response text
            resp = page.locator('.font-claude-response')
            count = await resp.count()
            if count > 0:
                return (await resp.nth(count - 1).inner_text()).strip()

            return "[Could not extract response — check the browser window]"
        except Exception:
            # Page is broken — discard it so next request gets a fresh one
            mgr._persistent_pages["claude"] = None
            try:
                await page.close()
            except Exception:
                pass
            raise


async def _ensure_gemini_model(page: Page):
    """Ensure Gemini is set to 'pro' or 'thinking' rather than 'flash'."""
    try:
        # Try multiple possible selectors for the model picker
        picker_selectors = [
            '.model-picker-container',
            'model-picker',
            '[data-test-id="model-selector"]',
            'button[aria-haspopup="listbox"]',
            'button[aria-haspopup="menu"]',
            'button[aria-haspopup="dialog"]',
        ]

        picker = None
        for sel in picker_selectors:
            loc = page.locator(sel)
            if await loc.count() > 0 and await loc.first.is_visible():
                picker = loc.first
                log.info("Found model picker via selector: %s", sel)
                break

        if not picker:
            # Broader search: look for buttons containing model-related text
            for text in ["Flash", "Pro", "Gemini"]:
                loc = page.locator(f'button:has-text("{text}")').first
                if await loc.count() > 0 and await loc.is_visible():
                    inner = (await loc.inner_text()).strip()
                    # Make sure it's actually a model selector, not the send button etc
                    if len(inner) < 60 and any(m in inner.lower() for m in ["flash", "pro", "gemini", "thinking"]):
                        picker = loc
                        log.info("Found model picker via text match: '%s'", inner)
                        break

        if not picker:
            log.info("No model picker found on page, skipping model check")
            return

        picker_text = (await picker.inner_text()).strip().lower()
        if "pro" in picker_text and "thinking" not in picker_text:
            log.info("Model already set to pro: '%s'", picker_text)
            return

        log.info("Gemini model is '%s', switching to pro", picker_text)
        await picker.click()
        await page.wait_for_timeout(random.randint(1200, 2000))

        # Now we know the structure: [role="menu"].gds-mode-switch-menu
        # contains children with text like "Pro\nAdvanced math and code..."
        # Use Playwright's real mouse clicks (not JS .click() which Angular ignores)

        # First, get the menu item structure for debugging
        try:
            dump = await page.evaluate("""() => {
                const menu = document.querySelector('[role="menu"]');
                if (!menu) return 'no [role=menu] found';
                const items = menu.querySelectorAll('*');
                const result = [];
                for (const el of items) {
                    if (el.children.length === 0 || el.getAttribute('role')) {
                        const text = el.innerText?.trim();
                        if (text && text.length > 1 && text.length < 100) {
                            result.push({tag: el.tagName, role: el.getAttribute('role'), cls: el.className?.toString().slice(0, 80), text: text.slice(0, 60)});
                        }
                    }
                }
                return JSON.stringify(result.slice(0, 30), null, 2);
            }""")
            log.info("Menu items: %s", dump[:1500])
        except Exception as e:
            log.warning("Menu dump failed: %s", e)

        # Use Playwright locator to click within the menu overlay
        menu = page.locator('[role="menu"]')
        clicked = False
        for label in ["Pro"]:
            # Find children of the menu whose text starts with the label
            # Use xpath to match direct/near text
            for sel in [
                f'[role="menu"] >> text=/^{label}$/i',
                f'[role="menu"] >> text=/^{label}\\n/i',
                f'.cdk-overlay-container >> text=/^{label}$/i',
                f'.cdk-overlay-container >> text=/^{label}\\n/i',
            ]:
                try:
                    loc = page.locator(sel)
                    if await loc.count() > 0:
                        await loc.first.click(timeout=3000)
                        await page.wait_for_timeout(random.randint(500, 1000))
                        log.info("Switched Gemini model to '%s' via Playwright: %s", label, sel)
                        clicked = True
                        break
                except Exception as e:
                    log.info("Selector %s failed: %s", sel, e)
                    continue
            if clicked:
                break

        if not clicked:
            # Fallback: use bounding box of text node to do a real mouse click
            try:
                box = await page.evaluate("""() => {
                    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
                    while (walker.nextNode()) {
                        const t = walker.currentNode.textContent?.trim();
                        if (t === 'Pro') {
                            const range = document.createRange();
                            range.selectNode(walker.currentNode);
                            const rect = range.getBoundingClientRect();
                            if (rect.width > 0 && rect.height > 0) {
                                return {x: rect.x + rect.width/2, y: rect.y + rect.height/2};
                            }
                        }
                    }
                    return null;
                }""")
                if box:
                    await page.mouse.click(box['x'], box['y'])
                    await page.wait_for_timeout(random.randint(500, 1000))
                    log.info("Switched Gemini model to Pro via mouse click at (%d, %d)", box['x'], box['y'])
                    clicked = True
                else:
                    log.warning("Could not find 'Pro' text node bounding box")
            except Exception as e:
                log.warning("Mouse click fallback failed: %s", e)

        if not clicked:
            await page.keyboard.press("Escape")
            await page.wait_for_timeout(300)
            log.warning("Could not find pro model option, keeping current selection")
    except Exception as e:
        log.warning("Model picker check failed: %s", e)
        try:
            await page.keyboard.press("Escape")
        except Exception:
            pass


async def _gemini_attempt(page: Page, prompt: str) -> str:
    """Single attempt to send a prompt on a Gemini page. Returns response or raises."""
    await _ensure_gemini_model(page)
    editor = page.locator('.ql-editor').first
    await editor.wait_for(state="visible", timeout=15000)
    await editor.click()
    await page.wait_for_timeout(random.randint(200, 600))

    # Clear any leftover text
    await page.keyboard.press("Control+a")
    await page.wait_for_timeout(random.randint(50, 150))
    await page.keyboard.press("Backspace")
    await page.wait_for_timeout(random.randint(200, 500))

    # Paste the whole prompt at once — Gemini handles it fine and typing hangs
    await page.keyboard.insert_text(prompt)
    await page.wait_for_timeout(random.randint(400, 1000))

    # Click send
    send_btn = page.locator('button[aria-label="Send message"]')
    await send_btn.wait_for(state="visible", timeout=5000)
    await send_btn.click()

    await page.wait_for_timeout(3000)

    # Check for error dialogs
    for retry_attempt in range(3):
        error_btn = page.locator('button:has-text("Retry"), button:has-text("Try again")')
        if await error_btn.count() > 0 and await error_btn.first.is_visible():
            log.warning("Gemini showed an error, clicking retry (attempt %d)", retry_attempt + 1)
            await error_btn.first.click()
            await page.wait_for_timeout(3000)
        else:
            break

    # Wait until .model-response-text has content and stabilizes
    last_text = ""
    stable_count = 0
    for _ in range(360):
        error_btn = page.locator('button:has-text("Retry"), button:has-text("Try again")')
        if await error_btn.count() > 0 and await error_btn.first.is_visible():
            log.warning("Gemini error during generation, clicking retry")
            await error_btn.first.click()
            await page.wait_for_timeout(3000)
            continue

        resp = page.locator('.model-response-text')
        count = await resp.count()
        if count > 0:
            text = (await resp.nth(count - 1).inner_text()).strip()
            if text and text == last_text:
                stable_count += 1
                if stable_count >= 3:
                    return text
            else:
                stable_count = 0
            last_text = text
        await page.wait_for_timeout(1000)

    if last_text:
        return last_text
    raise RuntimeError("Gemini did not produce a response")


async def send_to_gemini(prompt: str) -> str:
    """Send prompt to Gemini using a persistent tab."""
    async with mgr._locks["gemini"]:
        page, is_new = await _get_persistent_page("gemini", "https://gemini.google.com/app")

        try:
            if is_new:
                # Dismiss any initial popups
                try:
                    dismiss = page.locator('button:has-text("Got it"), button:has-text("Dismiss"), button:has-text("Close")')
                    if await dismiss.count() > 0 and await dismiss.first.is_visible():
                        await dismiss.first.click()
                        await page.wait_for_timeout(random.randint(800, 1500))
                except Exception:
                    pass
            else:
                # Reuse tab — click "New chat" button within Gemini
                new_chat = page.locator('a[href="/app"], button:has-text("New chat")')
                if await new_chat.count() > 0 and await new_chat.first.is_visible():
                    await new_chat.first.click()
                    await page.wait_for_timeout(random.randint(1500, 3000))
                else:
                    await page.goto("https://gemini.google.com/app", wait_until="domcontentloaded", timeout=30000)
                    await page.wait_for_timeout(random.randint(2000, 4000))

            # Try up to 2 times with a page reload on failure
            for attempt in range(2):
                try:
                    return await _gemini_attempt(page, prompt)
                except Exception as e:
                    if attempt == 0:
                        log.warning("Gemini attempt failed (%s), reloading page", e)
                        await page.reload(wait_until="domcontentloaded", timeout=30000)
                        await page.wait_for_timeout(random.randint(2000, 4000))
                    else:
                        raise

            return "[Could not extract response — check the browser window]"
        except Exception:
            mgr._persistent_pages["gemini"] = None
            try:
                await page.close()
            except Exception:
                pass
            raise


PROVIDERS = {
    "claude": send_to_claude,
    "gemini": send_to_gemini,
}

# ---------------------------------------------------------------------------
# API models
# ---------------------------------------------------------------------------

class SimpleRequest(BaseModel):
    provider: str = "claude"
    prompt: str

class ChatMessage(BaseModel):
    role: str
    content: str

class ChatCompletionRequest(BaseModel):
    model: str = "claude"
    messages: list[ChatMessage]
    stream: bool = False

# ---------------------------------------------------------------------------
# FastAPI app
# ---------------------------------------------------------------------------

@asynccontextmanager
async def lifespan(app: FastAPI):
    await mgr.start()
    yield
    await mgr.stop()

app = FastAPI(title="LLM Web UI Passthrough", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

WEB_DIR = Path(__file__).parent


@app.get("/")
async def index():
    return FileResponse(WEB_DIR / "passthru-test.html")


@app.post("/ask")
async def ask(req: SimpleRequest):
    provider = req.provider.lower()
    if provider not in PROVIDERS:
        raise HTTPException(400, f"Unknown provider: {provider}. Use: {list(PROVIDERS.keys())}")
    log.info("Request to %s: %s", provider, req.prompt[:80])
    try:
        response = await PROVIDERS[provider](req.prompt)
    except Exception as e:
        log.exception("Error from %s", provider)
        raise HTTPException(500, f"Browser automation error: {e}")
    return {"provider": provider, "response": response}


@app.post("/v1/chat/completions")
async def chat_completions(req: ChatCompletionRequest):
    """OpenAI-compatible endpoint."""
    provider = req.model.lower().split("/")[0]
    if provider not in PROVIDERS:
        provider = "claude"

    parts = []
    for msg in req.messages:
        if msg.role == "system":
            parts.append(f"[System instruction: {msg.content}]\n")
        elif msg.role == "user":
            parts.append(msg.content)
        elif msg.role == "assistant":
            parts.append(f"[Previous assistant response: {msg.content}]\n")
    prompt = "\n\n".join(parts)

    log.info("Chat completion via %s: %s", provider, prompt[:80])
    try:
        response = await PROVIDERS[provider](prompt)
    except Exception as e:
        log.exception("Error from %s", provider)
        raise HTTPException(500, f"Browser automation error: {e}")

    return {
        "id": f"chatcmpl-{uuid.uuid4().hex[:8]}",
        "object": "chat.completion",
        "created": int(time.time()),
        "model": provider,
        "choices": [
            {
                "index": 0,
                "message": {"role": "assistant", "content": response},
                "finish_reason": "stop",
            }
        ],
        "usage": {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0},
    }


@app.get("/health")
async def health():
    return {"status": "ok", "providers": list(PROVIDERS.keys())}


# ---------------------------------------------------------------------------
# Entrypoint
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="LLM Web UI Passthrough Server")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8899)
    parser.add_argument("--cdp", default=CDP_URL, help="Chrome DevTools Protocol URL")
    args = parser.parse_args()

    CDP_URL = args.cdp
    import uvicorn
    uvicorn.run(app, host=args.host, port=args.port)
