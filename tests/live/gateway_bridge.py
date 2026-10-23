"""JSON-lines bridge to the REAL Hermes gateway RPC handlers.

Used only by tests/live-backend.test.mjs. It points HERMES_HOME at a throwaway
directory (never the user's real one), seeds a few stored sessions, then answers
one JSON request per stdin line with the gateway's real `handle_request` result.

    {"id": 1, "method": "session.list", "params": {...}}
 -> {"id": 1, "response": {"jsonrpc": "2.0", "id": "1", "result": {...} | "error": {...}}}

Special methods (not part of Hermes): `__seed__` {sessions: [{id, title?, cwd?, messages?}]}.
"""

import json
import os
import sys

# The gateway repoints sys.stdout (it owns that stream for its own protocol), so keep ours.
REPLY = sys.stdout

home = os.environ["HERMES_HOME"]  # set by the Node test to a temp dir
agent_dir = os.environ["HERMES_AGENT_DIR"]
sys.path.insert(0, agent_dir)

from hermes_state import SessionDB  # noqa: E402
import tui_gateway.server as server  # noqa: E402


def seed(spec):
    db = SessionDB()
    for s in spec.get("sessions", []):
        kwargs = {}
        if s.get("cwd"):
            kwargs["cwd"] = s["cwd"]
        db.create_session(s["id"], "desktop", model="test-model", **kwargs)
        for i in range(s.get("messages", 2)):
            db.append_message(s["id"], "user" if i % 2 == 0 else "assistant", f"message {i} of {s['id']}")
        if s.get("title"):
            db.set_session_title(s["id"], s["title"])
    return {"seeded": len(spec.get("sessions", []))}


def main():
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        req = json.loads(line)
        try:
            if req["method"] == "__seed__":
                response = {"jsonrpc": "2.0", "id": str(req["id"]), "result": seed(req.get("params", {}))}
            else:
                response = server.handle_request(
                    {"jsonrpc": "2.0", "id": str(req["id"]), "method": req["method"], "params": req.get("params", {})}
                )
        except Exception as exc:  # surfaced to the test as a failure, never swallowed
            response = {"jsonrpc": "2.0", "id": str(req["id"]), "error": {"code": -1, "message": f"bridge exception: {exc!r}"}}
        REPLY.write(json.dumps({"id": req["id"], "response": response}, default=str) + "\n")
        REPLY.flush()


main()
