const state = {
  recipes: [],
  selected: [],
  favorites: new Set(JSON.parse(localStorage.getItem("recipe-favorites") || "[]")),
  madeCounts: JSON.parse(localStorage.getItem("recipe-made-counts") || "{}"),
  shoppingList: new Set(JSON.parse(localStorage.getItem("recipe-shopping-list") || "[]")),
  servings: {},
  onlyFavorites: false,
};

const $ = (selector) => document.querySelector(selector);
const elements = {
  add: $("#addIngredient"), difficulty: $("#difficultyFilter"), dialog: $("#recipeDialog"),
  detail: $("#recipeDetail"), empty: $("#emptyState"), exclude: $("#excludeSearch"),
  favoriteCount: $("#favoriteCount"), favoritesButton: $("#favoritesButton"), grid: $("#recipeGrid"),
  install: $("#installButton"), offlineNotice: $("#offlineNotice"), resultCount: $("#resultCount"),
  resultTitle: $("#resultTitle"), search: $("#ingredientSearch"), selected: $("#selectedIngredients"),
  shoppingButton: $("#shoppingButton"), shoppingCount: $("#shoppingCount"), shoppingDialog: $("#shoppingDialog"),
  shoppingDetail: $("#shoppingDetail"), suggestions: $("#suggestions"), time: $("#timeFilter"),
};

let deferredInstallPrompt;
let timerId;

function setConnectionNotice() {
  elements.offlineNotice.hidden = navigator.onLine;
  elements.offlineNotice.textContent = navigator.onLine ? "" : "当前离线：已缓存的菜谱、筛选和收藏均可使用。";
}
window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault(); deferredInstallPrompt = event; elements.install.hidden = false;
});
elements.install.addEventListener("click", async () => {
  if (!deferredInstallPrompt) return;
  deferredInstallPrompt.prompt(); await deferredInstallPrompt.userChoice;
  deferredInstallPrompt = undefined; elements.install.hidden = true;
});
window.addEventListener("online", setConnectionNotice);
window.addEventListener("offline", setConnectionNotice);

const normalize = (value) => String(value || "").trim().toLowerCase().replace(/\s+/g, "");
const sourceTag = (recipe) => recipe.source?.label || (() => {
  const platform = recipe.source?.platform === "bilibili" ? "B站" : recipe.source?.platform || "来源";
  return `@${platform}${recipe.source?.creator || ""}`;
})();
const madeCount = (recipe) => Number(state.madeCounts[recipe.id] || 0);
const isVisibleRecipe = (recipe) => !["excluded_from_recommendations", "needs_rebuild"].includes(recipe.quality?.status);
const ingredientTerms = (ingredient) => [ingredient.name, ingredient.canonicalName, ...(ingredient.aliases || [])].map(normalize);
const recipeServings = (recipe) => state.servings[recipe.id] || recipe.servings || 1;
const formatNumber = (value) => Number.isInteger(value) ? String(value) : value.toFixed(1).replace(/\.0$/, "");
const scaledQuantity = (recipe, ingredient) => {
  if (typeof ingredient.quantity !== "number") return `${ingredient.quantity ?? ""}${ingredient.unit || ""}`;
  return `${formatNumber(ingredient.quantity * recipeServings(recipe) / (recipe.servings || 1))}${ingredient.unit || ""}`;
};

function allIngredients() {
  const names = new Set();
  state.recipes.forEach((recipe) => recipe.ingredients.forEach((item) => {
    names.add(item.canonicalName); (item.aliases || []).forEach((name) => names.add(name));
  }));
  return [...names].sort((a, b) => a.localeCompare(b, "zh-CN"));
}
function ingredientMatches(ingredient, selected) {
  const target = normalize(selected);
  return ingredientTerms(ingredient).some((term) => term.includes(target) || target.includes(term));
}
function addIngredient(value = elements.search.value) {
  const clean = value.trim();
  if (clean && !state.selected.some((item) => normalize(item) === normalize(clean))) state.selected.push(clean);
  elements.search.value = ""; elements.suggestions.hidden = true; render();
}
function scoreRecipe(recipe) {
  const required = recipe.ingredients.filter((item) => item.required && item.role !== "调味料");
  const matched = state.selected.filter((selected) => recipe.ingredients.some((ingredient) => ingredientMatches(ingredient, selected)));
  const missing = required.filter((ingredient) => !state.selected.some((selected) => ingredientMatches(ingredient, selected)));
  return { matched, missing, score: state.selected.length ? matched.length / state.selected.length : 0 };
}
function filteredRecipes() {
  const excluded = elements.exclude.value.split(/[、，\s]+/).map(normalize).filter(Boolean);
  return state.recipes.filter(isVisibleRecipe)
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
  const favorite = state.favorites.has(recipe.id); const made = madeCount(recipe);
  const matchText = state.selected.length ? `匹配 ${matched.length}/${state.selected.length} 个所选食材` : `${recipe.ingredients.filter((item) => item.required).length} 种主要用料`;
  const missingText = state.selected.length && missing.length ? `<div class="match missing">还需：${missing.slice(0, 4).map((item) => item.canonicalName).join("、")}</div>` : "";
  return `<article class="recipe-card"><div class="card-top"><div><p class="eyebrow">${recipe.tags.meal[0]} <span class="source-tag">${sourceTag(recipe)}</span></p><h3>${recipe.title}</h3></div></div><p>${recipe.summary}</p><div class="meta"><span>${recipe.tags.estimatedMinutes}分钟</span><span>${recipe.tags.difficulty}</span><span>${recipe.tags.flavor.join(" · ")}</span></div><div class="match">${matchText}</div>${missingText}${made ? `<div class="made-count">已做 ${made} 次</div>` : ""}<div class="card-actions"><button class="primary" data-open="${recipe.id}">查看做法</button><button class="favorite ${favorite ? "active" : ""}" data-favorite="${recipe.id}" aria-label="收藏${recipe.title}">${favorite ? "已收藏" : "收藏"}</button></div></article>`;
}
function ingredientRows(recipe) {
  return recipe.ingredients.map((item) => `<li><span>${item.name}${item.required ? "" : "（可选）"}</span><strong>${scaledQuantity(recipe, item)}</strong>${item.prep ? `<small>${item.prep}</small>` : ""}${item.alternatives?.length ? `<small>可替代：${item.alternatives.join("、")}</small>` : ""}</li>`).join("");
}
function renderDetail(recipe) {
  clearInterval(timerId);
  const made = madeCount(recipe); const servings = recipeServings(recipe);
  const steps = recipe.steps.map((step) => `<li>${step.action}<div class="step-meta">${step.heat ? `<span>火候：${step.heat}</span>` : ""}${step.durationMinutes ? `<span>约${step.durationMinutes}分钟</span>` : ""}${step.cue ? `<span>状态：${step.cue}</span>` : ""}</div>${step.tips?.length ? `<p><strong>注意：</strong>${step.tips.join("；")}</p>` : ""}</li>`).join("");
  const notes = recipe.notes || recipe.unknowns || [];
  elements.detail.innerHTML = `<article class="detail"><div class="detail-header"><div><p class="eyebrow"><span class="source-tag">${sourceTag(recipe)}</span> · 已结构化整理</p><h2>${recipe.title}</h2></div><button class="close" data-close aria-label="关闭">×</button></div><p class="detail-summary">${recipe.summary}</p><div class="meta"><span>${recipe.tags.estimatedMinutes}分钟</span><span>${recipe.tags.difficulty}</span><span>${recipe.tags.methods.join(" · ")}</span></div><div class="made-row"><button class="made-button" data-made="${recipe.id}">我做过一次</button><span>累计 ${made} 次</span></div>${recipe.servings ? `<div class="serving-row"><span>按 <strong>${servings}</strong> 人份准备</span><button data-serving="-1" data-recipe="${recipe.id}" ${servings <= 1 ? "disabled" : ""}>−</button><button data-serving="1" data-recipe="${recipe.id}">＋</button></div>` : ""}<div class="detail-actions"><button class="primary" data-cook="${recipe.id}">进入做菜模式</button><button class="secondary" data-add-shopping="${recipe.id}">补齐缺少食材</button></div><h3>准备食材</h3><ul class="ingredient-list">${ingredientRows(recipe)}</ul><h3>完整步骤</h3><ol class="steps">${steps}</ol>${notes.length ? `<h3>提示与边界</h3><div class="unknowns">${notes.map((item) => `<div>· ${item}</div>`).join("")}</div>` : ""}<p><a class="source-link" href="${recipe.source.url}" target="_blank" rel="noreferrer">查看原始来源</a></p></article>`;
  if (!elements.dialog.open) elements.dialog.showModal();
}
function renderCookMode(recipe, stepIndex = 0) {
  clearInterval(timerId);
  const step = recipe.steps[stepIndex];
  const timerButton = step.durationMinutes ? `<button class="secondary" data-timer="${step.durationMinutes * 60}">开始 ${step.durationMinutes} 分钟计时</button>` : "";
  elements.detail.innerHTML = `<article class="detail cook-mode"><div class="detail-header"><div><p class="eyebrow">做菜模式 · ${stepIndex + 1}/${recipe.steps.length}</p><h2>${recipe.title}</h2></div><button class="close" data-close aria-label="关闭">×</button></div><div class="cook-progress"><span style="width:${((stepIndex + 1) / recipe.steps.length) * 100}%"></span></div><p class="cook-step">${step.action}</p><div class="step-meta large">${step.heat ? `<span>火候：${step.heat}</span>` : ""}${step.durationMinutes ? `<span>预计：${step.durationMinutes}分钟</span>` : ""}${step.cue ? `<span>看到：${step.cue}</span>` : ""}</div>${step.tips?.length ? `<div class="cook-tip"><strong>提醒：</strong>${step.tips.join("；")}</div>` : ""}<p class="timer" id="cookTimer"></p><div class="detail-actions"><button class="secondary" data-cook-step="${stepIndex - 1}" data-cook-recipe="${recipe.id}" ${stepIndex === 0 ? "disabled" : ""}>上一步</button>${timerButton}<button class="primary" data-cook-step="${stepIndex + 1}" data-cook-recipe="${recipe.id}">${stepIndex === recipe.steps.length - 1 ? "完成这次烹饪" : "下一步"}</button></div><button class="text-button" data-detail="${recipe.id}">返回完整菜谱</button></article>`;
}
function startTimer(seconds) {
  clearInterval(timerId); const endsAt = Date.now() + seconds * 1000;
  const update = () => { const remaining = Math.max(0, Math.ceil((endsAt - Date.now()) / 1000)); const node = $("#cookTimer"); if (node) node.textContent = remaining ? `计时中：${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, "0")}` : "时间到，可根据状态继续判断。"; if (!remaining) clearInterval(timerId); };
  update(); timerId = setInterval(update, 250);
}
function persistFavorites() { localStorage.setItem("recipe-favorites", JSON.stringify([...state.favorites])); }
function persistMadeCounts() { localStorage.setItem("recipe-made-counts", JSON.stringify(state.madeCounts)); }
function persistShoppingList() { localStorage.setItem("recipe-shopping-list", JSON.stringify([...state.shoppingList])); }
function addMissingToShopping(recipe) {
  recipe.ingredients.filter((item) => item.required && !state.selected.some((selected) => ingredientMatches(item, selected))).forEach((item) => state.shoppingList.add(item.canonicalName || item.name));
  persistShoppingList(); render();
}
function renderShoppingList() {
  const items = [...state.shoppingList];
  elements.shoppingDetail.innerHTML = `<article class="detail shopping-detail"><div class="detail-header"><div><p class="eyebrow">本机保存</p><h2>采购清单</h2></div><button class="close" data-shopping-close aria-label="关闭">×</button></div>${items.length ? `<ul class="shopping-list">${items.map((item) => `<li><span>${item}</span><button class="text-button" data-shopping-remove="${item}">移除</button></li>`).join("")}</ul><button class="secondary" data-shopping-clear>清空清单</button>` : "<p class=\"detail-summary\">还没有待采购食材。打开一份菜谱后，点“补齐缺少食材”即可加入。</p>"}</article>`;
  if (!elements.shoppingDialog.open) elements.shoppingDialog.showModal();
}
function render() {
  elements.selected.innerHTML = state.selected.map((item, index) => `<button class="chip" data-remove="${index}">${item}</button>`).join("");
  const entries = filteredRecipes(); elements.grid.innerHTML = entries.map(recipeCard).join(""); elements.empty.hidden = entries.length > 0;
  elements.resultCount.textContent = `${entries.length} 道`; elements.resultTitle.textContent = state.onlyFavorites ? "我的收藏" : state.selected.length ? "适合现有食材" : "全部菜谱";
  elements.favoriteCount.textContent = state.favorites.size; elements.shoppingCount.textContent = state.shoppingList.size;
}
elements.add.addEventListener("click", () => addIngredient());
elements.search.addEventListener("keydown", (event) => { if (event.key === "Enter") addIngredient(); });
elements.search.addEventListener("input", () => { const query = normalize(elements.search.value); const matches = query ? allIngredients().filter((name) => normalize(name).includes(query)).slice(0, 6) : []; elements.suggestions.innerHTML = matches.map((name) => `<button data-suggest="${name}">${name}</button>`).join(""); elements.suggestions.hidden = matches.length === 0; });
elements.suggestions.addEventListener("click", (event) => { const target = event.target.closest("[data-suggest]"); if (target) addIngredient(target.dataset.suggest); });
elements.selected.addEventListener("click", (event) => { const target = event.target.closest("[data-remove]"); if (target) { state.selected.splice(Number(target.dataset.remove), 1); render(); } });
[elements.time, elements.difficulty, elements.exclude].forEach((element) => element.addEventListener("input", render));
elements.favoritesButton.addEventListener("click", () => { state.onlyFavorites = !state.onlyFavorites; render(); });
elements.shoppingButton.addEventListener("click", renderShoppingList);
elements.grid.addEventListener("click", (event) => { const open = event.target.closest("[data-open]"); const favorite = event.target.closest("[data-favorite]"); if (open) renderDetail(state.recipes.find((recipe) => recipe.id === open.dataset.open)); if (favorite) { state.favorites.has(favorite.dataset.favorite) ? state.favorites.delete(favorite.dataset.favorite) : state.favorites.add(favorite.dataset.favorite); persistFavorites(); render(); } });
elements.dialog.addEventListener("click", (event) => {
  const made = event.target.closest("[data-made]"); const serving = event.target.closest("[data-serving]"); const cook = event.target.closest("[data-cook]"); const cookStep = event.target.closest("[data-cook-step]"); const detail = event.target.closest("[data-detail]"); const addShopping = event.target.closest("[data-add-shopping]"); const timer = event.target.closest("[data-timer]");
  if (made) { const recipe = state.recipes.find((item) => item.id === made.dataset.made); state.madeCounts[recipe.id] = madeCount(recipe) + 1; persistMadeCounts(); renderDetail(recipe); render(); return; }
  if (serving) { const recipe = state.recipes.find((item) => item.id === serving.dataset.recipe); state.servings[recipe.id] = Math.max(1, recipeServings(recipe) + Number(serving.dataset.serving)); renderDetail(recipe); return; }
  if (cook) { renderCookMode(state.recipes.find((item) => item.id === cook.dataset.cook)); return; }
  if (cookStep) { const recipe = state.recipes.find((item) => item.id === cookStep.dataset.cookRecipe); const next = Number(cookStep.dataset.cookStep); if (next >= recipe.steps.length) { state.madeCounts[recipe.id] = madeCount(recipe) + 1; persistMadeCounts(); renderDetail(recipe); render(); } else renderCookMode(recipe, next); return; }
  if (detail) { renderDetail(state.recipes.find((item) => item.id === detail.dataset.detail)); return; }
  if (addShopping) { addMissingToShopping(state.recipes.find((item) => item.id === addShopping.dataset.addShopping)); return; }
  if (timer) { startTimer(Number(timer.dataset.timer)); return; }
  if (event.target.closest("[data-close]") || event.target === elements.dialog) { clearInterval(timerId); elements.dialog.close(); }
});
elements.shoppingDialog.addEventListener("click", (event) => { const remove = event.target.closest("[data-shopping-remove]"); if (remove) { state.shoppingList.delete(remove.dataset.shoppingRemove); persistShoppingList(); render(); renderShoppingList(); return; } if (event.target.closest("[data-shopping-clear]")) { state.shoppingList.clear(); persistShoppingList(); render(); renderShoppingList(); return; } if (event.target.closest("[data-shopping-close]") || event.target === elements.shoppingDialog) elements.shoppingDialog.close(); });

const payloads = await Promise.all(["./data/recipes.json", "./data/recipes-howtocook.json"].map((url) => fetch(url).then((response) => response.json())));
state.recipes = payloads.flatMap((payload) => payload.recipes);
setConnectionNotice(); render();
if ("serviceWorker" in navigator) window.addEventListener("load", () => navigator.serviceWorker.register("./service-worker.js").catch(() => {}));
