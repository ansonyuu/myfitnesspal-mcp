# MyFitnessPal MCP Server

A Model Context Protocol (MCP) server that integrates with MyFitnessPal to retrieve nutrition data and log calories.

## Features

| Tool | Description |
|------|-------------|
| `get_diary` | Get food diary entries for a specific date |
| `get_nutrition_summary` | Get calories and macros summary for a date |
| `get_goals` | Get your calorie and macro goals |
| `quick_add_calories` | Add calories to a meal slot using Quick Add |

## Prerequisites

- Node.js 18+
- A MyFitnessPal account
- Active session in your browser

## Installation

```bash
npm install
```

## Setup: Exporting Your Session Cookie

Since MyFitnessPal doesn't have a public API, this server uses cookie-based authentication.

### Option 1: Use the Helper Script

```bash
npm run export-cookies
```

Follow the interactive prompts to create your `.env` file.

### Option 2: Manual Setup

1. **Log into MyFitnessPal** in your browser
2. **Open Developer Tools** (F12 or Cmd+Option+I on Mac)
3. **Go to Application/Storage tab** → Cookies → www.myfitnesspal.com
4. **Find the session cookie** (look for `mfp_session` or similar)
5. **Copy the cookie value**
6. **Create a `.env` file** in the project root:

```env
MFP_SESSION_COOKIE=your_session_cookie_value_here
MFP_USERNAME=your_username
```

## Usage

### Building

```bash
npm run build
```

### Running the Server

```bash
npm start
```

Or for development:

```bash
npm run dev
```

### Adding to Cursor

Add this to your `.cursor/mcp.json`:

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

Or for development with tsx:

```json
{
  "mcpServers": {
    "myfitnesspal": {
      "type": "stdio",
      "command": "npx",
      "args": ["tsx", "/path/to/myfitnesspal-mcp/src/index.ts"]
    }
  }
}
```

## Tool Examples

### Get Today's Diary

```
get_diary
```

Returns all meals with their food entries.

### Get Diary for a Specific Date

```
get_diary(date: "2024-01-15")
```

### Get Nutrition Summary

```
get_nutrition_summary(date: "2024-01-15")
```

Returns calories and macros consumed vs goals.

### Get Your Goals

```
get_goals
```

Returns your daily calorie and macro targets.

### Quick Add Calories

```
quick_add_calories(meal: "Lunch", calories: 500)
```

Adds 500 calories to your lunch.

### Quick Add with Macros

```
quick_add_calories(
  meal: "Dinner",
  calories: 800,
  carbs: 60,
  fat: 30,
  protein: 40
)
```

## Session Expiration

MyFitnessPal session cookies typically expire after about 30 days. If you get authentication errors, run the export-cookies script again to update your cookie.

## Technical Notes

- Uses web scraping since MyFitnessPal's API is private
- Cookie-based authentication (session cookies from your browser)
- Built with TypeScript and the MCP SDK
- Uses Cheerio for HTML parsing

## License

MIT

## Disclaimer

This is an unofficial integration for personal use. Please respect MyFitnessPal's Terms of Service.

