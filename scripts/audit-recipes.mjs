import { readFileSync } from "node:fs";

const files = ["recipes.json", "recipes-howtocook.json", "recipes-howtocook-batch.json", "recipes-howtocook-imported.json"];
const libraries = files.map((file) => JSON.parse(readFileSync(new URL(`../data/${file}`, import.meta.url), "utf8")));
const recipes = libraries.flatMap((library) => library.recipes);
const hiddenStatuses = new Set(["excluded_from_recommendations", "needs_rebuild"]);
const qualityStatuses = new Set(["reference_verified", "human_verified", "needs_user_spot_check", "source_structured", "excluded_from_recommendations", "needs_rebuild"]);
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
