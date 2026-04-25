# Browser Tooling Fallback

Shared fallback for both events playbooks when the `browser-tools` skill's Node scripts fail.

## When `browser-eval.js` / `browser-nav.js` time out

Observed with Chrome 147+ where `puppeteer-core` fails to connect. Error looks like: `Could not connect to browser: timeout`.

Fall back to Python + raw Chrome DevTools Protocol over a WebSocket, keeping one connection open across nav + multiple evals for efficiency:

```python
import asyncio, json, urllib.request
import websockets

async def cdp_eval(ws, expr, msg_id):
    await ws.send(json.dumps({"id": msg_id, "method": "Runtime.evaluate",
        "params": {"expression": expr, "returnByValue": True, "awaitPromise": True}}))
    for _ in range(60):
        try:
            msg = json.loads(await asyncio.wait_for(ws.recv(), timeout=10))
            if msg.get('id') == msg_id:
                return msg.get('result', {}).get('result', {}).get('value')
        except asyncio.TimeoutError:
            break
    return None

async def main():
    tabs = json.loads(urllib.request.urlopen('http://localhost:9222/json').read())
    page = next(t for t in tabs if t.get('type') == 'page')
    async with websockets.connect(page['webSocketDebuggerUrl'], max_size=10*1024*1024) as ws:
        await ws.send(json.dumps({"id": 0, "method": "Page.enable"}))
        _ = await asyncio.wait_for(ws.recv(), timeout=5)
        await ws.send(json.dumps({"id": 1, "method": "Page.navigate", "params": {"url": url}}))
        await asyncio.sleep(1)
        while True:
            try: await asyncio.wait_for(ws.recv(), timeout=0.3)
            except: break
        result = await cdp_eval(ws, js_code, msg_id=2)

asyncio.run(main())
```

Both `browser-nav.js` and `browser-eval.js` share the same puppeteer connection, so if one times out, both do — switch to Python CDP for the entire session.

## When Chrome has no open page tab

If `browser-nav` fails with `Cannot read properties of undefined (reading 'goto')`, Chrome is running but only has extension background pages. Open a blank tab:

```bash
curl -X PUT http://localhost:9222/json/new
```

Then retry `browser-nav`.
