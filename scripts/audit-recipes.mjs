import { readFileSync } from "node:fs";

const data = JSON.parse(readFileSync(new URL("../data/recipes.json", import.meta.url), "utf8"));
const hiddenStatuses = new Set(["excluded_from_recommendations", "needs_rebuild"]);
const errors = [];
const titles = new Set();

function terms(ingredient) {
  return [ingredient.name, ingredient.canonicalName, ...(ingredient.aliases || [])]
    .filter(Boolean)
    .map((item) => item.replace(/\s/g, ""));
}

for (const recipe of data.recipes) {
  const label = `${recipe.id}（${recipe.title}）`;
  if (!recipe.id || titles.has(recipe.id)) errors.push(`${label}: 菜谱 ID 缺失或重复`);
  titles.add(recipe.id);
  if (!hiddenStatuses.has(recipe.quality?.status) && recipe.title.length > 12) {
    errors.push(`${label}: 展示菜名超过 12 个字`);
  }
  if (!recipe.source?.creator || !recipe.source?.platform || !recipe.source?.url) {
    errors.push(`${label}: 来源信息不完整`);
  }
  if (!Array.isArray(recipe.ingredients) || !recipe.ingredients.length) {
    errors.push(`${label}: 没有材料`);
  }
  const ingredientTerms = recipe.ingredients.flatMap(terms);
  for (const required of recipe.quality?.requiredIngredients || []) {
    if (!ingredientTerms.some((item) => item === required || item.includes(required) || required.includes(item))) {
      errors.push(`${label}: 关键食材“${required}”未列入材料`);
    }
  }
  const orders = recipe.steps.map((step) => step.order);
  if (orders.some((order, index) => order !== index + 1)) {
    errors.push(`${label}: 步骤序号必须从 1 连续递增`);
  }
}

if (errors.length) {
  console.error(`菜谱审计失败（${errors.length} 项）：\n- ${errors.join("\n- ")}`);
  process.exitCode = 1;
} else {
  const visible = data.recipes.filter((recipe) => !hiddenStatuses.has(recipe.quality?.status));
  console.log(`菜谱审计通过：${visible.length} 道可推荐菜谱，${data.recipes.length - visible.length} 道待重建或已下架。`);
}
