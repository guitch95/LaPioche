import { api, ApiError, getSession, setUnauthorizedHandler, translateError } from "../api.js";
import { assertEqual, assertIncludes, assertTrue, test } from "./runner.js";
import { fakeApi, testSession, withFakeFetch, writeSession } from "./helpers.js";

// --- translateError : les messages de l'API deviennent des phrases en français

test("translateError translates a known message", () => {
  assertEqual(translateError(409, "Game is already on loan"), "Ce jeu est déjà emprunté : il faut d'abord le rendre.");
});

test("translateError translates each validation error separately", () => {
  const message = translateError(400, "title is empty, minPlayers is less than minimum of 1");
  assertEqual(message, "Le titre est obligatoire. Le nombre minimum de joueur·ses doit être d'au moins 1.");
});

test("translateError translates a missing field and an invalid email", () => {
  assertEqual(translateError(400, "name is required"), "Le nom est obligatoire.");
  assertIncludes(translateError(400, "email is not a valid email address"), "adresse e-mail n'est pas valide");
});

test("translateError never lets unknown English through", () => {
  assertEqual(translateError(409, "Something unexpected"), "Cette action est impossible dans l'état actuel des données.");
  assertEqual(translateError(500, "boom"), "Le serveur a rencontré une erreur. Réessayez dans un instant.");
  assertEqual(translateError(418, "teapot"), "Une erreur est survenue. Réessayez.");
});

// --- requêtes envoyées à l'API

test("listGames calls GET /games", async () => {
  const { fetch, calls } = fakeApi({ "GET /games": [] });
  await withFakeFetch(fetch, () => api.listGames());
  assertEqual(`${calls[0].method} ${calls[0].path}`, "GET /games");
});

test("createGame sends a JSON POST", async () => {
  const { fetch, calls } = fakeApi({ "POST /games": [201, { id: "1" }] });
  const game = { title: "Catan", minPlayers: 3, maxPlayers: 4, durationMinutes: 90 };
  const created = await withFakeFetch(fetch, () => api.createGame(game));
  assertEqual(calls[0].method, "POST");
  assertEqual(calls[0].body, game);
  assertEqual(created.id, "1");
});

test("borrow sends the game and the member", async () => {
  const { fetch, calls } = fakeApi({ "POST /loans": [201, { id: "l1" }] });
  await withFakeFetch(fetch, () => api.borrow("g1", "m1"));
  assertEqual(calls[0].body, { gameID: "g1", memberID: "m1" });
});

// --- erreurs

// Attend qu'une promesse échoue et renvoie l'erreur (échoue si elle réussit).
async function expectError(promise) {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("une erreur était attendue");
}

test("an unreachable server gives a clear message", async () => {
  const unreachable = async () => {
    throw new TypeError("Failed to fetch");
  };
  const error = await expectError(withFakeFetch(unreachable, () => api.listGames()));
  assertEqual(error.status, 0);
  assertIncludes(error.message, "Impossible de joindre le serveur");
});

test("a game already on loan (409) gives a French message", async () => {
  const { fetch } = fakeApi({ "POST /loans": [409, { error: true, reason: "Game is already on loan" }] });
  const error = await expectError(withFakeFetch(fetch, () => api.borrow("g1", "m1")));
  assertTrue(error instanceof ApiError, "l'erreur devrait être une ApiError");
  assertEqual(error.status, 409);
  assertEqual(error.message, "Ce jeu est déjà emprunté : il faut d'abord le rendre.");
});

// --- Authentification

const authResponse = { token: "jeton-1", expiresAt: "2026-11-20T10:00:00Z", user: { id: "u1", email: "staff@example.com" } };

test("login stores the session, then each call sends the token", async () => {
  const { fetch, calls } = fakeApi({ "POST /auth/login": authResponse, "GET /games": [] });
  await withFakeFetch(fetch, () => api.login("staff@example.com", "correct-horse"));
  assertEqual(getSession(), { token: "jeton-1", email: "staff@example.com" });
  await withFakeFetch(fetch, () => api.listGames());
  assertEqual(calls[1].headers.Authorization, "Bearer jeton-1");
});

test("without a session, no Authorization header is sent", async () => {
  const { fetch, calls } = fakeApi({ "GET /games": [] });
  await withFakeFetch(fetch, () => api.listGames());
  assertEqual(calls[0].headers.Authorization, undefined);
});

test("a failed login stores nothing and gives a French message", async () => {
  const { fetch } = fakeApi({ "POST /auth/login": [401, { error: true, reason: "Email ou mot de passe incorrect." }] });
  const error = await expectError(withFakeFetch(fetch, () => api.login("staff@example.com", "mauvais")));
  assertEqual(error.status, 401);
  assertEqual(error.message, "Adresse e-mail ou mot de passe incorrect.");
  assertEqual(getSession(), null);
});

test("a 401 on a protected route clears the session and warns the app", async () => {
  writeSession(testSession);
  let warned = null;
  setUnauthorizedHandler((message) => (warned = message));
  try {
    const { fetch } = fakeApi({ "GET /games": [401, { error: true, reason: "Token Invalide." }] });
    const error = await expectError(withFakeFetch(fetch, () => api.listGames()));
    assertEqual(error.status, 401);
    assertEqual(getSession(), null, "la session est effacée");
    assertIncludes(warned ?? "", "session a expiré");
  } finally {
    setUnauthorizedHandler(() => {});
  }
});

test("a 401 on login does not warn the app (it is a credential error)", async () => {
  let warned = false;
  setUnauthorizedHandler(() => (warned = true));
  try {
    const { fetch } = fakeApi({ "POST /auth/login": [401, { error: true, reason: "Email ou mot de passe incorrect." }] });
    await expectError(withFakeFetch(fetch, () => api.login("staff@example.com", "mauvais")));
    assertTrue(!warned, "le gestionnaire de 401 ne doit pas être appelé");
  } finally {
    setUnauthorizedHandler(() => {});
  }
});

test("logout forgets the session", () => {
  writeSession(testSession);
  api.logout();
  assertEqual(getSession(), null);
});

test("auth errors are translated to French", () => {
  assertEqual(
    translateError(400, "password is less than minimum of 8 character(s)"),
    "Le mot de passe doit faire au moins 8 caractères.",
  );
  assertEqual(
    translateError(409, "Un compte existe déjà avec cette adresse e-mail."),
    "Un compte existe déjà avec cette adresse e-mail.",
  );
});
