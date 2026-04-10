#!/usr/bin/env bash
#
# One-time setup: build the browser-tools plugin for the Claude Agent SDK backend.
#
# Copies ~/.pi/agent/skills/browser-tools into ~/.live-city/agent/skills/browser-tools,
# wraps it as a Claude Agent SDK plugin, and substitutes the {baseDir} template
# placeholders (pi substituted these at load time; the Claude SDK does not).
#
# Run once before the first `AGENT_RUNTIME=claude` invocation. Safe to re-run
# (overwrites any existing files in the destination).

set -euo pipefail

DEST="$HOME/.live-city/agent"
SRC="$HOME/.pi/agent/skills/browser-tools"
SKILL_DEST="$DEST/skills/browser-tools"

if [[ ! -d "$SRC" ]]; then
  echo "ERROR: source skill not found at $SRC" >&2
  echo "       install pi-coding-agent first, or point SRC at another browser-tools skill dir." >&2
  exit 1
fi

mkdir -p "$DEST/.claude-plugin"
mkdir -p "$SKILL_DEST"

# Plugin manifest
cat > "$DEST/.claude-plugin/plugin.json" <<'JSON'
{
  "name": "live-city-browser-skills",
  "version": "1.0.0",
  "description": "Isolated browser automation skill (CDP-backed) for live-city Claude Agent SDK sessions."
}
JSON

# Copy every file from the source skill dir into the destination
# (use /. so hidden files are included; -R preserves structure)
cp -R "$SRC/." "$SKILL_DEST/"

# Fix {baseDir} templating — pi substituted this at load time, Claude SDK does not.
# Replace with the absolute path to the skill directory.
ABS_SKILL_DIR="$SKILL_DEST"
SKILL_MD="$SKILL_DEST/SKILL.md"
if [[ -f "$SKILL_MD" ]]; then
  # macOS sed requires an empty -i argument; Linux does not. Detect and branch.
  if [[ "$(uname -s)" == "Darwin" ]]; then
    sed -i '' "s|{baseDir}|$ABS_SKILL_DIR|g" "$SKILL_MD"
  else
    sed -i "s|{baseDir}|$ABS_SKILL_DIR|g" "$SKILL_MD"
  fi
else
  echo "WARNING: $SKILL_MD not found — skill may not load correctly." >&2
fi

# Install CLI script deps (puppeteer, etc.) inside the skill dir
if [[ -f "$SKILL_DEST/package.json" ]]; then
  (cd "$SKILL_DEST" && npm install --silent)
fi

echo ""
echo "browser-tools plugin installed at $DEST"
echo "  plugin root:    $DEST"
echo "  skill dir:      $SKILL_DEST"
echo "  manifest:       $DEST/.claude-plugin/plugin.json"
echo ""
echo "Verify: grep -c '{baseDir}' '$SKILL_MD' should print 0."
