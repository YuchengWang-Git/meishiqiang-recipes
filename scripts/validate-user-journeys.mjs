import { readFileSync } from "node:fs";
import { canonicalIngredientName, ingredientTerms, isToolIngredient } from "../shared/ingredient-taxonomy.mjs";

const files = ["recipes.json", "recipes-howtocook.json", "recipes-howtocook-batch.json", "recipes-howtocook-imported.json", "recipes-cunlv.json", "recipes-mogu.json"];
const hiddenStatuses = new Set(["excluded_from_recommendations", "needs_rebuild"]);
const recipes = files.flatMap((file) => JSON.parse(readFileSync(new URL(`../data/${file}`, import.meta.url), "utf8")).recipes);
const visible = recipes.filter((recipe) => !hiddenStatuses.has(recipe.quality?.status));
const normalize = (value) => String(value || "").trim().toLowerCase().replace(/\s+/g, "");
const genericAnimalTerms = new Set(["肉", "肉片", "肉丝", "肉末", "鱼", "鱼片"]);
const pantryTerms = new Set(["水", "清水", "开水", "热水", "温水", "冷水", "冰水", "油", "食用油", "植物油", "花生油", "菜籽油", "猪油", "香油", "盐", "食盐", "糖", "白糖", "酱油", "生抽", "老抽", "醋", "料酒", "淀粉"].map(normalize));
const families = [["甲鱼", /甲鱼/], ["鳜鱼", /鳜鱼|桂鱼/], ["鲫鱼", /鲫鱼/], ["鲈鱼", /鲈鱼/], ["鱼", /鱼/], ["虾", /虾/], ["蟹", /蟹/], ["猪肉", /猪|五花|前腿|梅头/], ["牛肉", /牛/], ["羊肉", /羊/], ["鸡肉", /鸡(?!蛋)/], ["鸭肉", /鸭/]];
const familyOf = (value) => families.find(([, pattern]) => pattern.test(normalize(value)))?.[0] || null;
const terms = (item) => ingredientTerms(item).map(normalize);
function matches(item, selected) {
  const selectedFamily = familyOf(selected);
  const itemTerms = genericAnimalTerms.has(normalize(item.name || item.canonicalName)) ? [item.name, ...(item.aliases || [])].map(normalize) : terms(item);
  if (selectedFamily) return itemTerms.some((term) => {
    const family = familyOf(term);
    return family === selectedFamily || (selectedFamily === "鱼" && ["鳜鱼", "鲫鱼", "鲈鱼"].includes(family));
  });
  const target = normalize(selected);
  return itemTerms.some((term) => term === target || term.includes(target));
}
function byIngredients(selected) {
  return visible.map((recipe) => ({ recipe, matched: selected.filter((needle) => recipe.ingredients.some((item) => !pantryTerms.has(normalize(item.canonicalName || item.name)) && matches(item, needle))) }))
    .filter((entry) => entry.matched.length > 0);
}
function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const candidateNames = [...new Set(visible.flatMap((recipe) => recipe.ingredients.map((item) => item.canonicalName || item.name)))];
const badCandidates = candidateNames.filter((name) => /(?:[=＝]|(?:的)?(?:数量|用量|份数|数)$|秒表|单人|淹过|没过|手套|容器|塑料杯|玻璃杯|密封罐)/.test(name));
assert(!badCandidates.length, `食材选择池仍有异常项：${badCandidates.join("、")}`);
assert(candidateNames.includes("茄子"), "食材选择池缺少“茄子”");
const moguRecipes = recipes.filter((recipe) => recipe.source?.creator === "采蘑菇的小姑娘ヽ");
assert(moguRecipes.length === 5, `首批图文整理菜谱数量异常：${moguRecipes.length}`);
assert(moguRecipes.every((recipe) => recipe.quality?.status === "needs_user_spot_check" && recipe.source?.originalCreator && recipe.source?.originalCreatorUrl), "首批图文整理菜谱缺少待抽查状态或双重来源归属");
const taxonomyProblems = visible.flatMap((recipe) => {
  const names = recipe.ingredients.map((item) => canonicalIngredientName(item.canonicalName || item.name));
  const duplicates = names.filter((name, index) => name && names.indexOf(name) !== index);
  const tools = recipe.ingredients.filter((item) => isToolIngredient(item.name) || isToolIngredient(item.canonicalName));
  return [...new Set(duplicates)].map((name) => `${recipe.title}（重复：${name}）`)
    .concat(tools.map((item) => `${recipe.title}（工具：${item.name || item.canonicalName}）`));
});
assert(!taxonomyProblems.length, `食材分类仍有重复或工具项：${taxonomyProblems.slice(0, 10).join("、")}`);

const porkHits = byIngredients(["猪肉"]);
const crossProtein = porkHits.filter(({ recipe }) => !recipe.ingredients.some((item) => !pantryTerms.has(normalize(item.canonicalName || item.name)) && familyOf(terms(item).join(" ")) === "猪肉"));
assert(!crossProtein.length, `“猪肉”仍通过泛“肉”或默认库存误匹配：${crossProtein.map(({ recipe }) => recipe.title).join("、")}`);

const turtleHits = byIngredients(["甲鱼"]);
assert(turtleHits.every(({ recipe }) => recipe.ingredients.some((item) => /甲鱼/.test(terms(item).join(" ")))), `“甲鱼”被泛“鱼”误匹配：${turtleHits.map(({ recipe }) => recipe.title).join("、")}`);

const selected = ["虾", "柠檬", "百香果"];
const combinationHits = byIngredients(selected);
const target = combinationHits.find(({ recipe }) => recipe.title === "百香果酸辣柠檬虾" && recipe.source?.creator === "村驴");
assert(target?.matched.length === 3, "三种食材齐备时没有找到“百香果酸辣柠檬虾”");
const celeryEggHits = byIngredients(["芹菜", "鸡蛋"]);
assert(celeryEggHits.length > 0, "库存有“芹菜、鸡蛋”时不应显示为空");
assert(celeryEggHits.some(({ recipe }) => recipe.title === "蒜蓉炒芹菜"), "库存菜谱未保留可用的单食材匹配结果");
const celeryRecipe = visible.find((recipe) => recipe.title === "蒜蓉炒芹菜");
assert(celeryRecipe?.ingredients.filter((item) => canonicalIngredientName(item.canonicalName || item.name) === "芹菜").length === 1, "“芹菜/香芹”仍被当作两种食材");

const titleHits = visible.filter((recipe) => [recipe.title, ...(recipe.aliases || [])].some((name) => normalize(name).includes("东北溜肉段")));
assert(titleHits.length > 0, "菜名搜索无法找到“东北溜肉段”");

const quarantined = ["蒜香鱼片", "酸菜鱼", "肉末茄子", "红烧甲鱼", "干烧鳜鱼", "椒盐大虾"];
const leaked = recipes.filter((recipe) => quarantined.includes(recipe.title) && recipe.source?.creator === "美食强" && !hiddenStatuses.has(recipe.quality?.status));
assert(!leaked.length, `关键食材缺失菜谱仍在推荐：${leaked.map((recipe) => recipe.title).join("、")}`);

console.log(`用户场景回归通过：${visible.length} 道可推荐菜谱；猪肉命中 ${porkHits.length} 道，甲鱼命中 ${turtleHits.length} 道，芹菜+鸡蛋命中 ${celeryEggHits.length} 道。`);
