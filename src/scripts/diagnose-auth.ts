/**
 * Final round: fix diary listing + try food_entry measure format.
 */
import { config } from 'dotenv';
config();

const COOKIE = process.env.MFP_SESSION_COOKIE ?? '';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const hdrs = {
  'Cookie': COOKIE,
  'User-Agent': UA,
  'Accept': 'application/json',
  'Referer': 'https://www.myfitnesspal.com/',
};
const BASE = 'https://www.myfitnesspal.com/api/services';

async function get(label: string, url: string): Promise<any> {
  const resp = await fetch(url, { headers: hdrs });
  const text = await resp.text();
  const j = text.startsWith('{') || text.startsWith('[');
  console.log(`${resp.status} | ${label}`);
  if (j) console.log(`  ${text.slice(0, 300)}`);
  else if (resp.status !== 404) console.log(`  (non-JSON ${text.length})`);
  console.log();
  return j ? JSON.parse(text) : null;
}

async function post(label: string, url: string, body: any): Promise<any> {
  const resp = await fetch(url, {
    method: 'POST',
    headers: { ...hdrs, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await resp.text();
  const j = text.startsWith('{') || text.startsWith('[');
  console.log(`${resp.status} | POST ${label}`);
  if (j) console.log(`  ${text.slice(0, 500)}`);
  console.log();
  return j ? JSON.parse(text) : null;
}

async function main() {
  const testDate = '2026-02-15';

  // DIARY LISTING: try all param variations
  console.log('=== DIARY LIST: param variations ===');
  await get('diary?date=2026-02-15', `${BASE}/diary?date=${testDate}`);
  await get('diary?entry_date=2026-02-15', `${BASE}/diary?entry_date=${testDate}`);
  await get('diary?start_date=...&end_date=...', `${BASE}/diary?start_date=${testDate}&end_date=${testDate}`);
  await get('diary?from=...&to=...', `${BASE}/diary?from=${testDate}&to=${testDate}`);

  // Try fetching via food-entries instead of diary
  await get('food-entries?date=...', `${BASE}/food-entries?date=${testDate}`);

  // Check if the known entry_id from the same date is in a "diary-entries" path
  await get('diary-entries?date=...', `${BASE}/diary-entries?date=${testDate}`);

  // The GET /diary endpoint might ONLY return food_entry types, not quick_adds
  // Let me also check for entries by type
  await get('diary?type=quick_add&date=...', `${BASE}/diary?type=quick_add&date=${testDate}`);
  await get('diary?types[]=quick_add&date=...', `${BASE}/diary?types[]=quick_add&date=${testDate}`);

  // FOOD ENTRY: more measure formats
  console.log('=== FOOD ENTRY: measure variations ===');
  const foodId = '238335819526077';
  const servingId = '268718844939813';

  // Maybe it needs a "food_measure" wrapper
  await post('food_entry with food_measure', `${BASE}/diary`, {
    items: [{
      type: 'food_entry',
      date: '2026-02-12',
      meal_name: 'Snacks',
      food_id: foodId,
      food_measure: { id: servingId },
      quantity: 1,
    }],
  });

  // Try with just "measure"
  await post('food_entry with measure', `${BASE}/diary`, {
    items: [{
      type: 'food_entry',
      date: '2026-02-12',
      meal_name: 'Snacks',
      food_id: foodId,
      measure: { id: servingId },
      quantity: 1,
    }],
  });

  // Try with serving as a nested object with "id"
  await post('food_entry with serving:{id}', `${BASE}/diary`, {
    items: [{
      type: 'food_entry',
      date: '2026-02-12',
      meal_name: 'Snacks',
      food_id: foodId,
      serving: { id: servingId },
      quantity: 1,
    }],
  });

  // Try with serving as a nested object matching serving_sizes structure
  await post('food_entry with serving:{...full}', `${BASE}/diary`, {
    items: [{
      type: 'food_entry',
      date: '2026-02-12',
      meal_name: 'Snacks',
      food_id: foodId,
      serving: { id: servingId, nutrition_multiplier: 1.18, unit: 'medium', value: 1, index: 0 },
      quantity: 1,
    }],
  });

  // Last resort: maybe the food_entry type just doesn't work through the proxy
  // and we should use quick_add with nutritional_contents from the search result
  console.log('=== QUICK ADD with food nutrition (workaround) ===');
  await post('quick_add with banana nutrition', `${BASE}/diary`, {
    items: [{
      type: 'quick_add',
      date: '2026-02-12',
      meal_name: 'Snacks',
      nutritional_contents: {
        energy: { value: 105, unit: 'calories' },
        carbohydrates: 27,
        fat: 0.4,
        protein: 1.3,
        sugar: 14,
        fiber: 3.1,
      },
    }],
  });

  // Verify
  await get('diary 2026-02-12', `${BASE}/diary?date=2026-02-12`);
}

main().catch(console.error);
