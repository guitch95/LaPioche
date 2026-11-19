import { API_URL } from "./config.js";

// Client de l'API La Pioche : une fonction par route.
// Une route ajoutée côté Vapor s'ajoute dans l'objet `api`, en bas du fichier.

// --- Session -----------------------------------------------------------------

export const SESSION_KEY = "lapioche.session";

export function getSession() {
  try {
    return JSON.parse(sessionStorage.getItem(SESSION_KEY));
  } catch {
    return null; // contenu absent ou corrompu : pas de session
  }
}

function saveSession(auth) {
  sessionStorage.setItem(
    SESSION_KEY,
    JSON.stringify({ token: auth.token, email: auth.user.email }),
  );
}

export function clearSession() {
  sessionStorage.removeItem(SESSION_KEY);
}

let onUnauthorized = () => {};

export function setUnauthorizedHandler(handler) {
  onUnauthorized = handler;
}

export const SESSION_EXPIRED_MESSAGE =
  "Votre session a expiré ou n'est plus valide. Reconnectez-vous.";

// --- Erreurs -----------------------------------------------------------------

export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// L'API répond avec des messages techniques en anglais : on les traduit ici
// pour que l'interface n'affiche que des phrases claires en français.
const fieldLabels = {
  title: "Le titre",
  minPlayers: "Le nombre minimum de joueur·ses",
  maxPlayers: "Le nombre maximum de joueur·ses",
  durationMinutes: "La durée",
  name: "Le nom",
  email: "L'adresse e-mail",
  password: "Le mot de passe",
  players: "Le nombre de joueur·ses",
  maxDuration: "La durée maximale",
  available: "Le filtre de disponibilité",
};

const knownMessages = {
  "minPlayers must not exceed maxPlayers":
    "Le nombre minimum de joueur·ses ne peut pas dépasser le maximum.",
  "Game not found": "Ce jeu n'existe pas ou a déjà été supprimé.",
  "Member not found":
    "Cet·te adhérent·e n'existe pas ou a déjà été supprimé·e.",
  "Loan not found": "Cet emprunt n'existe pas.",
  "Invalid game id": "L'identifiant du jeu n'est pas valide.",
  "Invalid member id": "L'identifiant de l'adhérent·e n'est pas valide.",
  "Invalid loan id": "L'identifiant de l'emprunt n'est pas valide.",
  "Game is already on loan":
    "Ce jeu est déjà emprunté : il faut d'abord le rendre.",
  "Loan is already returned": "Cet emprunt a déjà été rendu.",
  "A game with loans cannot be deleted":
    "Suppression impossible : ce jeu a un historique d'emprunts, conservé même quand le jeu est rendu.",
  "A member with loans cannot be deleted":
    "Suppression impossible : cet·te adhérent·e a un historique d'emprunts, conservé même quand tout est rendu.",
  "A member with this email already exists":
    "Un·e autre adhérent·e utilise déjà cette adresse e-mail.",
  // Authentification (messages de l'API, déjà en français)
  "Email ou mot de passe incorrect.":
    "Adresse e-mail ou mot de passe incorrect.",
  "Un compte existe déjà avec cette adresse e-mail.":
    "Un compte existe déjà avec cette adresse e-mail.",
};

// Les erreurs de validation de Vapor arrivent regroupées :
// « title is empty, minPlayers is less than minimum of 1 ».
function translateValidation(part) {
  const label = (field) => fieldLabels[field] ?? `Le champ « ${field} »`;
  let match;
  // Avant la règle générale « is less than minimum of » : Vapor renvoie
  // « password is less than minimum of 8 character(s) ».
  if (
    (match = part.match(/^password is less than minimum of (\d+) character/))
  ) {
    return `Le mot de passe doit faire au moins ${match[1]} caractères.`;
  }
  if ((match = part.match(/^(\w+) is (?:empty|required)$/))) {
    return `${label(match[1])} est obligatoire.`;
  }
  if ((match = part.match(/^(\w+) is less than minimum of (\d+)/))) {
    return `${label(match[1])} doit être d'au moins ${match[2]}.`;
  }
  if ((match = part.match(/^(\w+) is not a\(n\) Int$/))) {
    return `${label(match[1])} doit être un nombre entier.`;
  }
  if ((match = part.match(/^(\w+) is not a\(n\) Bool$/))) {
    return `${label(match[1])} doit valoir « oui » ou « non ».`;
  }
  if (/^email is not a valid email address$/.test(part)) {
    return "L'adresse e-mail n'est pas valide (exemple : nom@example.com).";
  }
  return null;
}

const statusMessages = {
  400: "Les informations envoyées ne sont pas valides.",
  404: "Cet élément n'existe pas.",
  409: "Cette action est impossible dans l'état actuel des données.",
};

export function translateError(status, reason) {
  if (reason in knownMessages) {
    return knownMessages[reason];
  }
  const parts = (reason ?? "").split(", ").map(translateValidation);
  if (parts.length > 0 && parts.every(Boolean)) {
    return parts.join(" ");
  }
  if (status >= 500) {
    return "Le serveur a rencontré une erreur. Réessayez dans un instant.";
  }
  return statusMessages[status] ?? "Une erreur est survenue. Réessayez.";
}

async function request(method, path, body) {
  const headers =
    body === undefined ? {} : { "Content-Type": "application/json" };
  const session = getSession();
  if (session) {
    headers.Authorization = `Bearer ${session.token}`;
  }

  let response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(
      0,
      "Impossible de joindre le serveur. Vérifiez qu'il est bien lancé.",
    );
  }
  if (response.status === 204) {
    return null;
  }
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    // 401 sur une route protégée : le jeton n'est plus accepté (absent,
    // expiré, compte supprimé…). Sur /auth/login, un 401 veut seulement dire
    // « mauvais identifiants » : on laisse le formulaire afficher l'erreur.
    if (response.status === 401 && !path.startsWith("/auth/")) {
      clearSession();
      onUnauthorized(SESSION_EXPIRED_MESSAGE);
      throw new ApiError(401, SESSION_EXPIRED_MESSAGE);
    }
    // Vapor renvoie { error: true, reason: "..." }
    throw new ApiError(
      response.status,
      translateError(response.status, data?.reason),
    );
  }
  return data;
}

export const api = {
  // Connexion et inscription : la session n'est enregistrée que si l'API
  // accepte (en cas d'erreur, request lève une exception avant).
  login: async (email, password) => {
    const auth = await request("POST", "/auth/login", { email, password });
    saveSession(auth);
    return auth;
  },
  register: async (email, password) => {
    const auth = await request("POST", "/auth/register", { email, password });
    saveSession(auth);
    return auth;
  },
  logout: () => clearSession(),

  listGames: (filters = {}) => {
    const query = new URLSearchParams(filters).toString();
    return request("GET", `/games?${query}`);
  },
  createGame: (game) => request("POST", "/games", game),
  modifyGame: (game) => request("PUT", `/games/${game.id}`, game),
  deleteGame: (game) => request("DELETE", `/games/${game.id}`),

  listLoans: () => request("GET", "/loans"),
  returnLoan: (loan) => request("POST", `/loans/${loan.id}/return`),
  overdueLoan: () => request("GET", "/loans/overdue"),

  listMembers: () => request("GET", "/members"),
  listMemberLoans: (member) => request("GET", `/members/${member.id}/loans`),
  createMember: (member) => request("POST", "/members", member),
  modifyMember: (member) => request("PUT", `/members/${member.id}`, member),
  deleteMember: (member) => request("DELETE", `/members/${member.id}`),

  borrow: (gameID, memberID) => request("POST", "/loans", { gameID, memberID }),
};
