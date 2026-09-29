import test from 'node:test';
import assert from 'node:assert/strict';
import { launchBrowser, neededPageHeight } from '../src/browser.mjs';

const shell = `<body style="margin:0"><div style="height:100vh;display:flex"><main style="flex:1;overflow-y:auto"><div style="height:1500px"><p id=low style="margin-top:1200px">far below the fold</p></div></main></div></body>`;

test('page height accounts for an inner scroll container (100vh app shells), not just the document', async () => {
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage({ viewport: { width: 1000, height: 800 } });
    await page.setContent(shell);
    assert.equal(await page.evaluate(() => document.documentElement.scrollHeight), 800); // what the old sizing saw
    const need = await neededPageHeight(page);
    assert.ok(need >= 1500, `needed ${need}`);
    await page.setViewportSize({ width: 1000, height: need });
    const box = await page.locator('#low').boundingBox();
    assert.ok(box.y + box.height <= need, 'element is inside the captured area');
  } finally { await browser.close(); }
});
test('a normal document page needs no more than its own scroll height', async () => {
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage({ viewport: { width: 1000, height: 800 } });
    await page.setContent('<body style="margin:0"><div style="height:2000px">long</div></body>');
    assert.equal(await neededPageHeight(page), 2000);
  } finally { await browser.close(); }
});
