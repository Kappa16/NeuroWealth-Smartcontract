import json
import os
import subprocess
import sys
from datetime import datetime, timezone

size, sha, branch, path = int(sys.argv[1]), sys.argv[2], sys.argv[3], sys.argv[4]

payload = {}
if os.path.exists(path):
    with open(path, encoding="utf-8") as handle:
        payload = json.load(handle)

history = payload.get(branch, {}).get("history", [])
history.append({"sha": sha, "size_bytes": size})
updated_history = history[-20:]

payload[branch] = {
    "latest": {
        "sha": sha,
        "size_bytes": size,
        "timestamp_utc": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    },
    "history": updated_history,
}

with open(path, "w", encoding="utf-8") as handle:
    json.dump(payload, handle, indent=2)
    handle.write("\n")

subprocess.run(["git", "config", "user.name", "github-actions[bot]"], check=True)
subprocess.run(["git", "config", "user.email", "41898282+github-actions[bot]@users.noreply.github.com"], check=True)
subprocess.run(["git", "add", path], check=True)

if subprocess.run(["git", "diff", "--cached", "--quiet"]).returncode != 0:
    subprocess.run(["git", "commit", "-m", f"chore(ci): update wasm size baseline for {branch}"], check=True)
    subprocess.run(["git", "push", "origin", f"HEAD:{branch}"], check=True)
