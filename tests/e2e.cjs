// Parcours complet des critères d'acceptation, dans un vrai navigateur, contre `npm run dev`.
//   1. npm run db:migrate:local && npm run db:seed:local   (base locale neuve)
//   2. node scripts/admin-password.mjs --local "mot-de-passe-de-test"
//   3. npm run dev   puis, dans un autre terminal :   npm run test:e2e
const { chromium, devices } = require('playwright')
const assert = require('node:assert/strict')

const BASE = process.env.TUBY_URL || 'http://localhost:8788'
const PASSWORD = process.env.TUBY_ADMIN_PASSWORD || 'mot-de-passe-de-test'
const SHOTS = process.env.TUBY_SHOTS // dossier où enregistrer des captures (facultatif)
const log = (m) => console.log('✓', m)

const call = async (path, { method = 'GET', body, cookie } = {}) => {
  const res = await fetch(BASE + path, {
    method,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
  return { status: res.status, data: await res.json().catch(() => null), cookie: (res.headers.get('set-cookie') || '').split(';')[0] }
}

;(async () => {
  // 9. Sans session, tout /api/* (hors connexion) répond 401.
  for (const [method, path] of [['GET', '/api/state'], ['POST', '/api/assignments/1/act'], ['POST', '/api/logout'], ['GET', '/api/admin/overview'], ['POST', '/api/admin/students'], ['GET', '/api/admin/guides/1'], ['POST', '/api/admin/help/1/resolve'], ['DELETE', '/api/admin/guides/1']]) {
    const r = await call(path, { method, body: method === 'POST' ? {} : undefined })
    assert.equal(r.status, 401, `${method} ${path} → ${r.status}`)
  }
  log('sans session : 401 partout')

  const browser = await chromium.launch()
  const shot = async (page, name) => SHOTS && page.screenshot({ path: `${SHOTS}/${name}.png` })
  const title = (page) => page.locator('main h1').first()

  // 1. L'admin se connecte, crée un élève, obtient un code.
  const adminCtx = await browser.newContext({ ...devices['iPhone 14'] })
  const admin = await adminCtx.newPage()
  await admin.goto(BASE + '/admin')
  await admin.getByLabel('Mot de passe').fill('mauvais-mot-de-passe')
  await admin.getByRole('button', { name: 'Entrer' }).click()
  await admin.getByText('Mot de passe incorrect.').waitFor()
  await admin.getByLabel('Mot de passe').fill(PASSWORD)
  await admin.getByRole('button', { name: 'Entrer' }).click()
  await admin.getByRole('heading', { name: 'Blocages ouverts' }).waitFor()
  await admin.getByRole('link', { name: 'Élèves' }).click()
  const eleve = 'Test' + Date.now().toString().slice(-6)
  await admin.getByLabel('Prénom').fill(eleve)
  await admin.getByRole('button', { name: 'Créer et obtenir son code' }).click()
  const code = (await admin.getByTestId('code').innerText()).trim()
  assert.match(code, /^[A-HJKMNP-Z2-9]{6}$/)
  await shot(admin, 'admin-eleves')
  await admin.getByRole('button', { name: 'C’est noté' }).click()
  log(`admin connecté, élève créé, code obtenu (${code})`)

  // Attribution du guide de départ à ce nouvel élève.
  admin.on('dialog', (d) => d.accept())
  const card = admin.locator('div.rounded-card', { has: admin.getByText(eleve, { exact: true }) }).first()
  await card.getByRole('button', { name: 'Attribuer un guide' }).click()
  await admin.getByRole('dialog').getByRole('button', { name: /Création pas à pas d'un site web simple/ }).first().click()
  await card.getByText('En cours').waitFor()
  const adminCookie = (await adminCtx.cookies()).map((c) => `${c.name}=${c.value}`).join('; ')
  const zoe = 'Zoé' + Date.now().toString().slice(-6)
  const zoeCode = (await call('/api/admin/students', { method: 'POST', body: { prenom: zoe }, cookie: adminCookie })).data.code
  log('guide attribué')

  // 2. l’élève se connecte et arrive sur la première étape.
  let ctx = await browser.newContext({ ...devices['iPhone 14'] })
  let page = await ctx.newPage()
  await page.goto(BASE)
  await page.getByLabel('Ton prénom').fill(eleve.toLowerCase())
  await page.getByLabel('Ton code secret').fill(code.toLowerCase())
  await shot(page, 'eleve-connexion')
  await page.getByRole('button', { name: 'Entrer' }).click()
  await page.getByRole('heading', { name: 'Avant de commencer' }).waitFor()
  await page.getByText('Chapitre 0 · Préparer tes outils').waitFor()
  await page.getByText('Étape 1/7').waitFor()
  assert.equal(await page.getByRole('button', { name: 'C’est parti' }).isDisabled(), true)
  for (const box of await page.getByRole('checkbox').all()) await box.check()
  await shot(page, 'eleve-prerequis')
  await page.getByRole('button', { name: 'C’est parti' }).click()
  await page.getByRole('heading', { name: 'Connecte-toi à Claude' }).waitFor()
  assert.equal(await page.locator('main h1').count(), 1, 'une seule étape à l’écran')
  await shot(page, 'eleve-action')
  log('élève connecté, première étape, prérequis validés')

  // 3. Oui avance ; Pause enregistre et reprend au même endroit après fermeture du navigateur.
  await page.getByRole('button', { name: 'Oui' }).click()
  await page.getByRole('heading', { name: 'Compte GitHub' }).waitFor()
  await page.getByRole('button', { name: 'Pause' }).click()
  await page.getByRole('heading', { name: 'À bientôt, tu reprendras ici.' }).waitFor()
  await shot(page, 'eleve-pause')
  await page.waitForTimeout(400)
  const storage = await ctx.storageState()
  await ctx.close()
  ctx = await browser.newContext({ ...devices['iPhone 14'], storageState: storage })
  page = await ctx.newPage()
  await page.goto(BASE)
  await page.getByRole('heading', { name: 'Compte GitHub' }).waitFor()
  await page.getByRole('button', { name: 'Oui' }).waitFor()
  log('Oui avance, Pause reprend au même endroit après fermeture')

  // 4. À l'aide ouvre le champ ; le blocage apparaît dans l'admin.
  await page.getByRole('button', { name: 'À l’aide !' }).click()
  await page.getByLabel('Explique ce qui te bloque').fill('Je ne trouve pas le bouton Sign up.')
  await page.getByRole('button', { name: 'Envoyer à Gaby' }).click()
  await page.getByRole('heading', { name: 'Message envoyé à Gaby.' }).waitFor()
  await page.getByText('Je ne trouve pas le bouton Sign up.').waitFor()
  await shot(page, 'eleve-attente')
  await admin.goto(BASE + '/admin')
  const blocage = admin.getByRole('link', { name: new RegExp(eleve) }).filter({ hasText: 'Je ne trouve pas le bouton Sign up.' })
  await blocage.waitFor()
  assert.match(await blocage.innerText(), /Compte GitHub/)
  await shot(admin, 'admin-suivi')
  log('À l’aide : blocage visible dans l’admin (élève, étape, message)')

  // 5. Deux étapes intermédiaires pour l’élève seulement ; il les valide puis retombe sur l'étape initiale.
  await blocage.click()
  for (const [i, t] of ['Ouvre github.com', 'Cherche en haut à droite'].entries()) {
    await admin.getByRole('button', { name: /Ajouter une (autre )?étape/ }).click()
    await admin.getByLabel('Titre').nth(i).fill(t)
    await admin.getByLabel('Quoi faire').nth(i).fill(`Détail de l’aide ${i + 1}.`)
  }
  await admin.getByLabel(/Réponse courte/).fill('Regarde tout en haut à droite de la page.')
  await shot(admin, 'admin-blocage')
  await admin.getByRole('button', { name: /Envoyer 2 étapes et débloquer/ }).click()
  await admin.getByRole('heading', { name: 'Blocages ouverts' }).waitFor()
  await blocage.waitFor({ state: 'detached' })

  await page.reload()
  await page.getByText('Gaby t’a ajouté de l’aide').waitFor()
  await page.getByText('Regarde tout en haut à droite de la page.').waitFor()
  await page.getByRole('heading', { name: 'Ouvre github.com' }).waitFor()
  await shot(page, 'eleve-aide')
  await page.getByRole('button', { name: 'Oui' }).click()
  await page.getByRole('heading', { name: 'Cherche en haut à droite' }).waitFor()
  await page.getByRole('button', { name: 'Oui' }).click()
  await page.getByRole('heading', { name: 'Compte GitHub' }).waitFor()
  const guideId = (await call('/api/admin/overview', { cookie: adminCookie })).data.guides.find((g) => g.titre.startsWith('Création pas à pas')).id
  const guide = await call(`/api/admin/guides/${guideId}`, { cookie: adminCookie })
  assert.ok(!guide.data.steps.some((s) => s.titre === 'Ouvre github.com'), 'les étapes d’aide ne sont pas dans le guide commun')
  log('2 étapes d’aide pour l’élève seulement, puis retour sur l’étape initiale')

  // 7. Le fil d'Ariane permet de sauter à n'importe quelle étape.
  const jump = async (chapter, step) => {
    await page.getByRole('button', { name: 'Ouvrir le plan du guide' }).click()
    const dialog = page.getByRole('dialog')
    const ch = dialog.getByRole('button', { name: new RegExp(chapter) })
    if ((await ch.getAttribute('aria-expanded')) !== 'true') await ch.click()
    await dialog.getByRole('button', { name: new RegExp(step) }).click()
  }
  await page.getByRole('button', { name: 'Ouvrir le plan du guide' }).click()
  await shot(page, 'eleve-plan')
  await page.keyboard.press('Escape')
  await jump('Chapitre 2', 'Ton site a-t-il besoin')
  await page.getByRole('heading', { name: /Ton site a-t-il besoin d'une base de données/ }).waitFor()
  await page.getByText('Chapitre 2 · Création du MVP').waitFor()
  await page.getByText('Étape 5/11').waitFor()
  await shot(page, 'eleve-choix')
  log('fil d’Ariane : chapitre, étape, saut direct')

  // 6. Les choix envoient immédiatement à la bonne cible ; les boucles fonctionnent.
  await page.getByRole('button', { name: 'Je ne sais plus' }).click()
  await page.getByRole('heading', { name: 'Demande à Claude', exact: true }).waitFor()
  await page.getByRole('button', { name: 'Oui' }).click()
  await page.getByRole('heading', { name: /Ton site a-t-il besoin/ }).waitFor()
  await page.getByRole('button', { name: 'Oui', exact: true }).click()
  await page.getByRole('heading', { name: 'Crée la base de données' }).waitFor()
  await page.getByRole('button', { name: 'Oui' }).click()
  await page.getByRole('heading', { name: 'Donne-la à Claude Code' }).waitFor()
  await page.getByRole('button', { name: 'Copier' }).waitFor()
  await shot(page, 'eleve-d1')
  await page.getByRole('button', { name: 'Oui' }).click()
  await page.getByRole('heading', { name: 'Envoie et laisse Claude travailler' }).waitFor()
  await jump('Chapitre 2', 'Ton site a-t-il besoin')
  await page.getByRole('button', { name: 'Non', exact: true }).click()
  await page.getByRole('heading', { name: 'Envoie et laisse Claude travailler' }).waitFor()
  await page.getByRole('button', { name: 'Oui' }).click()
  await page.getByRole('heading', { name: 'Enregistre le travail dans GitHub' }).waitFor()
  await page.getByRole('button', { name: 'Oui' }).click()

  // 8. Chaque chapitre se termine par son récap.
  await page.getByRole('heading', { name: 'Ce que tu viens de faire' }).waitFor()
  await page.getByText('Le code est rangé dans GitHub').waitFor()
  await shot(page, 'eleve-recap')
  await page.getByRole('button', { name: 'Chapitre suivant' }).click()
  await page.getByText('Chapitre 3 · Mise en ligne').waitFor()

  // Vérification : « Non » affiche la consigne de rattrapage.
  await jump('Chapitre 3', 'Ouvre le lien qui finit par')
  await page.getByRole('button', { name: 'Non', exact: true }).click()
  await page.getByText(/Copie le message d'erreur de Cloudflare/).waitFor()
  await shot(page, 'eleve-verif-non')
  await page.getByRole('button', { name: 'C’est fait' }).click()
  await page.getByRole('heading', { name: 'Ce que tu viens de faire' }).waitFor()

  await jump('Chapitre 4', 'Alors')
  await page.getByRole('button', { name: 'Il y a un bug ou un truc moche' }).click()
  await page.getByRole('heading', { name: 'Explique le problème à Claude Code' }).waitFor()
  await page.getByRole('button', { name: 'Copier' }).waitFor()
  await page.getByRole('button', { name: 'Oui' }).click()
  await page.getByRole('heading', { name: 'Publie la correction' }).waitFor()
  await page.getByRole('button', { name: 'Oui' }).click()
  await page.getByRole('heading', { name: 'Teste sur ordinateur' }).waitFor()
  await jump('Chapitre 4', 'Alors')
  await page.getByRole('button', { name: 'Tout marche et c’est beau' }).or(page.getByRole('button', { name: "Tout marche et c'est beau" })).click()
  await page.getByRole('heading', { name: 'Ce que tu viens de faire' }).waitFor()

  await jump('Chapitre 5', 'Le client veut des modifications')
  await page.getByRole('button', { name: 'Oui', exact: true }).click()
  await page.getByRole('heading', { name: 'Fais les modifications' }).waitFor()
  await page.getByRole('button', { name: 'Oui' }).click()
  await page.getByRole('heading', { name: 'Montre le site au client' }).waitFor()
  await jump('Chapitre 5', 'Le client veut des modifications')
  await page.getByRole('button', { name: 'Non, il valide' }).click()
  await page.getByRole('heading', { name: 'Le propriétaire sait utiliser sa partie du site ?' }).waitFor()
  await page.getByRole('button', { name: 'Oui', exact: true }).click()
  await page.getByRole('heading', { name: 'Range ton dossier client' }).waitFor()
  await page.getByRole('button', { name: 'Oui' }).click()
  await page.getByRole('button', { name: 'Terminé' }).click()
  await page.getByRole('heading', { name: 'Bravo, guide terminé !' }).waitFor()
  await shot(page, 'eleve-fin')
  log('choix, boucles (base de données D1, bug, modifications client), récaps, fin du guide')

  // Nouveau site depuis l'écran de fin : le chapitre 0 reste fait, le reste repart de zéro.
  await page.getByRole('button', { name: 'Commencer un nouveau site' }).click()
  await page.getByRole('heading', { name: 'Avant de commencer' }).waitFor()
  await page.getByText('Chapitre 1 · SCOPE du cahier des charges').waitFor()
  await page.getByText('Étape 1/12').waitFor()
  await page.getByRole('button', { name: 'Ouvrir le plan du guide' }).click()
  const dlg = page.getByRole('dialog')
  await dlg.getByText('0/12').waitFor()
  const ch0 = await dlg.getByRole('button', { name: /Chapitre 0/ }).innerText()
  assert.match(ch0, /\b[1-9]\d*\/\d+/, `chapitre 0 gardé (${ch0})`) // ses étapes faites sont conservées
  await dlg.getByText('0/12').waitFor() // chapitre 1 : remis à zéro
  await dlg.getByText('0/11').waitFor() // chapitre 2 : remis à zéro
  await shot(page, 'eleve-nouveau-site')
  await page.keyboard.press('Escape')
  log('nouveau site (écran de fin) : chapitre 0 gardé, chapitres suivants remis à zéro')

  // 9. Un élève ne peut pas lire ni modifier les données d'un autre.
  const zoeLogin = await call('/api/login', { method: 'POST', body: { prenom: zoe, code: zoeCode } })
  assert.equal(zoeLogin.status, 200)
  const alessio = await call('/api/state', { cookie: (await ctx.cookies()).map((c) => `${c.name}=${c.value}`).join('; ') })
  const aid = alessio.data.tube.assignment.id
  assert.equal((await call(`/api/state?assignment=${aid}`, { cookie: zoeLogin.cookie })).status, 404)
  assert.equal((await call(`/api/assignments/${aid}/act`, { method: 'POST', body: { action: 'jump', to: 1 }, cookie: zoeLogin.cookie })).status, 404)
  assert.equal((await call('/api/admin/overview', { cookie: zoeLogin.cookie })).status, 401)
  assert.deepEqual((await call('/api/state', { cookie: zoeLogin.cookie })).data.assignments, [])
  log('un élève n’accède pas aux données d’un autre, ni à l’admin')

  // 3 bis. Limite d'essais : 5 erreurs → blocage.
  let last
  for (let i = 0; i < 6; i++) last = await call('/api/login', { method: 'POST', body: { prenom: zoe, code: 'AAAAAA' } })
  assert.equal(last.status, 429)
  assert.equal((await call('/api/login', { method: 'POST', body: { prenom: zoe, code: zoeCode } })).status, 429)
  log('5 erreurs de code → blocage 10 minutes')

  // Admin : éditeur, aperçu élève, duplication.
  await admin.goto(BASE + '/admin/guides')
  await admin.getByRole('button', { name: 'Dupliquer' }).first().click()
  await admin.getByText(/\(copie\)/).first().waitFor()
  await admin.getByRole('link', { name: /\(copie\)/ }).first().click()
  await admin.getByRole('heading', { name: /\(copie\)/ }).waitFor()
  await admin.getByRole('button', { name: 'Ajouter une étape' }).first().click()
  await admin.getByLabel('Titre').fill('Étape de test')
  await admin.getByRole('button', { name: 'Enregistrer' }).click()
  await admin.getByText('Étape de test').waitFor()
  await admin.getByRole('button', { name: 'Monter l’étape' }).nth(9).click()
  await shot(admin, 'admin-editeur')
  await admin.getByRole('link', { name: 'Aperçu élève' }).click()
  await admin.getByRole('heading', { name: 'Avant de commencer' }).waitFor()
  await shot(admin, 'admin-apercu')
  await admin.goto(BASE + '/admin/guides')
  await admin.locator('div.rounded-card', { hasText: '(copie)' }).first().getByRole('button', { name: 'Supprimer' }).click()
  await admin.getByText(/\(copie\)/).first().waitFor({ state: 'detached' })
  log('admin : duplication, édition, réordonnancement, aperçu élève, suppression')

  // 10. Reste utilisable sur un écran d'ordinateur ; manifeste PWA présent.
  const desk = await browser.newContext({ viewport: { width: 1440, height: 900 }, storageState: await ctx.storageState() })
  const dp = await desk.newPage()
  await dp.goto(BASE)
  await dp.getByRole('heading', { name: 'Avant de commencer' }).waitFor()
  await dp.getByRole('button', { name: 'Ouvrir le plan du guide' }).click()
  const ch1 = dp.getByRole('dialog').getByRole('button', { name: /Chapitre 1/ })
  if ((await ch1.getAttribute('aria-expanded')) !== 'true') await ch1.click()
  await dp.getByRole('dialog').getByRole('button', { name: /Demande le prompt pour Claude Code/ }).click()
  await dp.getByRole('heading', { name: 'Demande le prompt pour Claude Code' }).waitFor()
  await shot(dp, 'ordinateur-etape')
  const manifest = await (await fetch(BASE + '/manifest.webmanifest')).json()
  assert.equal(manifest.display, 'standalone')
  assert.ok((await fetch(BASE + '/icons/icon-180.png')).ok)
  log('ordinateur OK, manifeste PWA et icône iPhone présents')

  // Nouveau site depuis le plan, en cours de route (avec confirmation).
  await dp.getByRole('button', { name: 'Ouvrir le plan du guide' }).click()
  dp.once('dialog', (d) => d.accept())
  await dp.getByRole('dialog').getByRole('button', { name: 'Commencer un nouveau site' }).click()
  await dp.getByRole('heading', { name: 'Avant de commencer' }).waitFor()
  await dp.getByText('Étape 1/12').waitFor()
  log('nouveau site (plan du guide) : confirmation puis retour au chapitre 1')

  await browser.close()
  console.log('\nTous les critères d’acceptation passent.')
})().catch((e) => {
  console.error('\n✗ ÉCHEC :', e.message)
  process.exit(1)
})
