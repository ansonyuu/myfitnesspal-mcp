/**
 * Test script to verify session cookie auth works via the BFF proxy.
 *
 * Usage: npx tsx src/scripts/test-auth.ts
 */

import { createAuthManager } from '../auth.js';

async function main(): Promise<void> {
  console.log('=== MyFitnessPal Session Auth Test ===\n');

  // Step 1: Initialize auth manager with session cookie
  console.log('1. Initializing AuthManager from .env...');
  const auth = await createAuthManager();
  console.log('   OK AuthManager initialized (session cookie loaded)\n');

  // Step 2: Verify session via /api/auth/session
  console.log('2. Verifying session via /api/auth/session...');
  const cookieHeader = await auth.getCookieHeader();
  try {
    const response = await fetch('https://www.myfitnesspal.com/api/auth/session', {
      headers: {
        'Cookie': cookieHeader,
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Accept': 'application/json',
      },
    });
    console.log(`   Response: ${response.status} ${response.statusText}`);
    if (response.ok) {
      const data = await response.json() as Record<string, unknown>;
      const userId = data?.userId ?? '(unknown)';
      const expires = data?.expires ?? '(unknown)';
      console.log(`   OK Session valid! userId: ${userId}`);
      console.log(`   Expires: ${expires}`);
    } else {
      console.log('   FAIL Session invalid or expired');
      process.exit(1);
    }
  } catch (error) {
    console.error(`   FAIL Request failed: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  }
  console.log();

  // Step 3: Test food search via BFF proxy
  console.log('3. Testing food search via /api/nutrition...');
  try {
    const response = await fetch('https://www.myfitnesspal.com/api/nutrition?query=banana&per_page=3', {
      headers: {
        'Cookie': cookieHeader,
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Accept': 'application/json',
      },
    });
    console.log(`   Response: ${response.status} ${response.statusText}`);
    if (response.ok) {
      const data = await response.json() as Record<string, unknown>;
      const items = (data?.items ?? data?.results ?? []) as Array<Record<string, unknown>>;
      console.log(`   OK Found ${items.length} food items`);
      if (items.length > 0) {
        const first = (items[0] as any)?.item ?? items[0];
        console.log(`   First result: ${first?.description ?? first?.name ?? '(unknown)'}`);
      }
    } else {
      const text = await response.text();
      console.log(`   WARN Search returned ${response.status}: ${text.slice(0, 200)}`);
    }
  } catch (error) {
    console.log(`   WARN Search request failed: ${error instanceof Error ? error.message : error}`);
  }
  console.log();

  // Step 4: Test diary read via BFF proxy
  const today = new Date().toISOString().split('T')[0];
  console.log(`4. Testing diary read via /api/services/diary?entry_date=${today}...`);
  try {
    const response = await fetch(`https://www.myfitnesspal.com/api/services/diary?entry_date=${today}`, {
      headers: {
        'Cookie': cookieHeader,
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Accept': 'application/json',
      },
    });
    console.log(`   Response: ${response.status} ${response.statusText}`);
    if (response.ok) {
      const data = await response.json() as unknown[];
      const entries = Array.isArray(data) ? data : [];
      console.log(`   OK Diary returned ${entries.length} entries`);
    } else {
      const text = await response.text();
      console.log(`   WARN Diary returned ${response.status}: ${text.slice(0, 200)}`);
    }
  } catch (error) {
    console.log(`   WARN Diary request failed: ${error instanceof Error ? error.message : error}`);
  }
  console.log();

  console.log('=== Auth test complete ===');
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
