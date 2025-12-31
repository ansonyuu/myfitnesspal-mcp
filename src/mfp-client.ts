/**
 * MyFitnessPal HTTP client for fetching and parsing nutrition data.
 *
 * @remarks
 * This client handles all communication with the MyFitnessPal website,
 * including fetching diary pages, parsing HTML, and submitting Quick Add requests.
 */

import * as cheerio from 'cheerio';
import { AuthManager } from './auth.js';
import type {
  DayDiary,
  FoodEntry,
  Meal,
  MealSlot,
  NutritionGoals,
  NutritionSummary,
  QuickAddParams,
  QuickAddResult,
} from './types.js';

/** MyFitnessPal base URL */
const MFP_BASE_URL = 'https://www.myfitnesspal.com';

/** Map of meal slot names to their numeric IDs */
const MEAL_SLOT_IDS: Record<MealSlot, number> = {
  'Breakfast': 0,
  'Lunch': 1,
  'Dinner': 2,
  'Snacks': 3,
};

/**
 * Client for interacting with MyFitnessPal.
 */
export class MFPClient {
  private auth: AuthManager;

  /**
   * Creates a new MFP client.
   *
   * @param auth - The authentication manager to use for requests
   */
  constructor(auth: AuthManager) {
    this.auth = auth;
  }

  /**
   * Formats a date to YYYY-MM-DD format.
   *
   * @param date - Date to format (defaults to today)
   * @returns Date string in YYYY-MM-DD format
   */
  private formatDate(date?: Date | string): string {
    if (typeof date === 'string') {
      return date;
    }
    const d = date ?? new Date();
    return d.toISOString().split('T')[0];
  }

  /**
   * Fetches the diary page HTML for a specific date.
   *
   * @param date - The date to fetch (YYYY-MM-DD format or Date object)
   * @returns The raw HTML of the diary page
   */
  async fetchDiaryPage(date?: Date | string): Promise<string> {
    const dateStr = this.formatDate(date);
    const url = `${MFP_BASE_URL}/food/diary?date=${dateStr}`;
    
    const headers = await this.auth.getAuthHeaders();
    const response = await fetch(url, { headers });
    
    if (!response.ok) {
      throw new Error(`Failed to fetch diary page: ${response.status} ${response.statusText}`);
    }
    
    const html = await response.text();
    
    // Check if we got redirected to login
    if (html.includes('Sign In') && html.includes('password')) {
      throw new Error(
        'Session expired or invalid. Please update your MFP_SESSION_COOKIE in .env'
      );
    }
    
    return html;
  }

  /**
   * Parses the diary HTML to extract meal and food data.
   *
   * @param html - The raw HTML of the diary page
   * @param dateStr - The date string for the diary
   * @returns Parsed diary data
   */
  private parseDiaryHtml(html: string, dateStr: string): DayDiary {
    const $ = cheerio.load(html);
    const meals: Meal[] = [];
    
    // Parse each meal section
    const mealNames: MealSlot[] = ['Breakfast', 'Lunch', 'Dinner', 'Snacks'];
    
    mealNames.forEach((mealName, index) => {
      const entries: FoodEntry[] = [];
      let totalCalories = 0;
      let totalCarbs = 0;
      let totalFat = 0;
      let totalProtein = 0;
      
      // Find the meal section by looking for the meal header
      const mealSelector = `#diary-table tbody#meal_${index}`;
      const mealSection = $(mealSelector);
      
      if (mealSection.length) {
        // Parse each food row in this meal
        mealSection.find('tr.bottom').each((_, row) => {
          const $row = $(row);
          const name = $row.find('td.first a').text().trim();
          
          if (name) {
            // Extract numeric values from cells
            const calories = this.parseNumber($row.find('td').eq(1).text());
            const carbs = this.parseNumber($row.find('td').eq(2).text());
            const fat = this.parseNumber($row.find('td').eq(3).text());
            const protein = this.parseNumber($row.find('td').eq(4).text());
            const sodium = this.parseNumber($row.find('td').eq(5).text());
            const sugar = this.parseNumber($row.find('td').eq(6).text());
            
            entries.push({
              name,
              calories,
              carbs,
              fat,
              protein,
              sodium,
              sugar,
            });
            
            totalCalories += calories;
            totalCarbs += carbs;
            totalFat += fat;
            totalProtein += protein;
          }
        });
        
        // Also try to get totals from the total row if available
        const totalRow = mealSection.find('tr.total');
        if (totalRow.length) {
          const rowCalories = this.parseNumber(totalRow.find('td').eq(1).text());
          if (rowCalories > 0) {
            totalCalories = rowCalories;
            totalCarbs = this.parseNumber(totalRow.find('td').eq(2).text());
            totalFat = this.parseNumber(totalRow.find('td').eq(3).text());
            totalProtein = this.parseNumber(totalRow.find('td').eq(4).text());
          }
        }
      }
      
      meals.push({
        name: mealName,
        entries,
        totalCalories,
        totalCarbs,
        totalFat,
        totalProtein,
      });
    });
    
    // Parse daily totals
    const totalsRow = $('#diary-table tfoot tr.total');
    const goalRow = $('#diary-table tfoot tr.goal');
    const remainingRow = $('#diary-table tfoot tr.remaining');
    
    const totalCalories = this.parseNumber(totalsRow.find('td').eq(1).text());
    const goalCalories = this.parseNumber(goalRow.find('td').eq(1).text());
    const remainingCalories = this.parseNumber(remainingRow.find('td').eq(1).text());
    
    return {
      date: dateStr,
      meals,
      totalCalories,
      goalCalories,
      remainingCalories,
    };
  }

  /**
   * Parses a number from a string, handling commas and other formatting.
   *
   * @param text - Text containing a number
   * @returns The parsed number, or 0 if parsing fails
   */
  private parseNumber(text: string): number {
    const cleaned = text.replace(/[,\s]/g, '').trim();
    const num = parseInt(cleaned, 10);
    return isNaN(num) ? 0 : num;
  }

  /**
   * Gets the food diary for a specific date.
   *
   * @param date - The date to fetch (YYYY-MM-DD format or Date object)
   * @returns The parsed diary data
   */
  async getDiary(date?: Date | string): Promise<DayDiary> {
    const dateStr = this.formatDate(date);
    const html = await this.fetchDiaryPage(dateStr);
    return this.parseDiaryHtml(html, dateStr);
  }

  /**
   * Gets the nutrition summary for a specific date.
   *
   * @param date - The date to fetch (YYYY-MM-DD format or Date object)
   * @returns The nutrition summary with macros
   */
  async getNutritionSummary(date?: Date | string): Promise<NutritionSummary> {
    const dateStr = this.formatDate(date);
    const html = await this.fetchDiaryPage(dateStr);
    const $ = cheerio.load(html);
    
    // Parse from the diary table footer
    const totalsRow = $('#diary-table tfoot tr.total');
    const goalRow = $('#diary-table tfoot tr.goal');
    
    const calories = this.parseNumber(totalsRow.find('td').eq(1).text());
    const caloriesGoal = this.parseNumber(goalRow.find('td').eq(1).text());
    const carbs = this.parseNumber(totalsRow.find('td').eq(2).text());
    const carbsGoal = this.parseNumber(goalRow.find('td').eq(2).text());
    const fat = this.parseNumber(totalsRow.find('td').eq(3).text());
    const fatGoal = this.parseNumber(goalRow.find('td').eq(3).text());
    const protein = this.parseNumber(totalsRow.find('td').eq(4).text());
    const proteinGoal = this.parseNumber(goalRow.find('td').eq(4).text());
    const sodium = this.parseNumber(totalsRow.find('td').eq(5).text());
    const sodiumGoal = this.parseNumber(goalRow.find('td').eq(5).text());
    const sugar = this.parseNumber(totalsRow.find('td').eq(6).text());
    const sugarGoal = this.parseNumber(goalRow.find('td').eq(6).text());
    
    return {
      date: dateStr,
      calories,
      caloriesGoal,
      carbs,
      carbsGoal,
      fat,
      fatGoal,
      protein,
      proteinGoal,
      sodium,
      sodiumGoal,
      sugar,
      sugarGoal,
    };
  }

  /**
   * Gets the user's nutrition goals.
   *
   * @returns The user's configured nutrition goals
   */
  async getGoals(): Promise<NutritionGoals> {
    // Fetch today's diary to get goals from the goal row
    const html = await this.fetchDiaryPage();
    const $ = cheerio.load(html);
    
    const goalRow = $('#diary-table tfoot tr.goal');
    
    const calories = this.parseNumber(goalRow.find('td').eq(1).text());
    const carbs = this.parseNumber(goalRow.find('td').eq(2).text());
    const fat = this.parseNumber(goalRow.find('td').eq(3).text());
    const protein = this.parseNumber(goalRow.find('td').eq(4).text());
    const sodium = this.parseNumber(goalRow.find('td').eq(5).text());
    const sugar = this.parseNumber(goalRow.find('td').eq(6).text());
    
    // Calculate percentages based on calories
    // Carbs & protein = 4 cal/g, fat = 9 cal/g
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
   * Extracts the authenticity token from a page for form submissions.
   *
   * @param html - The HTML page containing the token
   * @returns The authenticity token
   */
  private extractAuthenticityToken(html: string): string {
    const $ = cheerio.load(html);
    const token = $('input[name="authenticity_token"]').val() as string;
    
    if (!token) {
      // Try to find in meta tag
      const metaToken = $('meta[name="csrf-token"]').attr('content');
      if (metaToken) {
        return metaToken;
      }
      throw new Error('Could not extract authenticity token from page');
    }
    
    return token;
  }

  /**
   * Adds calories using Quick Add.
   *
   * @param params - The Quick Add parameters
   * @returns The result of the Quick Add operation
   */
  async quickAddCalories(params: QuickAddParams): Promise<QuickAddResult> {
    const dateStr = this.formatDate(params.date);
    
    // First, fetch the diary page to get the authenticity token
    const diaryHtml = await this.fetchDiaryPage(dateStr);
    
    let authenticityToken: string;
    try {
      authenticityToken = this.extractAuthenticityToken(diaryHtml);
    } catch {
      // If we can't get the token, we might need to try a different approach
      throw new Error('Could not get authentication token for Quick Add. Session may be expired.');
    }
    
    // Prepare the form data for Quick Add
    const mealId = MEAL_SLOT_IDS[params.meal];
    const formData = new URLSearchParams();
    formData.append('authenticity_token', authenticityToken);
    formData.append('quick_add[calories]', params.calories.toString());
    formData.append('quick_add[meal]', mealId.toString());
    formData.append('quick_add[date]', dateStr);
    
    if (params.carbs !== undefined) {
      formData.append('quick_add[carbs]', params.carbs.toString());
    }
    if (params.fat !== undefined) {
      formData.append('quick_add[fat]', params.fat.toString());
    }
    if (params.protein !== undefined) {
      formData.append('quick_add[protein]', params.protein.toString());
    }
    
    const headers = await this.auth.getFormHeaders();
    const url = `${MFP_BASE_URL}/food/quick_add`;
    
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: formData.toString(),
      redirect: 'manual',
    });
    
    // A successful Quick Add typically redirects to the diary
    if (response.status === 302 || response.status === 200) {
      return {
        success: true,
        message: `Successfully added ${params.calories} calories to ${params.meal}`,
        date: dateStr,
        meal: params.meal,
        calories: params.calories,
      };
    }
    
    // Try to get error from response
    const responseText = await response.text();
    
    if (response.status === 401 || responseText.includes('Sign In')) {
      throw new Error('Session expired. Please update your MFP_SESSION_COOKIE.');
    }
    
    return {
      success: false,
      message: `Quick Add failed with status ${response.status}`,
      date: dateStr,
      meal: params.meal,
      calories: params.calories,
    };
  }

  /**
   * Verifies that the session is valid by making a test request.
   *
   * @returns True if the session is valid
   */
  async verifySession(): Promise<boolean> {
    try {
      const html = await this.fetchDiaryPage();
      // If we get the diary page without being redirected to login, session is valid
      return !html.includes('Sign In') || !html.includes('password');
    } catch {
      return false;
    }
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

