import { readFileSync } from "node:fs";
import { admissionFailures, normalizedTitle } from "./meishiqiang-admission-rules.mjs";

const files = ["recipes.json", "recipes-howtocook.json", "recipes-howtocook-batch.json", "recipes-howtocook-imported.json", "recipes-cunlv.json"];
const libraries = files.map((file) => JSON.parse(readFileSync(new URL(`../data/${file}`, import.meta.url), "utf8")));
const recipes = libraries.flatMap((library) => library.recipes);
const meishiqiangTitleCounts = new Map();
for (const recipe of recipes.filter((recipe) => recipe.source?.creator === "美食强")) {
  const key = normalizedTitle(recipe);
  meishiqiangTitleCounts.set(key, (meishiqiangTitleCounts.get(key) || 0) + 1);
}
const hiddenStatuses = new Set(["excluded_from_recommendations", "needs_rebuild"]);
const qualityStatuses = new Set(["reference_verified", "human_verified", "needs_user_spot_check", "source_structured", "creator_attributed", "excluded_from_recommendations", "needs_rebuild"]);
const malformedHowToCookIngredient = /(?:[=＝]|(?:的)?(?:数量|用量|份数|数)$|秒表|单人|淹过|没过|一般一个人可以食用|手套|容器|塑料杯|玻璃杯|密封罐|刻度)/;
const titleIngredientChecks = [
  ["甲鱼", /甲鱼/, /甲鱼/], ["鳜鱼", /鳜鱼/, /鳜/], ["鲫鱼", /鲫鱼/, /鲫/], ["鲈鱼", /鲈鱼/, /鲈/],
  ["虾", /虾/, /虾/], ["蟹", /蟹/, /蟹/], ["羊", /羊/, /羊/], ["牛", /牛/, /牛/], ["猪", /猪/, /猪/], ["鸭", /鸭/, /鸭/],
  ["鸡", /鸡(?!蛋)/, /鸡/], ["鱼", /鱼(?!香)/, /鱼/], ["茄子", /茄子/, /茄子/], ["柠檬", /柠檬/, /柠檬/],
];
const errors = [];
const ids = new Set();

function terms(ingredient) {
  return [ingredient.name, ingredient.canonicalName, ...(ingredient.aliases || [])]
    .filter(Boolean)
    .map((item) => String(item).replace(/\s/g, ""));
}

for (const recipe of recipes) {
  const label = `${recipe.id || "缺少 ID"}（${recipe.title || "无标题"}）`;
  if (!recipe.id || ids.has(recipe.id)) errors.push(`${label}: 菜谱 ID 缺失或重复`);
  ids.add(recipe.id);
  if (!hiddenStatuses.has(recipe.quality?.status) && (!recipe.title || recipe.title.length > 12)) errors.push(`${label}: 展示菜名为空或超过 12 个字`);
  if (!recipe.source?.creator || !recipe.source?.platform || !recipe.source?.url) errors.push(`${label}: 来源信息不完整`);
  if (!recipe.quality?.status) errors.push(`${label}: 缺少质量分层状态`);
  if (recipe.quality?.status && !qualityStatuses.has(recipe.quality.status)) errors.push(`${label}: 使用了未定义的质量分层状态`);
  if (!Array.isArray(recipe.ingredients) || !recipe.ingredients.length) errors.push(`${label}: 没有材料`);
  if (!Array.isArray(recipe.steps) || !recipe.steps.length) errors.push(`${label}: 没有步骤`);

  const ingredientTerms = (recipe.ingredients || []).flatMap(terms);
  if (!hiddenStatuses.has(recipe.quality?.status) && recipe.source?.creator === "HowToCook" && (recipe.ingredients || []).some((item) => malformedHowToCookIngredient.test(item.name) || malformedHowToCookIngredient.test(item.canonicalName))) {
    errors.push(`${label}: HowToCook 解析出工具或说明文字，不能作为可推荐食材`);
  }
  if (!hiddenStatuses.has(recipe.quality?.status) && recipe.source?.creator === "美食强") {
    const text = ingredientTerms.join(" ");
    const missing = titleIngredientChecks.filter(([, titlePattern, ingredientPattern]) => titlePattern.test(recipe.title) && !ingredientPattern.test(text)).map(([name]) => name);
    if (missing.length) errors.push(`${label}: 菜名关键食材“${missing.join("、")}”未列入材料，必须先停止推荐`);
    const failures = admissionFailures(recipe, { duplicate: meishiqiangTitleCounts.get(normalizedTitle(recipe)) > 1 });
    if (failures.length) errors.push(`${label}: 未通过美食强准入标准：${failures.join("；")}`);
  }
  if (recipe.source?.creator === "美食强" && recipe.quality?.status === "needs_rebuild" && !(recipe.quality?.admission?.severity && recipe.quality?.admission?.failures?.length)) {
    errors.push(`${label}: 已隔离的美食强菜谱缺少准入分级与复核原因`);
  }
  for (const required of recipe.quality?.requiredIngredients || []) {
    if (!ingredientTerms.some((item) => item === required || item.includes(required) || required.includes(item))) errors.push(`${label}: 关键食材“${required}”未列入材料`);
  }
  if ((recipe.steps || []).some((step, index) => step.order !== index + 1)) errors.push(`${label}: 步骤序号必须从 1 连续递增`);

  if (recipe.quality?.status === "reference_verified") {
    if (!Number.isFinite(recipe.servings) || recipe.servings < 1) errors.push(`${label}: 可纳入的参考菜谱必须有有效份数`);
    if (!(recipe.notes || []).length) errors.push(`${label}: 可纳入的参考菜谱必须有提示或保存边界`);
    for (const ingredient of recipe.ingredients.filter((item) => item.required)) {
      if (typeof ingredient.quantity !== "number" || !ingredient.unit) errors.push(`${label}: 必备食材“${ingredient.name}”必须有精确用量和单位`);
    }
  }
}

if (errors.length) {
  console.error(`菜谱审计失败（${errors.length} 项）：\n- ${errors.join("\n- ")}`);
  process.exitCode = 1;
} else {
  const visible = recipes.filter((recipe) => !hiddenStatuses.has(recipe.quality?.status));
  const verified = recipes.filter((recipe) => recipe.quality?.status === "reference_verified");
  console.log(`菜谱审计通过：${visible.length} 道可推荐菜谱，其中 ${verified.length} 道为已核对外部参考菜谱。`);
}
