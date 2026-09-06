const state = {
  recipes: [],
  selected: [],
  favorites: new Set(JSON.parse(localStorage.getItem("recipe-favorites") || "[]")),
  onlyFavorites: false,
};

const $ = (selector) => document.querySelector(selector);
const elements = {
  add: $("#addIngredient"),
  difficulty: $("#difficultyFilter"),
  dialog: $("#recipeDialog"),
  detail: $("#recipeDetail"),
  empty: $("#emptyState"),
  exclude: $("#excludeSearch"),
  favoriteCount: $("#favoriteCount"),
  favoritesButton: $("#favoritesButton"),
  grid: $("#recipeGrid"),
  install: $("#installButton"),
  offlineNotice: $("#offlineNotice"),
  resultCount: $("#resultCount"),
  resultTitle: $("#resultTitle"),
  search: $("#ingredientSearch"),
  selected: $("#selectedIngredients"),
  suggestions: $("#suggestions"),
  time: $("#timeFilter"),
};

let deferredInstallPrompt;

function setConnectionNotice() {
  const offline = !navigator.onLine;
  elements.offlineNotice.hidden = !offline;
  elements.offlineNotice.textContent = offline ? "当前离线：已缓存的菜谱、筛选和收藏均可使用。" : "";
}

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  deferredInstallPrompt = event;
  elements.install.hidden = false;
});
elements.install.addEventListener("click", async () => {
  if (!deferredInstallPrompt) return;
  deferredInstallPrompt.prompt();
  await deferredInstallPrompt.userChoice;
  deferredInstallPrompt = undefined;
  elements.install.hidden = true;
});
window.addEventListener("online", setConnectionNotice);
window.addEventListener("offline", setConnectionNotice);

const normalize = (value) => value.trim().toLowerCase().replace(/\s+/g, "");
const ingredientTerms = (ingredient) => [
  ingredient.name,
  ingredient.canonicalName,
  ...(ingredient.aliases || []),
].map(normalize);

function allIngredients() {
  const names = new Set();
  state.recipes.forEach((recipe) => recipe.ingredients.forEach((item) => {
    names.add(item.canonicalName);
    (item.aliases || []).forEach((name) => names.add(name));
  }));
  return [...names].sort((a, b) => a.localeCompare(b, "zh-CN"));
}

function ingredientMatches(ingredient, selected) {
  const target = normalize(selected);
  return ingredientTerms(ingredient).some((term) => term.includes(target) || target.includes(term));
}

function addIngredient(value = elements.search.value) {
  const clean = value.trim();
  if (clean && !state.selected.some((item) => normalize(item) === normalize(clean))) {
    state.selected.push(clean);
  }
  elements.search.value = "";
  elements.suggestions.hidden = true;
  render();
}

function scoreRecipe(recipe) {
  const required = recipe.ingredients.filter((item) => item.required && item.role !== "调味料");
  const matched = state.selected.filter((selected) =>
    recipe.ingredients.some((ingredient) => ingredientMatches(ingredient, selected)),
  );
  const missing = required.filter((ingredient) =>
    !state.selected.some((selected) => ingredientMatches(ingredient, selected)),
  );
  return { matched, missing, score: state.selected.length ? matched.length / state.selected.length : 0 };
}

function filteredRecipes() {
  const excluded = elements.exclude.value.split(/[、,，\s]+/).map(normalize).filter(Boolean);
  return state.recipes
    .filter((recipe) => !state.onlyFavorites || state.favorites.has(recipe.id))
    .filter((recipe) => !elements.time.value || recipe.tags.estimatedMinutes <= Number(elements.time.value))
    .filter((recipe) => !elements.difficulty.value || recipe.tags.difficulty === elements.difficulty.value)
    .filter((recipe) => !excluded.some((term) => recipe.ingredients.some((item) => ingredientTerms(item).some((name) => name.includes(term)))))
    .map((recipe) => ({ recipe, ...scoreRecipe(recipe) }))
    .filter((entry) => !state.selected.length || entry.matched.length > 0)
    .sort((a, b) => b.score - a.score || a.missing.length - b.missing.length);
}

function recipeCard(entry) {
  const { recipe, matched, missing } = entry;
  const favorite = state.favorites.has(recipe.id);
  const matchText = state.selected.length
    ? `匹配 ${matched.length}/${state.selected.length} 个所选食材`
    : `${recipe.ingredients.filter((item) => item.required).length} 种主要用料`;
  const missingText = state.selected.length && missing.length
    ? `<div class="match missing">还需：${missing.slice(0, 4).map((item) => item.canonicalName).join("、")}</div>`
    : "";
  return `
    <article class="recipe-card">
      <div class="card-top">
        <div>
          <p class="eyebrow">${recipe.tags.meal[0]}</p>
          <h3>${recipe.title}</h3>
        </div>
      </div>
      <p>${recipe.summary}</p>
      <div class="meta">
        <span>${recipe.tags.estimatedMinutes}分钟</span>
        <span>${recipe.tags.difficulty}</span>
        <span>${recipe.tags.flavor.join(" · ")}</span>
      </div>
      <div class="match">${matchText}</div>
      ${missingText}
      <div class="card-actions">
        <button class="primary" data-open="${recipe.id}">查看做法</button>
        <button class="favorite ${favorite ? "active" : ""}" data-favorite="${recipe.id}" aria-label="收藏${recipe.title}">${favorite ? "已收藏" : "收藏"}</button>
      </div>
    </article>`;
}

function renderDetail(recipe) {
  const qualityLabel = recipe.quality.status === "human_verified" ? "已人工校正" : "已结构化 · 待抽查";
  const ingredientRows = recipe.ingredients.map((item) => `
    <li>
      <span>${item.name}${item.required ? "" : "（可选）"}</span>
      <strong>${item.quantity ?? ""}${item.unit || ""}</strong>
      ${item.prep ? `<small>${item.prep}</small>` : ""}
      ${item.alternatives?.length ? `<small>可替代：${item.alternatives.join("、")}</small>` : ""}
    </li>`).join("");
  const steps = recipe.steps.map((step) => `
    <li>
      ${step.action}
      <div class="step-meta">
        ${step.heat ? `<span>火候：${step.heat}</span>` : ""}
        ${step.durationMinutes ? `<span>约${step.durationMinutes}分钟</span>` : ""}
        ${step.cue ? `<span>状态：${step.cue}</span>` : ""}
      </div>
      ${step.tips?.length ? `<p><strong>注意：</strong>${step.tips.join("；")}</p>` : ""}
    </li>`).join("");
  elements.detail.innerHTML = `
    <article class="detail">
      <div class="detail-header">
        <div><p class="eyebrow">${recipe.source.creator} · ${qualityLabel}</p><h2>${recipe.title}</h2></div>
        <button class="close" data-close aria-label="关闭">×</button>
      </div>
      <p class="detail-summary">${recipe.summary}</p>
      <div class="meta"><span>${recipe.tags.estimatedMinutes}分钟</span><span>${recipe.tags.difficulty}</span><span>${recipe.tags.methods.join(" · ")}</span></div>
      <h3>准备食材</h3>
      <ul class="ingredient-list">${ingredientRows}</ul>
      <h3>开始做</h3>
      <ol class="steps">${steps}</ol>
      <h3>视频未明确</h3>
      <div class="unknowns">${recipe.unknowns.map((item) => `<div>· ${item}</div>`).join("")}</div>
      <p><a class="source-link" href="${recipe.source.url}" target="_blank" rel="noreferrer">查看原始视频</a></p>
    </article>`;
  elements.dialog.showModal();
}

function persistFavorites() {
  localStorage.setItem("recipe-favorites", JSON.stringify([...state.favorites]));
}

function render() {
  elements.selected.innerHTML = state.selected.map((item, index) => `<button class="chip" data-remove="${index}">${item}</button>`).join("");
  const entries = filteredRecipes();
  elements.grid.innerHTML = entries.map(recipeCard).join("");
  elements.empty.hidden = entries.length > 0;
  elements.resultCount.textContent = `${entries.length} 道`;
  elements.resultTitle.textContent = state.onlyFavorites ? "我的收藏" : state.selected.length ? "适合现有食材" : "全部菜谱";
  elements.favoriteCount.textContent = state.favorites.size;
}

elements.add.addEventListener("click", () => addIngredient());
elements.search.addEventListener("keydown", (event) => {
  if (event.key === "Enter") addIngredient();
});
elements.search.addEventListener("input", () => {
  const query = normalize(elements.search.value);
  const matches = query ? allIngredients().filter((name) => normalize(name).includes(query)).slice(0, 6) : [];
  elements.suggestions.innerHTML = matches.map((name) => `<button data-suggest="${name}">${name}</button>`).join("");
  elements.suggestions.hidden = matches.length === 0;
});
elements.suggestions.addEventListener("click", (event) => {
  const target = event.target.closest("[data-suggest]");
  if (target) addIngredient(target.dataset.suggest);
});
elements.selected.addEventListener("click", (event) => {
  const target = event.target.closest("[data-remove]");
  if (target) { state.selected.splice(Number(target.dataset.remove), 1); render(); }
});
[elements.time, elements.difficulty, elements.exclude].forEach((element) => element.addEventListener("input", render));
elements.favoritesButton.addEventListener("click", () => { state.onlyFavorites = !state.onlyFavorites; render(); });
elements.grid.addEventListener("click", (event) => {
  const open = event.target.closest("[data-open]");
  const favorite = event.target.closest("[data-favorite]");
  if (open) renderDetail(state.recipes.find((recipe) => recipe.id === open.dataset.open));
  if (favorite) {
    state.favorites.has(favorite.dataset.favorite) ? state.favorites.delete(favorite.dataset.favorite) : state.favorites.add(favorite.dataset.favorite);
    persistFavorites();
    render();
  }
});
elements.dialog.addEventListener("click", (event) => {
  if (event.target.closest("[data-close]") || event.target === elements.dialog) elements.dialog.close();
});

const payload = await fetch("./data/recipes.json").then((response) => response.json());
state.recipes = payload.recipes;
setConnectionNotice();
render();

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("./service-worker.js").catch(() => {
    // The local development server is intentionally usable even where service
    // workers are unavailable (for example a non-HTTPS LAN address).
  }));
}
