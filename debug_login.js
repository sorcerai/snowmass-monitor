// debug-login.js - Standalone debug script
import { chromium } from 'playwright';

async function debugLogin() {
  console.log('🐛 Debug Login Test');
  
  // Replace these with your actual credentials
  const username = 'jillyn.johnson@gmail.com';  // REPLACE THIS
  const password = 'OneSnowmass25';           // REPLACE THIS
  
  console.log('📧 Using email:', username);
  console.log('🔒 Password length:', password.length);
  
  const browser = await chromium.launch({ 
    headless: false,  // Keep visible for debugging
    slowMo: 500       // Slow down actions so you can see them
  });

  try {
    const page = await browser.newPage();
    
    // Go to homepage first
    console.log('🏠 Going to homepage...');
    await page.goto('https://osrcreservations.com');
    
    // Look for login link
    console.log('🔍 Looking for login link...');
    const loginLink = page.locator('a:has-text("Login"), a:has-text("Log in"), [href*="login"]').first();
    
    if (await loginLink.isVisible()) {
      console.log('✅ Login link found, clicking...');
      await loginLink.click();
      await page.waitForLoadState('networkidle');
    } else {
      console.log('🚫 Login link not found, going direct to /login');
      await page.goto('https://osrcreservations.com/login');
    }
    
    // Debug form fields
    console.log('🔍 Analyzing form fields...');
    
    const emailField = page.locator('input[type="email"], input[name="email"]').first();
    const passwordField = page.locator('input[type="password"], input[name="password"]').first();
    
    console.log('📧 Email field visible:', await emailField.isVisible());
    console.log('🔒 Password field visible:', await passwordField.isVisible());
    
    // Get field attributes for debugging
    if (await emailField.isVisible()) {
      const emailAttrs = await emailField.evaluate(el => ({
        name: el.name,
        id: el.id,
        type: el.type,
        placeholder: el.placeholder
      }));
      console.log('📧 Email field attributes:', emailAttrs);
    }
    
    if (await passwordField.isVisible()) {
      const passwordAttrs = await passwordField.evaluate(el => ({
        name: el.name,
        id: el.id,
        type: el.type,
        placeholder: el.placeholder
      }));
      console.log('🔒 Password field attributes:', passwordAttrs);
    }
    
    // Fill fields step by step
    console.log('✍️ Filling email field...');
    await emailField.fill(username);
    
    // Check if email was filled
    const emailValue = await emailField.inputValue();
    console.log('📧 Email field value after fill:', emailValue);
    
    console.log('✍️ Filling password field...');
    await passwordField.fill(password);
    
    // Check if password was filled (don't log the actual password)
    const passwordValue = await passwordField.inputValue();
    console.log('🔒 Password field filled (length):', passwordValue.length);
    
    // Look for submit button
    console.log('🔍 Looking for submit button...');
    const submitButton = page.locator('button:has-text("Log in"), input[type="submit"], button[type="submit"]').first();
    console.log('🔘 Submit button visible:', await submitButton.isVisible());
    
    if (await submitButton.isVisible()) {
      const buttonText = await submitButton.textContent();
      console.log('🔘 Button text:', buttonText);
      
      console.log('🚀 Clicking submit button...');
      await submitButton.click();
      
      // Wait and see what happens
      await page.waitForTimeout(5000);
      
      console.log('📍 Current URL after submit:', page.url());
      const title = await page.title();
      console.log('📄 Page title:', title);
    }
    
    // Keep browser open for manual inspection
    console.log('🔍 Browser will stay open for 30 seconds for inspection...');
    await page.waitForTimeout(30000);
    
  } catch (error) {
    console.error('❌ Debug test failed:', error.message);
  } finally {
    await browser.close();
  }
}

debugLogin();