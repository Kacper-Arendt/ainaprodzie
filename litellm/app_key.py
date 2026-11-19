"""Creates the app's virtual key in LiteLLM, or brings an existing one in line with APP_KEY, then stays up.

The app calls LiteLLM with this key, not with the master key (chat ADR 0002). Run by the litellm-app-key service of
compose.yaml; in production an administrator runs the same requests once, and the key goes to the app as a secret.
"""

import json
import os
import signal
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

LITELLM_URL = os.environ["LITELLM_URL"]
MASTER_KEY = os.environ["LITELLM_MASTER_KEY"]

# What the app may do: call the aliases of the access group app in config.yaml, spend at most $1 a day (the day
# resets at midnight UTC) and send at most 60 requests a minute. Over the budget LiteLLM answers 422, over the rate
# limit 429. The admin UI (http://localhost:4000/ui) shows the key's spend.
APP_KEY = {
    "key": os.environ["LITELLM_APP_KEY"],
    "key_alias": "retrofit-app",
    "models": ["app"],
    "max_budget": 1.0,
    "budget_duration": "1d",
    "rpm_limit": 60,
}

# The healthcheck's mark: docker compose up --wait, which Spring Boot runs, lets the app start only once it exists.
READY = Path("/tmp/app-key-ready")


def call(method, path, body=None):
    request = urllib.request.Request(
        LITELLM_URL + path,
        method=method,
        data=json.dumps(body).encode() if body is not None else None,
        headers={"Authorization": "Bearer " + MASTER_KEY, "Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(request, timeout=10) as response:
            return response.status
    except urllib.error.HTTPError as error:
        if error.code != 404:
            print(f"{method} {path} answered {error.code}: {error.read().decode()}", file=sys.stderr)
        return error.code


def main():
    # LiteLLM's /key/generate answers 200 for a key that exists and leaves it unchanged, so an existing key is updated.
    exists = call("GET", "/key/info?key=" + urllib.parse.quote(APP_KEY["key"])) == 200
    if call("POST", "/key/update" if exists else "/key/generate", APP_KEY) != 200:
        sys.exit(1)
    print("The app's key " + APP_KEY["key_alias"] + (" updated" if exists else " created"), flush=True)
    READY.touch()
    # docker compose up --wait counts a container that exits as failed, even with status 0.
    signal.pause()


if __name__ == "__main__":
    main()
