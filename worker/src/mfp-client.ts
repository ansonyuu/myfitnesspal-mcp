/**
 * MyFitnessPal HTTP client for Cloudflare Workers.
 *
 * @remarks
 * This client handles all communication with the MyFitnessPal website,
 * adapted for the Cloudflare Workers runtime.
 */

import * as cheerio from 'cheerio';
import type {
  DayDiary,
  Env,
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
 * Client for interacting with MyFitnessPal from Cloudflare Workers.
 */
export class MFPClient {
  private sessionCookie: string;

  /**
   * Creates a new MFP client.
   *
   * @param env - Cloudflare Worker environment with secrets
   */
  constructor(env: Env) {
    if (!env.MFP_SESSION_COOKIE) {
      throw new Error('MFP_SESSION_COOKIE secret is not configured');
    }
    this.sessionCookie = env.MFP_SESSION_COOKIE;
  }

  /**
   * Gets headers for authenticated requests.
   */
  private getHeaders(): Record<string, string> {
    return {
      'Cookie': `_mfp_session=${this.sessionCookie}`,
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'Cache-Control': 'no-cache',
    };
  }

  /**
   * Gets headers for form submission requests.
   */
  private getFormHeaders(): Record<string, string> {
    return {
      ...this.getHeaders(),
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    };
  }

  /**
   * Formats a date to YYYY-MM-DD format.
   */
  private formatDate(date?: Date | string): string {
    if (typeof date === 'string') {
      return date;
    }
    const d = date ?? new Date();
    return d.toISOString().split('T')[0];
  }

  /**
   * Parses a number from a string.
   */
  private parseNumber(text: string): number {
    const cleaned = text.replace(/[,\s]/g, '').trim();
    const num = parseInt(cleaned, 10);
    return isNaN(num) ? 0 : num;
  }

  /**
   * Fetches the diary page HTML for a specific date.
   */
  async fetchDiaryPage(date?: Date | string): Promise<string> {
    const dateStr = this.formatDate(date);
    const url = `${MFP_BASE_URL}/food/diary?date=${dateStr}`;
    
    const response = await fetch(url, { headers: this.getHeaders() });
    
    if (!response.ok) {
      throw new Error(`Failed to fetch diary: ${response.status}`);
    }
    
    const html = await response.text();
    
    if (html.includes('Sign In') && html.includes('password')) {
      throw new Error('Session expired. Please update MFP_SESSION_COOKIE secret.');
    }
    
    return html;
  }

  /**
   * Parses the diary HTML to extract meal and food data.
   */
  private parseDiaryHtml(html: string, dateStr: string): DayDiary {
    const $ = cheerio.load(html);
    const meals: Meal[] = [];
    
    const mealNames: MealSlot[] = ['Breakfast', 'Lunch', 'Dinner', 'Snacks'];
    
    mealNames.forEach((mealName, index) => {
      const entries: FoodEntry[] = [];
      let totalCalories = 0;
      let totalCarbs = 0;
      let totalFat = 0;
      let totalProtein = 0;
      
      const mealSelector = `#diary-table tbody#meal_${index}`;
      const mealSection = $(mealSelector);
      
      if (mealSection.length) {
        mealSection.find('tr.bottom').each((_, row) => {
          const $row = $(row);
          const name = $row.find('td.first a').text().trim();
          
          if (name) {
            const calories = this.parseNumber($row.find('td').eq(1).text());
            const carbs = this.parseNumber($row.find('td').eq(2).text());
            const fat = this.parseNumber($row.find('td').eq(3).text());
            const protein = this.parseNumber($row.find('td').eq(4).text());
            const sodium = this.parseNumber($row.find('td').eq(5).text());
            const sugar = this.parseNumber($row.find('td').eq(6).text());
            
            entries.push({ name, calories, carbs, fat, protein, sodium, sugar });
            
            totalCalories += calories;
            totalCarbs += carbs;
            totalFat += fat;
            totalProtein += protein;
          }
        });
        
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
    
    const totalsRow = $('#diary-table tfoot tr.total');
    const goalRow = $('#diary-table tfoot tr.goal');
    const remainingRow = $('#diary-table tfoot tr.remaining');
    
    return {
      date: dateStr,
      meals,
      totalCalories: this.parseNumber(totalsRow.find('td').eq(1).text()),
      goalCalories: this.parseNumber(goalRow.find('td').eq(1).text()),
      remainingCalories: this.parseNumber(remainingRow.find('td').eq(1).text()),
    };
  }

  /**
   * Gets the food diary for a specific date.
   */
  async getDiary(date?: Date | string): Promise<DayDiary> {
    const dateStr = this.formatDate(date);
    const html = await this.fetchDiaryPage(dateStr);
    return this.parseDiaryHtml(html, dateStr);
  }

  /**
   * Gets the nutrition summary for a specific date.
   */
  async getNutritionSummary(date?: Date | string): Promise<NutritionSummary> {
    const dateStr = this.formatDate(date);
    const html = await this.fetchDiaryPage(dateStr);
    const $ = cheerio.load(html);
    
    const totalsRow = $('#diary-table tfoot tr.total');
    const goalRow = $('#diary-table tfoot tr.goal');
    
    return {
      date: dateStr,
      calories: this.parseNumber(totalsRow.find('td').eq(1).text()),
      caloriesGoal: this.parseNumber(goalRow.find('td').eq(1).text()),
      carbs: this.parseNumber(totalsRow.find('td').eq(2).text()),
      carbsGoal: this.parseNumber(goalRow.find('td').eq(2).text()),
      fat: this.parseNumber(totalsRow.find('td').eq(3).text()),
      fatGoal: this.parseNumber(goalRow.find('td').eq(3).text()),
      protein: this.parseNumber(totalsRow.find('td').eq(4).text()),
      proteinGoal: this.parseNumber(goalRow.find('td').eq(4).text()),
      sodium: this.parseNumber(totalsRow.find('td').eq(5).text()),
      sodiumGoal: this.parseNumber(goalRow.find('td').eq(5).text()),
      sugar: this.parseNumber(totalsRow.find('td').eq(6).text()),
      sugarGoal: this.parseNumber(goalRow.find('td').eq(6).text()),
    };
  }

  /**
   * Gets the user's nutrition goals.
   */
  async getGoals(): Promise<NutritionGoals> {
    const html = await this.fetchDiaryPage();
    const $ = cheerio.load(html);
    
    const goalRow = $('#diary-table tfoot tr.goal');
    
    const calories = this.parseNumber(goalRow.find('td').eq(1).text());
    const carbs = this.parseNumber(goalRow.find('td').eq(2).text());
    const fat = this.parseNumber(goalRow.find('td').eq(3).text());
    const protein = this.parseNumber(goalRow.find('td').eq(4).text());
    const sodium = this.parseNumber(goalRow.find('td').eq(5).text());
    const sugar = this.parseNumber(goalRow.find('td').eq(6).text());
    
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
   * Extracts the authenticity token from a page.
   */
  private extractAuthenticityToken(html: string): string {
    const $ = cheerio.load(html);
    const token = $('input[name="authenticity_token"]').val() as string;
    
    if (!token) {
      const metaToken = $('meta[name="csrf-token"]').attr('content');
      if (metaToken) return metaToken;
      throw new Error('Could not extract authenticity token');
    }
    
    return token;
  }

  /**
   * Adds calories using Quick Add.
   */
  async quickAddCalories(params: QuickAddParams): Promise<QuickAddResult> {
    const dateStr = this.formatDate(params.date);
    const diaryHtml = await this.fetchDiaryPage(dateStr);
    
    let authenticityToken: string;
    try {
      authenticityToken = this.extractAuthenticityToken(diaryHtml);
    } catch {
      throw new Error('Could not get auth token. Session may be expired.');
    }
    
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
    
    const response = await fetch(`${MFP_BASE_URL}/food/quick_add`, {
      method: 'POST',
      headers: this.getFormHeaders(),
      body: formData.toString(),
      redirect: 'manual',
    });
    
    if (response.status === 302 || response.status === 200) {
      return {
        success: true,
        message: `Added ${params.calories} calories to ${params.meal}`,
        date: dateStr,
        meal: params.meal,
        calories: params.calories,
      };
    }
    
    const responseText = await response.text();
    if (response.status === 401 || responseText.includes('Sign In')) {
      throw new Error('Session expired. Update MFP_SESSION_COOKIE secret.');
    }
    
    return {
      success: false,
      message: `Quick Add failed: ${response.status}`,
      date: dateStr,
      meal: params.meal,
      calories: params.calories,
    };
  }

  /**
   * Verifies that the session is valid.
   */
  async verifySession(): Promise<boolean> {
    try {
      const html = await this.fetchDiaryPage();
      return !html.includes('Sign In') || !html.includes('password');
    } catch {
      return false;
    }
  }
}

