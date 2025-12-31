/**
 * TypeScript interfaces for MyFitnessPal data structures.
 *
 * @remarks
 * These types represent the data returned from scraping the MyFitnessPal website.
 */

/**
 * Represents a single food entry in a meal.
 */
export interface FoodEntry {
  /** Name of the food item */
  name: string;
  /** Calories in this entry */
  calories: number;
  /** Carbohydrates in grams */
  carbs: number;
  /** Fat in grams */
  fat: number;
  /** Protein in grams */
  protein: number;
  /** Sodium in milligrams */
  sodium: number;
  /** Sugar in grams */
  sugar: number;
  /** Serving size description */
  servingSize?: string;
}

/**
 * Represents a meal (Breakfast, Lunch, Dinner, Snacks).
 */
export interface Meal {
  /** Name of the meal (e.g., "Breakfast", "Lunch") */
  name: string;
  /** List of food entries in this meal */
  entries: FoodEntry[];
  /** Total calories for this meal */
  totalCalories: number;
  /** Total carbs for this meal */
  totalCarbs: number;
  /** Total fat for this meal */
  totalFat: number;
  /** Total protein for this meal */
  totalProtein: number;
}

/**
 * Represents a complete food diary for a single day.
 */
export interface DayDiary {
  /** The date in YYYY-MM-DD format */
  date: string;
  /** List of meals for the day */
  meals: Meal[];
  /** Total calories consumed */
  totalCalories: number;
  /** Goal calories for the day */
  goalCalories: number;
  /** Remaining calories (goal - consumed + exercise) */
  remainingCalories: number;
}

/**
 * Represents daily nutrition summary with macros.
 */
export interface NutritionSummary {
  /** The date in YYYY-MM-DD format */
  date: string;
  /** Total calories consumed */
  calories: number;
  /** Goal calories */
  caloriesGoal: number;
  /** Total carbohydrates in grams */
  carbs: number;
  /** Carbohydrates goal in grams */
  carbsGoal: number;
  /** Total fat in grams */
  fat: number;
  /** Fat goal in grams */
  fatGoal: number;
  /** Total protein in grams */
  protein: number;
  /** Protein goal in grams */
  proteinGoal: number;
  /** Total sodium in mg */
  sodium: number;
  /** Sodium goal in mg */
  sodiumGoal: number;
  /** Total sugar in grams */
  sugar: number;
  /** Sugar goal in grams */
  sugarGoal: number;
}

/**
 * Represents user's nutrition goals.
 */
export interface NutritionGoals {
  /** Daily calorie goal */
  calories: number;
  /** Daily carbohydrates goal in grams */
  carbs: number;
  /** Percentage of calories from carbs */
  carbsPercent: number;
  /** Daily fat goal in grams */
  fat: number;
  /** Percentage of calories from fat */
  fatPercent: number;
  /** Daily protein goal in grams */
  protein: number;
  /** Percentage of calories from protein */
  proteinPercent: number;
  /** Daily sodium goal in mg */
  sodium: number;
  /** Daily sugar goal in grams */
  sugar: number;
}

/**
 * Meal slot names for Quick Add.
 */
export type MealSlot = 'Breakfast' | 'Lunch' | 'Dinner' | 'Snacks';

/**
 * Parameters for Quick Add calories.
 */
export interface QuickAddParams {
  /** The meal slot to add calories to */
  meal: MealSlot;
  /** Number of calories to add */
  calories: number;
  /** Optional: carbs in grams */
  carbs?: number;
  /** Optional: fat in grams */
  fat?: number;
  /** Optional: protein in grams */
  protein?: number;
  /** Optional: date in YYYY-MM-DD format (defaults to today) */
  date?: string;
}

/**
 * Result of a Quick Add operation.
 */
export interface QuickAddResult {
  /** Whether the operation was successful */
  success: boolean;
  /** Message describing the result */
  message: string;
  /** The date the calories were added to */
  date: string;
  /** The meal slot that received the calories */
  meal: MealSlot;
  /** Number of calories added */
  calories: number;
}

/**
 * Configuration for the MFP client.
 */
export interface MFPClientConfig {
  /** Session cookie value */
  sessionCookie: string;
  /** Optional username for verification */
  username?: string;
}

