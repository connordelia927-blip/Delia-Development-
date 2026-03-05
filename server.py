"""
WARZONE - aiohttp server (single port 8000)
  HTTP  : static files, POST /log-ip
  WS    : /ws  (lobby list, player sync)
Works through Cloudflare Tunnel since everything is on one port.
"""
import asyncio, json, os, datetime, uuid, pathlib, mimetypes
from aiohttp import web

PORT = 8000
STATIC = pathlib.Path(__file__).parent
LOG_FILE = STATIC / "visitor_log.txt"

# ---- state ----
lobbies = {}      # { lid: {id, name, players:{pid:data}} }
ws_players = {}   # { ws: {player_id, lobby_id} }

# ---- helpers ----
async def bcast_lobby(lobby_id, msg, skip=None):
    for ws, info in list(ws_players.items()):
        if info["lobby_id"] == lobby_id and ws is not skip:
            try: await ws.send_json(msg)
            except: pass

async def bcast_all(msg):
    for ws in list(ws_players):
        try: await ws.send_json(msg)
        except: pass

def lobby_list_msg():
    return {"type":"lobby_list","lobbies":[
        {"id":l["id"],"name":l["name"],"count":len(l["players"])}
        for l in lobbies.values()
    ]}

# ---- WebSocket handler ----
async def ws_handler(request):
    ws = web.WebSocketResponse()
    await ws.prepare(request)
    ws_players[ws] = {"player_id": None, "lobby_id": None}

    try:
        async for msg in ws:
            if msg.type != web.WSMsgType.TEXT:
                continue
            d = json.loads(msg.data)
            t = d.get("type")

            if t == "get_lobbies":
                await ws.send_json(lobby_list_msg())

            elif t == "create_lobby":
                lid = str(uuid.uuid4())[:6].upper()
                name = d.get("name", f"LOBBY-{lid}")
                lobbies[lid] = {"id": lid, "name": name, "players": {}}
                await ws.send_json({"type":"lobby_created","id":lid,"name":name})
                await bcast_all(lobby_list_msg())

            elif t == "join_lobby":
                lid = d.get("lobby_id")
                pid = d.get("player_id")
                if lid not in lobbies:
                    await ws.send_json({"type":"error","msg":"Lobby not found"})
                    continue
                ws_players[ws] = {"player_id": pid, "lobby_id": lid}
                pdata = d.get("player_data", {})
                lobbies[lid]["players"][pid] = pdata
                # Send existing players to joiner
                others = {p:v for p,v in lobbies[lid]["players"].items() if p != pid}
                await ws.send_json({"type":"init_players","players":others})
                # Announce new player to others
                await bcast_lobby(lid, {"type":"player_join","player_id":pid,"player_data":pdata}, skip=ws)
                await bcast_all(lobby_list_msg())

            elif t == "update":
                info = ws_players.get(ws, {})
                lid = info.get("lobby_id")
                pid = info.get("player_id")
                if lid and pid and lid in lobbies:
                    state = d.get("state", {})
                    lobbies[lid]["players"][pid] = state
                    await bcast_lobby(lid, {"type":"update","player_id":pid,"state":state}, skip=ws)

    except Exception as e:
        print(f"[WS] {e}")
    finally:
        info = ws_players.pop(ws, {})
        pid  = info.get("player_id")
        lid  = info.get("lobby_id")
        if pid and lid and lid in lobbies:
            lobbies[lid]["players"].pop(pid, None)
            await bcast_lobby(lid, {"type":"player_leave","player_id":pid})
            if not lobbies[lid]["players"]:
                del lobbies[lid]
            await bcast_all(lobby_list_msg())
    return ws

# ---- /log-ip ----
async def log_ip(request):
    try:
        body = await request.json()
        ip   = request.headers.get("X-Forwarded-For", request.remote).split(",")[0].strip()
        ua   = body.get("userAgent", "UNKNOWN")
        ts   = datetime.datetime.utcnow().isoformat() + "Z"
        entry = f"[{ts}]\nIP      : {ip}\nAGENT   : {ua}\n--------------------------------------\n\n"
        with open(LOG_FILE, "a", encoding="utf-8") as f:
            f.write(entry)
        print(f"  [LOG] {ts} | {ip}")
    except Exception as e:
        print(f"  [LOG-ERR] {e}")
    return web.json_response({"ok": True})

# ---- static fallback ----
async def static_file(request):
    path = request.match_info.get("path", "index.html") or "index.html"
    fp = STATIC / path
    if not fp.exists() or not fp.is_file():
        fp = STATIC / "index.html"
    mime = mimetypes.guess_type(str(fp))[0] or "application/octet-stream"
    return web.Response(body=fp.read_bytes(), content_type=mime)

# ---- app ----
app = web.Application()
app.router.add_get("/ws", ws_handler)
app.router.add_post("/log-ip", log_ip)
app.router.add_get("/", lambda r: static_file(r))
app.router.add_get("/{path:.+}", static_file)

if __name__ == "__main__":
    print(f"\n  WARZONE server  ->  http://localhost:{PORT}\n")
    web.run_app(app, host="0.0.0.0", port=PORT, print=None)
