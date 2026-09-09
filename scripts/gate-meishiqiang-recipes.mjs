import { readFileSync, writeFileSync } from "node:fs";
import { admissionFailures, normalizedTitle } from "./meishiqiang-admission-rules.mjs";

const file = new URL("../data/recipes.json", import.meta.url);
const library = JSON.parse(readFileSync(file, "utf8"));
const recipes = library.recipes.filter((recipe) => recipe.source?.creator === "美食强");
const titleCounts = new Map();
for (const recipe of recipes) {
  const key = normalizedTitle(recipe);
  titleCounts.set(key, (titleCounts.get(key) || 0) + 1);
}

const quarantined = [];
for (const recipe of recipes) {
  const failures = admissionFailures(recipe, { duplicate: titleCounts.get(normalizedTitle(recipe)) > 1 });
  if (!failures.length) continue;
  recipe.quality = {
    ...recipe.quality,
    status: "needs_rebuild",
    reviewNote: `美食强准入未通过：${failures.join("；")}。保留原视频，待重建后重新准入。`,
  };
  quarantined.push(`${recipe.title}（${failures.join("；")}）`);
}

writeFileSync(file, `${JSON.stringify(library, null, 2)}\n`, "utf8");
console.log(`美食强准入检查完成：${recipes.length} 道中隔离 ${quarantined.length} 道。\n${quarantined.join("\n")}`);
