import { readFileSync, writeFileSync } from "node:fs";
import { admissionFailures, normalizedTitle, reviewRoute } from "./meishiqiang-admission-rules.mjs";

const file = new URL("../data/recipes.json", import.meta.url);
const library = JSON.parse(readFileSync(file, "utf8"));
const recipes = library.recipes.filter((recipe) => recipe.source?.creator === "美食强");
const titleCounts = new Map();
for (const recipe of recipes) {
  const key = normalizedTitle(recipe);
  titleCounts.set(key, (titleCounts.get(key) || 0) + 1);
}

const quarantined = [];
const reviewQueue = [];
for (const recipe of recipes) {
  const failures = admissionFailures(recipe, { duplicate: titleCounts.get(normalizedTitle(recipe)) > 1 });
  if (!failures.length) continue;
  const route = reviewRoute(failures);
  recipe.quality = {
    ...recipe.quality,
    status: "needs_rebuild",
    admission: { severity: route.severity, label: route.label, failures, action: route.action },
    reviewNote: `美食强准入未通过：${failures.join("；")}。保留原视频，待重建后重新准入。`,
  };
  reviewQueue.push({ id: recipe.id, title: recipe.title, sourceUrl: recipe.source?.url, severity: route.severity, label: route.label, failures, action: route.action });
  quarantined.push(`${recipe.title}（${route.severity} · ${failures.join("；")}）`);
}

writeFileSync(file, `${JSON.stringify(library, null, 2)}\n`, "utf8");
const severityOrder = { A: 0, B: 1, C: 2 };
reviewQueue.sort((left, right) => severityOrder[left.severity] - severityOrder[right.severity] || left.title.localeCompare(right.title, "zh-CN"));
const queueFile = new URL("../data/meishiqiang-review-queue.json", import.meta.url);
writeFileSync(queueFile, `${JSON.stringify({ generatedAt: new Date().toISOString(), source: "美食强准入门禁", items: reviewQueue }, null, 2)}\n`, "utf8");
const counts = Object.fromEntries(["A", "B", "C"].map((severity) => [severity, reviewQueue.filter((item) => item.severity === severity).length]));
console.log(`美食强准入检查完成：${recipes.length} 道中隔离 ${quarantined.length} 道（A ${counts.A} / B ${counts.B} / C ${counts.C}）。\n${quarantined.join("\n")}`);
