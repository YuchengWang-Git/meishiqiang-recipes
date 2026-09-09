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
const escapeCell = (value) => String(value || "").replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
const recipeById = new Map(recipes.map((recipe) => [recipe.id, recipe]));
const renderedQueue = ["A", "B", "C"].map((severity) => {
  const items = reviewQueue.filter((item) => item.severity === severity);
  const rows = items.map((item) => `| ${escapeCell(item.title)} | ${escapeCell(item.failures.join("；"))} | [原视频](${item.sourceUrl}) |`).join("\n");
  return `## ${severity} · ${items[0]?.label || ""}\n\n| 菜谱 | 隔离原因 | 来源 |\n| --- | --- | --- |\n${rows}`;
}).join("\n\n");
const formatQuantity = (ingredient) => ingredient.quantity === null || ingredient.quantity === undefined ? ingredient.unit || "适量" : `${ingredient.quantity}${ingredient.unit || ""}`;
const formatEvidence = (range) => {
  if (!Array.isArray(range) || range.length !== 2) return "";
  const clock = (seconds) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
  return `（字幕 ${clock(range[0])}–${clock(range[1])}）`;
};
const cReviewCards = reviewQueue.filter((item) => item.severity === "C").map((item) => {
  const recipe = recipeById.get(item.id);
  const ingredients = (recipe.ingredients || []).map((ingredient) => `- ${ingredient.canonicalName || ingredient.name}：${formatQuantity(ingredient)}${ingredient.prep ? `；${ingredient.prep}` : ""}`).join("\n") || "- 未提取到材料";
  const steps = (recipe.steps || []).map((step, index) => `${index + 1}. ${escapeCell(step.action)}${formatEvidence(step.evidenceRangeSeconds)}`).join("\n") || "1. 未提取到步骤";
  return `### ${escapeCell(recipe.title)} · ${recipe.id}\n\n**隔离原因：** ${escapeCell(item.failures.join("；"))}\n\n**快速处理建议：** ${item.action}\n\n[打开原视频](${item.sourceUrl})\n\n**当前材料表**\n\n${ingredients}\n\n**当前步骤（含字幕证据时间）**\n\n${steps}`;
}).join("\n\n");
writeFileSync(new URL("../MEISHIQIANG_REVIEW_QUEUE.md", import.meta.url), `${markdown}${renderedQueue}\n\n## C 级逐条人工复核卡\n\n以下内容是当前结构化结果，不是原视频的替代品；请对照右侧原视频链接核验。\n\n${cReviewCards}\n`, "utf8");
console.log(`美食强准入检查完成：${recipes.length} 道中隔离 ${quarantined.length} 道（A ${counts.A} / B ${counts.B} / C ${counts.C}）。\n${quarantined.join("\n")}`);
