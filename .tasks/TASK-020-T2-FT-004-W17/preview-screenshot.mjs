import {chromium} from '@playwright/test';
const browser=await chromium.launch(); const page=await browser.newPage({viewport:{width:1672,height:941}});
await page.goto('http://127.0.0.1:3197/?screen=results');
await page.getByLabel('Логин').fill('operator');await page.getByLabel('Пароль',{exact:true}).fill('test-password');await page.getByRole('button',{name:'Войти',exact:true}).click();
await page.locator('.card').first().waitFor();await page.evaluate(()=>document.fonts.ready);
await page.screenshot({path:'.tasks/TASK-020-T2-FT-004-W17/final-production-preview.png'});
const overflow=await page.locator('.card .portrait').evaluateAll(nodes=>nodes.some(img=>{const a=img.getBoundingClientRect(),b=img.closest('.card').getBoundingClientRect();return a.bottom>b.bottom+1||a.top<b.top-1}));
console.log(JSON.stringify({portraitOverflow:overflow,cards:await page.locator('.card').count()}));
await browser.close();
