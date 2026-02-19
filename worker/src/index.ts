/**
 * MyFitnessPal MCP Server for Cloudflare Workers.
 *
 * @remarks
 * Provides HTTP-accessible MCP tools for MyFitnessPal integration.
 * Uses the BFF proxy API for all data access.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { z } from 'zod';
import { MFPClient } from './mfp-client.js';
import type { Env, MealSlot } from './types.js';

/** Schema for date parameter validation */
const DateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, {
  message: 'Date must be in YYYY-MM-DD format',
}).optional().describe('Date in YYYY-MM-DD format. Defaults to today if not provided.');

/** Schema for meal slot validation */
const MealSlotSchema = z.enum(['Breakfast', 'Lunch', 'Dinner', 'Snacks'])
  .describe('The meal slot to add calories to');

/**
 * Creates and configures the MCP server with all tools.
 */
function createMcpServer(env: Env): McpServer {
  const client = new MFPClient(env);

  const server = new McpServer({
    name: 'myfitnesspal',
    version: '1.0.0',
  });

  // Register get_diary tool
  server.tool(
    'get_diary',
    'Get food diary entries for a specific date. Returns all meals with their food entries and calorie/macro totals.',
    { date: DateSchema },
    async ({ date }) => {
      try {
        const diary = await client.getDiary(date);
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify(diary, null, 2),
          }],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        return {
          content: [{ type: 'text' as const, text: `Error: ${message}` }],
        };
      }
    }
  );

  // Register get_nutrition_summary tool
  server.tool(
    'get_nutrition_summary',
    'Get a nutrition summary for a specific date, including calories, carbs, fat, protein, sodium, and sugar with their goals.',
    { date: DateSchema },
    async ({ date }) => {
      try {
        const summary = await client.getNutritionSummary(date);
        const formatted = `
Nutrition Summary for ${summary.date}
=====================================
Calories: ${summary.calories} / ${summary.caloriesGoal} (${summary.caloriesGoal - summary.calories} remaining)
Carbs:    ${summary.carbs}g / ${summary.carbsGoal}g
Fat:      ${summary.fat}g / ${summary.fatGoal}g
Protein:  ${summary.protein}g / ${summary.proteinGoal}g
Sodium:   ${summary.sodium}mg / ${summary.sodiumGoal}mg
Sugar:    ${summary.sugar}g / ${summary.sugarGoal}g
        `.trim();

        return {
          content: [{ type: 'text' as const, text: formatted }],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        return {
          content: [{ type: 'text' as const, text: `Error: ${message}` }],
        };
      }
    }
  );

  // Register get_goals tool
  server.tool(
    'get_goals',
    'Get your daily calorie and macro goals from MyFitnessPal.',
    {},
    async () => {
      try {
        const goals = await client.getGoals();
        const formatted = `
Your Nutrition Goals
====================
Calories: ${goals.calories} cal

Macros:
  Carbs:   ${goals.carbs}g (${goals.carbsPercent}%)
  Fat:     ${goals.fat}g (${goals.fatPercent}%)
  Protein: ${goals.protein}g (${goals.proteinPercent}%)

Other:
  Sodium:  ${goals.sodium}mg
  Sugar:   ${goals.sugar}g
        `.trim();

        return {
          content: [{ type: 'text' as const, text: formatted }],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        return {
          content: [{ type: 'text' as const, text: `Error: ${message}` }],
        };
      }
    }
  );

  // Register quick_add_calories tool
  server.tool(
    'quick_add_calories',
    'Add calories to your diary using Quick Add. Optionally specify carbs, fat, and protein.',
    {
      meal: MealSlotSchema,
      calories: z.number().int().positive().describe('Number of calories to add'),
      carbs: z.number().min(0).optional().describe('Carbohydrates in grams (optional)'),
      fat: z.number().min(0).optional().describe('Fat in grams (optional)'),
      protein: z.number().min(0).optional().describe('Protein in grams (optional)'),
      date: DateSchema,
    },
    async ({ meal, calories, carbs, fat, protein, date }) => {
      try {
        const result = await client.quickAddCalories({
          meal: meal as MealSlot,
          calories,
          carbs,
          fat,
          protein,
          date,
        });

        if (result.success) {
          let message = `Added ${result.calories} calories to ${result.meal} on ${result.date}`;
          if (carbs !== undefined || fat !== undefined || protein !== undefined) {
            const macros = [];
            if (carbs !== undefined) macros.push(`${carbs}g carbs`);
            if (fat !== undefined) macros.push(`${fat}g fat`);
            if (protein !== undefined) macros.push(`${protein}g protein`);
            message += `\n  Macros: ${macros.join(', ')}`;
          }
          return {
            content: [{ type: 'text' as const, text: message }],
          };
        } else {
          return {
            content: [{ type: 'text' as const, text: `Failed: ${result.message}` }],
          };
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        return {
          content: [{ type: 'text' as const, text: `Error: ${message}` }],
        };
      }
    }
  );

  // Register search_food tool
  server.tool(
    'search_food',
    'Search the MyFitnessPal food database. Returns food items with calories and macros.',
    {
      query: z.string().min(1).describe('Search query (e.g., "banana", "chicken breast", "Chipotle burrito bowl")'),
      page: z.number().int().min(1).optional().describe('Page number for pagination (default: 1)'),
      max_results: z.number().int().min(1).max(50).optional().describe('Maximum results to return (default: 20, max: 50)'),
    },
    async ({ query, page, max_results }) => {
      try {
        const results = await client.searchFood({ query, page, max_results });

        if (results.items.length === 0) {
          return {
            content: [{
              type: 'text' as const,
              text: `No food items found for "${query}".`,
            }],
          };
        }

        const lines: string[] = [
          `Food Search Results for "${query}" (page ${results.page}, ${results.items.length} of ${results.total_results ?? '?'} results)`,
          '='.repeat(60),
        ];

        for (const item of results.items) {
          const nc = item.nutritional_contents;
          const macros = [
            `${nc.calories} cal`,
            nc.carbohydrates !== undefined ? `${nc.carbohydrates}g carbs` : null,
            nc.fat !== undefined ? `${nc.fat}g fat` : null,
            nc.protein !== undefined ? `${nc.protein}g protein` : null,
          ].filter(Boolean).join(', ');

          const brand = item.brand ? ` (${item.brand})` : '';
          const serving = item.serving_size ? ` [${item.serving_size}]` : '';
          const verified = item.verified ? ' [verified]' : '';

          lines.push(`- ${item.name}${brand}${verified}`);
          lines.push(`  ID: ${item.id} | ${macros}${serving}`);
        }

        lines.push('');
        lines.push('Use get_food_details with an ID to see serving sizes, then add_food to log it.');

        return {
          content: [{
            type: 'text' as const,
            text: lines.join('\n'),
          }],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        return {
          content: [{
            type: 'text' as const,
            text: `Error searching food: ${message}`,
          }],
        };
      }
    }
  );

  // Register get_food_details tool
  server.tool(
    'get_food_details',
    'Get detailed nutrition information and serving sizes for a specific food item. Use the food ID from search_food results.',
    {
      food_id: z.string().min(1).describe('The food item ID from search results'),
    },
    async ({ food_id }) => {
      try {
        const details = await client.getFoodDetails(food_id);

        const nc = details.nutritional_contents;
        const lines: string[] = [
          `${details.name}${details.brand ? ` (${details.brand})` : ''}${details.verified ? ' [verified]' : ''}`,
          '='.repeat(40),
          '',
          'Nutrition (per default serving):',
          `  Calories: ${nc.calories}`,
          nc.carbohydrates !== undefined ? `  Carbs:    ${nc.carbohydrates}g` : null,
          nc.fat !== undefined ? `  Fat:      ${nc.fat}g` : null,
          nc.protein !== undefined ? `  Protein:  ${nc.protein}g` : null,
          nc.sodium !== undefined ? `  Sodium:   ${nc.sodium}mg` : null,
          nc.sugar !== undefined ? `  Sugar:    ${nc.sugar}g` : null,
          nc.fiber !== undefined ? `  Fiber:    ${nc.fiber}g` : null,
        ].filter((line): line is string => line !== null);

        if (details.serving_sizes.length > 0) {
          lines.push('');
          lines.push('Serving Sizes:');
          for (const s of details.serving_sizes) {
            lines.push(`  - ${s.value} (ID: ${s.id}, multiplier: ${s.nutrition_multiplier})`);
          }
        }

        lines.push('');
        lines.push(`Raw Data:\n${JSON.stringify(details, null, 2)}`);

        return {
          content: [{
            type: 'text' as const,
            text: lines.join('\n'),
          }],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        return {
          content: [{
            type: 'text' as const,
            text: `Error fetching food details: ${message}`,
          }],
        };
      }
    }
  );

  // Register add_food tool
  server.tool(
    'add_food',
    'Add a food item to your diary. Use search_food to find the food ID first. Optionally use get_food_details to find a specific serving size.',
    {
      food_id: z.string().min(1).describe('The food item ID from search results'),
      meal: MealSlotSchema,
      quantity: z.number().positive().describe('Number of servings (e.g., 1, 0.5, 2)'),
      serving_id: z.string().optional().describe('Serving size ID from get_food_details (uses default if not specified)'),
      date: DateSchema,
    },
    async ({ food_id, meal, quantity, serving_id, date }) => {
      try {
        const result = await client.addFood({
          food_id,
          meal: meal as MealSlot,
          quantity,
          serving_id,
          date,
        });

        if (result.success) {
          return {
            content: [{ type: 'text' as const, text: result.message }],
          };
        } else {
          return {
            content: [{ type: 'text' as const, text: `Failed: ${result.message}` }],
          };
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        return {
          content: [{ type: 'text' as const, text: `Error adding food: ${message}` }],
        };
      }
    }
  );

  return server;
}

// Create the Hono app
const app = new Hono<{ Bindings: Env }>();

// Enable CORS for cross-origin requests
app.use('*', cors({
  origin: '*',
  allowMethods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
  allowHeaders: [
    'Content-Type',
    'Authorization',
    'Accept',
    'MCP-Session-Id',
    'MCP-Protocol-Version',
    'Last-Event-ID',
  ],
  exposeHeaders: [
    'MCP-Session-Id',
    'MCP-Protocol-Version',
  ],
}));

// Health check endpoint
app.get('/', (c) => {
  return c.json({
    name: 'myfitnesspal-mcp',
    version: '1.0.0',
    status: 'ok',
    endpoints: {
      mcp: '/mcp',
      health: '/',
    },
  });
});

// MCP endpoint - handles all MCP protocol requests
app.all('/mcp', async (c) => {
  const server = createMcpServer(c.env);
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });

  await server.connect(transport);

  try {
    const originalRequest = c.req.raw;
    const headers = new Headers(originalRequest.headers);

    const acceptHeader = headers.get('Accept') || '';
    if (!acceptHeader.includes('text/event-stream')) {
      headers.set('Accept', 'application/json, text/event-stream');
    }

    const modifiedRequest = new Request(originalRequest.url, {
      method: originalRequest.method,
      headers: headers,
      body: originalRequest.method !== 'GET' && originalRequest.method !== 'HEAD'
        ? originalRequest.body
        : undefined,
      // @ts-expect-error - duplex is needed for streaming body
      duplex: originalRequest.method !== 'GET' && originalRequest.method !== 'HEAD' ? 'half' : undefined,
    });

    const response = await transport.handleRequest(modifiedRequest);
    return response;
  } finally {
    await server.close();
  }
});

// Export for Cloudflare Workers
export default app;
