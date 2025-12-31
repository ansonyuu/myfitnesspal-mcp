#!/usr/bin/env node
/**
 * MyFitnessPal MCP Server.
 *
 * @remarks
 * Provides tools for interacting with MyFitnessPal:
 * - get_diary: Retrieve food diary entries for a specific date
 * - get_nutrition_summary: Get calories and macros summary for a date
 * - get_goals: Get your calorie and macro goals
 * - quick_add_calories: Add calories to a meal slot using Quick Add
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { createAuthManager } from './auth.js';
import { createMFPClient, MFPClient } from './mfp-client.js';
import type { MealSlot } from './types.js';

/** Valid meal slot values */
const MEAL_SLOTS: MealSlot[] = ['Breakfast', 'Lunch', 'Dinner', 'Snacks'];

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
    'Get food diary entries for a specific date. Returns all meals with their food entries and calorie/macro totals.',
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

