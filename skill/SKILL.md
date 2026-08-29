---
name: wellness-cgm
description: >
  Local-first CGM MCP for agents. Prefer MCP tools if connected; otherwise the package CLI.
  Use when the user wants Wellness CGM data or actions through an agent.
---

# Wellness CGM — skill or MCP

Same binary either way. Do not duplicate the API client.

## Choose a surface

**MCP** — tools appear natively after stdio/HTTP config:

```json
{ "mcpServers": { "wellness-cgm": { "command": "npx", "args": ["-y", "wellness-cgm"] } } }
```

Do not put mutation flags in that snippet.

**Skill / CLI** — no MCP client required. Same tools:

```bash
npx -y wellness-cgm call cgm_connection_status --json '{}'
```

If MCP tools named `cgm_*` are already available, use them. Do not also shell out.

## Loop

1. Call `cgm_connection_status` (or `doctor --json` when that exists).
2. Use read tools as asked.
3. Stop on `USER_ACTION_REQUIRED`. Do not invent env flags. Do not enable mutations from this skill.

## Never

- Paste tokens into git, chat logs, or the prompt
- Copy a mutations-enabled assignment into config
