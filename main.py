#!/usr/bin/env python3
"""Installs this repository's Claude Code plugin from a cli-tools-kit installer.

An installer built on cli-tools-kit (https://github.com/Probst1nator/cli-tools-kit)
finds this file, asks it what it offers (--advertise), and runs --install or
--remove, which call `claude plugin` through cli-tools-kit 1.5.0 or newer.
Without such an installer, install the plugin as the README says.
"""
import json
import sys

PLUGIN = "clawd@clawd"
MARKETPLACE = "Probst1nator/clawd"

if "--advertise" in sys.argv:
    print(json.dumps([{
        "name": "clawd",
        "desktop_file": "clawd.desktop",
        "icon": "applications-games",
        "desc": "Clawd, the Claude Code logo, runs around in the band above the prompt and reacts to the session.",
        "tags": ["Plugin"],
        "capability": "claude-mod",
        "claude_plugin": PLUGIN,
        "claude_marketplace": MARKETPLACE,
    }]))
    sys.exit(0)

try:
    from cli_tools_kit import plugins
except ImportError:
    sys.exit("Installing this plugin from an installer needs cli-tools-kit 1.5.0 or newer: "
             "pip install -U cli-tools-kit")
sys.exit(plugins.main(PLUGIN, MARKETPLACE))
