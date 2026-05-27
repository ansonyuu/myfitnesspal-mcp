#!/usr/bin/env node
/**
 * MyFitnessPal MCP Server.
 *
 * @remarks
 * Provides tools for interacting with MyFitnessPal:
 * - search_food / get_food_details: Look up foods and serving sizes
 * - get_diary: Retrieve individual diary entries (with ids) for a date
 * - get_nutrition_summary: Get calories and macros summary for a date
 * - get_goals: Get your calorie and macro goals
 * - add_food: Log a named food entry to a meal
 * - edit_entry / delete_diary_entry: Modify or remove a diary entry
 * - quick_add_calories: Add bare calories to a meal slot
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { createAuthManager } from './auth.js';
import { createMFPClient } from './mfp-client.js';
import type { MealSlot } from './types.js';

/** Schema for date parameter validation */
const DateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, {
  message: 'Date must be in YYYY-MM-DD format',
}).optional().describe('Date in YYYY-MM-DD format. Defaults to today if not provided.');

/** Schema for meal slot validation */
const MealSlotSchema = z.enum(['Breakfast', 'Lunch', 'Dinner', 'Snacks'])
  .describe('The meal slot to add calories to');

/**
 * Main entry point for the MCP server.
 */
async function main(): Promise<void> {
  // Initialize authentication
  const auth = await createAuthManager();
  const client = createMFPClient(auth);

  // Create the MCP server
  const server = new McpServer({
    name: 'myfitnesspal',
    version: '1.0.0',
  });

  // Register the get_diary tool
  server.tool(
    'get_diary',
    'Get food diary entries for a specific date. Returns each meal with its individual food entries (each has an `id` for edit/delete) and calorie/macro totals.',
    {
      date: DateSchema,
    },
    async ({ date }): Promise<{ content: Array<{ type: 'text'; text: string }> }> => {
      try {
        const diary = await client.getDiary(date);
        return {
          content: [{
            type: 'text',
            text: JSON.stringify(diary, null, 2),
          }],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error occurred';
        return {
          content: [{
            type: 'text',
            text: `Error fetching diary: ${message}`,
          }],
        };
      }
    }
  );

  // Register the get_nutrition_summary tool
  server.tool(
    'get_nutrition_summary',
    'Get a nutrition summary for a specific date, including calories, carbs, fat, protein, sodium, and sugar with their goals.',
    {
      date: DateSchema,
    },
    async ({ date }): Promise<{ content: Array<{ type: 'text'; text: string }> }> => {
      try {
        const summary = await client.getNutritionSummary(date);
        
        // Format a nice summary
        const formatted = `
Nutrition Summary for ${summary.date}
=====================================
Calories: ${summary.calories} / ${summary.caloriesGoal} (${summary.caloriesGoal - summary.calories} remaining)
Carbs:    ${summary.carbs}g / ${summary.carbsGoal}g
Fat:      ${summary.fat}g / ${summary.fatGoal}g
Protein:  ${summary.protein}g / ${summary.proteinGoal}g
Sodium:   ${summary.sodium}mg / ${summary.sodiumGoal}mg
Sugar:    ${summary.sugar}g / ${summary.sugarGoal}g

Raw Data:
${JSON.stringify(summary, null, 2)}
        `.trim();
        
        return {
          content: [{
            type: 'text',
            text: formatted,
          }],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error occurred';
        return {
          content: [{
            type: 'text',
            text: `Error fetching nutrition summary: ${message}`,
          }],
        };
      }
    }
  );

  // Register the get_goals tool
  server.tool(
    'get_goals',
    'Get your daily calorie and macro goals from MyFitnessPal.',
    {},
    async (): Promise<{ content: Array<{ type: 'text'; text: string }> }> => {
      try {
        const goals = await client.getGoals();
        
        // Format a nice summary
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

Raw Data:
${JSON.stringify(goals, null, 2)}
        `.trim();
        
        return {
          content: [{
            type: 'text',
            text: formatted,
          }],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error occurred';
        return {
          content: [{
            type: 'text',
            text: `Error fetching goals: ${message}`,
          }],
        };
      }
    }
  );

  // Register the quick_add_calories tool
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
    async ({ meal, calories, carbs, fat, protein, date }): Promise<{ content: Array<{ type: 'text'; text: string }> }> => {
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
          let message = `✓ Added ${result.calories} calories to ${result.meal} on ${result.date}`;
          if (carbs !== undefined || fat !== undefined || protein !== undefined) {
            const macros = [];
            if (carbs !== undefined) macros.push(`${carbs}g carbs`);
            if (fat !== undefined) macros.push(`${fat}g fat`);
            if (protein !== undefined) macros.push(`${protein}g protein`);
            message += `\n  Macros: ${macros.join(', ')}`;
          }
          return {
            content: [{
              type: 'text',
              text: message,
            }],
          };
        } else {
          return {
            content: [{
              type: 'text',
              text: `✗ ${result.message}`,
            }],
          };
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error occurred';
        return {
          content: [{
            type: 'text',
            text: `Error with Quick Add: ${message}`,
          }],
        };
      }
    }
  );

  // Register the search_food tool
  server.tool(
    'search_food',
    'Search the MyFitnessPal food database. Returns food items with calories and macros.',
    {
      query: z.string().min(1).describe('Search query (e.g., "banana", "chicken breast", "Chipotle burrito bowl")'),
      page: z.number().int().min(1).optional().describe('Page number for pagination (default: 1)'),
      max_results: z.number().int().min(1).max(50).optional().describe('Maximum results to return (default: 20, max: 50)'),
    },
    async ({ query, page, max_results }): Promise<{ content: Array<{ type: 'text'; text: string }> }> => {
      try {
        const results = await client.searchFood({ query, page, max_results });

        if (results.items.length === 0) {
          return {
            content: [{
              type: 'text',
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
          const verified = item.verified ? ' ✓' : '';

          lines.push(`• ${item.name}${brand}${verified}`);
          lines.push(`  ID: ${item.id} | ${macros}${serving}`);
        }

        lines.push('');
        lines.push('Use get_food_details with an ID to see serving sizes, then add_food to log it.');

        return {
          content: [{
            type: 'text',
            text: lines.join('\n'),
          }],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error occurred';
        return {
          content: [{
            type: 'text',
            text: `Error searching food: ${message}`,
          }],
        };
      }
    }
  );

  // Register the get_food_details tool
  server.tool(
    'get_food_details',
    'Get detailed nutrition information and serving sizes for a specific food item. Use the food ID from search_food results.',
    {
      food_id: z.string().min(1).describe('The food item ID from search results'),
    },
    async ({ food_id }): Promise<{ content: Array<{ type: 'text'; text: string }> }> => {
      try {
        const details = await client.getFoodDetails(food_id);

        const nc = details.nutritional_contents;
        const lines: string[] = [
          `${details.name}${details.brand ? ` (${details.brand})` : ''}${details.verified ? ' ✓' : ''}`,
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
            lines.push(`  • ${s.value} (ID: ${s.id}, multiplier: ${s.nutrition_multiplier})`);
          }
        }

        lines.push('');
        lines.push(`Raw Data:\n${JSON.stringify(details, null, 2)}`);

        return {
          content: [{
            type: 'text',
            text: lines.join('\n'),
          }],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error occurred';
        return {
          content: [{
            type: 'text',
            text: `Error fetching food details: ${message}`,
          }],
        };
      }
    }
  );

  // Register the add_food tool
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
    async ({ food_id, meal, quantity, serving_id, date }): Promise<{ content: Array<{ type: 'text'; text: string }> }> => {
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
            content: [{
              type: 'text',
              text: `✓ ${result.message}${result.entry_id ? `\n  Entry ID: ${result.entry_id} (use this to edit or delete)` : ''}`,
            }],
          };
        } else {
          return {
            content: [{
              type: 'text',
              text: `✗ ${result.message}`,
            }],
          };
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error occurred';
        return {
          content: [{
            type: 'text',
            text: `Error adding food: ${message}`,
          }],
        };
      }
    }
  );

  // Register the delete_diary_entry tool
  server.tool(
    'delete_diary_entry',
    'Delete a diary entry by its entry ID (get the ID from get_diary). Permanent.',
    {
      entry_id: z.string().min(1).describe('The diary entry ID to delete (from get_diary)'),
    },
    async ({ entry_id }): Promise<{ content: Array<{ type: 'text'; text: string }> }> => {
      try {
        const result = await client.deleteEntry(entry_id);
        return {
          content: [{
            type: 'text',
            text: result.success ? `✓ ${result.message}` : `✗ ${result.message}`,
          }],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error occurred';
        return {
          content: [{
            type: 'text',
            text: `Error deleting entry: ${message}`,
          }],
        };
      }
    }
  );

  // Register the edit_entry tool
  server.tool(
    'edit_entry',
    'Edit an existing diary entry\'s servings and/or meal slot. Get the entry ID and its date from get_diary. At least one of servings or meal must be provided.',
    {
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { message: 'Date must be in YYYY-MM-DD format' })
        .describe('Date of the entry in YYYY-MM-DD format (from get_diary)'),
      entry_id: z.string().min(1).describe('The diary entry ID to edit (from get_diary)'),
      servings: z.number().positive().optional().describe('New number of servings (optional)'),
      meal: z.enum(['Breakfast', 'Lunch', 'Dinner', 'Snacks']).optional().describe('New meal slot (optional)'),
    },
    async ({ date, entry_id, servings, meal }): Promise<{ content: Array<{ type: 'text'; text: string }> }> => {
      try {
        if (servings === undefined && meal === undefined) {
          return {
            content: [{ type: 'text', text: '✗ Provide at least one of `servings` or `meal` to change.' }],
          };
        }
        const result = await client.editEntry({
          date,
          entry_id,
          servings,
          meal: meal as MealSlot | undefined,
        });
        return {
          content: [{
            type: 'text',
            text: `✓ ${result.message}${result.entry_id ? `\n  New entry ID: ${result.entry_id}` : ''}`,
          }],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error occurred';
        return {
          content: [{
            type: 'text',
            text: `Error editing entry: ${message}`,
          }],
        };
      }
    }
  );

  // Start the server
  const transport = new StdioServerTransport();
  await server.connect(transport);
  
  // Log to stderr since stdout is used for MCP communication
  console.error('MyFitnessPal MCP server started');
}

// Run the server
main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});



