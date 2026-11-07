#!/bin/bash
# Double-click to open the dashboard (macOS). Serves this folder at http://localhost:8000.
# Close this window (or press Ctrl+C) to stop.
cd "$(dirname "$0")" || exit 1
PORT=8000
(sleep 1; open "http://localhost:$PORT" 2>/dev/null || xdg-open "http://localhost:$PORT" 2>/dev/null) &
echo "KYC dashboard running at http://localhost:$PORT  (Ctrl+C to stop)"
python3 -m http.server "$PORT"
