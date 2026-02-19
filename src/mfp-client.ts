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

/**
 * Client for interacting with MyFitnessPal via the BFF proxy.
 */
export class MFPClient {
  private auth: AuthManager;

  constructor(auth: AuthManager) {
    this.auth = auth;
  }

  /**
   * Formats a date to YYYY-MM-DD format.
   */
  private formatDate(date?: Date | string): string {
    if (typeof date === 'string') return date;
    const d = date ?? new Date();
    return d.toISOString().split('T')[0];
  }

  /**
   * Makes an authenticated GET request to the MFP BFF proxy.
   */
  private async apiGet(path: string): Promise<Response> {
    const cookieHeader = await this.auth.getCookieHeader();
    return fetch(`${MFP_BASE_URL}${path}`, {
      headers: {
        'Cookie': cookieHeader,
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'Accept': 'application/json',
        'Referer': 'https://www.myfitnesspal.com/',
      },
    });
  }

  /**
   * Makes an authenticated POST request to the MFP BFF proxy.
   */
  private async apiPost(path: string, body: any): Promise<Response> {
    const cookieHeader = await this.auth.getCookieHeader();
    return fetch(`${MFP_BASE_URL}${path}`, {
      method: 'POST',
      headers: {
        'Cookie': cookieHeader,
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'Referer': 'https://www.myfitnesspal.com/',
      },
      body: JSON.stringify(body),
    });
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
    const resp = await this.apiGet(`/api/services/diary?entry_date=${dateStr}`);

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
   * Parses the BFF proxy diary response into our DayDiary format.
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

    // The response could be an array of entries or an object with a wrapper
    const entries = Array.isArray(data) ? data : (data?.items ?? data?.diary_entries ?? data?.entries ?? []);

    for (const entry of entries) {
      const mealName = entry.meal_name ?? MEAL_INDEX_TO_NAME[entry.meal_index] ?? 'Snacks';
      const meal = mealMap.get(mealName) ?? mealMap.get('Snacks')!;

      const nc = entry.nutritional_contents ?? entry.nutrition ?? {};
      const calories = nc.energy?.value ?? nc.calories ?? 0;
      const carbs = nc.carbohydrates ?? nc.carbs ?? 0;
      const fat = nc.fat ?? 0;
      const protein = nc.protein ?? 0;
      const sodium = nc.sodium ?? 0;
      const sugar = nc.sugar ?? 0;

      const foodEntry: FoodEntry = {
        name: entry.food?.description ?? entry.food_name ?? entry.description ?? entry.type ?? 'Quick Add',
        calories,
        carbs,
        fat,
        protein,
        sodium,
        sugar,
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
    // Try known goals endpoints on the BFF proxy
    const paths = [
      '/api/services/goals',
      '/api/services/me/goals',
      '/api/services/nutrition-goals',
    ];

    for (const path of paths) {
      try {
        const resp = await this.apiGet(path);
        if (resp.ok) {
          const data = await resp.json() as any;
          return this.parseGoalsResponse(data);
        }
      } catch {
        continue;
      }
    }

    throw new Error(
      'Could not fetch nutrition goals. The goals endpoint may not be available through the BFF proxy.'
    );
  }

  /**
   * Parses the goals API response.
   */
  private parseGoalsResponse(data: any): NutritionGoals {
    const goals = data?.goals ?? data?.item ?? data ?? {};
    const nc = goals.nutritional_contents ?? goals.default_goal ?? goals ?? {};

    const calories = nc.energy?.value ?? nc.calories ?? goals.calories ?? 0;
    const carbs = nc.carbohydrates ?? nc.carbs ?? goals.carbs ?? 0;
    const fat = nc.fat ?? goals.fat ?? 0;
    const protein = nc.protein ?? goals.protein ?? 0;
    const sodium = nc.sodium ?? goals.sodium ?? 0;
    const sugar = nc.sugar ?? goals.sugar ?? 0;

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
    return this.parseFoodSearchResponse(data, page);
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
   * Adds a food item to the diary.
   *
   * @remarks
   * The BFF proxy doesn't support the food_entry type directly, so this
   * fetches the food's nutrition info and creates a quick_add entry with
   * the scaled nutritional values. The entry will appear as "Quick Add"
   * in the MFP diary rather than showing the food name.
   *
   * @param params - The add food parameters
   * @returns Result of the add operation
   */
  async addFood(params: AddFoodParams): Promise<AddFoodResult> {
    const dateStr = params.date ?? this.formatDate();

    // Fetch food details to get nutrition info
    const details = await this.getFoodDetails(params.food_id);

    // Find the serving size multiplier
    let multiplier = 1;
    if (params.serving_id && details.serving_sizes.length > 0) {
      const serving = details.serving_sizes.find(s => s.id === params.serving_id);
      if (serving) {
        multiplier = serving.nutrition_multiplier;
      }
    }

    // Scale nutrition by multiplier and quantity
    const scale = multiplier * params.quantity;
    const nc = details.nutritional_contents;

    const nutritional_contents: any = {
      energy: { value: Math.round(nc.calories * scale), unit: 'calories' },
    };
    if (nc.carbohydrates !== undefined) nutritional_contents.carbohydrates = Math.round(nc.carbohydrates * scale * 10) / 10;
    if (nc.fat !== undefined) nutritional_contents.fat = Math.round(nc.fat * scale * 10) / 10;
    if (nc.protein !== undefined) nutritional_contents.protein = Math.round(nc.protein * scale * 10) / 10;
    if (nc.sodium !== undefined) nutritional_contents.sodium = Math.round(nc.sodium * scale * 10) / 10;
    if (nc.sugar !== undefined) nutritional_contents.sugar = Math.round(nc.sugar * scale * 10) / 10;
    if (nc.fiber !== undefined) nutritional_contents.fiber = Math.round(nc.fiber * scale * 10) / 10;

    const resp = await this.apiPost('/api/services/diary', {
      items: [{
        type: 'quick_add',
        date: dateStr,
        meal_name: params.meal,
        nutritional_contents,
      }],
    });

    if (resp.ok || resp.status === 201) {
      const foodName = details.name;
      const cals = Math.round(nc.calories * scale);
      return {
        success: true,
        message: `Added ${foodName} (${cals} cal) to ${params.meal} on ${dateStr}`,
        date: dateStr,
        meal: params.meal,
        food_name: foodName,
      };
    }

    const text = await resp.text();

    if (resp.status === 401 || resp.status === 403) {
      throw new Error('Session expired. Please update your MFP_SESSION_COOKIE.');
    }

    return {
      success: false,
      message: `Failed to add food: ${resp.status} ${text.slice(0, 300)}`,
      date: dateStr,
      meal: params.meal,
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
