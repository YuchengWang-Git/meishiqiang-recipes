import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { resolve, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const sourceRoot = resolve(projectRoot, "..", "howtocook-full-reference", "dishes");
const outputPath = resolve(projectRoot, "data", "recipes-howtocook-imported.json");
const existingFiles = ["recipes.json", "recipes-howtocook.json", "recipes-howtocook-batch.json"];
const includedCategories = new Set(["aquatic", "breakfast", "dessert", "drink", "meat_dish", "soup", "staple", "vegetable_dish"]);
const categoryTags = {
  aquatic: ["主菜", "水产"], breakfast: ["早餐", "快手菜"], dessert: ["甜品"], drink: ["饮品"],
  meat_dish: ["主菜", "家常菜"], "semi-finished": ["快手菜", "半成品"], soup: ["汤", "家常菜"],
  staple: ["主食", "家常菜"], vegetable_dish: ["蔬菜", "家常菜"],
};
const toolPattern = /(锅|刀|铲|碗|盘|勺|烤箱|空气炸锅|电饭煲|微波炉|蒸箱|冰箱|保鲜膜|砧板|厨师机|打蛋器|榨汁机|搅拌机|漏勺|滤网|模具|锡纸|油纸|温度计|厨房秤|料理机|秒表|计时器)/;
const narrativePattern = /^(?:单人|多人|每份|淹过|没过|覆盖|水位|能支撑|根据|以能|请|一般一个人可以食用)/;
const lowValueTitles = new Set([
  "水煮玉米", "太阳蛋", "溏心蛋", "完美水煮蛋", "微波炉荷包蛋", "温泉蛋", "蒸水蛋",
  "煮泡面加蛋", "炒方便面", "电饭煲蒸米饭", "煮锅蒸米饭", "汤面", "柠檬水",
  "海边落日", "金菲士", "金汤力", "可乐桶", "长岛冰茶", "B52轰炸机", "Mojito莫吉托",
]);

function walk(directory) {
  return readdirSync(directory).flatMap((name) => {
    const entry = resolve(directory, name);
    return statSync(entry).isDirectory() ? walk(entry) : [entry];
  });
}

function cleanMarkdown(value) {
  return String(value || "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[*_`>#]/g, "")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function section(markdown, name) {
  const expression = new RegExp(`^##\\s+${name}\\s*$([\\s\\S]*?)(?=^##\\s+|\\Z)`, "m");
  return markdown.match(expression)?.[1] || "";
}

function listLines(markdown) {
  return markdown.split(/\r?\n/)
    .filter((line) => /^\s*[-*+]\s+/.test(line))
    .map((line) => cleanMarkdown(line.replace(/^\s*[-*+]\s+/, "")))
    .filter(Boolean);
}

function cleanIngredientName(value) {
  return cleanMarkdown(value)
    .replace(/[（(][^）)]*[）)]/g, "")
    .replace(/[（(].*$/, "")
    .replace(/^(?:约|适量的?)\s*/, "")
    .replace(/\s+(?:[一二两三四五六七八九十半]|\d+)(?:个|根|块|把|片|颗|只|袋|头|瓣|勺|杯|碗|瓶|罐|张|条|枚).*$/, "")
    .replace(/[：:，,。；;].*$/, "")
    .replace(/\s*(?:切|洗|泡|腌|挽|备用|少许|适量|若干).*$/, "")
    .trim();
}

function parseIngredient(line) {
  const text = cleanMarkdown(line).replace(/^(?:必备|可选|原料|调料|食材|配料|材料)[：:]\s*/, "");
  if (!text || toolPattern.test(text) || narrativePattern.test(text)) return null;
  const quantityMatch = text.match(/^(.+?)(?:\s+|[：:])([0-9]+(?:\.[0-9]+)?)(?:\s*(?:～|~|-|至)\s*[0-9]+(?:\.[0-9]+)?)?\s*(克|g|毫升|ml|颗|个|只|片|瓣|根|把|勺|大勺|小勺|杯|块|斤|公斤|千克|袋|条|张|枚|瓶|罐|碗|盘)?/i);
  const quantityFirst = text.match(/^([0-9]+(?:\.[0-9]+)?)\s*(克|g|毫升|ml|颗|个|只|片|瓣|根|把|勺|大勺|小勺|杯|块|斤|公斤|千克|袋|条|张|枚|瓶|罐|碗|盘)\s+(.+)/i);
  const name = cleanIngredientName(quantityFirst ? quantityFirst[3] : quantityMatch ? quantityMatch[1] : text);
  if (!name || name.length > 20 || toolPattern.test(name) || narrativePattern.test(name) || /^(?:必备|可选|原料|调料|食材|配料|材料)$/.test(name)) return null;
  return {
    name,
    canonicalName: name,
    aliases: [],
    quantity: quantityFirst ? Number(quantityFirst[1]) : quantityMatch ? Number(quantityMatch[2]) : null,
    unit: quantityFirst?.[2] || quantityMatch?.[3] || "适量",
    role: "原料",
    required: !/(?:可选|按需|可不|可略|随意)/.test(text),
  };
}

function parseIngredients(markdown) {
  const essentialRows = listLines(section(markdown, "必备原料和工具"));
  const calculationRows = listLines(section(markdown, "计算"));
  const merged = new Map();
  for (const row of essentialRows) {
    const ingredient = parseIngredient(row);
    if (!ingredient) continue;
    const previous = merged.get(ingredient.canonicalName);
    if (!previous || (previous.quantity === null && ingredient.quantity !== null)) merged.set(ingredient.canonicalName, ingredient);
  }
  for (const row of calculationRows) {
    const ingredient = parseIngredient(row);
    if (!ingredient) continue;
    const previous = merged.get(ingredient.canonicalName);
    if (!previous || ingredient.quantity !== null) merged.set(ingredient.canonicalName, ingredient);
  }
  return [...merged.values()];
}

function heatFrom(action) {
  if (/大火/.test(action)) return "大火";
  if (/中小火/.test(action)) return "中小火";
  if (/中火/.test(action)) return "中火";
  if (/小火/.test(action)) return "小火";
  if (/微波/.test(action)) return "微波";
  return null;
}

function parseSteps(markdown) {
  const lines = section(markdown, "操作").split(/\r?\n/);
  const steps = [];
  for (const line of lines) {
    const matched = line.match(/^\s*(\d+)[.、]\s+(.+)$/);
    if (!matched) continue;
    const action = cleanMarkdown(matched[2]);
    if (action.length < 4) continue;
    const time = action.match(/(\d+(?:\.\d+)?)\s*(分钟|min)/i);
    steps.push({
      order: steps.length + 1,
      action,
      heat: heatFrom(action),
      ...(time ? { durationMinutes: Number(time[1]) } : {}),
    });
  }
  return steps;
}

function methodsFrom(steps) {
  const text = steps.map((step) => step.action).join(" ");
  const methods = [["炒", "炒"], ["煎", "煎"], ["炸", "炸"], ["焖", "焖"], ["炖", "炖"], ["煮", "煮"], ["蒸", "蒸"], ["烤", "烤"], ["拌", "拌"], ["腌", "腌"], ["焯", "焯"], ["微波", "微波"]]
    .filter(([needle]) => text.includes(needle)).map(([, label]) => label);
  return methods.length ? methods.slice(0, 3) : ["制作"];
}

function difficultyFrom(markdown) {
  const stars = markdown.match(/预估烹饪难度：\s*(★+)/)?.[1].length || 3;
  if (stars >= 4) return "困难";
  if (stars >= 3) return "中等";
  return "简单";
}

function timeFrom(markdown, steps) {
  const explicit = markdown.match(/(?:约|需要|预计|全程)[^\n]{0,18}?(\d+)\s*分钟/);
  if (explicit) return Math.min(180, Math.max(5, Number(explicit[1])));
  return Math.min(120, Math.max(10, Math.ceil((steps.length * 4 + 8) / 5) * 5));
}

function recipeFrom(file, occupiedTitles) {
  const markdown = readFileSync(file, "utf8");
  const relativePath = relative(sourceRoot, file).split(sep).join("/");
  const [category] = relativePath.split("/");
  if (!includedCategories.has(category)) return null;
  const heading = markdown.match(/^#\s+(.+)$/m)?.[1];
  const title = cleanMarkdown(heading || relativePath.replace(/\.md$/, "")).replace(/的做法$/, "").replace(/[（(][^）)]*[）)]/g, "").trim();
  const ingredients = parseIngredients(markdown);
  const steps = parseSteps(markdown);
  if (!title || title.length > 12 || occupiedTitles.has(title) || ingredients.length < 2 || steps.length < 2) return null;
  const hash = createHash("sha1").update(relativePath).digest("hex").slice(0, 12);
  occupiedTitles.add(title);
  return {
    id: `howtocook-structured-${hash}`,
    title,
    aliases: [],
    summary: "根据 HowToCook 公开菜谱的原始流程整理。",
    source: { platform: "github", creator: "HowToCook", label: "@HowToCook", url: `https://github.com/Anduin2017/HowToCook/blob/master/dishes/${encodeURI(relativePath)}`, license: "Unlicense" },
    tags: { meal: categoryTags[category], flavor: [], methods: methodsFrom(steps), difficulty: difficultyFrom(markdown), estimatedMinutes: timeFrom(markdown, steps), spicyLevel: 0 },
    ingredients,
    steps,
    notes: ["源自 HowToCook 公开结构化菜谱；用量、工具和保存提示请以原文为准。"],
    quality: lowValueTitles.has(title)
      ? { status: "excluded_from_recommendations", requiredIngredients: ingredients.filter((item) => item.required).slice(0, 2).map((item) => item.canonicalName.replace(/\s/g, "")), ingredientConfidence: 0.8, quantityConfidence: 0.7, stepConfidence: 0.9, reviewNote: "不作为独立家常菜谱推荐：属于基础操作、速食组合或单一饮品。" }
      : { status: "source_structured", requiredIngredients: ingredients.filter((item) => item.required).slice(0, 2).map((item) => item.canonicalName.replace(/\s/g, "")), ingredientConfidence: 0.8, quantityConfidence: 0.7, stepConfidence: 0.9, reviewNote: "已按来源的原料、计算和操作章节结构化导入，尚未逐道人工复核。" },
  };
}

const existingTitles = new Set(existingFiles.flatMap((file) => JSON.parse(readFileSync(resolve(projectRoot, "data", file), "utf8")).recipes.map((recipe) => recipe.title)));
const recipes = walk(sourceRoot).filter((file) => file.endsWith(".md")).sort((a, b) => a.localeCompare(b, "zh-CN"))
  .map((file) => recipeFrom(file, existingTitles)).filter(Boolean);

writeFileSync(outputPath, `${JSON.stringify({ source: "HowToCook structured import", recipes }, null, 2)}\n`, "utf8");
console.log(`已导入 ${recipes.length} 道 HowToCook 结构化菜谱：${outputPath}`);
