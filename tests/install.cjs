// Installation comme une appli : invitation, un clic, tutoriel iPhone / iPad, refus et report, déjà installée.
// Serveur local lancé (npm run dev), puis : node tests/install.cjs
const { chromium, devices } = require('playwright')
const assert = require('node:assert/strict')

const BASE = process.env.TUBY_URL || 'http://localhost:8788'
const SHOTS = process.env.TUBY_SHOTS
const log = (m) => console.log('✓', m)
const WAIT = 3500 // l'invitation attend 2,5 s avant d'apparaître

/** Simule l'invitation d'un navigateur compatible (Chrome, Edge…), que l'automate ne déclenche pas tout seul. */
const fakeInstallPrompt = (outcome) => {
  const e = new Event('beforeinstallprompt', { cancelable: true })
  e.prompt = async () => { window.__prompted = (window.__prompted || 0) + 1 }
  e.userChoice = Promise.resolve({ outcome })
  window.dispatchEvent(e)
}

;(async () => {
  const browser = await chromium.launch()
  const shot = (page, name) => SHOTS && page.screenshot({ path: `${SHOTS}/${name}.png` })
  const banner = (page) => page.getByRole('dialog', { name: 'Installer TUBy' }).first()
  const open = async (options, init) => {
    const ctx = await browser.newContext(options)
    if (init) await ctx.addInitScript(init)
    const page = await ctx.newPage()
    await page.goto(BASE)
    await page.getByLabel('Ton prénom').waitFor()
    return { ctx, page }
  }
  const memo = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('tuby-install') || '{}'))

  // 1. Le manifeste rend l'appli installable, en fenêtre indépendante.
  const manifest = await (await fetch(BASE + '/manifest.webmanifest')).json()
  assert.equal(manifest.display, 'standalone')
  assert.equal(manifest.short_name, 'TUBy')
  assert.ok(manifest.icons.some((i) => i.sizes === '512x512' && i.purpose === 'maskable'))
  for (const i of manifest.icons) assert.ok((await fetch(BASE + i.src)).ok, i.src)
  assert.ok((await fetch(BASE + '/icons/icon-180.png')).ok)
  log('manifeste : nom, icônes, mode standalone')

  // 2-3. Ordinateur, navigateur compatible : invitation avec nom et icône, installation en un clic.
  let { ctx, page } = await open({ viewport: { width: 1280, height: 800 } })
  await page.evaluate(fakeInstallPrompt, 'accepted')
  assert.equal(await banner(page).isVisible(), false, 'pas d’invitation immédiate')
  await banner(page).waitFor({ timeout: WAIT + 2000 })
  assert.ok(await banner(page).getByText('Installer TUBy').isVisible())
  assert.ok(await banner(page).locator('img[src="/icons/icon-192.png"]').isVisible())
  await shot(page, 'install-ordinateur')
  await banner(page).getByRole('button', { name: 'Installer' }).click()
  await page.waitForFunction(() => window.__prompted === 1)
  await banner(page).waitFor({ state: 'detached' })
  assert.equal((await memo(page)).installed, true)
  log('ordinateur : invitation (nom + icône), installation en un clic')

  // 5. Déjà installée : plus d'invitation.
  await page.reload()
  await page.evaluate(fakeInstallPrompt, 'accepted')
  await page.waitForTimeout(WAIT)
  assert.equal(await banner(page).count(), 0)
  await ctx.close()

  // Installation refusée dans la fenêtre du navigateur : reportée de 7 jours.
  ;({ ctx, page } = await open({ viewport: { width: 1280, height: 800 } }))
  await page.evaluate(fakeInstallPrompt, 'dismissed')
  await banner(page).getByRole('button', { name: 'Installer' }).click({ timeout: WAIT + 2000 })
  await banner(page).waitFor({ state: 'detached' })
  assert.ok((await memo(page)).snoozeUntil > Date.now() + 6 * 864e5)
  await ctx.close()
  log('refus dans la fenêtre du navigateur : reporté de 7 jours')

  // 6. « Plus tard » : rien pendant 7 jours, puis l'invitation revient ; le lien reste disponible.
  ;({ ctx, page } = await open({ viewport: { width: 1280, height: 800 } }))
  await page.evaluate(fakeInstallPrompt, 'accepted')
  await banner(page).getByRole('button', { name: 'Plus tard' }).click({ timeout: WAIT + 2000 })
  await banner(page).waitFor({ state: 'detached' })
  await page.reload()
  await page.evaluate(fakeInstallPrompt, 'accepted')
  await page.waitForTimeout(WAIT)
  assert.equal(await banner(page).count(), 0, 'pas sollicité à chaque visite')
  await page.getByRole('button', { name: 'Installer l’appli' }).click() // installation volontaire, quand on veut
  await page.waitForFunction(() => window.__prompted === 1)
  await page.evaluate(() => localStorage.setItem('tuby-install', JSON.stringify({ snoozeUntil: Date.now() - 1000 })))
  await page.reload()
  await page.evaluate(fakeInstallPrompt, 'accepted')
  await banner(page).waitFor({ timeout: WAIT + 2000 })
  await ctx.close()
  log('« Plus tard » : silence 7 jours, puis l’invitation revient ; lien « Installer l’appli » toujours là')

  // 6 bis. « Ne plus proposer » : définitif.
  ;({ ctx, page } = await open({ viewport: { width: 1280, height: 800 } }))
  await page.evaluate(fakeInstallPrompt, 'accepted')
  await banner(page).getByRole('button', { name: 'Ne plus proposer' }).click({ timeout: WAIT + 2000 })
  await page.reload()
  await page.evaluate(fakeInstallPrompt, 'accepted')
  await page.waitForTimeout(WAIT)
  assert.equal(await banner(page).count(), 0)
  assert.equal((await memo(page)).never, true)
  await ctx.close()
  log('« Ne plus proposer » : plus jamais d’invitation')

  // Navigateur sans installation possible (ex. Firefox) : on ne propose rien.
  ;({ ctx, page } = await open({ viewport: { width: 1280, height: 800 } }))
  await page.waitForTimeout(WAIT)
  assert.equal(await banner(page).count(), 0)
  assert.equal(await page.getByRole('button', { name: 'Installer l’appli' }).count(), 0)
  await ctx.close()
  log('navigateur sans installation possible : rien n’est proposé')

  // 4. iPhone : tutoriel adapté (bouton Partager en bas), « C'est fait » arrête les invitations.
  ;({ ctx, page } = await open({ ...devices['iPhone 14'] }))
  await banner(page).waitFor({ timeout: WAIT + 2000 })
  await shot(page, 'install-iphone')
  await banner(page).getByRole('button', { name: 'Comment faire ?' }).click()
  const sheet = page.getByRole('dialog', { name: 'Installer TUBy' }).last()
  await sheet.getByText('Sur l’écran d’accueil').waitFor()
  assert.ok(await sheet.getByText('en bas de l’écran').isVisible())
  await shot(page, 'install-iphone-tuto')
  await sheet.getByRole('button', { name: 'C’est fait' }).click()
  await page.reload()
  await page.waitForTimeout(WAIT)
  assert.equal(await banner(page).count(), 0)
  await ctx.close()
  log('iPhone : tutoriel (Partager en bas → Sur l’écran d’accueil), plus d’invitation après « C’est fait »')

  // iPad : le bouton Partager est en haut à droite.
  ;({ ctx, page } = await open({ ...devices['iPad Pro 11'] }))
  await banner(page).getByRole('button', { name: 'Comment faire ?' }).click({ timeout: WAIT + 2000 })
  await page.getByText('en haut à droite de l’écran').waitFor()
  await shot(page, 'install-ipad')
  await ctx.close()
  log('iPad : tutoriel adapté (Partager en haut à droite)')

  // 5 & 7. Ouverte depuis l'écran d'accueil (mode standalone) : aucune invitation, aucun lien.
  ;({ ctx, page } = await open({ ...devices['iPhone 14'] }, () => Object.defineProperty(navigator, 'standalone', { get: () => true })))
  await page.waitForTimeout(WAIT)
  assert.equal(await banner(page).count(), 0)
  assert.equal(await page.getByRole('button', { name: 'Installer l’appli' }).count(), 0)
  await ctx.close()
  log('appli déjà installée (ouverte depuis l’écran d’accueil) : rien n’est proposé')

  await browser.close()
  console.log('\nInstallation : tout passe.')
})().catch((e) => {
  console.error('\n✗ ÉCHEC :', e.message)
  process.exit(1)
})
