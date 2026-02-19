/**
 * Cookie-based authentication manager for MyFitnessPal.
 *
 * @remarks
 * MFP migrated from Rails to Next.js with NextAuth.js. All API access
 * goes through the BFF proxy at /api/services/ which handles Bearer token
 * injection server-side. Only the session cookie is needed client-side.
 *
 * Supports two modes:
 * 1. Raw cookie header string (recommended) - copy the full Cookie header from DevTools
 * 2. Legacy single-cookie mode - provide just the session token value
 */

import { config } from 'dotenv';
import { Cookie, CookieJar } from 'tough-cookie';
import type { MFPClientConfig } from './types.js';

// Load environment variables
config();

/** MyFitnessPal base URL */
const MFP_BASE_URL = 'https://www.myfitnesspal.com';

/**
 * Manages authentication state for MyFitnessPal requests.
 */
export class AuthManager {
  private cookieJar: CookieJar;
  private config: MFPClientConfig;
  private initialized: boolean = false;

  /** Raw cookie header string (if provided as full header) */
  private rawCookieHeader: string | null = null;

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
   * Detects whether the session cookie value is a raw cookie header string
   * (contains multiple key=value pairs separated by '; ') or a single token value.
   */
  private isRawCookieHeader(value: string): boolean {
    return value.includes('; ') && value.includes('=');
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
        'Copy the full Cookie header from DevTools > Network tab > any MFP request.'
      );
    }

    if (this.isRawCookieHeader(this.config.sessionCookie)) {
      // Raw cookie header mode - use as-is
      this.rawCookieHeader = this.config.sessionCookie;
    } else {
      // Legacy single-value mode - try both old and new cookie names
      const cookieNames = [
        '__Secure-next-auth.session-token',
        'mfp_session',
      ];

      for (const name of cookieNames) {
        const cookie = new Cookie({
          key: name,
          value: this.config.sessionCookie,
          domain: 'www.myfitnesspal.com',
          path: '/',
          secure: true,
          httpOnly: true,
        });
        await this.cookieJar.setCookie(cookie, MFP_BASE_URL);
      }
    }

    this.initialized = true;
  }

  /**
   * Gets the cookie header string for making authenticated requests.
   *
   * @returns The Cookie header value
   */
  async getCookieHeader(): Promise<string> {
    await this.initialize();

    if (this.rawCookieHeader) {
      return this.rawCookieHeader;
    }

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
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      'Accept': 'application/json',
      'Referer': 'https://www.myfitnesspal.com/',
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
      'Content-Type': 'application/json',
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
