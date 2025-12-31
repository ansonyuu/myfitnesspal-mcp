/**
 * Cookie-based authentication manager for MyFitnessPal.
 *
 * @remarks
 * Handles loading session cookies from environment variables and
 * preparing them for use with HTTP requests to MyFitnessPal.
 */

import { config } from 'dotenv';
import { Cookie, CookieJar } from 'tough-cookie';
import type { MFPClientConfig } from './types.js';

// Load environment variables
config();

/** MyFitnessPal base URL */
const MFP_BASE_URL = 'https://www.myfitnesspal.com';

/** Required cookie name for MFP session */
const MFP_SESSION_COOKIE_NAME = 'mfp_session';

/**
 * Manages authentication state for MyFitnessPal requests.
 */
export class AuthManager {
  private cookieJar: CookieJar;
  private config: MFPClientConfig;
  private initialized: boolean = false;

  /**
   * Creates a new AuthManager instance.
   *
   * @param config - Optional configuration. If not provided, reads from environment.
   */
  constructor(config?: Partial<MFPClientConfig>) {
    this.cookieJar = new CookieJar();
    this.config = {
      sessionCookie: config?.sessionCookie ?? process.env.MFP_SESSION_COOKIE ?? '',
      username: config?.username ?? process.env.MFP_USERNAME,
    };
  }

  /**
   * Initializes the cookie jar with the session cookie.
   *
   * @throws Error if the session cookie is not configured
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    if (!this.config.sessionCookie) {
      throw new Error(
        'MFP_SESSION_COOKIE is not configured. Please set it in your .env file.\n' +
        'See README.md for instructions on how to export your session cookie.'
      );
    }

    // Create the session cookie
    const cookie = new Cookie({
      key: MFP_SESSION_COOKIE_NAME,
      value: this.config.sessionCookie,
      domain: 'www.myfitnesspal.com',
      path: '/',
      secure: true,
      httpOnly: true,
    });

    await this.cookieJar.setCookie(cookie, MFP_BASE_URL);
    this.initialized = true;
  }

  /**
   * Gets the cookie header string for making authenticated requests.
   *
   * @returns The Cookie header value
   */
  async getCookieHeader(): Promise<string> {
    await this.initialize();
    return this.cookieJar.getCookieString(MFP_BASE_URL);
  }

  /**
   * Gets the full set of headers needed for authenticated requests.
   *
   * @returns Headers object for fetch requests
   */
  async getAuthHeaders(): Promise<Record<string, string>> {
    const cookieHeader = await this.getCookieHeader();
    
    return {
      'Cookie': cookieHeader,
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'Cache-Control': 'no-cache',
      'Pragma': 'no-cache',
    };
  }

  /**
   * Gets headers for JSON API requests.
   *
   * @returns Headers object for JSON fetch requests
   */
  async getJsonHeaders(): Promise<Record<string, string>> {
    const baseHeaders = await this.getAuthHeaders();
    
    return {
      ...baseHeaders,
      'Accept': 'application/json',
      'Content-Type': 'application/json',
    };
  }

  /**
   * Gets headers for form submission requests.
   *
   * @returns Headers object for form POST requests
   */
  async getFormHeaders(): Promise<Record<string, string>> {
    const baseHeaders = await this.getAuthHeaders();
    
    return {
      ...baseHeaders,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    };
  }

  /**
   * Stores a new cookie received in a response.
   *
   * @param setCookieHeader - The Set-Cookie header value from a response
   */
  async storeCookie(setCookieHeader: string): Promise<void> {
    await this.cookieJar.setCookie(setCookieHeader, MFP_BASE_URL);
  }

  /**
   * Gets the configured username if available.
   *
   * @returns The username or undefined
   */
  getUsername(): string | undefined {
    return this.config.username;
  }

  /**
   * Checks if the session appears to be valid.
   *
   * @remarks
   * This is a basic check - the session could still be expired.
   *
   * @returns True if a session cookie is configured
   */
  isConfigured(): boolean {
    return !!this.config.sessionCookie;
  }
}

/**
 * Creates and initializes an AuthManager instance.
 *
 * @param config - Optional configuration
 * @returns An initialized AuthManager
 */
export async function createAuthManager(config?: Partial<MFPClientConfig>): Promise<AuthManager> {
  const manager = new AuthManager(config);
  await manager.initialize();
  return manager;
}

