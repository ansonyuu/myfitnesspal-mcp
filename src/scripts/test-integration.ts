/**
 * Integration test for all MFP client operations via BFF proxy.
 *
 * Usage: npx tsx src/scripts/test-integration.ts
 */

import { createAuthManager } from '../auth.js';
import { createMFPClient } from '../mfp-client.js';

async function main(): Promise<void> {
  console.log('=== MyFitnessPal MCP Integration Test ===\n');

  const auth = await createAuthManager();
  const client = createMFPClient(auth);

  // 1. Verify session
  console.log('1. Verifying session...');
  const valid = await client.verifySession();
  console.log(`   ${valid ? 'OK' : 'FAIL'} Session ${valid ? 'valid' : 'invalid'}\n`);
  if (!valid) {
    console.error('Session invalid. Update MFP_SESSION_COOKIE in .env');
    process.exit(1);
  }

  // 2. Search food
  console.log('2. Searching for "banana"...');
  try {
    const results = await client.searchFood({ query: 'banana', max_results: 3 });
    console.log(`   OK Found ${results.items.length} results`);
    for (const item of results.items) {
      console.log(`   - ${item.name} (${item.nutritional_contents.calories} cal) [ID: ${item.id}]`);
    }
    console.log();

    // 3. Get food details for first result
    if (results.items.length > 0) {
      const foodId = results.items[0].id;
      console.log(`3. Getting details for food ID ${foodId}...`);
      const details = await client.getFoodDetails(foodId);
      console.log(`   OK ${details.name}`);
      console.log(`   Calories: ${details.nutritional_contents.calories}`);
      console.log(`   Serving sizes: ${details.serving_sizes.length}`);
      for (const s of details.serving_sizes.slice(0, 3)) {
        console.log(`   - ${s.value} (multiplier: ${s.nutrition_multiplier}, ID: ${s.id})`);
      }
      console.log();
    } else {
      console.log('3. Skipping food details (no search results)\n');
    }
  } catch (error) {
    console.error(`   FAIL: ${error instanceof Error ? error.message : error}\n`);
  }

  // 4. Get diary for today
  const today = new Date().toISOString().split('T')[0];
  console.log(`4. Getting diary for ${today}...`);
  try {
    const diary = await client.getDiary(today);
    console.log(`   OK ${diary.meals.length} meals, ${diary.totalCalories} total calories`);
    for (const meal of diary.meals) {
      if (meal.entries.length > 0) {
        console.log(`   ${meal.name}: ${meal.totalCalories} cal (${meal.entries.length} entries)`);
      }
    }
  } catch (error) {
    console.error(`   FAIL: ${error instanceof Error ? error.message : error}`);
  }
  console.log();

  // 5. Quick add test (small amount to Snacks on a past date to avoid polluting today)
  const testDate = '2026-02-12';
  console.log(`5. Quick adding 50 cal to Snacks on ${testDate}...`);
  try {
    const result = await client.quickAddCalories({
      meal: 'Snacks',
      calories: 50,
      protein: 5,
      date: testDate,
    });
    console.log(`   ${result.success ? 'OK' : 'FAIL'} ${result.message}`);
  } catch (error) {
    console.error(`   FAIL: ${error instanceof Error ? error.message : error}`);
  }
  console.log();

  // 6. Verify the quick add by reading diary
  console.log(`6. Verifying diary for ${testDate}...`);
  try {
    const diary = await client.getDiary(testDate);
    console.log(`   OK ${diary.totalCalories} total calories`);
    const snacks = diary.meals.find(m => m.name === 'Snacks');
    if (snacks && snacks.entries.length > 0) {
      console.log(`   Snacks: ${snacks.totalCalories} cal (${snacks.entries.length} entries)`);
    }
  } catch (error) {
    console.error(`   FAIL: ${error instanceof Error ? error.message : error}`);
  }
  console.log();

  // 7. Get nutrition summary
  console.log(`7. Getting nutrition summary for ${testDate}...`);
  try {
    const summary = await client.getNutritionSummary(testDate);
    console.log(`   OK Calories: ${summary.calories}`);
    console.log(`   Carbs: ${summary.carbs}g, Fat: ${summary.fat}g, Protein: ${summary.protein}g`);
  } catch (error) {
    console.error(`   FAIL: ${error instanceof Error ? error.message : error}`);
  }
  console.log();

  console.log('=== Integration test complete ===');
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
