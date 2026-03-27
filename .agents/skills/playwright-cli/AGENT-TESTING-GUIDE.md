# TradeNext Agent Testing Guide

> Comprehensive Playwright CLI testing workflow for TradeNext development

## Overview

This guide documents the standardized testing workflow using Playwright CLI for UI/UX validation during new feature development on TradeNext.

## Prerequisites

### 1. Install Playwright CLI

```bash
# Install globally
npm install -g playwright-cli

# Or use npx
npx playwright-cli --version
```

### 2. Install Browser (if needed)

```bash
playwright-cli install
```

### 3. Start Development Server

```bash
# Start dev server before testing
npm run dev
# Server runs on http://localhost:3000
```

---

## Test Credentials

| Role | Email | Password |
|------|-------|----------|
| Demo | demo@tradenext6.app | demo123 |
| Admin | admin@tradenext6.app | admin123 |

---

## Standard Testing Workflow

### Phase 1: Setup

```bash
# 1. Start dev server (if not running)
npm run dev

# 2. Open browser
playwright-cli open http://localhost:3000
```

### Phase 2: Core Flows

#### Login Testing

```bash
# Navigate to login
playwright-cli goto http://localhost:3000

# Take initial snapshot
playwright-cli snapshot

# Click login button or navigate to signin
playwright-cli click e[login-button-ref]

# Fill email
playwright-cli fill e[email-field] "demo@tradenext6.app"

# Fill password  
playwright-cli fill e[password-field] "demo123"

# Submit form
playwright-cli click e[submit-button]

# Verify redirect to dashboard
playwright-cli snapshot
```

#### Navigation Testing

```bash
# Test Markets dropdown
playwright-cli hover e[markets-menu]
playwright-cli click e[analytics-link]
playwright-cli snapshot

# Test sidebar navigation
playwright-cli click e[portfolio-link]
playwright-cli snapshot
```

### Phase 3: Feature-Specific Testing

#### Forms

```bash
# Navigate to form page
playwright-cli goto http://localhost:3000/alerts

# Fill form fields
playwright-cli fill e[symbol-input] "RELIANCE"
playwright-cli fill e[price-input] "2500"

# Select from dropdown
playwright-cli select e[type-dropdown] "above"

# Submit
playwright-cli click e[submit-button]

# Verify success/error state
playwright-cli snapshot
```

#### Tables & Data

```bash
# Navigate to data page
playwright-cli goto http://localhost:3000/markets/analytics?tab=corporate-actions

# Test sorting - click column header
playwright-cli click e[sort-column-header]

# Test filtering - click filter button
playwright-cli click e[filter-button]
playwright-cli snapshot

# Test pagination
playwright-cli click e[next-page-button]
playwright-cli snapshot
```

#### Modals & Dialogs

```bash
# Open modal
playwright-cli click e[open-modal-button]
playwright-cli snapshot

# Interact with modal
playwright-cli fill e[modal-input] "test value"
playwright-cli click e[modal-submit]

# Close modal
playwright-cli click e[close-button]
playwright-cli snapshot
```

### Phase 4: Responsive Testing

```bash
# Mobile viewport
playwright-cli resize 375 667
playwright-cli snapshot

# Tablet viewport
playwright-cli resize 768 1024
playwright-cli snapshot

# Desktop viewport
playwright-cli resize 1920 1080
playwright-cli snapshot
```

### Phase 5: Error Detection

```bash
# Check console for errors
playwright-cli console error

# Check for warnings
playwright-cli console warning

# Network requests
playwright-cli network
```

### Phase 6: Cleanup

```bash
# Close browser
playwright-cli close

# Stop dev server (if you started it)
# Use Ctrl+C in terminal or kill process
```

---

## Common Test Scenarios

### 1. Authentication Flow

```
1. Open browser → goto http://localhost:3000
2. Click sign in button
3. Fill demo credentials
4. Submit → Verify dashboard loads
5. Check user menu shows correct name
6. Test logout → Verify redirect to home
```

### 2. Alert Creation Flow

```
1. Login as demo user
2. Navigate to /alerts
3. Click "Create Alert" button
4. Select stock symbol (e.g., RELIANCE)
5. Choose alert type (price_above)
6. Enter target price
7. Submit → Verify alert appears in list
8. Check notifications (should show alert created)
```

### 3. Portfolio Transaction Flow

```
1. Login as demo user
2. Navigate to /portfolio
3. Click "Add Transaction"
4. Fill: Symbol, Quantity, Price, Type (BUY)
5. Submit → Verify holding appears
6. Check P&L calculation is correct
```

### 4. Corporate Actions Viewing

```
1. Navigate to /markets/analytics?tab=corporate-actions
2. Verify table loads with data
3. Test filter by type (Dividend)
4. Verify filtered results
5. Test pagination
6. Test sorting (click column headers)
```

### 5. Admin User Management

```
1. Login as admin (admin@tradenext6.app)
2. Navigate to /admin/users
3. Verify user list loads
4. Test "Add User" form
5. Test edit user
6. Test delete user (with confirmation)
```

---

## Troubleshooting

### Browser Issues

```bash
# Reinstall browsers
playwright-cli install

# Use specific browser
playwright-cli open --browser=chrome
playwright-cli open --browser=firefox
playwright-cli open --browser=webkit
```

### Session Issues

```bash
# Clear all data and start fresh
playwright-cli delete-data

# Save state for later
playwright-cli state-save auth.json

# Restore saved state
playwright-cli state-load auth.json
```

### Network Issues

```bash
# List active routes
playwright-cli route-list

# Mock API response
playwright-cli route "**/api/**" --body='{"mock": true}'
```

---

## Commands Reference

### Navigation
| Command | Description |
|---------|-------------|
| `playwright-cli open URL` | Open URL in new browser |
| `playwright-cli goto URL` | Navigate to URL |
| `playwright-cli go-back` | Go back in history |
| `playwright-cli go-forward` | Go forward in history |
| `playwright-cli reload` | Reload page |

### Interaction
| Command | Description |
|---------|-------------|
| `playwright-cli click REF` | Click element by ref |
| `playwright-cli fill REF text` | Fill input field |
| `playwright-cli type REF text` | Type with keyboard |
| `playwright-cli select REF value` | Select dropdown option |
| `playwright-cli hover REF` | Hover over element |
| `playwright-cli check REF` | Check checkbox |
| `playwright-cli uncheck REF` | Uncheck checkbox |

### Verification
| Command | Description |
|---------|-------------|
| `playwright-cli snapshot` | Take snapshot of page |
| `playwright-cli console` | Show console messages |
| `playwright-cli network` | Show network requests |
| `playwright-cli eval "code"` | Evaluate JavaScript |

### Device
| Command | Description |
|---------|-------------|
| `playwright-cli resize W H` | Resize viewport |
| `playwright-cli screenshot` | Take screenshot |

### Session
| Command | Description |
|---------|-------------|
| `playwright-cli close` | Close current browser |
| `playwright-cli kill-all` | Kill all browsers |
| `playwright-cli cookie-list` | List cookies |

---

## Integration with Agent Workflow

### Before Finalizing Any UI Change

1. **Start dev server** (if not running)
   ```bash
   npm run dev
   ```

2. **Run Playwright tests** following the workflow above

3. **Verify**:
   - Page loads without errors
   - Components render correctly
   - Interactive elements work
   - Responsive behavior works
   - No console errors

4. **Cleanup**: Close browser, stop server (if you started it)

### Required Checklist Items

- [ ] Start dev server if needed
- [ ] Test login page loads
- [ ] Test login with demo credentials
- [ ] Test UI changes render correctly
- [ ] Check responsive behavior
- [ ] Verify dark/light mode if applicable
- [ ] Test form submissions and interactions
- [ ] Check console errors
- [ ] Cleanup dev server processes

---

## Example: Complete Test Session

```bash
# Start
npm run dev &
sleep 5

# Open and test login
playwright-cli open http://localhost:3000
playwright-cli snapshot

# Navigate to login
playwright-cli click e[sign-in-button]
playwright-cli fill e[email] "demo@tradenext6.app"
playwright-cli fill e[password] "demo123"
playwright-cli click e[submit]
playwright-cli snapshot

# Test alerts page
playwright-cli goto http://localhost:3000/alerts
playwright-cli snapshot

# Create alert
playwright-cli click e[create-alert-button]
playwright-cli fill e[symbol] "TCS"
playwright-cli select e[alert-type] "price_above"
playwright-cli fill e[price] "4000"
playwright-cli click e[submit]
playwright-cli snapshot

# Check for errors
playwright-cli console error

# Cleanup
playwright-cli close

# Stop dev server
pkill -f "next dev"
```

---

## Tips & Best Practices

1. **Use refs from snapshot**: After each command, note the element refs (e.g., `e5`, `e12`) for reliable targeting

2. **Take snapshots frequently**: Helps verify state changes and debug issues

3. **Check console**: Always check for JavaScript errors with `playwright-cli console error`

4. **Test responsive**: Resize to mobile (375x667), tablet (768x1024), desktop (1920x1080)

5. **Save auth state**: Use `playwright-cli state-save` to avoid re-login for each test

6. **Mock APIs when needed**: Use `playwright-cli route` to mock API responses for testing

7. **Clean up**: Always close browser and stop server after testing

---

## Related Documentation

- [AGENTS.md](../AGENTS.md) - Development guide
- [README.md](../../README.md) - Project overview
- [playwright-cli skill](./README.md) - Full CLI reference
