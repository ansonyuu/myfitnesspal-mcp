# MyFitnessPal MCP Server

An MCP server that lets AI assistants read and log your MyFitnessPal nutrition data. Track calories, macros, search foods, and add meals — all through natural conversation.

## Tools

| Tool | Description |
|------|-------------|
| `get_diary` | Get the individual diary entries for a date (each with its entry `id`, grouped by meal) |
| `get_nutrition_summary` | Get calories and macros summary for a date |
| `get_goals` | Get your daily calorie and macro targets |
| `search_food` | Search the MFP food database |
| `get_food_details` | Get nutrition info and serving sizes for a food item |
| `add_food` | Log a food item to your diary as a named entry |
| `edit_entry` | Change an existing entry's servings and/or meal |
| `delete_diary_entry` | Delete a diary entry by its `id` |
| `quick_add_calories` | Quick-add bare calories (and optionally macros) to a meal |

## Setup

### 1. Get your session cookie

MyFitnessPal doesn't have a public API, so this server authenticates using your browser's session cookie.

1. Log into [MyFitnessPal](https://www.myfitnesspal.com) in your browser
2. Open DevTools (`F12` or `Cmd+Option+I`)
3. Go to **Application** → **Cookies** → `www.myfitnesspal.com`
4. Copy the full cookie string (or use the helper script below)

**Or use the helper script:**

```bash
npm run export-cookies
```

### 2. Configure environment

```bash
cp env.example .env
```

Fill in your values:

```env
MFP_SESSION_COOKIE=your_session_cookie_value_here
MFP_USERNAME=your_username
```

### 3. Build

```bash
npm install
npm run build
```

## Usage

### Claude Code

Add to `~/.claude/settings.json`:

```json
{
  "mcpServers": {
    "myfitnesspal": {
      "type": "stdio",
      "command": "node",
      "args": ["/path/to/myfitnesspal-mcp/dist/index.js"]
    }
  }
}
```

### Cursor

Add to `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "myfitnesspal": {
      "type": "stdio",
      "command": "node",
      "args": ["/path/to/myfitnesspal-mcp/dist/index.js"]
    }
  }
}
```

### Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS):

```json
{
  "mcpServers": {
    "myfitnesspal": {
      "type": "stdio",
      "command": "node",
      "args": ["/path/to/myfitnesspal-mcp/dist/index.js"]
    }
  }
}
```

Replace `/path/to/myfitnesspal-mcp` with the actual path to this repo.

## Remote Deployment (Cloudflare Workers)

The `worker/` directory contains a Cloudflare Workers deployment for using this as a remote MCP server.

```bash
cd worker
npm install
npx wrangler login
npx wrangler deploy
npx wrangler secret put MFP_SESSION_COOKIE   # paste your cookie when prompted
```

Then connect from Claude Desktop:

```json
{
  "mcpServers": {
    "myfitnesspal": {
      "command": "npx",
      "args": ["mcp-remote", "https://myfitnesspal-mcp.<your-subdomain>.workers.dev/mcp"]
    }
  }
}
```

## Session Expiration

MFP session cookies expire roughly every 30 days. If you get auth errors, grab a fresh cookie from your browser and update your `.env` (or run `npx wrangler secret put MFP_SESSION_COOKIE` for the worker).

## License

MIT

## Disclaimer

Unofficial integration for personal use. Please respect MyFitnessPal's Terms of Service.
