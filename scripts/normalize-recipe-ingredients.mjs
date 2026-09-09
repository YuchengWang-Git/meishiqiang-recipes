import { readFileSync, writeFileSync } from "node:fs";
import { canonicalIngredientName, ingredientTerms, mergeNormalizedIngredients } from "../shared/ingredient-taxonomy.mjs";

const files = ["recipes.json", "recipes-howtocook.json", "recipes-howtocook-batch.json", "recipes-howtocook-imported.json", "recipes-cunlv.json"];
let changedRecipes = 0;
let removedOrMerged = 0;

for (const name of files) {
  const file = new URL(`../data/${name}`, import.meta.url);
  const library = JSON.parse(readFileSync(file, "utf8"));
  for (const recipe of library.recipes) {
    const before = JSON.stringify(recipe.ingredients || []);
    const previousCount = (recipe.ingredients || []).length;
    const normalized = mergeNormalizedIngredients(recipe.ingredients || []);
    recipe.ingredients = normalized;
    if (recipe.quality?.requiredIngredients) {
      const available = new Set(normalized.flatMap(ingredientTerms).map(canonicalIngredientName));
      // `requiredIngredients` is derived metadata.  Keep it aligned with the
      // material list so an old extraction hint cannot claim an absent item is
      // a required ingredient (for example an optional oil mentioned in a step).
      recipe.quality.requiredIngredients = [...new Set(recipe.quality.requiredIngredients
        .map(canonicalIngredientName)
        .filter((name) => name && available.has(name)))];
    }
    if (before !== JSON.stringify(normalized)) changedRecipes += 1;
    removedOrMerged += Math.max(0, previousCount - normalized.length);
  }
  writeFileSync(file, `${JSON.stringify(library, null, 2)}\n`, "utf8");
}

console.log(`食材规范化完成：更新 ${changedRecipes} 道菜谱，合并或移除 ${removedOrMerged} 个重复/工具项。`);
