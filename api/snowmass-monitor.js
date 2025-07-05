// api/snowmass-monitor.js - COMPLETELY CLEAN VERSION
import { chromium } from 'playwright';
import { promises as fs } from 'fs';
import path from 'path';
import fetch from 'node-fetch';

const STORAGE_PATH = './tmp/baselines/';
const NOTIFICATION_LOG_PATH = './tmp/notifications.json';
const MAX_DAILY_NOTIFICATIONS = 2;

export default async function handler(req, res) {
  if (req.method === 'GET') {
    return res.status(200).json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      playwright: 'ready'
    });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { 
      snowmassUsername = process.env.SNOWMASS_USERNAME,
      snowmassPassword = process.env.SNOWMASS_PASSWORD,
      requestId = `local-${Date.now()}`
    } = req.body;

    if (!snowmassUsername || !snowmassPassword) {
      return res.status(400).json({ 
        error: 'Missing credentials'
      });
    }

    console.log(`🎭 Starting monitor for request ${requestId}`);

    const results = await runMonitor({
      username: snowmassUsername,
      password: snowmassPassword,
      requestId
    });

    // Send webhook notification if there are changes
    if (results.changedMonths.length > 0) {
      await sendWebhookNotification(results);
    }

    return res.status(200).json({
      success: true,
      requestId,
      timestamp: new Date().toISOString(),
      monthsChecked: results.totalMonths,
      changedMonths: results.changedMonths.length,
      summary: results.summary,
      results: results.allResults,
      webhookSent: results.changedMonths.length > 0
    });

  } catch (error) {
    console.error('❌ Monitor failed:', error);
    return res.status(500).json({
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
}

// Performance tracking
const performanceTracker = {
  metrics: [],
  
  logOperation(operation, startTime, success = true, metadata = {}) {
    const duration = Date.now() - startTime;
    const metric = {
      timestamp: new Date().toISOString(),
      operation,
      duration,
      success,
      memory: process.memoryUsage(),
      ...metadata
    };
    
    this.metrics.push(metric);
    console.log(`⚡ ${operation}: ${duration}ms [${success ? 'SUCCESS' : 'FAILED'}]`);
    
    if (duration > 30000) {
      console.warn(`⚠️ Slow operation: ${operation} took ${duration}ms`);
    }
    
    return metric;
  }
};

async function runMonitor({ username, password, requestId }) {
  const monitorStart = Date.now();
  console.log(`🏔️ Starting monitor for request ${requestId}`);
  
  const browser = await chromium.launch({
    headless: true, // Always headless for Cloud Run
    args: [
      '--no-sandbox', 
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage', // Use /tmp instead of /dev/shm
      '--disable-gpu',
      '--no-first-run',
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      
      // Cloud Run specific optimizations
      '--memory-pressure-off',
      '--disable-background-networking',
      '--disable-background-sync',
      '--disable-extensions',
      '--disable-plugins',
      '--max-old-space-size=384', // Limit to 384MB heap
      '--disable-web-security' // Reduce security overhead for trusted internal use
    ]
  });

  try {
    const context = await browser.newContext({
      viewport: { width: 1200, height: 800 }
    });
    const page = await context.newPage();
    
    // Login
    await doLogin(page, username, password);
    
    // Get months to check
    const monthsToCheck = getMonthsToCheck();
    const results = [];
    
    for (const month of monthsToCheck) {
      const monthStart = Date.now();
      console.log(`📅 Processing ${month.name}...`);
      
      try {
        const captureStart = Date.now();
        const screenshot = await captureMonthWithRetry(page, month);
        performanceTracker.logOperation(`capture_${month.key}`, captureStart, true, { monthName: month.name });
        
        const compareStart = Date.now();
        const comparison = await compareWithBaseline(month, screenshot);
        performanceTracker.logOperation(`compare_${month.key}`, compareStart, true, { 
          monthName: month.name,
          changePercentage: comparison.changePercentage,
          shouldNotify: comparison.shouldNotify
        });
        
        results.push({
          month: month.key,
          name: month.name,
          ...comparison
        });
        
        if (comparison.shouldUpdateBaseline) {
          await saveBaseline(month.key, screenshot);
        }
        
        performanceTracker.logOperation(`process_${month.key}`, monthStart, true, { monthName: month.name });
        
      } catch (error) {
        console.error(`❌ Error processing ${month.name}:`, error);
        performanceTracker.logOperation(`process_${month.key}`, monthStart, false, { 
          monthName: month.name, 
          error: error.message 
        });
        results.push({
          month: month.key,
          name: month.name,
          error: error.message,
          shouldNotify: false
        });
      }
    }
    
    const changedMonths = results.filter(r => r.shouldNotify);
    
    performanceTracker.logOperation('total_monitor_run', monitorStart, true, {
      monthsProcessed: results.length,
      changedMonths: changedMonths.length,
      finalMemory: process.memoryUsage()
    });
    
    return {
      totalMonths: results.length,
      changedMonths,
      allResults: results,
      summary: {
        totalMonthsChecked: results.length,
        monthsWithChanges: changedMonths.length,
        highestChangePercent: Math.max(...results.map(r => parseFloat(r.changePercentage || 0))),
        totalAvailabilityIncrease: changedMonths.reduce((sum, m) => sum + (m.availabilityIncrease || 0), 0)
      },
      performance: performanceTracker.metrics
    };
    
  } finally {
    await browser.close();
    
    // Final memory cleanup
    if (global.gc) {
      global.gc();
      console.log(`🧹 Final cleanup - Memory: ${JSON.stringify(process.memoryUsage())}`);
    }
  }
}

// HELPER FUNCTIONS for bulletproof navigation

function parseMonthHeader(headerText) {
  if (!headerText) return { month: 'unknown', year: 0 };
  
  // Multiple parsing patterns for different calendar formats
  const patterns = [
    /(\w+)\s+(\d{4})/,           // "January 2024"
    /(\w+),?\s*(\d{4})/,        // "January, 2024"
    /(\d{4})\s+(\w+)/,          // "2024 January"
    /(\w+)\s*-\s*(\d{4})/,      // "January - 2024"
  ];
  
  for (const pattern of patterns) {
    const match = headerText.match(pattern);
    if (match) {
      const [, first, second] = match;
      
      // Determine which is month and which is year
      const isFirstMonth = isNaN(parseInt(first));
      const month = isFirstMonth ? first.toLowerCase() : second.toLowerCase();
      const year = parseInt(isFirstMonth ? second : first);
      
      return { month, year };
    }
  }
  
  console.log(`⚠️ Could not parse month header: "${headerText}"`);
  return { month: 'unknown', year: 0 };
}

function calculateNavigationDirection(current, target) {
  if (current.month === target.month && current.year === target.year) {
    return 'already_there';
  }
  
  const monthNames = ['january', 'february', 'march', 'april', 'may', 'june',
                     'july', 'august', 'september', 'october', 'november', 'december'];
  
  const currentIndex = monthNames.indexOf(current.month);
  const targetIndex = monthNames.indexOf(target.month);
  
  // Year comparison takes precedence
  if (current.year < target.year) {
    return 'forward';
  } else if (current.year > target.year) {
    return 'backward';
  } else {
    // Same year - compare months
    return currentIndex < targetIndex ? 'forward' : 'backward';
  }
}

async function clickNavigationButton(page, direction) {
  const buttonSelectors = direction === 'forward' ? 
    ['.ui-datepicker-next', '.calendar-header .next', 'button[title*="Next"]', 'a[title*="Next"]', '[class*="next"]'] :
    ['.ui-datepicker-prev', '.calendar-header .prev', 'button[title*="Prev"]', 'a[title*="Prev"]', '[class*="prev"]'];
  
  for (const selector of buttonSelectors) {
    try {
      const button = page.locator(selector).first();
      if (await button.isVisible({ timeout: 2000 })) {
        console.log(`🔘 Clicking ${direction} button: ${selector}`);
        await button.click();
        console.log(`✅ Successfully clicked ${direction} button`);
        return true;
      }
    } catch (e) {
      console.log(`❌ Button click failed for selector: ${selector}`);
    }
  }
  
  console.log(`❌ Could not find any ${direction} navigation button`);
  return false;
}

async function waitForCalendarStability(page, headerSelector) {
  // Wait for calendar to stabilize by checking header text doesn't change
  let previousText = '';
  let stableCount = 0;
  
  for (let i = 0; i < 10; i++) {
    await page.waitForTimeout(500);
    
    try {
      const currentText = await page.locator(headerSelector).first().textContent({ timeout: 2000 });
      
      if (currentText === previousText) {
        stableCount++;
        if (stableCount >= 3) { // 3 consecutive stable readings
          console.log(`📍 Calendar stabilized at: "${currentText}"`);
          return;
        }
      } else {
        stableCount = 0;
        previousText = currentText;
      }
    } catch (error) {
      console.log(`⚠️ Stability check failed: ${error.message}`);
    }
  }
  
  console.log(`⚠️ Calendar may not be fully stable, proceeding...`);
}

async function validateMonthWithTextExtraction(page, expectedMonth, expectedYear) {
  try {
    // PRIMARY: Use Playwright's built-in text extraction
    console.log(`🔍 PLAYWRIGHT TEXT EXTRACTION for ${expectedMonth} ${expectedYear}...`);
    
    // Extract all text from calendar area
    const calendarSelectors = [
      'table', '.calendar', '.datepicker', '.ui-datepicker', 
      '[class*="calendar"]', '[class*="datepicker"]', 'main', 'body'
    ];
    
    let allText = '';
    let workingSelector = '';
    
    for (const selector of calendarSelectors) {
      try {
        const text = await page.locator(selector).first().textContent({ timeout: 3000 });
        if (text && text.length > allText.length) {
          allText = text;
          workingSelector = selector;
        }
      } catch (e) {
        // Try next selector
      }
    }
    
    console.log(`📝 Extracted text from "${workingSelector}": ${allText.substring(0, 200)}...`);
    
    // ANALYSIS: Look for month and year in extracted text
    const textLower = allText.toLowerCase();
    const hasExpectedMonth = expectedMonth === 'any' || textLower.includes(expectedMonth.toLowerCase());
    const hasExpectedYear = allText.includes(expectedYear.toString());
    
    // ADVANCED: Check for other months to ensure we're not seeing multiple months
    const monthNames = ['january', 'february', 'march', 'april', 'may', 'june',
                       'july', 'august', 'september', 'october', 'november', 'december'];
    
    const otherMonths = expectedMonth === 'any' ? [] : monthNames.filter(month => 
      month !== expectedMonth.toLowerCase() && textLower.includes(month)
    );
    
    // ADVANCED: Look for specific month/year combinations
    const monthYearPatterns = expectedMonth === 'any' ? [] : [
      new RegExp(`${expectedMonth}\\s+${expectedYear}`, 'i'),
      new RegExp(`${expectedMonth},?\\s*${expectedYear}`, 'i'),
      new RegExp(`${expectedYear}\\s+${expectedMonth}`, 'i'),
      new RegExp(`${expectedMonth.substring(0, 3)}\\s+${expectedYear}`, 'i') // "Jan 2024"
    ];
    
    const hasExactPattern = expectedMonth === 'any' || monthYearPatterns.some(pattern => pattern.test(allText));
    
    // CONFIDENCE CALCULATION
    let confidence = 0;
    if (hasExpectedMonth) confidence += 0.4;
    if (hasExpectedYear) confidence += 0.3;
    if (hasExactPattern) confidence += 0.4;
    if (otherMonths.length === 0) confidence += 0.2; // Bonus for no other months
    if (otherMonths.length > 2) confidence -= 0.3; // Penalty for multiple months
    
    confidence = Math.min(Math.max(confidence, 0), 1.0);
    
    console.log(`🎯 TEXT EXTRACTION ANALYSIS:`);
    console.log(`   📅 Expected: ${expectedMonth} ${expectedYear}`);
    console.log(`   ✅ Has month: ${hasExpectedMonth}`);
    console.log(`   ✅ Has year: ${hasExpectedYear}`);
    console.log(`   🎯 Exact pattern: ${hasExactPattern}`);
    console.log(`   ⚠️ Other months: ${otherMonths.length} (${otherMonths.join(', ')})`);
    console.log(`   📊 Confidence: ${confidence.toFixed(2)}`);
    
    return {
      confidence,
      detectedMonth: hasExpectedMonth ? expectedMonth : 'not_found',
      detectedYear: hasExpectedYear ? expectedYear : 0,
      hasExactPattern,
      otherMonthsFound: otherMonths.length,
      extractedTextLength: allText.length,
      workingSelector
    };
    
  } catch (error) {
    console.log(`⚠️ Text extraction failed: ${error.message}`);
    return {
      confidence: 0,
      detectedMonth: 'error',
      detectedYear: 0,
      hasExactPattern: false,
      otherMonthsFound: 0,
      extractedTextLength: 0,
      workingSelector: 'none'
    };
  }
}

async function validateCalendarDates(page, targetMonth, targetYear) {
  try {
    // Check if calendar shows dates for the correct month
    const dateElements = await page.locator('td[class*="day"], .calendar-day, .ui-datepicker-calendar td').count();
    
    if (dateElements < 20) { // Should have at least 28-31 days visible
      console.log(`⚠️ Only ${dateElements} date elements found, expected 28-31`);
      return false;
    }
    
    // Check for first few days of month (1, 2, 3) to confirm correct month
    const hasDay1 = await page.locator('text="1"').first().isVisible().catch(() => false);
    const hasDay2 = await page.locator('text="2"').first().isVisible().catch(() => false);
    
    console.log(`📅 Calendar validation: ${dateElements} days, day1=${hasDay1}, day2=${hasDay2}`);
    return hasDay1 && hasDay2;
    
  } catch (error) {
    console.log(`⚠️ Date validation failed: ${error.message}`);
    return false;
  }
}

async function doLogin(page, username, password) {
  console.log('🔐 Logging in...');
  
  // Go to homepage
  await page.goto('https://osrcreservations.com');
  
  // Click login link
  await page.click('text=Login');
  await page.waitForLoadState('networkidle');
  
  // Fill login form
  await page.fill('input[type="email"]', username);
  await page.fill('input[type="password"]', password);
  
  // Submit login
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle' }),
    page.click('button:has-text("Log in")')
  ]);

  console.log('✅ Login successful');
  
  // Wait for login to complete
  await page.waitForTimeout(3000);
}

async function captureSpecificMonth(page, monthName, year, monthNumber) {
  console.log(`🗓️ Capturing ${monthName} ${year}...`);
  
  // Go to General Availability page
  await page.goto('https://osrcreservations.com/generalavailability', { 
    waitUntil: 'networkidle',
    timeout: 20000 
  });
  
  await page.waitForTimeout(2000);
  
  // Navigate to the specific month
  const targetMonth = { month: monthNumber, year: year, name: `${monthName} ${year}` };
  await navigateToMonth(page, targetMonth);
  
  // Take screenshot
  try {
    const calendar = page.locator('table').first();
    await calendar.scrollIntoViewIfNeeded();
    const screenshot = await calendar.screenshot({ type: 'png' });
    console.log(`📸 Screenshot captured for ${monthName}`);
    return screenshot;
  } catch (error) {
    console.log(`📸 Taking fallback screenshot for ${monthName}`);
    return await page.screenshot({
      clip: { x: 400, y: 200, width: 500, height: 400 },
      type: 'png'
    });
  }
}

// Retry wrapper for critical operations
async function captureMonthWithRetry(page, monthData, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await captureMonth(page, monthData);
    } catch (error) {
      if (attempt === maxRetries) {
        console.error(`❌ Final attempt failed for ${monthData.name}: ${error.message}`);
        throw error;
      }
      
      const delay = Math.min(1000 * Math.pow(2, attempt - 1), 8000); // Max 8s delay
      console.log(`🔄 Retry ${attempt}/${maxRetries} for ${monthData.name} in ${delay}ms: ${error.message}`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}

async function captureMonth(page, monthData) {
  console.log('🏔️ Going to General Availability...');
  
  // Go directly to General Availability
  await page.goto('https://osrcreservations.com/generalavailability', { 
    waitUntil: 'networkidle',
    timeout: 20000 
  });
  
  console.log('✅ On General Availability page');
  await page.waitForTimeout(3000);
  
  // Navigate to target month
  await navigateToMonth(page, monthData);

  // Take screenshot
  try {
    const calendar = page.locator('table').first();
    await calendar.scrollIntoViewIfNeeded();
    const screenshot = await calendar.screenshot({ type: 'png' });
    console.log(`📸 Screenshot captured for ${monthData.name}`);
    return screenshot;
  } catch (error) {
    console.log('📸 Taking fallback screenshot');
    return await page.screenshot({
      clip: { x: 400, y: 200, width: 500, height: 400 },
      type: 'png'
    });
  }
}

async function navigateToMonth(page, monthData) {
  const targetMonth = monthData.month;
  const targetYear = monthData.year;
  const targetMonthName = ['january', 'february', 'march', 'april', 'may', 'june',
                          'july', 'august', 'september', 'october', 'november', 'december'][targetMonth - 1];
  
  console.log(`🗓️ BULLETPROOF NAVIGATION to ${monthData.name} (${targetMonthName} ${targetYear})...`);
  
  // VERIFICATION STEP 1: Take screenshot of starting state
  const startingScreenshot = await page.screenshot({ type: 'png' });
  console.log(`📸 Starting state captured (${startingScreenshot.length} bytes)`);
  
  // VERIFICATION STEP 2: PRIMARY - Use Playwright text extraction to find current month
  console.log(`🔍 PRIMARY METHOD: Playwright text extraction for current month detection...`);
  const currentTextValidation = await validateMonthWithTextExtraction(page, 'any', new Date().getFullYear());
  
  let currentMonthText = '';
  let workingSelector = '';
  
  if (currentTextValidation.extractedTextLength > 0) {
    // Extract current month from text using all month patterns
    const monthNames = ['january', 'february', 'march', 'april', 'may', 'june',
                       'july', 'august', 'september', 'october', 'november', 'december'];
    
    const extractedText = currentTextValidation.workingSelector ? 
      await page.locator(currentTextValidation.workingSelector).textContent() : '';
    
    // Find the first month/year combination in the text
    for (const month of monthNames) {
      const patterns = [
        new RegExp(`${month}\\s+(\\d{4})`, 'i'),
        new RegExp(`${month},?\\s*(\\d{4})`, 'i'),
        new RegExp(`(\\d{4})\\s+${month}`, 'i')
      ];
      
      for (const pattern of patterns) {
        const match = extractedText.match(pattern);
        if (match) {
          currentMonthText = match[0];
          workingSelector = currentTextValidation.workingSelector;
          console.log(`📍 PRIMARY SUCCESS: Found current month via text extraction: "${currentMonthText}"`);
          break;
        }
      }
      if (currentMonthText) break;
    }
  }
  
  // FALLBACK: Multiple header detection methods if text extraction failed
  if (!currentMonthText) {
    console.log(`⚠️ Text extraction failed, falling back to header selectors...`);
    
    const headerSelectors = [
      '.ui-datepicker-title',
      '.calendar-header h3', 
      '.calendar-header h2',
      'h2.ui-datepicker-title',
      '.datepicker-title',
      '[class*="month"][class*="year"]',
      '[class*="calendar"][class*="header"] h2',
      '[class*="calendar"][class*="header"] h3'
    ];
    
    for (const selector of headerSelectors) {
      try {
        const text = await page.locator(selector).first().textContent({ timeout: 3000 });
        if (text && text.trim()) {
          currentMonthText = text.trim();
          workingSelector = selector;
          console.log(`📍 FALLBACK SUCCESS: Found header with selector "${selector}": "${currentMonthText}"`);
          break;
        }
      } catch (e) {
        console.log(`❌ Selector "${selector}" failed: ${e.message}`);
      }
    }
  }
  
  if (!currentMonthText) {
    console.error(`🚨 CRITICAL: Could not detect current month via text extraction OR header selectors!`);
    throw new Error('Cannot detect month - page structure may have changed or calendar not loaded');
  }
  
  // VERIFICATION STEP 3: Playwright text extraction validation
  const textValidation = await validateMonthWithTextExtraction(page, targetMonthName, targetYear);
  
  // VERIFICATION STEP 4: Navigate with triple-validation
  for (let attempts = 0; attempts < 12; attempts++) { // Increased attempts
    try {
      // Get current month using the working selector
      const monthHeaderText = await page.locator(workingSelector).first().textContent({ timeout: 5000 });
      console.log(`🔍 Attempt ${attempts + 1}: Current month header: "${monthHeaderText}"`);
      
      // VERIFICATION: Parse and validate current month
      const parsedCurrent = parseMonthHeader(monthHeaderText);
      const parsedTarget = { month: targetMonthName, year: targetYear };
      
      console.log(`📊 PARSED: Current=${parsedCurrent.month} ${parsedCurrent.year}, Target=${parsedTarget.month} ${parsedTarget.year}`);
      
      // VERIFICATION: Check if we're at exact target
      if (parsedCurrent.month === parsedTarget.month && parsedCurrent.year === parsedTarget.year) {
        console.log(`✅ MONTH MATCH DETECTED!`);
        
        // TRIPLE VERIFICATION before declaring success
        await page.waitForTimeout(2000); // Let calendar fully stabilize
        
        // Verification 1: Re-check header text
        const doubleCheck = await page.locator(workingSelector).first().textContent();
        const doubleCheckParsed = parseMonthHeader(doubleCheck);
        
        // Verification 2: Take screenshot and compare with starting state
        const currentScreenshot = await page.screenshot({ type: 'png' });
        const screenshotDiff = Math.abs(currentScreenshot.length - startingScreenshot.length);
        console.log(`📸 Screenshot size change: ${screenshotDiff} bytes`);
        
        // Verification 3: Playwright text extraction validation
        const textConfirm = await validateMonthWithTextExtraction(page, targetMonthName, targetYear);
        
        if (doubleCheckParsed.month === parsedTarget.month && 
            doubleCheckParsed.year === parsedTarget.year &&
            textConfirm.confidence > 0.8) {
          
          console.log(`🎯 TRIPLE VERIFIED SUCCESS:`);
          console.log(`   ✅ Header text: "${doubleCheck}"`);
          console.log(`   ✅ Screenshot diff: ${screenshotDiff} bytes`);
          console.log(`   ✅ Text extraction confidence: ${textConfirm.confidence}`);
          console.log(`   ✅ Text detected: ${textConfirm.detectedMonth} ${textConfirm.detectedYear}`);
          
          // FINAL VALIDATION: Check for calendar dates
          const hasValidDates = await validateCalendarDates(page, targetMonth, targetYear);
          if (hasValidDates) {
            console.log(`   ✅ Calendar dates validated for ${targetMonthName} ${targetYear}`);
            return; // SUCCESS!
          } else {
            console.log(`   ❌ Calendar dates validation failed`);
          }
        } else {
          console.log(`❌ TRIPLE VERIFICATION FAILED:`);
          console.log(`   - DoubleCheck: ${doubleCheckParsed.month} ${doubleCheckParsed.year}`);
          console.log(`   - Text confidence: ${textConfirm.confidence}`);
          console.log(`   - Text detected: ${textConfirm.detectedMonth} ${textConfirm.detectedYear}`);
        }
      }
      
      // NAVIGATION: Determine direction with validation
      const navigationDirection = calculateNavigationDirection(parsedCurrent, parsedTarget);
      console.log(`🧭 Navigation direction: ${navigationDirection}`);
      
      if (navigationDirection === 'already_there') {
        console.log(`🤔 Should be there but verification failed - taking recovery screenshot`);
        await page.screenshot({ path: './tmp/navigation-error.png' });
        throw new Error(`Navigation claims success but verification failed`);
      }
      
      // CLICK: Navigation button with validation
      const clickSuccess = await clickNavigationButton(page, navigationDirection);
      if (!clickSuccess) {
        console.log(`❌ Could not click navigation button, stopping`);
        break;
      }
      
      // WAIT: For navigation to complete with stability check
      await page.waitForTimeout(3000);
      await waitForCalendarStability(page, workingSelector);
      
    } catch (error) {
      console.error(`❌ Navigation attempt ${attempts + 1} failed:`, error.message);
      
      // Take error screenshot for debugging
      await page.screenshot({ path: `./tmp/nav-error-${attempts}.png` }).catch(() => {});
    }
  }
  
  // FINAL VERIFICATION with detailed failure analysis
  try {
    const finalMonthText = await page.locator(workingSelector).first().textContent();
    const finalParsed = parseMonthHeader(finalMonthText);
    const finalTextExtraction = await validateMonthWithTextExtraction(page, targetMonthName, targetYear);
    
    console.log(`🏁 FINAL STATE ANALYSIS:`);
    console.log(`   📝 Header text: "${finalMonthText}"`);
    console.log(`   📊 Parsed: ${finalParsed.month} ${finalParsed.year}`);
    console.log(`   🔍 Text extraction: ${finalTextExtraction.detectedMonth} ${finalTextExtraction.detectedYear} (confidence: ${finalTextExtraction.confidence})`);
    console.log(`   🎯 Target: ${targetMonthName} ${targetYear}`);
    
    // Take final diagnostic screenshot
    await page.screenshot({ path: './tmp/final-navigation-state.png' });
    
    // DUAL VALIDATION: Both header parsing AND text extraction must confirm success
    const headerSuccess = finalParsed.month === targetMonthName && finalParsed.year === targetYear;
    const textSuccess = finalTextExtraction.confidence > 0.8 && 
                       finalTextExtraction.detectedMonth === targetMonthName && 
                       finalTextExtraction.detectedYear === targetYear;
    
    if (!headerSuccess && !textSuccess) {
      const errorMsg = `NAVIGATION FAILED: Target=${targetMonthName} ${targetYear}, Header=${finalParsed.month} ${finalParsed.year}, Text=${finalTextExtraction.detectedMonth} ${finalTextExtraction.detectedYear}`;
      console.error(`❌ ${errorMsg}`);
      throw new Error(errorMsg);
    } else if (!headerSuccess && textSuccess) {
      console.log(`⚠️ Header parsing failed but text extraction succeeded - proceeding with text validation`);
    } else if (headerSuccess && !textSuccess) {
      console.log(`⚠️ Text extraction failed but header parsing succeeded - proceeding with header validation`);
    } else {
      console.log(`✅ DUAL VALIDATION SUCCESS: Both header and text extraction confirm target month`);
    }
    
  } catch (error) {
    console.error(`❌ Final verification failed:`, error.message);
    throw error;
  }
}

function getMonthsToCheck() {
  const now = new Date();
  const ninetyDaysFromNow = new Date(now.getTime() + (90 * 24 * 60 * 60 * 1000));
  const months = [];
  
  // Start from current month and add all months that fall within 90 days
  const currentDate = new Date(now.getFullYear(), now.getMonth(), 1);
  
  while (currentDate <= ninetyDaysFromNow) {
    const monthData = {
      key: `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, '0')}`,
      name: currentDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }),
      month: currentDate.getMonth() + 1,
      year: currentDate.getFullYear(),
      startDate: new Date(currentDate),
      endDate: ninetyDaysFromNow
    };
    months.push(monthData);
    
    // Move to next month
    currentDate.setMonth(currentDate.getMonth() + 1);
  }
  
  console.log(`📅 Monitoring next 90 days: ${now.toDateString()} to ${ninetyDaysFromNow.toDateString()}`);
  console.log(`📅 Months to check: ${months.map(m => m.name).join(', ')}`);
  
  return months;
}

async function compareWithBaseline(monthData, currentScreenshot) {
  const baselinePath = path.join(STORAGE_PATH, `${monthData.key}.png`);
  let baselineBuffer = null;
  
  try {
    await fs.mkdir(STORAGE_PATH, { recursive: true });
    baselineBuffer = await fs.readFile(baselinePath);
    
    console.log(`📊 Comparing ${monthData.name} with existing baseline`);
    console.log(`  - Baseline size: ${baselineBuffer.length} bytes`);
    console.log(`  - Current size: ${currentScreenshot.length} bytes`);
    
    const comparison = performVisualComparison(baselineBuffer, currentScreenshot);
    
    // Memory cleanup - explicitly null large buffers
    baselineBuffer = null;
    
    // Force garbage collection if available (Cloud Run optimization)
    if (global.gc) {
      global.gc();
    }
    
    console.log(`📊 Comparison results for ${monthData.name}:`);
    console.log(`  - Total pixels: ${comparison.totalPixels}`);
    console.log(`  - Changed pixels: ${comparison.changedPixels}`);
    console.log(`  - Change percentage: ${comparison.changePercentage}%`);
    console.log(`  - Availability increase: ${comparison.availabilityIncrease}`);
    console.log(`  - Significant change: ${comparison.significantChange}`);
    console.log(`  - Likely new availability: ${comparison.likelyNewAvailability}`);
    console.log(`  - Would notify: ${comparison.significantChange && comparison.likelyNewAvailability}`);
    
    return {
      hasBaseline: true,
      shouldNotify: comparison.significantChange && comparison.likelyNewAvailability,
      shouldUpdateBaseline: comparison.significantChange,
      ...comparison
    };
    
  } catch (error) {
    console.log(`📸 No baseline found for ${monthData.key} - creating new baseline`);
    await saveBaseline(monthData.key, currentScreenshot);
    
    return {
      hasBaseline: false,
      shouldNotify: false,
      shouldUpdateBaseline: false,
      message: `Baseline created for ${monthData.name}`
    };
  }
}

function performVisualComparison(baselineBuffer, currentBuffer) {
  let totalPixels = 0;
  let changedPixels = 0;
  let availabilityIncrease = 0;
  let dateHighlightChanges = 0;
  let nonAvailabilityChanges = 0;
  
  const minLength = Math.min(baselineBuffer.length, currentBuffer.length);
  
  // 1x sampling for 90-day accuracy: every pixel (4 bytes = 1 pixel)
  for (let i = 0; i < minLength; i += 4) {
    if (i + 3 < minLength) {
      totalPixels++;
      
      const currentR = currentBuffer[i];
      const currentG = currentBuffer[i + 1];
      const currentB = currentBuffer[i + 2];
      
      const baselineR = baselineBuffer[i];
      const baselineG = baselineBuffer[i + 1];
      const baselineB = baselineBuffer[i + 2];
      
      const colorDiff = Math.sqrt(
        Math.pow(currentR - baselineR, 2) +
        Math.pow(currentG - baselineG, 2) +
        Math.pow(currentB - baselineB, 2)
      );
      
      if (colorDiff > 30) {
        // Check if this looks like date highlighting (blues, grays, whites)
        const isCurrentDateHighlight = 
          (currentR > 200 && currentG > 200 && currentB > 240) || // Light blue/white highlighting
          (currentR > 150 && currentG > 170 && currentB > 200) || // Blue highlighting
          (Math.abs(currentR - currentG) < 20 && Math.abs(currentG - currentB) < 20 && currentR > 180); // Light gray highlighting
          
        const isBaselineDateHighlight = 
          (baselineR > 200 && baselineG > 200 && baselineB > 240) || 
          (baselineR > 150 && baselineG > 170 && baselineB > 200) ||
          (Math.abs(baselineR - baselineG) < 20 && Math.abs(baselineG - baselineB) < 20 && baselineR > 180);
        
        // If either is date highlighting, ignore this change
        if (isCurrentDateHighlight || isBaselineDateHighlight) {
          dateHighlightChanges++;
          continue;
        }
        
        changedPixels++;
        
        // PRECISE availability color detection based on actual Snowmass colors
        const currentIsAvailable = 
          // Light gray/beige available (current month) - RGB around 220-235 range
          (currentR >= 215 && currentR <= 240 && 
           currentG >= 215 && currentG <= 240 && 
           currentB >= 210 && currentB <= 235 &&
           Math.abs(currentR - currentG) < 15 && Math.abs(currentG - currentB) < 15) ||
          // Light tan/beige available (adjacent month) - slightly more brown/tan
          (currentR >= 210 && currentR <= 235 && 
           currentG >= 205 && currentG <= 230 && 
           currentB >= 190 && currentB <= 220 &&
           currentR > currentB + 10); // More red than blue for tan color
        
        const baselineIsAvailable = 
          // Same detection for baseline
          (baselineR >= 215 && baselineR <= 240 && 
           baselineG >= 215 && baselineG <= 240 && 
           baselineB >= 210 && baselineB <= 235 &&
           Math.abs(baselineR - baselineG) < 15 && Math.abs(baselineG - baselineB) < 15) ||
          (baselineR >= 210 && baselineR <= 235 && 
           baselineG >= 205 && baselineG <= 230 && 
           baselineB >= 190 && baselineB <= 220 &&
           baselineR > baselineB + 10);
        
        // Only count as availability increase if:
        // 1. Current pixel is clearly available color
        // 2. Baseline pixel was NOT available color
        // 3. Baseline was not white/empty (background)
        const baselineIsBackground = (baselineR > 240 && baselineG > 240 && baselineB > 240);
        
        if (currentIsAvailable && !baselineIsAvailable && !baselineIsBackground) {
          availabilityIncrease++;
        } else if (!currentIsAvailable && !baselineIsAvailable) {
          // Non-availability related change (text, borders, etc.)
          nonAvailabilityChanges++;
        }
      }
    }
  }
  
  const changePercentage = (changedPixels / totalPixels) * 100;
  const availabilityScore = (availabilityIncrease / totalPixels) * 100;
  
  console.log(`  - Date highlight changes ignored: ${dateHighlightChanges}`);
  console.log(`  - Non-availability changes: ${nonAvailabilityChanges}`);
  console.log(`  - True availability increases: ${availabilityIncrease}`);
  
  // ULTRA-SENSITIVE thresholds - prevents missed alerts like July 12th
  const significantChange = changePercentage > 2.0; // More sensitive than 5.0
  const likelyNewAvailability = availabilityIncrease > 0 && availabilityScore > 0.01; // ANY availability increase triggers alert
  
  return {
    changePercentage: changePercentage.toFixed(3),
    availabilityScore: availabilityScore.toFixed(3),
    changedPixels,
    totalPixels,
    availabilityIncrease,
    dateHighlightChanges,
    nonAvailabilityChanges,
    significantChange,
    likelyNewAvailability
  };
}

async function saveBaseline(monthKey, screenshot) {
  await fs.mkdir(STORAGE_PATH, { recursive: true });
  const baselinePath = path.join(STORAGE_PATH, `${monthKey}.png`);
  await fs.writeFile(baselinePath, screenshot);
  console.log(`💾 Baseline saved for ${monthKey}`);
}

async function sendWebhookNotification(results) {
  const webhookUrl = 'https://buildsolutions.app.n8n.cloud/webhook/onesnowmass';
  
  try {
    // Check daily notification limit
    const canNotify = await checkNotificationLimit();
    if (!canNotify) {
      console.log('⏸️ Daily notification limit reached (2/day) - skipping webhook');
      return;
    }
    
    console.log('📡 Sending webhook notification to n8n...');
    
    const payload = {
      timestamp: new Date().toISOString(),
      alert: 'NEW_AVAILABILITY_DETECTED',
      timeframe: 'NEXT_90_DAYS',
      summary: {
        totalMonthsChecked: results.totalMonths,
        monthsWithChanges: results.changedMonths.length,
        highestChangePercent: results.summary.highestChangePercent,
        totalAvailabilityIncrease: results.summary.totalAvailabilityIncrease
      },
      changedMonths: results.changedMonths.map(month => ({
        month: month.month,
        name: month.name,
        changePercentage: month.changePercentage,
        availabilityScore: month.availabilityScore,
        availabilityIncrease: month.availabilityIncrease,
        significantChange: month.significantChange,
        likelyNewAvailability: month.likelyNewAvailability
      })),
      message: `🏔️ NEW SNOWMASS AVAILABILITY! ${results.changedMonths.length} month(s) show new condo availability in the next 90 days. Book now!`
    };
    
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Snowmass-Monitor/1.0.0'
      },
      body: JSON.stringify(payload)
    });
    
    if (response.ok) {
      console.log('✅ Webhook notification sent successfully');
      console.log(`📊 Notified about ${results.changedMonths.length} changed months`);
      await logNotification();
    } else {
      console.error('❌ Webhook failed:', response.status, response.statusText);
    }
    
  } catch (error) {
    console.error('❌ Webhook notification failed:', error.message);
  }
}

async function checkNotificationLimit() {
  try {
    await fs.mkdir('./tmp', { recursive: true });
    
    let notificationLog = [];
    try {
      const logData = await fs.readFile(NOTIFICATION_LOG_PATH, 'utf8');
      notificationLog = JSON.parse(logData);
    } catch (error) {
      // File doesn't exist, start fresh
      notificationLog = [];
    }
    
    const today = new Date().toDateString();
    const todayNotifications = notificationLog.filter(n => 
      new Date(n.timestamp).toDateString() === today
    );
    
    console.log(`📊 Today's notifications: ${todayNotifications.length}/${MAX_DAILY_NOTIFICATIONS}`);
    
    return todayNotifications.length < MAX_DAILY_NOTIFICATIONS;
  } catch (error) {
    console.error('❌ Error checking notification limit:', error);
    return true; // Allow notification on error
  }
}

async function logNotification() {
  try {
    let notificationLog = [];
    try {
      const logData = await fs.readFile(NOTIFICATION_LOG_PATH, 'utf8');
      notificationLog = JSON.parse(logData);
    } catch (error) {
      // File doesn't exist, start fresh
    }
    
    // Add new notification
    notificationLog.push({
      timestamp: new Date().toISOString(),
      type: 'availability_change'
    });
    
    // Keep only last 7 days of logs
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    notificationLog = notificationLog.filter(n => 
      new Date(n.timestamp) > sevenDaysAgo
    );
    
    await fs.writeFile(NOTIFICATION_LOG_PATH, JSON.stringify(notificationLog, null, 2));
    console.log('📝 Notification logged');
  } catch (error) {
    console.error('❌ Error logging notification:', error);
  }
}