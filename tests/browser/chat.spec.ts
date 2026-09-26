import { test, expect, type Page } from '@playwright/test';
async function send(page: Page, message: string) {
  await page.getByRole('textbox', { name: 'Message WB Copilot' }).fill(message);
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(page).toHaveURL(/\/chat\/.+/);
}
test('lazy creation, background isolation, unread, refresh and browser history', async ({ page }) => {
  await page.goto('/chat'); await expect(page.getByRole('button', { name: 'Send message' })).toBeDisabled();
  await page.getByRole('link', { name: 'New chat', exact: true }).click();
  await expect(page.getByText('A fresh start')).toBeVisible();
  await send(page, '[slow] Conversation A'); const a = page.url();
  await expect(page.getByText('Running isolated integration fixture')).toBeVisible();
  await page.getByRole('link', { name: 'New chat', exact: true }).click();
  await send(page, 'Conversation B'); const b = page.url();
  await expect(page.getByRole('article', { name: 'WB Copilot response' })).toContainText('Conversation B');
  await expect(page.getByRole('img', { name: 'New response' })).toBeVisible({ timeout: 15000 });
  await expect(page.getByRole('article', { name: 'WB Copilot response' })).not.toContainText('Conversation A');
  await page.getByRole('link', { name: '[slow] Conversation A' }).click();
  await expect(page).toHaveURL(a); await expect(page.getByRole('article', { name: 'WB Copilot response' })).toContainText('Conversation A');
  await page.reload(); await expect(page.getByRole('article', { name: 'WB Copilot response' })).toContainText('Conversation A');
  await page.goBack(); await expect(page).toHaveURL(b); await page.goForward(); await expect(page).toHaveURL(a);
});
test('offline preserves history and reconnects', async ({ page, context }) => {
  await page.goto('/chat'); await send(page, 'Connectivity check'); await expect(page.getByRole('article', { name: 'WB Copilot response' })).toBeVisible();
  await context.setOffline(true); await expect(page.getByText('You’re offline. Your loaded chats are still here.')).toBeVisible();
  await expect(page.getByRole('article', { name: 'WB Copilot response' })).toBeVisible();
  await context.setOffline(false); await expect(page.getByText('You’re offline. Your loaded chats are still here.')).not.toBeVisible();
  await send(page, 'After reconnect'); await expect(page.getByRole('article', { name: 'WB Copilot response' }).last()).toContainText('After reconnect');
});
test('failed transport retains optimistic text and retries without duplication', async ({ page }) => {
  await page.goto('/chat'); await page.route('**/api/conversations/*/messages', route => route.abort());
  await send(page, 'Keep this message'); await expect(page.getByText('Could not send message.')).toBeVisible();
  await page.unroute('**/api/conversations/*/messages'); await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(page.getByRole('article', { name: 'WB Copilot response' })).toBeVisible();
  await expect(page.getByRole('article', { name: 'Your message' })).toHaveCount(1);
});
test('new content does not pull a reader away from older messages', async ({ page }) => {
  await page.goto('/chat'); await send(page, '[long] Scroll fixture');
  await expect(page.getByRole('heading', { name: 'Test section 50' })).toBeVisible();
  await send(page, '[slow] New content');
  await page.locator('.message-scroll').evaluate(element => { element.scrollTop = 0; });
  await expect(page.getByRole('button', { name: 'New messages', exact: true })).toBeVisible({ timeout: 15000 });
  expect(await page.locator('.message-scroll').evaluate(element => element.scrollTop)).toBeLessThan(100);
  await page.getByRole('button', { name: 'New messages', exact: true }).click();
  await expect(page.getByRole('article', { name: 'WB Copilot response' }).last()).toBeInViewport();
});
test('mobile drawer, rename, search and delete confirmation', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await page.goto('/chat'); await send(page, 'Mobile test');
  await expect(page.getByRole('article', { name: 'WB Copilot response' })).toBeVisible();
  await page.getByRole('button', { name: 'Open navigation' }).click();
  await page.getByRole('button', { name: 'Actions for Mobile test' }).click(); await page.getByRole('button', { name: 'Rename', exact: true }).click();
  await page.getByRole('textbox', { name: 'Chat title' }).fill('Renamed chat'); await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByRole('textbox', { name: 'Search chats' }).fill('Renamed'); await expect(page.getByRole('link', { name: 'Renamed chat' })).toBeVisible();
  await page.getByRole('button', { name: 'Actions for Renamed chat' }).click(); await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Delete this chat?' })).toBeVisible(); await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Renamed chat' })).toBeVisible();
});
