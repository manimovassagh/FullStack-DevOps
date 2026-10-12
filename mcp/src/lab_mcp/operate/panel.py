"""The only door from lab-operate to the lab: Mission Control's HTTP API (stdlib only: no subprocess, no Docker).

Mission Control keeps the rules (one pipeline at a time, stage actions paused while CI runs, a same-site check on
every POST). This client sends the header its browser UI sends, `X-Panel: 1`, and turns its refusals into messages
an AI can act on.
"""
from __future__ import annotations

import json
import urllib.error
import urllib.request


class PanelUnavailable(Exception):
    """Mission Control is not reachable."""


class PanelError(Exception):
    """Mission Control refused or failed the request."""

    def __init__(self, status: int, message: str, job: str | None = None):
        super().__init__(message)
        self.status, self.message, self.job = status, message, job


class Panel:
    def __init__(self, base_url: str, timeout: float = 10.0):
        self.base = base_url.rstrip("/")
        self.timeout = timeout

    def get(self, path: str):
        return self._request("GET", path)

    def post(self, path: str) -> dict:
        return self._request("POST", path)

    def _request(self, method: str, path: str):
        req = urllib.request.Request(self.base + path, method=method, data=b"" if method == "POST" else None,
                                     headers={"X-Panel": "1", "Accept": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as r:
                body = r.read()
        except urllib.error.HTTPError as e:
            raw = e.read()
            try:
                data = json.loads(raw or b"{}")
            except ValueError:
                data = {}
            raise PanelError(e.code, data.get("error") or e.reason or f"HTTP {e.code}", data.get("job")) from None
        except (urllib.error.URLError, TimeoutError, ConnectionError, OSError) as e:
            raise PanelUnavailable(
                f"Mission Control is not reachable at {self.base} ({getattr(e, 'reason', e)}). "
                "Start it in the lab repository with `make dashboard-up`.") from None
        return json.loads(body) if body else {}
