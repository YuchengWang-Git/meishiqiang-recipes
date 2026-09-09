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
const markdown = [
  "# 美食强菜谱复核队列",
  "",
  `当前隔离 ${reviewQueue.length} 道：A 级 ${counts.A} 道、B 级 ${counts.B} 道、C 级 ${counts.C} 道。`,
  "",
  "- **A · 必须重建**：缺主料、菜名主体错配或操作不足，需依据原视频重建。",
  "- **B · 定点复核**：材料与步骤无法互相证实，需回看相关片段后修正。",
  "- **C · 快速校验**：仅有开场口播或同名版本待归并，可优先人工快速处理。",
  "",
].join("\n");
const renderedQueue = ["A", "B", "C"].map((severity) => {
  const items = reviewQueue.filter((item) => item.severity === severity);
  const rows = items.map((item) => `| ${item.title.replace(/\|/g, "\\|")} | ${item.failures.join("；").replace(/\|/g, "\\|")} | [原视频](${item.sourceUrl}) |`).join("\n");
  return `## ${severity} · ${items[0]?.label || ""}\n\n| 菜谱 | 隔离原因 | 来源 |\n| --- | --- | --- |\n${rows}`;
}).join("\n\n");
writeFileSync(new URL("../MEISHIQIANG_REVIEW_QUEUE.md", import.meta.url), `${markdown}${renderedQueue}\n`, "utf8");
console.log(`美食强准入检查完成：${recipes.length} 道中隔离 ${quarantined.length} 道（A ${counts.A} / B ${counts.B} / C ${counts.C}）。\n${quarantined.join("\n")}`);
