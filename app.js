import { canonicalIngredientName, ingredientTerms as taxonomyTerms } from "./shared/ingredient-taxonomy.mjs";

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
  add: $("#addIngredient"), difficulty: $("#difficultyFilter"), quality: $("#qualityFilter"), dialog: $("#recipeDialog"),
  detail: $("#recipeDetail"), empty: $("#emptyState"), exclude: $("#excludeSearch"),
  favoriteCount: $("#favoriteCount"), favoritesButton: $("#favoritesButton"), grid: $("#recipeGrid"),
  install: $("#installButton"), offlineNotice: $("#offlineNotice"), resultCount: $("#resultCount"),
  resultTitle: $("#resultTitle"), recipeSearch: $("#recipeSearch"), search: $("#ingredientSearch"), selected: $("#selectedIngredients"),
  shoppingButton: $("#shoppingButton"), shoppingCount: $("#shoppingCount"), shoppingDialog: $("#shoppingDialog"),
  shoppingDetail: $("#shoppingDetail"), source: $("#sourceFilter"), suggestions: $("#suggestions"),
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
const selectionName = (value) => {
  const cleaned = String(value || "").trim()
    .replace(/[（(][^）)]*[）)]/g, "")
    .replace(/[=＝].*$/g, "")
    .replace(/[\/／].*$/g, "")
    .replace(/(?:或|、).*/g, "")
    .replace(/(?:的)?(?:用量|量)\s*(?:为)?\s*.*$/g, "")
    .replace(/\s*(?:约|大约)\s*$/g, "")
    .replace(/\s*[\d.]+\s*(?:克|g|毫升|ml|个|只|枚|颗|根|把|片|块|条|瓣|勺|匙|斤)?\s*$/iu, "")
    .replace(/^[\d一二三四五六七八九十半两]+(?:[./、-]\d+)?\s*(?:个|只|枚|颗|根|把|片|块|条|瓣|勺|匙|克|g|毫升|ml|斤)?\s*/iu, "")
    .trim();
  if (normalize(cleaned).includes("鸡蛋")) return "鸡蛋";
  const canonical = canonicalIngredientName(cleaned) || cleaned;
  const produce = ["西红柿", "番茄", "茄子", "土豆", "青椒", "辣椒", "豆腐"]
    .find((name) => canonical.endsWith(name));
  // 原始菜谱常把“长的上小下大的茄子”或品种描述当作材料名；搜索池只保留可买到的通用食材名。
  if (produce && canonical !== produce) return produce;
  return canonical;
};
const ingredientFamilies = [
  ["甲鱼", /甲鱼/], ["鳜鱼", /鳜鱼|桂鱼/], ["鲫鱼", /鲫鱼/], ["鲈鱼", /鲈鱼/], ["鱼", /鱼/],
  ["虾", /虾/], ["蟹", /蟹/], ["猪肉", /猪|五花|前腿|梅头/], ["牛肉", /牛/], ["羊肉", /羊/], ["鸡肉", /鸡(?!蛋)/], ["鸭肉", /鸭/],
];
const genericAnimalTerms = new Set(["肉", "肉片", "肉丝", "肉末", "鱼", "鱼片"]);
function ingredientFamily(value) {
  const term = normalize(selectionName(value));
  return ingredientFamilies.find(([, pattern]) => pattern.test(term))?.[0] || null;
}
const pantryIngredientTerms = new Set([
  "水", "清水", "开水", "热水", "温水", "冷水", "冰水",
  "油", "食用油", "植物油", "花生油", "菜籽油", "猪油", "香油",
  "盐", "食盐", "海盐", "糖", "白糖", "冰糖", "砂糖",
  "酱油", "生抽", "老抽", "醋", "米醋", "陈醋", "香醋", "料酒", "淀粉", "玉米淀粉", "红薯淀粉", "土豆淀粉", "生粉",
  "葱", "小葱", "大葱", "大葱叶", "葱花", "姜", "生姜", "姜片", "蒜", "大蒜", "蒜末", "蒜瓣", "香菜",
  "干辣椒", "辣椒", "花椒", "八角", "桂皮", "香叶", "鸡精", "味精", "白胡椒粉", "胡椒粉", "辣椒面", "辣椒粉", "小米辣", "美人椒",
  "洋葱", "小洋葱", "红葱头", "黄豆酱", "蚝油", "豆瓣酱", "大酱",
].map(normalize));
const sourceTag = (recipe) => recipe.source?.label || (() => {
  const platform = recipe.source?.platform === "bilibili" ? "B站" : recipe.source?.platform || "来源";
  return `@${platform}${recipe.source?.creator || ""}`;
})();
const sourceGroup = (recipe) => ({ "村驴": "cunlv", "美食强": "meishiqiang", "HowToCook": "howtocook", "采蘑菇的小姑娘ヽ": "mogu" }[recipe.source?.creator] || "other");
const qualityInfo = (recipe) => {
  const status = recipe.quality?.status;
  if (["reference_verified", "human_verified"].includes(status)) return { rank: 3, label: "已核对", className: "" };
  if (status === "needs_user_spot_check") return { rank: 2, label: "已整理待抽查", className: "review" };
  if (status === "source_structured") return { rank: 2, label: "结构化来源", className: "review" };
  if (status === "creator_attributed") return { rank: 2, label: "来源整理", className: "review" };
  return { rank: 1, label: "待补全", className: "transcript" };
};
const madeCount = (recipe) => Number(state.madeCounts[recipe.id] || 0);
const isVisibleRecipe = (recipe) => !["excluded_from_recommendations", "needs_rebuild"].includes(recipe.quality?.status);
const ingredientTerms = (ingredient) => taxonomyTerms(ingredient).map(normalize);
function ingredientMatchTerms(ingredient) {
  const raw = ingredient.name || ingredient.canonicalName || "";
  return genericAnimalTerms.has(normalize(raw)) ? [raw, ...(ingredient.aliases || [])].map(normalize) : ingredientTerms(ingredient);
}
const isDefaultPantryIngredient = (ingredient) => {
  const rawTerms = typeof ingredient === "string" ? [ingredient] : [ingredient.name, ingredient.canonicalName, ...(ingredient.aliases || [])];
  return rawTerms.some((term) => {
    const clean = normalize(selectionName(term));
    return pantryIngredientTerms.has(clean) || /^(?:(?:热|熟|炸用|炒菜用|炒馅用|普通|食用|植物|菜籽|花生|大豆|玉米|猪|香|芝麻|麻)?油)$/.test(clean);
  });
};
const ingredientLabel = (ingredient) => selectionName(ingredient.canonicalName || ingredient.name) || ingredient.name;
const isUsableIngredientCandidate = (name) => Boolean(name) && !/(?:等.*(?:类|等)|配菜|调味包|蘸料|碗汁|用量|数量|份数|(?:的)?数$|每个|一个人|适量|^装成品)/.test(name);
const recipeServings = (recipe) => state.servings[recipe.id] || recipe.servings || 1;
const formatNumber = (value) => Number.isInteger(value) ? String(value) : value.toFixed(1).replace(/\.0$/, "");
const scaledQuantity = (recipe, ingredient) => {
  if (typeof ingredient.quantity !== "number") return `${ingredient.quantity ?? ""}${ingredient.unit || ""}`;
  return `${formatNumber(ingredient.quantity * recipeServings(recipe) / (recipe.servings || 1))}${ingredient.unit || ""}`;
};
const estimatedTime = (recipe) => Number.isFinite(recipe.tags.estimatedMinutes) ? `${recipe.tags.estimatedMinutes}分钟` : "用时见步骤";

function allIngredients() {
  const names = new Set();
  state.recipes.forEach((recipe) => recipe.ingredients.forEach((item) => {
    const name = selectionName(item.canonicalName || item.name);
    if (!isDefaultPantryIngredient(item) && isUsableIngredientCandidate(name)) names.add(name);
  }));
  return [...names].sort((a, b) => a.localeCompare(b, "zh-CN"));
}
function ingredientMatches(ingredient, selected) {
  const selectedFamily = ingredientFamily(selected);
  const terms = ingredientMatchTerms(ingredient);
  if (selectedFamily) return terms.some((term) => {
    const family = ingredientFamily(term);
    if (family === selectedFamily) return true;
    // “鱼”是上位类，允许找各类可食用鱼；但“甲鱼”等具体品种绝不能退化成泛“鱼”匹配。
    return selectedFamily === "鱼" && ["鳜鱼", "鲫鱼", "鲈鱼"].includes(family);
  });
  const target = normalize(selected);
  return terms.some((term) => term === target || term.includes(target));
}
function addIngredient(value = elements.search.value) {
  const clean = selectionName(value);
  if (clean && isUsableIngredientCandidate(clean) && !isDefaultPantryIngredient(clean) && !state.selected.some((item) => normalize(item) === normalize(clean))) state.selected.push(clean);
  elements.search.value = ""; elements.suggestions.hidden = true; render();
}
function scoreRecipe(recipe) {
  // 关键食材包含非默认库存的必备主料、配料和特殊调味；不能只凭第一种主料就判定能做。
  const required = recipe.ingredients.filter((item) => item.required && !isDefaultPantryIngredient(item));
  const mainIngredients = required;
  // 水、油、盐等默认库存既不出现在候选池，也不能反向把“猪油”算作“猪肉”已具备。
  const matched = state.selected.filter((selected) => recipe.ingredients.some((ingredient) => !isDefaultPantryIngredient(ingredient) && ingredientMatches(ingredient, selected)));
  const missing = required.filter((ingredient) => !state.selected.some((selected) => ingredientMatches(ingredient, selected)));
  const missingMain = mainIngredients.filter((ingredient) => !state.selected.some((selected) => ingredientMatches(ingredient, selected)));
  const matchedMain = mainIngredients.length - missingMain.length;
  return {
    matched,
    missing,
    missingMain,
    mainComplete: mainIngredients.length > 0 && missingMain.length === 0,
    mainCoverage: mainIngredients.length ? matchedMain / mainIngredients.length : 0,
    score: state.selected.length ? matched.length / state.selected.length : 0,
  };
}
function filteredRecipes() {
  const excluded = elements.exclude.value.split(/[、，\s]+/).map(normalize).filter(Boolean);
  const titleQuery = normalize(elements.recipeSearch.value);
  return state.recipes.filter(isVisibleRecipe)
    .filter((recipe) => !state.onlyFavorites || state.favorites.has(recipe.id))
    .filter((recipe) => !titleQuery || [recipe.title, ...(recipe.aliases || [])].some((item) => normalize(item).includes(titleQuery)))
    .filter((recipe) => !elements.source.value || sourceGroup(recipe) === elements.source.value)
    .filter((recipe) => !elements.difficulty.value || recipe.tags.difficulty === elements.difficulty.value)
    .filter((recipe) => !elements.quality.value || qualityInfo(recipe).rank >= (elements.quality.value === "verified" ? 3 : 2))
    .filter((recipe) => !excluded.some((term) => recipe.ingredients.some((item) => ingredientTerms(item).some((name) => name.includes(term)))))
    .map((recipe) => ({ recipe, quality: qualityInfo(recipe), ...scoreRecipe(recipe) }))
    // 已有食材是库存，不是必须同时用光的筛选条件；至少命中一项即可，再按覆盖度排序。
    .filter((entry) => !state.selected.length || entry.matched.length > 0)
    .sort((a, b) => Number(b.mainComplete) - Number(a.mainComplete)
      || b.matched.length - a.matched.length
      || a.missingMain.length - b.missingMain.length
      || b.mainCoverage - a.mainCoverage
      || b.score - a.score
      || b.quality.rank - a.quality.rank
      || a.missing.length - b.missing.length);
}
function recipeCard(entry) {
  const { recipe, matched, missing } = entry;
  const quality = qualityInfo(recipe);
  const favorite = state.favorites.has(recipe.id); const made = madeCount(recipe);
  const mainIngredientCount = recipe.ingredients.filter((item) => item.required && !isDefaultPantryIngredient(item)).length;
  const matchText = state.selected.length ? `匹配 ${matched.length}/${state.selected.length} 个所选食材` : `${mainIngredientCount} 种关键食材`;
  const missingText = state.selected.length && missing.length ? `<div class="match missing">还需：${missing.slice(0, 4).map(ingredientLabel).join("、")}</div>` : "";
  return `<article class="recipe-card"><div class="card-top"><div><p class="eyebrow">${recipe.tags.meal[0]} <span class="source-tag">${sourceTag(recipe)}</span><span class="quality-tag ${quality.className}">${quality.label}</span></p><h3>${recipe.title}</h3></div></div><p>${recipe.summary}</p><div class="meta"><span>${estimatedTime(recipe)}</span><span>${recipe.tags.difficulty}</span><span>${recipe.tags.flavor.join(" · ")}</span></div><div class="match">${matchText}</div>${missingText}${made ? `<div class="made-count">已做 ${made} 次</div>` : ""}<div class="card-actions"><button class="primary" data-open="${recipe.id}">查看做法</button><button class="favorite ${favorite ? "active" : ""}" data-favorite="${recipe.id}" aria-label="收藏${recipe.title}">${favorite ? "已收藏" : "收藏"}</button></div></article>`;
}
function ingredientRows(recipe) {
  return recipe.ingredients.map((item) => `<li><span>${ingredientLabel(item)}${item.required ? "" : "（可选）"}</span><strong>${scaledQuantity(recipe, item)}</strong>${item.prep ? `<small>${item.prep}</small>` : ""}${item.alternatives?.length ? `<small>可替代：${item.alternatives.join("、")}</small>` : ""}</li>`).join("");
}
function renderDetail(recipe) {
  clearInterval(timerId);
  const made = madeCount(recipe); const servings = recipeServings(recipe);
  const steps = recipe.steps.map((step) => `<li>${step.action}<div class="step-meta">${step.heat ? `<span>火候：${step.heat}</span>` : ""}${step.durationMinutes ? `<span>约${step.durationMinutes}分钟</span>` : ""}${step.cue ? `<span>状态：${step.cue}</span>` : ""}</div>${step.tips?.length ? `<p><strong>注意：</strong>${step.tips.join("；")}</p>` : ""}</li>`).join("");
  const notes = recipe.notes || recipe.unknowns || [];
  const quality = qualityInfo(recipe);
  const originalSource = recipe.source.originalCreator ? `<p><span>原视频作者：</span>${recipe.source.originalCreatorUrl ? `<a class="source-link" href="${recipe.source.originalCreatorUrl}" target="_blank" rel="noreferrer">${recipe.source.originalCreator}</a>` : recipe.source.originalCreator}</p>` : "";
  elements.detail.innerHTML = `<article class="detail"><div class="detail-header"><div><p class="eyebrow"><span class="source-tag">${sourceTag(recipe)}</span><span class="quality-tag ${quality.className}">${quality.label}</span></p><h2>${recipe.title}</h2></div><button class="close" data-close aria-label="关闭">×</button></div><p class="detail-summary">${recipe.summary}</p><div class="meta"><span>${estimatedTime(recipe)}</span><span>${recipe.tags.difficulty}</span><span>${recipe.tags.methods.join(" · ")}</span></div><div class="made-row"><button class="made-button" data-made="${recipe.id}">我做过一次</button><span>累计 ${made} 次</span></div>${recipe.servings ? `<div class="serving-row"><span>按 <strong>${servings}</strong> 人份准备</span><button data-serving="-1" data-recipe="${recipe.id}" ${servings <= 1 ? "disabled" : ""}>−</button><button data-serving="1" data-recipe="${recipe.id}">＋</button></div>` : ""}<div class="detail-actions"><button class="primary" data-cook="${recipe.id}">进入做菜模式</button><button class="secondary" data-add-shopping="${recipe.id}">补齐缺少食材</button></div><h3>准备食材</h3><ul class="ingredient-list">${ingredientRows(recipe)}</ul><h3>完整步骤</h3><ol class="steps">${steps}</ol>${notes.length ? `<h3>提示与边界</h3><div class="unknowns">${notes.map((item) => `<div>· ${item}</div>`).join("")}</div>` : ""}<p><span>图文整理：</span><a class="source-link" href="${recipe.source.url}" target="_blank" rel="noreferrer">${recipe.source.creator}</a></p>${originalSource}</article>`;
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
  recipe.ingredients.filter((item) => item.required && !isDefaultPantryIngredient(item) && !state.selected.some((selected) => ingredientMatches(item, selected))).forEach((item) => state.shoppingList.add(ingredientLabel(item)));
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
  elements.resultCount.textContent = `${entries.length} 道`; elements.resultTitle.textContent = state.onlyFavorites ? "我的收藏" : elements.recipeSearch.value.trim() ? "菜名搜索结果" : state.selected.length ? "适合现有食材" : "全部菜谱";
  elements.favoriteCount.textContent = state.favorites.size; elements.shoppingCount.textContent = state.shoppingList.size;
}
elements.add.addEventListener("click", () => addIngredient());
elements.search.addEventListener("keydown", (event) => { if (event.key === "Enter") addIngredient(); });
elements.search.addEventListener("input", () => { const query = normalize(elements.search.value); const matches = query ? allIngredients().filter((name) => normalize(name).includes(query)).sort((a, b) => Number(normalize(b) === query) - Number(normalize(a) === query) || Number(normalize(b).startsWith(query)) - Number(normalize(a).startsWith(query)) || a.localeCompare(b, "zh-CN")).slice(0, 6) : []; elements.suggestions.innerHTML = matches.map((name) => `<button data-suggest="${name}">${name}</button>`).join(""); elements.suggestions.hidden = matches.length === 0; });
elements.suggestions.addEventListener("click", (event) => { const target = event.target.closest("[data-suggest]"); if (target) addIngredient(target.dataset.suggest); });
elements.selected.addEventListener("click", (event) => { const target = event.target.closest("[data-remove]"); if (target) { state.selected.splice(Number(target.dataset.remove), 1); render(); } });
[elements.recipeSearch, elements.source, elements.difficulty, elements.quality, elements.exclude].forEach((element) => element.addEventListener("input", render));
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

const payloads = await Promise.all(["./data/recipes.json", "./data/recipes-howtocook.json", "./data/recipes-howtocook-batch.json", "./data/recipes-howtocook-imported.json", "./data/recipes-cunlv.json", "./data/recipes-mogu.json"].map((url) => fetch(url).then((response) => response.json())));
state.recipes = payloads.flatMap((payload) => payload.recipes);
setConnectionNotice(); render();
if ("serviceWorker" in navigator) window.addEventListener("load", () => navigator.serviceWorker.register("./service-worker.js").catch(() => {}));
