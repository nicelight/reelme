# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: display.spec.ts >> Chromium operator journey: stages, QR, paging, email retry, durable deadline and preserved links
- Location: tests/display.spec.ts:11:1

# Error details

```
Error: 1280x720 initial card bottom

expect(received).toBeLessThanOrEqual(expected)

Expected: <= 720
Received:    855.65625
```

# Page snapshot

```yaml
- generic [ref=f1e2]:
  - banner [ref=f1e3]:
    - link "ReelMe — главная" [ref=f1e4] [cursor=pointer]:
      - /url: /
      - text: Reel
      - generic [ref=f1e5]: Me
      - generic [ref=f1e6]: STUDIO
    - generic [ref=f1e7]:
      - button "Тёмная тема" [ref=f1e8] [cursor=pointer]: ◐
      - generic [ref=f1e9]: Оператор
      - button "Выйти" [ref=f1e10] [cursor=pointer]
  - navigation "Разделы" [ref=f1e11]:
    - button "Сегодня" [ref=f1e12] [cursor=pointer]
    - button "Архив" [ref=f1e13] [cursor=pointer]
  - main [ref=f1e14]:
    - generic [ref=f1e15]:
      - generic [ref=f1e16]:
        - paragraph [ref=f1e17]: REELME / 14 ноября / НОВОСИБИРСК
        - heading "Ваша история — здесь." [level=1] [ref=f1e18]
        - paragraph [ref=f1e19]: Найдите свой номер. Когда видео готово, наведите камеру телефона на QR.
      - generic [ref=f1e20]:
        - strong [ref=f1e21]: "8"
        - text: на экране
    - generic [ref=f1e22]:
      - article "История № 1" [ref=f1e23]:
        - generic [ref=f1e24]:
          - generic [ref=f1e25]:
            - generic [ref=f1e26]: ВАША ИСТОРИЯ
            - generic [ref=f1e27]: Этап 4 из 6
          - generic [ref=f1e28]:
            - heading "№ 1" [level=2] [ref=f1e29]
            - paragraph [ref=f1e30]: Видео ждёт скачивания
          - 'img "Этап 4 из 6: Видео ждёт скачивания" [ref=f1e31]'
        - generic [ref=f1e38]:
          - figure "Ваше фото" [ref=f1e39]:
            - img "Исходное фото посетителя № 1" [ref=f1e40]
          - figure "Ваше видео" [ref=f1e42]:
            - img "Кадр видео № 1" [ref=f1e43]
        - generic [ref=f1e45]:
          - img "QR формы получения видео № 1" [ref=f1e46]
          - generic [ref=f1e47]:
            - text: № 1
            - paragraph [ref=f1e48]: Получите видеопо email
            - generic [ref=f1e49]: Наведите камеру на QR
      - article "История № 2" [ref=f1e50]:
        - generic [ref=f1e51]:
          - generic [ref=f1e52]:
            - generic [ref=f1e53]: ВАША ИСТОРИЯ
            - generic [ref=f1e54]: Этап 2 из 6
          - generic [ref=f1e55]:
            - heading "№ 2" [level=2] [ref=f1e56]
            - paragraph [ref=f1e57]: Генерация
          - 'img "Этап 2 из 6: Генерация" [ref=f1e58]'
        - generic [ref=f1e65]:
          - generic [aria-hidden] [ref=f1e66]: ↗
          - paragraph [ref=f1e67]: У каждой истории свой ритм
          - generic [ref=f1e68]: Фото и QR появятся здесь, когда видео будет готово.
      - article "История № 3" [ref=f1e69]:
        - generic [ref=f1e70]:
          - generic [ref=f1e71]:
            - generic [ref=f1e72]: ВАША ИСТОРИЯ
            - generic [ref=f1e73]: Нужна помощь
          - generic [ref=f1e74]:
            - heading "№ 3" [level=2] [ref=f1e75]
            - paragraph [ref=f1e76]: Генерация не завершена
          - img "Генерация не завершена" [ref=f1e77]
          - paragraph [ref=f1e84]: Не удалось создать видео. Обратитесь к сотруднику.
        - generic [ref=f1e85]:
          - generic [aria-hidden] [ref=f1e86]: "!"
          - paragraph [ref=f1e87]: Сотрудник поможет вам
          - generic [ref=f1e88]: Покажите ему свой номер.
    - generic [ref=f1e89]:
      - paragraph [ref=f1e90]: После подтверждения email история остаётся на экране ещё 3 минуты.
      - navigation "Страницы историй" [ref=f1e91]:
        - button "Предыдущая страница" [ref=f1e92] [cursor=pointer]: ←
        - generic [ref=f1e93]: 1 / 3
        - button "Следующая страница" [ref=f1e94] [cursor=pointer]: →
        - button "Приостановить смену страниц" [ref=f1e95] [cursor=pointer]: Пауза
```

# Test source

```ts
  19  |   await control();
  20  |   execFileSync(process.execPath, ['--import', 'tsx', 'src/server/setup.ts'], { env: { ...process.env, DATA_DIR: dataDir, ADMIN_PASSWORD: 'test-password', OPERATOR_PASSWORD: 'test-password' }, stdio: 'pipe' });
  21  |   const video = join(root, 'fixture.mp4');
  22  |   execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=320x240:d=1:r=10', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', video]);
  23  |   const bytes = await readFile(video);
  24  |   const seeds = [];
  25  |   for (let number = 1; number <= 8; number++) seeds.push(await preparedSession(dataDir, bytes, number));
  26  |   const db = openDatabase(dataDir);
  27  |   type Delivery = { receive_token: string; download_token: string; opened_at: number | null; email_confirmed_at: number | null; email_state: string };
  28  |   const row = () => db.prepare('SELECT * FROM session_delivery WHERE session_id=?').get(seeds[0].id) as Delivery;
  29  |   let child: ChildProcess | undefined;
  30  |   async function start() {
  31  |     child = spawn(process.execPath, ['--import', 'tsx', 'tests/display-browser-server.ts'], { env: { ...process.env, DATA_DIR: dataDir }, stdio: 'ignore' });
  32  |     for (let i = 0; i < 100; i++) {
  33  |       if (child.exitCode !== null) throw new Error('Display fixture exited');
  34  |       try { if ((await fetch(origin)).ok) return; } catch {}
  35  |       await new Promise(resolve => setTimeout(resolve, 100));
  36  |     }
  37  |     throw new Error('Display fixture did not start');
  38  |   }
  39  |   async function stop() {
  40  |     if (child && child.exitCode === null) {
  41  |       const exited = new Promise<void>(resolve => child!.once('exit', () => resolve()));
  42  |       child.kill('SIGTERM'); await exited;
  43  |     }
  44  |   }
  45  |   const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  46  |   const visitor = await browser.newContext(); const form = await visitor.newPage();
  47  |   form.on('pageerror', error => errors.push(error.message));
  48  |   try {
  49  |     await start();
  50  |     for (const [i, state] of ['submit_pending', 'observing', 'preparing'].entries()) db.prepare('UPDATE capture_sessions SET state=? WHERE id=?').run(state, seeds[i].id);
  51  |     await page.setViewportSize({ width: 1440, height: 900 }); await page.emulateMedia({ colorScheme: 'light' });
  52  |     await page.goto(origin);
  53  |     await expect(page.getByRole('heading', { name: 'Войти в аккаунт' })).toBeVisible();
  54  |     await expect(page.locator('.result-card')).toHaveCount(0);
  55  |     await page.getByLabel('Логин').fill('operator'); await page.getByLabel('Пароль').fill('test-password');
  56  |     await page.getByRole('button', { name: 'Войти', exact: true }).click();
  57  |     await expect(page.getByRole('heading', { name: 'Ваша история — здесь.' })).toBeVisible();
  58  |     await expect(page.locator('.result-card')).toHaveCount(3);
  59  |     await page.getByRole('button', { name: 'Приостановить смену страниц' }).click();
  60  |     const first = page.locator('[data-session="1"]');
  61  |     for (const [number, stage, color] of [[1, 1, 'rgb(219, 119, 158)'], [2, 2, 'rgb(152, 98, 197)'], [3, 3, 'rgb(125, 198, 223)']] as const) {
  62  |       const card = page.locator(`[data-session="${number}"]`);
  63  |       await expect(card.locator('.stage-bar .filled')).toHaveCount(stage);
  64  |       expect(await card.locator('.filled').first().evaluate(node => getComputedStyle(node).backgroundColor)).toBe(color);
  65  |     }
  66  |     await expect(first).toContainText('Отправка на генерацию');
  67  |     await expect(page.locator('[data-session="2"]')).toContainText('Генерация');
  68  |     await expect(page.locator('[data-session="3"]')).toContainText('Подготовка для скачивания');
  69  |     await page.screenshot({ path: join(artifacts, 'display-stages-1-3-desktop.png'), fullPage: true });
  70  |     // Same session advances; preparing already has verified fixture files.
  71  |     for (const [state, stage] of [['observing', 2], ['preparing', 3], ['ready', 4]] as const) {
  72  |       db.prepare('UPDATE capture_sessions SET state=? WHERE id=?').run(state, seeds[0].id);
  73  |       await expect(first.locator('.stage-bar .filled')).toHaveCount(stage, { timeout: 5000 });
  74  |     }
  75  |     db.prepare("UPDATE capture_sessions SET state='capturing' WHERE id=?").run(seeds[2].id);
  76  |     await expect(page.locator('[data-session="3"]')).toContainText('Идёт съёмка');
  77  |     await expect(page.locator('[data-session="3"] .filled')).toHaveCount(0);
  78  |     db.prepare("UPDATE capture_sessions SET state='failed' WHERE id=?").run(seeds[2].id);
  79  |     await expect(page.locator('[data-session="3"]')).toContainText('Не удалось создать видео');
  80  |     await expect(page.locator('[data-session="3"] .result-qr')).toHaveCount(0);
  81  |     await expect(first).toContainText('Видео ждёт скачивания');
  82  |     expect(await first.locator('.filled').first().evaluate(node => getComputedStyle(node).backgroundColor)).toBe('rgb(175, 216, 140)');
  83  |     const images = first.locator('.result-images img');
  84  |     await expect(images).toHaveCount(2);
  85  |     expect(await images.evaluateAll(nodes => nodes.every(node => (node as HTMLImageElement).complete && (node as HTMLImageElement).naturalWidth > 0))).toBe(true);
  86  |     // Decode exactly the QR raster drawn in Chromium, including its rendered size.
  87  |     const qrShot = await first.getByAltText('QR формы получения видео № 1').screenshot();
  88  |     const png = await sharp(qrShot).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  89  |     const decoded = jsQR(new Uint8ClampedArray(png.data), png.info.width, png.info.height)?.data;
  90  |     expect(decoded).toBe(`${origin}/receive/${row().receive_token}`);
  91  |     expect(row().opened_at).toBeNull(); expect(row().email_confirmed_at).toBeNull();
  92  |     await page.screenshot({ path: join(artifacts, 'display-ready-desktop.png'), fullPage: true });
  93  |     // Overflow pages cycle on a controlled 10-second clock and never open forms.
  94  |     await page.clock.install(); await page.clock.pauseAt(new Date());
  95  |     await page.getByRole('button', { name: 'Продолжить смену страниц' }).click();
  96  |     // DOM visibility alone misses clipped QR codes on short operator screens.
  97  |     // Never scroll a locator into view before measuring the actual viewport.
  98  |     const viewportChecks = [];
  99  |     for (const [width, height] of [[1280, 720], [1366, 768], [1440, 900], [1920, 1080], [1920, 1300]]) {
  100 |       await page.setViewportSize({ width, height });
  101 |       await page.reload(); await expect(first).toBeVisible();
  102 |       await page.evaluate(() => scrollTo(0, 0));
  103 |       for (const phase of ['initial', 'next'] as const) {
  104 |         if (phase === 'next') {
  105 |           await page.clock.fastForward(10_000);
  106 |           await expect(page.locator(`[data-session="${height >= 1300 ? 7 : 4}"]`)).toBeVisible();
  107 |         }
  108 |         await expect.poll(() => page.locator('.result-qr').evaluateAll(nodes =>
  109 |           nodes.length > 0 && nodes.every(node => (node as HTMLImageElement).complete && (node as HTMLImageElement).naturalWidth > 0))).toBe(true);
  110 |         const bounds = await page.locator('.result-card, .result-qr').evaluateAll(nodes => nodes.map(node => {
  111 |           const { top, right, bottom, left, width, height } = node.getBoundingClientRect();
  112 |           return { kind: node.classList.contains('result-qr') ? 'qr' : 'card', top, right, bottom, left, width, height };
  113 |         }));
  114 |         expect(await page.evaluate(() => scrollY)).toBe(0);
  115 |         for (const box of bounds) {
  116 |           expect(box.top, `${width}x${height} ${phase} ${box.kind} top`).toBeGreaterThanOrEqual(0);
  117 |           expect(box.left).toBeGreaterThanOrEqual(0);
  118 |           expect(box.right).toBeLessThanOrEqual(width);
> 119 |           expect(box.bottom, `${width}x${height} ${phase} ${box.kind} bottom`).toBeLessThanOrEqual(height);
      |                                                                                ^ Error: 1280x720 initial card bottom
  120 |           if (box.kind === 'qr') expect(box.width).toBe(height >= 1300 ? 128 : 154);
  121 |         }
  122 |         if (height <= 768) {
  123 |           const shot = await page.screenshot({ path: join(artifacts, `display-fit-${width}x${height}-${phase}.png`) });
  124 |           const box = bounds.find(box => box.kind === 'qr')!;
  125 |           const raster = await sharp(shot).extract({ left: Math.floor(box.left), top: Math.floor(box.top),
  126 |             width: Math.ceil(box.width), height: Math.ceil(box.height) }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  127 |           const qr = jsQR(new Uint8ClampedArray(raster.data), raster.info.width, raster.info.height)?.data;
  128 |           const token = await page.locator('.result-card:has(.result-qr)').first().getAttribute('data-session');
  129 |           const delivery = db.prepare('SELECT receive_token FROM session_delivery WHERE session_id=?').get(seeds[Number(token) - 1].id) as Delivery;
  130 |           expect(qr).toBe(`${origin}/receive/${delivery.receive_token}`);
  131 |         }
  132 |         viewportChecks.push({ width, height, phase, bounds });
  133 |       }
  134 |     }
  135 |     await writeFile(join(artifacts, 'display-viewport-observations.json'), JSON.stringify(viewportChecks, null, 2) + '\n');
  136 |     await page.setViewportSize({ width: 1440, height: 900 });
  137 |     await page.reload(); await expect(first).toBeVisible();
  138 |     await page.clock.fastForward(9999); await expect(first).toBeVisible();
  139 |     await page.clock.fastForward(1); await expect(page.locator('[data-session="4"]')).toBeVisible();
  140 |     await page.clock.fastForward(10_000); await expect(page.locator('[data-session="7"]')).toBeVisible();
  141 |     await page.clock.fastForward(10_000); await expect(first).toBeVisible();
  142 |     expect(row().opened_at).toBeNull();
  143 |     await page.getByRole('button', { name: 'Приостановить смену страниц' }).click();
  144 |     await form.goto(decoded!); await expect(form.getByRole('heading', { name: 'История № 1' })).toBeVisible();
  145 |     expect((await visitor.cookies()).some(cookie => cookie.name === 'reelme')).toBe(false);
  146 |     await expect.poll(() => row().opened_at).not.toBeNull();
  147 |     await page.clock.fastForward(2100); await expect(first).toContainText('Видео в процессе получения клиентом');
  148 |     await expect(first.locator('.filled')).toHaveCount(5);
  149 |     expect(await first.locator('.filled').first().evaluate(node => getComputedStyle(node).backgroundColor)).toBe('rgb(75, 156, 95)');
  150 |     now += 240_000; await control(); await page.reload(); await expect(first).toBeVisible();
  151 |     expect(row().email_confirmed_at).toBeNull();
  152 |     await page.getByRole('button', { name: 'Приостановить смену страниц' }).click();
  153 |     await form.getByLabel('Ваш email').fill('mailname@example.com');
  154 |     await form.getByRole('button', { name: 'Получить видео по email' }).click();
  155 |     await expect.poll(() => row().email_state).toBe('failed');
  156 |     const confirmed = row().email_confirmed_at!;
  157 |     await page.clock.fastForward(2100); await expect(first).toContainText('Письмо не подтверждено');
  158 |     await expect(first.locator('.filled')).toHaveCount(5);
  159 |     await page.screenshot({ path: join(artifacts, 'display-mail-error.png'), fullPage: true });
  160 |     await stop(); await start(); expect(row().email_confirmed_at).toBe(confirmed);
  161 |     fail = false; now += 30_000; await control();
  162 |     await form.reload(); await form.getByLabel('Ваш email').fill('mailname@example.com');
  163 |     await form.getByRole('button', { name: 'Повторить отправку' }).click();
  164 |     await expect.poll(() => row().email_state).toBe('sent');
  165 |     await page.clock.fastForward(2100); await expect(first).toContainText('Видео отправлено на mailname***@***.com');
  166 |     expect(row().email_confirmed_at).toBe(confirmed);
  167 |     await expect(first.locator('.filled')).toHaveCount(6);
  168 |     const fillColors = await first.locator('.filled').evaluateAll(nodes => nodes.map(node => getComputedStyle(node).backgroundColor));
  169 |     expect(new Set(fillColors)).toEqual(new Set(['rgb(77, 98, 56)']));
  170 |     expect(await page.locator('body').innerText()).not.toContain('mailname@example.com');
  171 |     const payload = await (await page.request.get(origin + '/api/display/today')).text();
  172 |     expect(payload).not.toMatch(/mailname@example\.com|fixture.test|download_token/);
  173 |     await page.getByRole('button', { name: 'Тёмная тема' }).click();
  174 |     await page.screenshot({ path: join(artifacts, 'display-sent-dark.png'), fullPage: true });
  175 |     await page.setViewportSize({ width: 375, height: 812 });
  176 |     await expect(first).toBeVisible(); await expect(page.locator('.result-card')).toHaveCount(1);
  177 |     expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  178 |     await page.screenshot({ path: join(artifacts, 'display-mobile-dark.png'), fullPage: true });
  179 |     await page.setViewportSize({ width: 1440, height: 900 });
  180 |     // The old deadline remains across restart, retry, reload and a failed poll.
  181 |     now = confirmed + 179_000; await control(); await page.reload();
  182 |     await expect(first.locator('.result-progress')).toBeVisible(); await expect(first.locator('.result-qr')).toBeVisible();
  183 |     await page.screenshot({ path: join(artifacts, 'display-2m59.png'), fullPage: true });
  184 |     await page.route('**/api/display/today', route => route.abort());
  185 |     await page.clock.fastForward(1001); await expect(first).toHaveCount(0);
  186 |     now = confirmed + 180_000; await control(); await page.unroute('**/api/display/today');
  187 |     await page.reload(); await expect(first).toHaveCount(0);
  188 |     await page.screenshot({ path: join(artifacts, 'display-3m00.png'), fullPage: true });
  189 |     expect(row().email_confirmed_at).toBe(confirmed);
  190 |     expect((await request.get(decoded!)).status()).toBe(200);
  191 |     expect(await (await request.get(`${origin}/download/${row().download_token}`)).body()).toEqual(bytes);
  192 |     expect(await readFile(join(dataDir, 'media', seeds[0].video_path))).toEqual(bytes);
  193 |     now = Date.parse('2026-11-14T17:00:00Z'); await control(); await page.reload();
  194 |     await expect(page.getByRole('heading', { name: 'Здесь появится ваше видео.' })).toBeVisible();
  195 |     expect((await request.get(decoded!)).status()).toBe(200);
  196 |     expect(await (await request.get(`${origin}/download/${row().download_token}`)).body()).toEqual(bytes);
  197 |     expect(errors).toEqual([]);
  198 |     await writeFile(join(artifacts, 'display-observations.json'), JSON.stringify({ browser: 'Chromium', stages: [1, 2, 3, 4, 5, 6], filledSegmentsMatchStage: true, capturingNotGeneration: true, generationFailureNoSuccess: true, currentStageColorAcrossFilledBar: true, qrDecodedFromRenderedCard: true, noOpenedFromDisplayOrMedia: true, pagingMilliseconds: 10000, wraps: true, unauthenticatedQrForm: true, email: 'real worker / injected local transport / failed then sent', firstConfirmationSurvivesRetryRestartReload: true, visibleAtSeconds: 179, hiddenAtSeconds: 180, hiddenWithoutSuccessfulPoll: true, fullEmailAbsent: true, mobileWidth: 375, theme: ['light', 'dark'], filesAndLinksPreservedAfterHideAndDayChange: true, archiveUi: 'deferred to FT-005', pageErrors: errors, externalFalOrSmtp: false }, null, 2) + '\n');
  199 |   } finally { await visitor.close(); await stop(); db.close(); await rm(root, { recursive: true, force: true }); }
  200 | });
  201 | 
```