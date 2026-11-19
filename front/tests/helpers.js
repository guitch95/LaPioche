// Outils pour tester le front sans serveur : une fausse API remplace `fetch`.
import { API_URL } from "../config.js";
import { SESSION_KEY } from "../api.js";
import { waitFor } from "./runner.js";

// Construit une réponse HTTP. `body` est converti en JSON (undefined : pas de corps).
export function jsonResponse(status, body) {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// Crée une fausse API. `routes` associe "MÉTHODE /chemin" à une réponse :
//   "GET /games": [{ id: "1", title: "Catan" }]                 -> 200 avec ce corps
//   "POST /games": [201, { id: "2" }]                           -> statut et corps choisis
//   "GET /members/1/loans": ({ body }) => [200, []]             -> fonction appelée à chaque requête
// Les paramètres de recherche sont d'abord cherchés tels quels ("GET /games?q=cat"), puis sans.
// `calls` garde la liste des requêtes reçues : { method, path, search, body, headers }.
export function fakeApi(routes) {
  const calls = [];
  const fetchStub = async (input, init = {}) => {
    const url = new URL(input);
    const method = init.method ?? "GET";
    const body = init.body ? JSON.parse(init.body) : undefined;
    const headers = init.headers ?? {};
    const call = { method, path: url.pathname, search: url.search, body, headers };
    calls.push(call);

    let handler = routes[`${method} ${url.pathname}${url.search}`] ?? routes[`${method} ${url.pathname}`];
    if (handler === undefined) {
      return jsonResponse(404, { error: true, reason: "Not found" });
    }
    if (typeof handler === "function") {
      handler = handler(call);
    }
    if (Array.isArray(handler) && typeof handler[0] === "number") {
      return jsonResponse(handler[0], handler[1]);
    }
    return jsonResponse(200, handler);
  };
  return { fetch: fetchStub, calls };
}

// Remplace `fetch` le temps d'un test (pour tester api.js directement).
export async function withFakeFetch(fetchStub, action) {
  const original = globalThis.fetch;
  globalThis.fetch = fetchStub;
  try {
    return await action();
  } finally {
    globalThis.fetch = original;
  }
}

// Session enregistrée par défaut avant de charger la page : la plupart des
// tests portent sur la ludothèque, donc on démarre connecté·e.
export const testSession = { token: "test-token", email: "staff@example.com" };

// Lit et écrit la session comme le fait api.js. L'iframe a la même origine
// que la page de tests : elle partage son sessionStorage.
export function readSession() {
  return JSON.parse(sessionStorage.getItem(SESSION_KEY));
}
export function writeSession(session) {
  if (session) {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
  } else {
    sessionStorage.removeItem(SESSION_KEY);
  }
}

// Charge la vraie page index.html dans un iframe, branchée sur une fausse API.
// `session: null` démarre sans session (écran de connexion).
// Renvoie { win, doc, $, calls, click, type }.
export async function mountApp(routes, { hash = "", session = testSession } = {}) {
  writeSession(session);
  const api = fakeApi(routes);
  const pageURL = new URL("../index.html", import.meta.url);
  const html = await (await fetch(pageURL)).text();

  // Avant app.js : on remplace fetch et on choisit l'onglet affiché.
  const prelude = `<base href="${pageURL.href}">
    <script>
      window.fetch = window.parent.__fakeFetch;
      history.replaceState(null, "", "${hash}" || location.pathname);
    <\/script>`;

  const frame = document.createElement("iframe");
  frame.dataset.testFrame = "true";
  frame.style.cssText = "width:900px;height:600px;border:1px solid #ccc";
  document.body.append(frame);
  window.__fakeFetch = api.fetch;

  const doc = frame.contentDocument;
  doc.open();
  doc.write(html.replace("<head>", `<head>${prelude}`));
  doc.close();

  const win = frame.contentWindow;
  const $ = (selector) => doc.querySelector(selector);
  const $$ = (selector) => [...doc.querySelectorAll(selector)];
  await waitFor(() => doc.readyState === "complete", "la page ne se charge pas");

  return {
    win,
    doc,
    $,
    $$,
    calls: api.calls,
    // Clique sur le premier bouton dont le texte est exactement `label`, dans `root`.
    click(label, root = doc) {
      const target = [...root.querySelectorAll("button")].find((button) => button.textContent.trim() === label);
      if (!target) throw new Error(`bouton « ${label} » introuvable`);
      target.click();
    },
    // Saisit une valeur dans un champ et déclenche l'événement « input ».
    type(field, value) {
      field.value = value;
      field.dispatchEvent(new win.Event("input", { bubbles: true }));
    },
  };
}
