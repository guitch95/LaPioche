import { API_URL } from "./config.js";
import { api, getSession, setUnauthorizedHandler } from "./api.js";

const $ = (selector, root = document) => root.querySelector(selector);

$("#docs-link").href = API_URL;

const dateFormat = new Intl.DateTimeFormat("fr-FR", { dateStyle: "long" });
const formatDate = (iso) => dateFormat.format(new Date(iso));

// Construit un élément sans jamais passer par innerHTML : les données de
// l'API (titres, noms) sont insérées comme du texte.
function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === "class") node.className = value;
    else if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value);
  }
  node.append(...children);
  return node;
}

function button(label, onClick, className = "") {
  return el(
    "button",
    { type: "button", class: className, onclick: onClick },
    label,
  );
}

function toast(message, isError = false) {
  const node = el("p", { class: isError ? "toast error" : "toast" }, message);
  $("#toasts").append(node);
  setTimeout(() => node.remove(), 5000);
}

// Exécute une action déclenchée par un bouton et affiche l'erreur de l'API.
async function run(action) {
  try {
    await action();
  } catch (error) {
    // Un 401 ramène déjà à l'écran de connexion avec son message : pas de toast en double.
    if (error.status !== 401) {
      toast(error.message, true);
    }
  }
}

function showFormError(dialog, error) {
  const target = $(".form-error", dialog);
  target.textContent = error ? error.message : "";
  target.hidden = !error;
}

for (const cancel of document.querySelectorAll("[data-cancel]")) {
  cancel.addEventListener("click", () => cancel.closest("dialog").close());
}

// Branche un formulaire de boîte de dialogue sur un appel à l'API.
// L'erreur renvoyée par l'API reste affichée dans la boîte, qui ne se ferme
// qu'en cas de succès.
function bindSubmit(dialog, form, handler) {
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    showFormError(dialog, null);
    try {
      await handler(new FormData(form));
      dialog.close();
      await refresh();
    } catch (error) {
      showFormError(dialog, error);
    }
  });
}

// --- Onglets ---------------------------------------------------------------

const tabs = ["games", "members", "overdueloan"];

function currentTab() {
  const name = location.hash.slice(1);
  return tabs.includes(name) ? name : "games";
}

async function refresh() {
  // Sans session, rien à charger : l'écran de connexion est affiché.
  if (!getSession()) {
    return;
  }
  const tab = currentTab();
  for (const name of tabs) {
    $(`#${name}`).hidden = name !== tab;
    $(`[data-tab="${name}"]`).toggleAttribute("aria-current", name === tab);
  }
  if (tab === "games") {
    await run(loadGames);
  } else if (tab === "members") {
    await run(loadMembers);
  } else if (tab === "overdueloan") {
    await run(loadOverdueLoan);
  }
}

window.addEventListener("hashchange", refresh);

// --- Connexion -------------------------------------------------------------

const loginForm = $("#login-form");
const registerForm = $("#register-form");

// Affiche le formulaire de connexion ou de création de compte ou connexion
function showAuthForm(name) {
  loginForm.hidden = name !== "login";
  registerForm.hidden = name !== "register";
  showFormError(loginForm, null);
  showFormError(registerForm, null);
}

// Écran de connexion
function showAuth(message = "") {
  for (const dialog of document.querySelectorAll("dialog[open]")) {
    dialog.close();
  }
  $("#app").hidden = true;
  $("#app-nav").hidden = true;
  $("#session").hidden = true;
  $("#auth").hidden = false;
  $("#auth-message").textContent = message;
  $("#auth-message").hidden = !message;
  showAuthForm("login");
}

// Ludothèque, avec l'adresse de la personne connectée.
async function showApp() {
  $("#auth").hidden = true;
  $("#current-user").textContent = getSession().email;
  $("#session").hidden = false;
  $("#app-nav").hidden = false;
  $("#app").hidden = false;
  await refresh();
}

// En cas d'erreur, le message s'affiche dans le formulaire, qui n'est pas vidé.
function bindAuthForm(form, action) {
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    showFormError(form, null);
    const data = new FormData(form);
    try {
      await action(data.get("email").trim(), data.get("password"));
      form.reset(); // succès : on ne laisse pas le mot de passe dans la page
      await showApp();
    } catch (error) {
      showFormError(form, error);
    }
  });
}

bindAuthForm(loginForm, api.login);
bindAuthForm(registerForm, api.register);

for (const link of document.querySelectorAll("[data-auth-switch]")) {
  link.addEventListener("click", (event) => {
    event.preventDefault(); // href="#" : ne pas changer l'onglet
    showAuthForm(link.dataset.authSwitch);
  });
}

$("#logout").addEventListener("click", () => {
  api.logout();
  showAuth();
});

// L'API a refusé le jeton : retour à l'écran de connexion avec l'explication.
setUnauthorizedHandler(showAuth);

// --- Jeux ------------------------------------------------------------------

async function loadGames(filters = {}) {
  const games = await api.listGames(filters);
  const hasFilters = Object.keys(filters).length > 0;
  const noGames = games.length === 0;
  $("#games-empty").hidden = !(!hasFilters && noGames);
  $("#games-no-result").hidden = !(hasFilters && noGames);
  $("#games-list").replaceChildren(...games.map(gameCard));
}

function gameCard(game) {
  const players =
    game.minPlayers === game.maxPlayers
      ? `${game.minPlayers}`
      : `${game.minPlayers} à ${game.maxPlayers}`;
  const status = game.isAvailable
    ? el("span", { class: "badge ok" }, "Disponible")
    : el("span", { class: "badge busy" }, "Emprunté");

  const actions = el("div", { class: "actions" });
  if (game.isAvailable) {
    actions.append(
      button("Emprunter", () => openBorrowDialog(game), "primary"),
    );
    actions.append(
      button("Modifier", () => openModifyDialog(game), "secondary"),
    );
    actions.append(
      button("Supprimer", () => openDeleteDialog(game), "tertiary"),
    );
  }

  if (!game.isAvailable) {
    actions.append(
      button("Rendre", () => openReturnDialog(game), "returnedLoan"),
    );
  }

  return el(
    "li",
    { class: "card" },
    el("div", { class: "card-head" }, el("h3", {}, game.title), status),
    el(
      "p",
      { class: "meta" },
      `${players} joueur·ses · ${game.durationMinutes} min`,
    ),
    actions,
  );
}

const gameDialog = $("#game-dialog");
const gameForm = $("#game-form");

$("#add-game").addEventListener("click", () => {
  gameForm.reset();
  showFormError(gameDialog, null);
  gameDialog.showModal();
});

bindSubmit(gameDialog, gameForm, (data) =>
  api.createGame({
    title: data.get("title").trim(),
    minPlayers: Number(data.get("minPlayers")),
    maxPlayers: Number(data.get("maxPlayers")),
    durationMinutes: Number(data.get("durationMinutes")),
  }),
);

// --- Emprunts --------------------------------------------------------------

const borrowDialog = $("#borrow-dialog");
const borrowForm = $("#borrow-form");
let borrowedGame = null;

async function openBorrowDialog(game) {
  await run(async () => {
    const members = await api.listMembers();
    if (members.length === 0) {
      toast("Ajoutez d'abord un·e adhérent·e pour pouvoir emprunter.", true);
      return;
    }
    borrowedGame = game;
    $("#borrow-dialog-title").textContent = `Emprunter « ${game.title} »`;
    $("select", borrowForm).replaceChildren(
      ...members.map((member) =>
        el("option", { value: member.id }, `${member.name} (${member.email})`),
      ),
    );
    showFormError(borrowDialog, null);
    borrowDialog.showModal();
  });
}

bindSubmit(borrowDialog, borrowForm, async (data) => {
  const loan = await api.borrow(borrowedGame.id, data.get("memberID"));
  toast(
    `« ${borrowedGame.title} » emprunté, à rendre avant le ${formatDate(loan.dueAt)}.`,
  );
});

// ---- Modification Jeu ---------------------------------------------------------

const modifyDialog = $("#modify-dialog");
const modfiyForm = $("#modify-form");
let modifiedGame = null;

async function openModifyDialog(game) {
  await run(async () => {
    modifiedGame = game;
    $("#modify-dialog-title").textContent = `Modifier « ${game.title} »`;
    $('[name="title"]', modfiyForm).value = game.title;
    $('[name="minPlayers"]', modfiyForm).value = game.minPlayers;
    $('[name="maxPlayers"]', modfiyForm).value = game.maxPlayers;
    $('[name="durationMinutes"]', modfiyForm).value = game.durationMinutes;
    showFormError(modifyDialog, null);
    modifyDialog.showModal();
  });
}

bindSubmit(modifyDialog, modfiyForm, async (data) => {
  await api.modifyGame({
    id: modifiedGame.id,
    title: data.get("title").trim(),
    minPlayers: Number(data.get("minPlayers")),
    maxPlayers: Number(data.get("maxPlayers")),
    durationMinutes: Number(data.get("durationMinutes")),
  });
});

// --- Suppression Jeu -----------------------------------------------------------

const deleteDialog = $("#delete-dialog");
const deleteForm = $("#delete-form");
let deletedGame = null;

async function openDeleteDialog(game) {
  await run(async () => {
    deletedGame = game;
    $("#delete-dialog-title").textContent =
      `Êtes vous sûr de vouloir supprimer « ${game.title} »`;
    showFormError(deleteDialog, null);
    deleteDialog.showModal();
  });
}

bindSubmit(deleteDialog, deleteForm, async () => {
  await api.deleteGame(deletedGame);
});

// Returned Game --------------------------------------------------------
const returnedLoanDialog = $("#return-dialog");
const returnForm = $("#return-form");
let returnedLoan = null;

async function openReturnDialog(game) {
  await run(async () => {
    const loans = await api.listLoans();
    const loan = loans.find(
      (loan) => loan.gameID == game.id && !loan.returnedAt,
    );

    if (!loan) {
      toast("Ce jeu a déjà été rendu.", true);
      return;
    }

    returnedLoan = loan;
    $("#return-dialog-title").textContent =
      `Êtes-vous sûr de vouloir rendre « ${game.title} »`;
    showFormError(returnedLoanDialog, null);
    returnedLoanDialog.showModal();
  });
}

bindSubmit(returnedLoanDialog, returnForm, async () => {
  await api.returnLoan(returnedLoan);
});

// --- Adhérent·es -----------------------------------------------------------

async function loadMembers() {
  const members = await api.listMembers();
  $("#members-empty").hidden = members.length > 0;
  $("#members-list").replaceChildren(...members.map(memberRow));
}

function memberRow(member) {
  return el(
    "li",
    { class: "row" },
    el(
      "div",
      { class: "row-main" },
      el("p", {}, el("strong", {}, member.name)),
      el("p", { class: "meta" }, member.email),
      button("Modifier", () => openModifyMemberDialog(member), "secondary"),
      button("Supprimer", () => openDeleteMemberDialog(member), "tertiary"),
      button(
        "Voir les emprunts",
        () => openShowLoansDialog(member),
        "showLoans",
      ),
    ),
  );
}

const memberDialog = $("#member-dialog");
const memberForm = $("#member-form");

$("#add-member").addEventListener("click", () => {
  memberForm.reset();
  showFormError(memberDialog, null);
  memberDialog.showModal();
});

bindSubmit(memberDialog, memberForm, (data) =>
  api.createMember({
    name: data.get("name").trim(),
    email: data.get("email").trim(),
  }),
);

// Modification Adhérent -----------------------------------------------

const modifyMemberDialog = $("#modify-member-dialog");
const modifyMemberForm = $("#modify-member-form");
let modifiedMember = null;

async function openModifyMemberDialog(member) {
  await run(async () => {
    modifiedMember = member;
    $("#modify-member-dialog-title").textContent =
      `Modifier « ${member.name} »`;
    $('[name="name"]', modifyMemberForm).value = member.name;
    $('[name="email"]', modifyMemberForm).value = member.email;
    showFormError(modifyMemberDialog, null);
    modifyMemberDialog.showModal();
  });
}

bindSubmit(modifyMemberDialog, modifyMemberForm, async (data) => {
  await api.modifyMember({
    id: modifiedMember.id,
    name: data.get("name").trim(),
    email: data.get("email").trim(),
  });
});

// Suppression Adhérent ------------------------------------------------------

const deleteMemberDialog = $("#delete-member-dialog");
const deleteMemberForm = $("#delete-member-form");
let deletedMember = null;

async function openDeleteMemberDialog(member) {
  await run(async () => {
    deletedMember = member;
    $("#delete-member-dialog-title").textContent =
      `Êtes vous sûr de vouloir supprimer « ${member.name} »`;
    showFormError(deleteMemberDialog, null);
    deleteMemberDialog.showModal();
  });
}

bindSubmit(deleteMemberDialog, deleteMemberForm, async () => {
  await api.deleteMember(deletedMember);
});

// Emprunt d'un adhérent ------------------------------------------------

const showLoansDialog = $("#show-loans-dialog");
const showLoansForm = $("#show-loans-form");

async function openShowLoansDialog(member) {
  await run(async () => {
    const loans = await api.listMemberLoans(member);
    const games = await api.listGames();
    $("#loans-empty").hidden = loans.length > 0;
    $("#loans-list").replaceChildren(
      ...loans.map((loan) => loanCard(loan, games)),
    );
    // console.log(loans);
    $("#show-loan-dialog-title").textContent = `Emprunt de « ${member.name} »`;

    showFormError(showLoansDialog, null);
    showLoansDialog.showModal();
  });
}

function loanCard(loan, games) {
  const gameLoaned = games.find((game) => game.id == loan.gameID);
  let status;
  if (new Date(loan.dueAt) < Date.now() && !loan.returnedAt) {
    status = "En retard";
  } else if (!loan.returnedAt) {
    status = "En cours";
  } else {
    status = "Rendu";
  }
  return el(
    "li",
    { class: "cardLoan" },
    el("h3", { class: "meta" }, `${gameLoaned?.title ?? "Jeu inconnu"}`),
    el(
      "p",
      { class: "meta" },
      `Date d'emprunt: ${formatDate(loan.borrowedAt)}`,
    ),
    el(
      "p",
      { class: "meta" },
      `Date de retour prévue: ${formatDate(loan.dueAt)}`,
    ),
    el("h3", { class: "" }, status),
  );
}

// Overdue Loan ---------------------------------------------------------

async function loadOverdueLoan() {
  const overdueLoans = await api.overdueLoan();
  const games = await api.listGames();
  const members = await api.listMembers();
  // console.log(overdueLoans);
  $("#overdue-loan-empty").hidden = overdueLoans.length > 0;
  $("#overdue-loan-list").replaceChildren(
    ...overdueLoans.map((loan) => overdueCard(loan, games, members)),
  );
}

function overdueCard(overdueLoans, games, members) {
  const gameLoaned = games.find((game) => game.id == overdueLoans.gameID);
  const member = members.find((member) => member.id == overdueLoans.memberID);
  // console.log(gameLoaned);
  // console.log(member);
  const MS_PER_DAY = 24 * 60 * 60 * 1000;
  let numberOfOverdueDay = Math.floor(
    (Date.now() - new Date(overdueLoans.dueAt)) / MS_PER_DAY,
  );

  if (numberOfOverdueDay === 0) {
    numberOfOverdueDay = Math.ceil(
      (Date.now() - new Date(overdueLoans.dueAt)) / MS_PER_DAY,
    );
  }

  return el(
    "li",
    { class: "cardLoan" },
    el(
      "div",
      { class: "row-main" },
      el("strong", {}, gameLoaned?.title ?? "Jeu inconnu"),
      el("br", {}),
      el("p", {}, `Jeu emprunté par: ${member?.name ?? "Membre inconnu"}`),
      el("p", {}, `Date de retour prévue: ${formatDate(overdueLoans.dueAt)}`),
      el(
        "strong",
        {},
        `Retour en retard de: ${numberOfOverdueDay} jour${numberOfOverdueDay > 1 ? "s" : ""}`,
      ),
    ),
  );
}

// function memberRow(member) {
//   return el(
//     "li",
//     { class: "row" },
//     el(
//       "div",
//       { class: "row-main" },
//       el("p", {}, el("strong", {}, member.name)),
//       el("p", { class: "meta" }, member.email),
//       button("Modifier", () => openModifyMemberDialog(member), "secondary"),
//       button("Supprimer", () => openDeleteMemberDialog(member), "tertiary"),
//       button(
//         "Voir les emprunts",
//         () => openShowLoansDialog(member),
//         "showLoans",
//       ),
//     ),
//   );
// }

// Search FORM -----------------------------------------------

const searchForm = $("#search-form");

searchForm.addEventListener("submit", (event) => {
  event.preventDefault();
  searchGames();
});

$("#available").addEventListener("input", searchGames);

function searchGames() {
  const data = new FormData(searchForm);
  const filters = {};
  if (data.get("q").trim() !== "") {
    filters.q = data.get("q").trim();
  }
  if (data.get("players") !== "") {
    filters.players = data.get("players");
  }
  if (data.get("maxDuration") !== "") {
    filters.maxDuration = data.get("maxDuration");
  }
  if (data.get("available") !== null) {
    filters.available = data.get("available");
  }
  run(() => loadGames(filters));
}

$("#btn-cancel-search").addEventListener("click", () => {
  run(loadGames);
});

// --- Démarrage -------------------------------------------------------------
if (getSession()) {
  showApp();
} else {
  showAuth();
}
