import { readFileSync, writeFileSync } from "node:fs";

const file = new URL("../data/recipes.json", import.meta.url);
const library = JSON.parse(readFileSync(file, "utf8"));
const checks = [
  ["甲鱼", /甲鱼/, /甲鱼/], ["鳜鱼", /鳜鱼/, /鳜/], ["鲫鱼", /鲫鱼/, /鲫/], ["鲈鱼", /鲈鱼/, /鲈/],
  ["虾", /虾/, /虾/], ["蟹", /蟹/, /蟹/], ["羊", /羊/, /羊/], ["牛", /牛/, /牛/], ["猪", /猪/, /猪/], ["鸭", /鸭/, /鸭/],
  ["鸡", /鸡(?!蛋)/, /鸡/], ["鱼", /鱼(?!香)/, /鱼/], ["茄子", /茄子/, /茄子/], ["柠檬", /柠檬/, /柠檬/],
];

function ingredientText(recipe) {
  return recipe.ingredients.flatMap((item) => [item.name, item.canonicalName, ...(item.aliases || [])]).filter(Boolean).join(" ");
}

const quarantined = [];
for (const recipe of library.recipes) {
  if (recipe.source?.creator !== "美食强") continue;
  const text = ingredientText(recipe);
  const missing = checks.filter(([, titlePattern, ingredientPattern]) => titlePattern.test(recipe.title) && !ingredientPattern.test(text)).map(([name]) => name);
  if (!missing.length) continue;
  recipe.quality = {
    ...recipe.quality,
    status: "needs_rebuild",
    reviewNote: `自动质量门禁：菜名关键食材“${missing.join("、")}”未在材料中找到，已停止推荐，待依据原视频重建。`,
  };
  quarantined.push(`${recipe.title}（缺少：${missing.join("、")}）`);
}

writeFileSync(file, `${JSON.stringify(library, null, 2)}\n`, "utf8");
console.log(`已下架 ${quarantined.length} 道关键食材缺失的美食强菜谱：\n${quarantined.join("\n")}`);
