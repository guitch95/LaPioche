import { assertEqual, assertIncludes, assertTrue, test, waitFor } from "./runner.js";
import { mountApp, readSession, testSession } from "./helpers.js";

const catan = { id: "g1", title: "Catan", minPlayers: 3, maxPlayers: 4, durationMinutes: 90, isAvailable: true };
const dixit = { id: "g2", title: "Dixit", minPlayers: 3, maxPlayers: 6, durationMinutes: 30, isAvailable: false };
const camille = { id: "m1", name: "Camille", email: "camille@example.com" };

const cardOf = (app, title) => app.$$("#games-list .card").find((card) => card.querySelector("h3").textContent === title);

// --- Jeux

test("games list shows one card per game with its availability", async () => {
  const app = await mountApp({ "GET /games": [catan, dixit] });
  await waitFor(() => app.$$("#games-list .card").length === 2, "deux cartes de jeu");
  assertIncludes(cardOf(app, "Catan").textContent, "Disponible");
  assertIncludes(cardOf(app, "Dixit").textContent, "Emprunté");
  assertIncludes(cardOf(app, "Catan").textContent, "3 à 4 joueur·ses · 90 min");
});

test("only an available game offers Borrow", async () => {
  const app = await mountApp({ "GET /games": [catan, dixit] });
  await waitFor(() => app.$$("#games-list .card").length === 2);
  const labels = (title) => [...cardOf(app, title).querySelectorAll("button")].map((button) => button.textContent);
  assertTrue(labels("Catan").includes("Emprunter"), "Catan devrait proposer Emprunter");
  assertTrue(!labels("Dixit").includes("Emprunter"), "Dixit est emprunté, il ne doit pas proposer Emprunter");
});

test("with no game, a message invites to add one", async () => {
  const app = await mountApp({ "GET /games": [] });
  await waitFor(() => !app.$("#games-empty").hidden);
  assertIncludes(app.$("#games-empty").textContent, "ne contient aucun jeu");
  assertIncludes(app.$("#games-empty").textContent, "Ajouter un jeu");
});

test("adding a game posts the form then reloads the list", async () => {
  const app = await mountApp({ "GET /games": [catan], "POST /games": [201, { ...catan, id: "g3", title: "Dixit" }] });
  await waitFor(() => app.$$("#games-list .card").length === 1);
  app.click("Ajouter un jeu");
  const form = app.$("#game-form");
  form.elements.title.value = "  Dixit ";
  form.elements.minPlayers.value = "3";
  form.elements.maxPlayers.value = "6";
  form.elements.durationMinutes.value = "30";
  form.requestSubmit();
  await waitFor(() => app.calls.some((call) => call.method === "POST" && call.path === "/games"), "l'appel POST /games");
  assertEqual(app.calls.find((call) => call.method === "POST").body, {
    title: "Dixit",
    minPlayers: 3,
    maxPlayers: 6,
    durationMinutes: 30,
  });
  await waitFor(() => !app.$("#game-dialog").open, "la boîte se ferme");
});

test("a validation error is shown in French and the dialog stays open", async () => {
  const app = await mountApp({
    "GET /games": [],
    "POST /games": [400, { error: true, reason: "title is empty, durationMinutes is less than minimum of 1" }],
  });
  await waitFor(() => !app.$("#games-empty").hidden, "la page est chargée");
  app.click("Ajouter un jeu");
  app.$("#game-form").requestSubmit();
  await waitFor(() => !app.$("#game-dialog .form-error").hidden, "le message d'erreur");
  assertEqual(app.$("#game-dialog .form-error").textContent, "Le titre est obligatoire. La durée doit être d'au moins 1.");
  assertTrue(app.$("#game-dialog").open, "la boîte devrait rester ouverte");
});

// --- Emprunts

test("borrowing a game sends the game and the chosen member", async () => {
  const app = await mountApp({
    "GET /games": [catan],
    "GET /members": [camille],
    "POST /loans": [201, { id: "l1", gameID: "g1", memberID: "m1", borrowedAt: new Date().toISOString(), dueAt: new Date().toISOString() }],
  });
  await waitFor(() => app.$$("#games-list .card").length === 1);
  app.click("Emprunter", cardOf(app, "Catan"));
  await waitFor(() => app.$("#borrow-dialog").open, "la boîte d'emprunt");
  app.$("#borrow-form").requestSubmit();
  await waitFor(() => app.calls.some((call) => call.method === "POST" && call.path === "/loans"), "l'appel POST /loans");
  assertEqual(app.calls.find((call) => call.path === "/loans").body, { gameID: "g1", memberID: "m1" });
  await waitFor(() => app.$("#toasts").textContent.includes("emprunté"), "le message de confirmation");
});

test("borrowing without any member explains that one must be added first", async () => {
  const app = await mountApp({ "GET /games": [catan], "GET /members": [] });
  await waitFor(() => app.$$("#games-list .card").length === 1);
  app.click("Emprunter", cardOf(app, "Catan"));
  await waitFor(() => app.$("#toasts").textContent.includes("Ajoutez d'abord"), "le message d'aide");
  assertTrue(!app.$("#borrow-dialog").open, "la boîte d'emprunt ne doit pas s'ouvrir");
});

// --- Adhérent·es

test("members tab lists the members", async () => {
  const app = await mountApp({ "GET /members": [camille] }, { hash: "#members" });
  await waitFor(() => app.$$("#members-list .row").length === 1);
  assertIncludes(app.$("#members-list .row").textContent, "Camille");
  assertIncludes(app.$("#members-list .row").textContent, "camille@example.com");
});

test("with no member, a message invites to add one", async () => {
  const app = await mountApp({ "GET /members": [] }, { hash: "#members" });
  await waitFor(() => !app.$("#members-empty").hidden);
  assertIncludes(app.$("#members-empty").textContent, "Ajouter un·e adhérent·e");
});

test("adding a member posts the form", async () => {
  const app = await mountApp({ "GET /members": [], "POST /members": [201, camille] }, { hash: "#members" });
  await waitFor(() => !app.$("#members-empty").hidden);
  app.click("Ajouter un·e adhérent·e");
  const form = app.$("#member-form");
  form.elements.name.value = " Camille ";
  form.elements.email.value = "camille@example.com";
  form.requestSubmit();
  await waitFor(() => app.calls.some((call) => call.method === "POST" && call.path === "/members"), "l'appel POST /members");
  assertEqual(app.calls.find((call) => call.method === "POST").body, { name: "Camille", email: "camille@example.com" });
});

test("an email already in use is shown in French", async () => {
  const app = await mountApp(
    { "GET /members": [], "POST /members": [409, { error: true, reason: "A member with this email already exists" }] },
    { hash: "#members" },
  );
  await waitFor(() => !app.$("#members-empty").hidden);
  app.click("Ajouter un·e adhérent·e");
  app.$("#member-form").requestSubmit();
  await waitFor(() => !app.$("#member-dialog .form-error").hidden, "le message d'erreur");
  assertIncludes(app.$("#member-dialog .form-error").textContent, "utilise déjà cette adresse e-mail");
});

// --- Authentification

const auth = { token: "jeton-1", expiresAt: "2026-11-20T10:00:00Z", user: { id: "u1", email: "staff@example.com" } };
const isShown = (app, selector) => !app.$(selector).hidden;

test("without a session, the login screen replaces the library", async () => {
  const app = await mountApp({ "GET /games": [catan] }, { session: null });
  await waitFor(() => isShown(app, "#auth"), "l'écran de connexion");
  assertTrue(!isShown(app, "#app"), "la ludothèque doit être cachée");
  assertTrue(!isShown(app, "#app-nav"), "les onglets doivent être cachés");
  assertTrue(isShown(app, "#login-form"), "le formulaire de connexion est affiché");
  assertEqual(app.calls.length, 0, "aucun appel à l'API sans session");
});

test("a link switches between login and account creation", async () => {
  const app = await mountApp({}, { session: null });
  await waitFor(() => isShown(app, "#auth"), "app.js a affiché l'écran de connexion");
  app.$('[data-auth-switch="register"]').click();
  assertTrue(isShown(app, "#register-form") && !isShown(app, "#login-form"), "création de compte affichée");
  app.$('[data-auth-switch="login"]').click();
  assertTrue(isShown(app, "#login-form") && !isShown(app, "#register-form"), "connexion affichée");
});

test("a successful login stores the token then sends it with every call", async () => {
  const app = await mountApp({ "POST /auth/login": auth, "GET /games": [catan] }, { session: null });
  await waitFor(() => isShown(app, "#auth"), "app.js a affiché l'écran de connexion");
  const form = app.$("#login-form");
  form.elements.email.value = " staff@example.com ";
  form.elements.password.value = "correct-horse";
  form.requestSubmit();

  await waitFor(() => isShown(app, "#app"), "la ludothèque s'affiche");
  assertEqual(app.calls[0].body, { email: "staff@example.com", password: "correct-horse" });
  assertEqual(readSession()?.token, "jeton-1", "le jeton est conservé dans l'onglet");
  await waitFor(() => app.calls.some((call) => call.path === "/games"), "la liste des jeux est chargée");
  assertEqual(app.calls.find((call) => call.path === "/games").headers.Authorization, "Bearer jeton-1");
  assertEqual(app.$("#current-user").textContent, "staff@example.com");
  assertTrue(isShown(app, "#session"), "le bouton de déconnexion est affiché");
});

test("a failed login is shown in French and keeps the form filled", async () => {
  const app = await mountApp(
    { "POST /auth/login": [401, { error: true, reason: "Email ou mot de passe incorrect." }] },
    { session: null },
  );
  await waitFor(() => isShown(app, "#auth"), "app.js a affiché l'écran de connexion");
  const form = app.$("#login-form");
  form.elements.email.value = "staff@example.com";
  form.elements.password.value = "mauvais";
  form.requestSubmit();

  await waitFor(() => !app.$("#login-form .form-error").hidden, "le message d'erreur");
  assertEqual(app.$("#login-form .form-error").textContent, "Adresse e-mail ou mot de passe incorrect.");
  assertEqual(form.elements.email.value, "staff@example.com", "l'adresse n'est pas effacée");
  assertEqual(form.elements.password.value, "mauvais", "le mot de passe n'est pas effacé");
  assertTrue(isShown(app, "#auth") && !isShown(app, "#app"), "on reste sur l'écran de connexion");
  assertEqual(readSession(), null, "aucune session après un échec");
});

test("account creation errors are shown in French without clearing the form", async () => {
  const app = await mountApp(
    { "POST /auth/register": [400, { error: true, reason: "password is less than minimum of 8 character(s)" }] },
    { session: null },
  );
  await waitFor(() => isShown(app, "#auth"), "app.js a affiché l'écran de connexion");
  app.$('[data-auth-switch="register"]').click();
  const form = app.$("#register-form");
  form.elements.email.value = "nouveau@example.com";
  form.elements.password.value = "court";
  form.requestSubmit();

  await waitFor(() => !app.$("#register-form .form-error").hidden, "le message d'erreur");
  assertEqual(app.$("#register-form .form-error").textContent, "Le mot de passe doit faire au moins 8 caractères.");
  assertEqual(form.elements.email.value, "nouveau@example.com");
  assertEqual(form.elements.password.value, "court");
});

test("creating an account logs in directly", async () => {
  const app = await mountApp(
    { "POST /auth/register": [201, { ...auth, user: { id: "u2", email: "nouveau@example.com" } }], "GET /games": [] },
    { session: null },
  );
  await waitFor(() => isShown(app, "#auth"), "app.js a affiché l'écran de connexion");
  app.$('[data-auth-switch="register"]').click();
  const form = app.$("#register-form");
  form.elements.email.value = "nouveau@example.com";
  form.elements.password.value = "correct-horse";
  form.requestSubmit();

  await waitFor(() => isShown(app, "#app"), "la ludothèque s'affiche");
  assertEqual(app.$("#current-user").textContent, "nouveau@example.com");
});

test("with a session kept in the tab, the library shows directly", async () => {
  const app = await mountApp({ "GET /games": [catan] });
  await waitFor(() => app.$$("#games-list .card").length === 1, "la liste des jeux");
  assertTrue(!isShown(app, "#auth"), "pas d'écran de connexion");
  assertEqual(app.$("#current-user").textContent, testSession.email);
});

test("a 401 from the API goes back to the login screen with an explanation", async () => {
  const app = await mountApp({ "GET /games": [401, { error: true, reason: "Token Invalide." }] });
  await waitFor(() => isShown(app, "#auth"), "retour à l'écran de connexion");
  assertTrue(!isShown(app, "#app"), "la ludothèque est cachée");
  assertIncludes(app.$("#auth-message").textContent, "session a expiré");
  assertEqual(readSession(), null, "la session est effacée");
  assertEqual(app.$("#toasts").textContent, "", "pas de toast en plus du message");
});

test("logging out goes back to the login screen and forgets the token", async () => {
  const app = await mountApp({ "GET /games": [catan] });
  await waitFor(() => app.$$("#games-list .card").length === 1);
  app.click("Se déconnecter");
  assertTrue(isShown(app, "#auth") && !isShown(app, "#app"), "écran de connexion affiché");
  assertTrue(app.$("#auth-message").hidden, "pas de message d'erreur après une déconnexion volontaire");
  assertEqual(readSession(), null, "le jeton est oublié");
});
