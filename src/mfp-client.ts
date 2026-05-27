/**
 * MyFitnessPal HTTP client using the Next.js BFF proxy API.
 *
 * @remarks
 * MFP migrated from Rails to Next.js. All API access now goes through
 * the BFF (Backend for Frontend) proxy at /api/services/ which handles
 * Bearer token injection server-side. Only session cookies are needed.
 *
 * Food search uses a separate endpoint at /api/nutrition.
 */

import { AuthManager } from './auth.js';
import type {
  AddFoodParams,
  AddFoodResult,
  DayDiary,
  DeleteResult,
  EditFoodParams,
  FoodEntry,
  FoodItemDetails,
  FoodSearchParams,
  FoodSearchResponse,
  FoodSearchResult,
  Meal,
  MealSlot,
  NutritionalContents,
  NutritionGoals,
  NutritionSummary,
  QuickAddParams,
  QuickAddResult,
  ServingSize,
} from './types.js';

/** MyFitnessPal base URL */
const MFP_BASE_URL = 'https://www.myfitnesspal.com';

/** Map meal index to name */
const MEAL_INDEX_TO_NAME: Record<number, MealSlot> = {
  0: 'Breakfast',
  1: 'Lunch',
  2: 'Dinner',
  3: 'Snacks',
};

/** Map meal name to its diary position (used when writing entries) */
const MEAL_NAME_TO_POSITION: Record<MealSlot, number> = {
  Breakfast: 0,
  Lunch: 1,
  Dinner: 2,
  Snacks: 3,
};

/**
 * Client for interacting with MyFitnessPal via the BFF proxy.
 */
export class MFPClient {
  private auth: AuthManager;

  constructor(auth: AuthManager) {
    this.auth = auth;
  }

  /**
   * Formats a date to YYYY-MM-DD format using the LOCAL date.
   *
   * @remarks
   * Uses local calendar parts rather than toISOString() (UTC), which would
   * roll an evening entry into the next day for users behind UTC.
   */
  private formatDate(date?: Date | string): string {
    if (typeof date === 'string') return date;
    const d = date ?? new Date();
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  /**
   * Common headers for authenticated requests to the MFP BFF proxy.
   *
   * @remarks
   * The `mfp-client-id` header identifies the web client; several diary
   * endpoints (e.g. /api/nutrition search, read_diary) require it.
   */
  private async authHeaders(): Promise<Record<string, string>> {
    return {
      'Cookie': await this.auth.getCookieHeader(),
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      'Accept': 'application/json',
      'Referer': 'https://www.myfitnesspal.com/',
      'mfp-client-id': 'mfp-main-js',
    };
  }

  /**
   * Makes an authenticated GET request to the MFP BFF proxy.
   */
  private async apiGet(path: string): Promise<Response> {
    return fetch(`${MFP_BASE_URL}${path}`, { headers: await this.authHeaders() });
  }

  /**
   * Makes an authenticated POST request to the MFP BFF proxy.
   */
  private async apiPost(path: string, body: any): Promise<Response> {
    return fetch(`${MFP_BASE_URL}${path}`, {
      method: 'POST',
      headers: { ...(await this.authHeaders()), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  /**
   * Makes an authenticated DELETE request to the MFP BFF proxy.
   */
  private async apiDelete(path: string): Promise<Response> {
    return fetch(`${MFP_BASE_URL}${path}`, { method: 'DELETE', headers: await this.authHeaders() });
  }

  /**
   * Verifies that the session is valid.
   *
   * @returns True if the session cookie is valid and not expired
   */
  async verifySession(): Promise<boolean> {
    try {
      const resp = await this.apiGet('/api/auth/session');
      if (!resp.ok) return false;
      const data = await resp.json() as any;
      return !!data?.userId || !!data?.user;
    } catch {
      return false;
    }
  }

  /**
   * Gets the food diary for a specific date.
   *
   * @param date - The date to fetch (YYYY-MM-DD format or Date object)
   * @returns The parsed diary data
   */
  async getDiary(date?: Date | string): Promise<DayDiary> {
    const dateStr = this.formatDate(date);
    // read_diary returns INDIVIDUAL entries (with ids + food names), unlike
    // /api/services/diary which only returns per-meal aggregate totals.
    const resp = await this.apiGet(
      `/api/services/diary/read_diary?entry_date=${dateStr}&fields=all&types=food_entry,exercise_entry,steps_aggregate&username=`
    );

    if (!resp.ok) {
      const text = await resp.text();
      if (resp.status === 401 || resp.status === 403) {
        throw new Error('Session expired. Please update your MFP_SESSION_COOKIE.');
      }
      throw new Error(`Failed to fetch diary: ${resp.status} ${resp.statusText}\n${text.slice(0, 500)}`);
    }

    const data = await resp.json();
    return this.parseDiaryResponse(data, dateStr);
  }

  /**
   * Parses the read_diary response (individual entries) into our DayDiary format.
   */
  private parseDiaryResponse(data: any, dateStr: string): DayDiary {
    const mealNames: MealSlot[] = ['Breakfast', 'Lunch', 'Dinner', 'Snacks'];

    // Initialize meal accumulators
    const mealMap = new Map<string, {
      entries: FoodEntry[];
      cal: number; carbs: number; fat: number; protein: number; sodium: number; sugar: number;
    }>();
    for (const name of mealNames) {
      mealMap.set(name, { entries: [], cal: 0, carbs: 0, fat: 0, protein: 0, sodium: 0, sugar: 0 });
    }

    // read_diary returns an array (or object-of-entries) of typed items
    const entries = Array.isArray(data) ? data : (data?.items ?? Object.values(data ?? {}));

    for (const entry of entries) {
      if (entry?.type !== 'food_entry') continue;

      const mealName = (entry.meal_name as MealSlot) ?? MEAL_INDEX_TO_NAME[entry.meal_position] ?? 'Snacks';
      const meal = mealMap.get(mealName) ?? mealMap.get('Snacks')!;

      const nc = entry.nutritional_contents ?? entry.nutrition ?? {};
      const calories = nc.energy?.value ?? nc.calories ?? 0;
      const carbs = nc.carbohydrates ?? nc.carbs ?? 0;
      const fat = nc.fat ?? 0;
      const protein = nc.protein ?? 0;
      const sodium = nc.sodium ?? 0;
      const sugar = nc.sugar ?? 0;

      const ss = entry.serving_size;
      const servingDesc = ss ? `${ss.value} ${ss.unit}`.trim() : undefined;

      const foodEntry: FoodEntry = {
        id: entry.id,
        name: entry.food?.description ?? entry.food?.brand_name ?? entry.description ?? 'Quick Add',
        servings: entry.servings,
        calories,
        carbs,
        fat,
        protein,
        sodium,
        sugar,
        servingSize: servingDesc,
      };

      meal.entries.push(foodEntry);
      meal.cal += calories;
      meal.carbs += carbs;
      meal.fat += fat;
      meal.protein += protein;
      meal.sodium += sodium;
      meal.sugar += sugar;
    }

    let totalCalories = 0;
    const meals: Meal[] = mealNames.map(name => {
      const meal = mealMap.get(name)!;
      totalCalories += meal.cal;
      return {
        name,
        entries: meal.entries,
        totalCalories: meal.cal,
        totalCarbs: meal.carbs,
        totalFat: meal.fat,
        totalProtein: meal.protein,
      };
    });

    return {
      date: dateStr,
      meals,
      totalCalories,
      goalCalories: 0,
      remainingCalories: 0,
    };
  }

  /**
   * Gets the nutrition summary for a specific date.
   *
   * @param date - The date to fetch (YYYY-MM-DD format or Date object)
   * @returns The nutrition summary with macros and goals
   */
  async getNutritionSummary(date?: Date | string): Promise<NutritionSummary> {
    const diary = await this.getDiary(date);

    let calories = 0, carbs = 0, fat = 0, protein = 0, sodium = 0, sugar = 0;
    for (const meal of diary.meals) {
      calories += meal.totalCalories;
      carbs += meal.totalCarbs;
      fat += meal.totalFat;
      protein += meal.totalProtein;
      for (const entry of meal.entries) {
        sodium += entry.sodium;
        sugar += entry.sugar;
      }
    }

    // Try to get goals (may fail if endpoint not available)
    let goals: NutritionGoals | null = null;
    try {
      goals = await this.getGoals();
    } catch {
      // Goals endpoint not available through BFF proxy
    }

    return {
      date: diary.date,
      calories,
      caloriesGoal: goals?.calories ?? 0,
      carbs,
      carbsGoal: goals?.carbs ?? 0,
      fat,
      fatGoal: goals?.fat ?? 0,
      protein,
      proteinGoal: goals?.protein ?? 0,
      sodium,
      sodiumGoal: goals?.sodium ?? 0,
      sugar,
      sugarGoal: goals?.sugar ?? 0,
    };
  }

  /**
   * Gets the user's nutrition goals.
   *
   * @returns The user's configured nutrition goals
   */
  async getGoals(): Promise<NutritionGoals> {
    const dateStr = this.formatDate();
    const resp = await this.apiGet(`/api/services/diary/nutrient_goals?date=${dateStr}`);

    if (!resp.ok) {
      const text = await resp.text();
      if (resp.status === 401 || resp.status === 403) {
        throw new Error('Session expired. Please update your MFP_SESSION_COOKIE.');
      }
      throw new Error(`Could not fetch nutrition goals: ${resp.status} ${resp.statusText}\n${text.slice(0, 300)}`);
    }

    const data = await resp.json() as any;
    return this.parseGoalsResponse(data, dateStr);
  }

  /**
   * Parses the nutrient_goals API response.
   *
   * @remarks
   * The response carries a `daily_goals` array keyed by day_of_week (goals
   * can differ per day); we select the goal for the requested date.
   */
  private parseGoalsResponse(data: any, dateStr: string): NutritionGoals {
    const daily = Array.isArray(data?.daily_goals) ? data.daily_goals : [];
    const weekday = new Date(`${dateStr}T00:00:00`)
      .toLocaleDateString('en-US', { weekday: 'long' })
      .toLowerCase();
    const goals = daily.find((g: any) => g.day_of_week === weekday) ?? daily[0] ?? data ?? {};

    const calories = goals.energy?.value ?? goals.calories ?? 0;
    const carbs = goals.carbohydrates ?? goals.carbs ?? 0;
    const fat = goals.fat ?? 0;
    const protein = goals.protein ?? 0;
    const sodium = goals.sodium ?? 0;
    const sugar = goals.sugar ?? 0;

    const carbsCal = carbs * 4;
    const fatCal = fat * 9;
    const proteinCal = protein * 4;
    const totalMacroCal = carbsCal + fatCal + proteinCal;

    return {
      calories,
      carbs,
      carbsPercent: totalMacroCal > 0 ? Math.round((carbsCal / totalMacroCal) * 100) : 0,
      fat,
      fatPercent: totalMacroCal > 0 ? Math.round((fatCal / totalMacroCal) * 100) : 0,
      protein,
      proteinPercent: totalMacroCal > 0 ? Math.round((proteinCal / totalMacroCal) * 100) : 0,
      sodium,
      sugar,
    };
  }

  /**
   * Searches the MFP food database.
   *
   * @param params - Search parameters
   * @returns Search results with food items
   */
  async searchFood(params: FoodSearchParams): Promise<FoodSearchResponse> {
    const page = params.page ?? 1;
    const maxResults = params.max_results ?? 20;

    // Food search uses /api/nutrition (NOT under /api/services/)
    const searchParams = new URLSearchParams({
      query: params.query,
      page: page.toString(),
      per_page: maxResults.toString(),
    });

    const resp = await this.apiGet(`/api/nutrition?${searchParams}`);

    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`Food search failed: ${resp.status} ${resp.statusText}\n${text.slice(0, 500)}`);
    }

    const data = await resp.json();
    const parsed = this.parseFoodSearchResponse(data, page);
    // MFP ignores per_page and returns ~100 rows; cap to the requested count
    // (total_results still reflects the full match count for the caller).
    return { ...parsed, items: parsed.items.slice(0, maxResults) };
  }

  /**
   * Defensively parses the food search API response.
   */
  private parseFoodSearchResponse(data: any, page: number): FoodSearchResponse {
    const items: FoodSearchResult[] = [];

    const rawItems = data?.items ?? data?.results ?? data?.foods ?? data?.nutrition ?? [];
    const itemsList = Array.isArray(rawItems) ? rawItems : (Array.isArray(data) ? data : []);

    for (const item of itemsList) {
      try {
        const parsed = this.parseFoodItem(item);
        if (parsed) items.push(parsed);
      } catch {
        // Skip unparseable items
      }
    }

    return {
      items,
      total_results: data?.total_results ?? data?.total ?? data?.totalResultsCount ?? items.length,
      page,
    };
  }

  /**
   * Parses a single food item from the API response.
   */
  private parseFoodItem(item: any): FoodSearchResult | null {
    if (!item) return null;
    const food = item.item ?? item;

    const id = String(food.id ?? food.food_id ?? '');
    const name = food.description ?? food.name ?? food.food_name ?? '';
    if (!id || !name) return null;

    const nc = food.nutritional_contents ?? food.nutrition ?? food.nutrients ?? {};

    return {
      id,
      name,
      brand: food.brand_name ?? food.brand ?? undefined,
      nutritional_contents: this.parseNutritionalContents(nc),
      serving_size: food.serving_description ?? food.serving_size ?? food.serving ?? undefined,
      verified: food.verified ?? food.is_verified ?? undefined,
    };
  }

  /**
   * Normalizes nutritional contents from various API response formats.
   */
  private parseNutritionalContents(nc: any): NutritionalContents {
    return {
      calories: nc.energy?.value ?? nc.calories ?? nc.energy ?? 0,
      carbohydrates: nc.carbohydrates ?? nc.carbs ?? nc.total_carbohydrates ?? undefined,
      fat: nc.fat ?? nc.total_fat ?? undefined,
      protein: nc.protein ?? undefined,
      sodium: nc.sodium ?? undefined,
      sugar: nc.sugar ?? nc.total_sugars ?? undefined,
      fiber: nc.fiber ?? nc.dietary_fiber ?? undefined,
      saturated_fat: nc.saturated_fat ?? undefined,
      cholesterol: nc.cholesterol ?? undefined,
      potassium: nc.potassium ?? undefined,
    };
  }

  /**
   * Gets detailed information about a specific food item.
   *
   * @param foodId - The food item ID
   * @returns Detailed food information with serving sizes
   */
  async getFoodDetails(foodId: string): Promise<FoodItemDetails> {
    const resp = await this.apiGet(`/api/services/foods?ids[]=${foodId}`);

    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`Failed to get food details: ${resp.status} ${resp.statusText}\n${text.slice(0, 500)}`);
    }

    const data = await resp.json();
    return this.parseFoodDetails(data);
  }

  /**
   * Parses the food details API response.
   */
  private parseFoodDetails(data: any): FoodItemDetails {
    // Response could be an array or {items: [...]}
    const items = Array.isArray(data) ? data : (data?.items ?? data?.foods ?? [data]);
    const food = items[0]?.item ?? items[0] ?? data?.item ?? data;

    const id = String(food.id ?? food.food_id ?? '');
    const name = food.description ?? food.name ?? food.food_name ?? '';

    if (!id || !name) {
      throw new Error(
        `Invalid food details response: missing id or name. Keys: ${Object.keys(food).join(', ')}`
      );
    }

    const nc = food.nutritional_contents ?? food.nutrition ?? {};
    const rawServings = food.serving_sizes ?? food.servings ?? [];
    const servingsList = Array.isArray(rawServings) ? rawServings : [];

    const serving_sizes: ServingSize[] = servingsList.map((s: any) => ({
      id: String(s.id ?? ''),
      nutrition_multiplier: s.nutrition_multiplier ?? s.multiplier ?? 1,
      value: s.value ?? s.description ?? s.serving_description ?? '',
      unit: s.unit ?? undefined,
      index: s.index ?? undefined,
    }));

    return {
      id,
      version: food.version !== undefined ? String(food.version) : undefined,
      name,
      brand: food.brand_name ?? food.brand ?? undefined,
      nutritional_contents: this.parseNutritionalContents(nc),
      serving_sizes,
      verified: food.verified ?? food.is_verified ?? undefined,
    };
  }

  /**
   * Adds calories using Quick Add via the BFF proxy.
   *
   * @param params - The Quick Add parameters
   * @returns The result of the Quick Add operation
   */
  async quickAddCalories(params: QuickAddParams): Promise<QuickAddResult> {
    const dateStr = this.formatDate(params.date);

    const nutritional_contents: any = {
      energy: { value: params.calories, unit: 'calories' },
    };
    if (params.carbs !== undefined) nutritional_contents.carbohydrates = params.carbs;
    if (params.fat !== undefined) nutritional_contents.fat = params.fat;
    if (params.protein !== undefined) nutritional_contents.protein = params.protein;

    const resp = await this.apiPost('/api/services/diary', {
      items: [{
        type: 'quick_add',
        date: dateStr,
        meal_name: params.meal,
        nutritional_contents,
      }],
    });

    if (resp.ok || resp.status === 201) {
      return {
        success: true,
        message: `Successfully added ${params.calories} calories to ${params.meal}`,
        date: dateStr,
        meal: params.meal,
        calories: params.calories,
      };
    }

    const text = await resp.text();

    if (resp.status === 401 || resp.status === 403) {
      throw new Error('Session expired. Please update your MFP_SESSION_COOKIE.');
    }

    return {
      success: false,
      message: `Quick Add failed: ${resp.status} ${text.slice(0, 300)}`,
      date: dateStr,
      meal: params.meal,
      calories: params.calories,
    };
  }

  /**
   * Posts a single named food_entry to the diary.
   *
   * @returns The created entry object (includes its `id`).
   * @throws If the request fails (session expired or validation error).
   */
  private async postFoodEntry(opts: {
    date: string;
    foodId: string;
    version?: string;
    mealPosition: number;
    servings: number;
    serving: { nutrition_multiplier: number; unit?: string; value: number | string };
  }): Promise<any> {
    const entry = {
      type: 'food_entry',
      date: opts.date,
      food: { id: opts.foodId, version: opts.version },
      servings: opts.servings,
      meal_position: opts.mealPosition,
      serving_size: {
        nutrition_multiplier: opts.serving.nutrition_multiplier,
        unit: opts.serving.unit,
        value: Number(opts.serving.value),
      },
    };

    const resp = await this.apiPost('/api/services/diary', { items: [entry] });

    if (!resp.ok && resp.status !== 201) {
      const text = await resp.text();
      if (resp.status === 401 || resp.status === 403) {
        throw new Error('Session expired. Please update your MFP_SESSION_COOKIE.');
      }
      throw new Error(`Failed to log food entry: ${resp.status} ${resp.statusText}\n${text.slice(0, 300)}`);
    }

    const data = await resp.json() as any;
    return Array.isArray(data) ? data[0] : (data?.items?.[0] ?? data);
  }

  /**
   * Adds a food item to the diary as a named food_entry.
   *
   * @param params - The add food parameters
   * @returns Result of the add operation (includes the new entry id)
   */
  async addFood(params: AddFoodParams): Promise<AddFoodResult> {
    const dateStr = params.date ?? this.formatDate();
    const details = await this.getFoodDetails(params.food_id);

    if (details.serving_sizes.length === 0) {
      throw new Error(`No serving sizes available for food ${params.food_id}.`);
    }

    // Default to the first serving; select by serving_id when provided.
    let serving = details.serving_sizes[0];
    if (params.serving_id) {
      const found = details.serving_sizes.find(s => s.id === params.serving_id);
      if (found) serving = found;
    }

    const created = await this.postFoodEntry({
      date: dateStr,
      foodId: params.food_id,
      version: details.version,
      mealPosition: MEAL_NAME_TO_POSITION[params.meal],
      servings: params.quantity,
      serving: { nutrition_multiplier: serving.nutrition_multiplier, unit: serving.unit, value: serving.value },
    });

    const cals = created?.nutritional_contents?.energy?.value;
    return {
      success: true,
      message: `Added ${details.name}${cals !== undefined ? ` (${Math.round(cals)} cal)` : ''} to ${params.meal} on ${dateStr}`,
      date: dateStr,
      meal: params.meal,
      food_name: details.name,
      entry_id: created?.id,
    };
  }

  /**
   * Deletes a diary entry by its id.
   *
   * @param entryId - The diary entry id (from get_diary)
   */
  async deleteEntry(entryId: string): Promise<DeleteResult> {
    const resp = await this.apiDelete(`/api/services/diary/${entryId}`);

    if (resp.status === 204 || resp.ok) {
      return { success: true, message: `Deleted entry ${entryId}.` };
    }
    if (resp.status === 401 || resp.status === 403) {
      throw new Error('Session expired. Please update your MFP_SESSION_COOKIE.');
    }
    if (resp.status === 404) {
      return { success: false, message: `Entry ${entryId} not found (already deleted?).` };
    }
    const text = await resp.text();
    throw new Error(`Failed to delete entry: ${resp.status} ${resp.statusText}\n${text.slice(0, 200)}`);
  }

  /**
   * Edits an existing diary entry's servings and/or meal.
   *
   * @remarks
   * Implemented as recreate-then-delete (MFP's PUT endpoint is unreliable).
   * The new entry is created first so a failure never loses the original.
   *
   * @param params - Which entry to edit and the new servings/meal
   * @returns Result describing the updated entry (with the new entry id)
   */
  async editEntry(params: EditFoodParams): Promise<AddFoodResult> {
    const resp = await this.apiGet(
      `/api/services/diary/read_diary?entry_date=${params.date}&fields=all&types=food_entry&username=`
    );
    if (!resp.ok) {
      if (resp.status === 401 || resp.status === 403) {
        throw new Error('Session expired. Please update your MFP_SESSION_COOKIE.');
      }
      throw new Error(`Failed to read diary for ${params.date}: ${resp.status} ${resp.statusText}`);
    }

    const data = await resp.json() as any;
    const items = Array.isArray(data) ? data : (data?.items ?? Object.values(data ?? {}));
    const entry = items.find((e: any) => e.id === params.entry_id && e.type === 'food_entry');
    if (!entry) {
      throw new Error(`Entry ${params.entry_id} not found on ${params.date}.`);
    }
    if (!entry.food?.id) {
      throw new Error(`Entry ${params.entry_id} has no food reference and can't be edited; delete and re-add instead.`);
    }

    const newServings = params.servings ?? entry.servings ?? 1;
    const newMeal: MealSlot =
      params.meal ?? (entry.meal_name as MealSlot) ?? MEAL_INDEX_TO_NAME[entry.meal_position] ?? 'Snacks';
    const ss = entry.serving_size ?? {};

    // Recreate first (so the original is never lost on failure), then delete the old.
    const created = await this.postFoodEntry({
      date: params.date,
      foodId: entry.food.id,
      version: entry.food.version,
      mealPosition: MEAL_NAME_TO_POSITION[newMeal],
      servings: newServings,
      serving: { nutrition_multiplier: ss.nutrition_multiplier ?? 1, unit: ss.unit, value: ss.value ?? 1 },
    });
    await this.deleteEntry(params.entry_id);

    const cals = created?.nutritional_contents?.energy?.value;
    const foodName = entry.food?.description ?? 'Food';
    return {
      success: true,
      message: `Updated ${foodName} → ${newServings} serving(s) in ${newMeal} on ${params.date}${cals !== undefined ? ` (${Math.round(cals)} cal)` : ''}`,
      date: params.date,
      meal: newMeal,
      food_name: foodName,
      entry_id: created?.id,
    };
  }
}

/**
 * Creates a new MFP client with the given auth manager.
 *
 * @param auth - The authentication manager
 * @returns A configured MFP client
 */
export function createMFPClient(auth: AuthManager): MFPClient {
  return new MFPClient(auth);
}
