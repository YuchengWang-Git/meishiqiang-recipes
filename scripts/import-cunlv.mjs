import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const sourceFile = process.argv[2] || "../../cunlv-menu-reference/data/recipes.js";
const outputFile = new URL("../data/recipes-cunlv.json", import.meta.url);
const raw = readFileSync(sourceFile, "utf8");
const normalizationSource = readFileSync(resolve(dirname(sourceFile), "..", "norms.py"), "utf8");
const normalizationMap = new Map([...normalizationSource.matchAll(/'([^']+)':'([^']+)'/g)].map(([, from, to]) => [from, to]));
const marker = "window.RECIPES =";
const start = raw.indexOf(marker);
if (start < 0) throw new Error("未找到 window.RECIPES 数据声明");
const sourceRecipes = JSON.parse(raw.slice(start + marker.length).trim().replace(/;\s*$/, ""));

const methodRules = [["空气炸锅", /空气炸锅/], ["凉拌", /凉拌|凉菜|拌菜/], ["煎", /煎/], ["炒", /炒|小炒/], ["炸", /炸|复炸/], ["烤", /烤/], ["蒸", /蒸/], ["炖", /炖|煲/], ["焖", /焖/], ["煮", /煮/], ["卤", /卤/], ["腌", /腌/], ["拌", /拌/]];
const titlePrefixes = /^(超详细|保姆级|家庭版|简单版|自制|秘制|正宗|家常版)/;
const titleSuffixes = /(教程|做法|详细做法|家常做法|保姆级教程)$/;
const titleOverrides = new Map([
  ["东北大丰收（铁锅炖排骨贴饼子）", "东北大丰收"],
  ["家庭版手擀面配东北炸鸡蛋酱", "手擀面配鸡蛋酱"],
  ["白粽与肉粽（牛角粽与枕头粽）", "白粽与肉粽"],
  ["粉蒸蔬菜（茼蒿/土豆/胡萝卜）", "粉蒸蔬菜"],
]);
const mainIngredientWords = /鸡|鸭|鹅|猪|牛|羊|鱼|虾|蟹|贝|蛤|鱿|肉|排骨|肚|肠|耳|蹄|蛋|豆腐|茄子|土豆|白菜|包菜|黄瓜|莲藕|藕|番茄|西红柿|蘑菇|菌|面|粉|饭|饼|馍|粥|海带|粉丝/;
const seasoningWords = /油|盐|糖|酱|醋|料酒|黄酒|生抽|老抽|蚝油|胡椒|淀粉|香料|水|葱|姜|蒜|味精|鸡精|辣椒|小米辣|美人椒/;

function compactTitle(title) {
  if (titleOverrides.has(title)) return titleOverrides.get(title);
  const clean = String(title || "").replace(titlePrefixes, "").replace(titleSuffixes, "").replace(/\s+/g, "").trim();
  if (clean.length > 12) throw new Error(`菜名需要人工整理：${title}`);
  return clean;
}
function canonicalName(name) {
  const raw = String(name || "").replace(/\s+/g, "");
  const base = raw.replace(/[（(].*?[）)]/g, "").replace(/（.*$/g, "").replace(/^(新鲜|普通|细|干|鲜|泡好|带皮|去皮|食用)/, "").replace(/(用|适量|少许)$/g, "");
  return normalizationMap.get(raw) || normalizationMap.get(base) || [...base.split(/或|\/|、/)].map((item) => normalizationMap.get(item.trim())).find(Boolean) || base || raw || "食材";
}
function mealTags(recipe) {
  const tags = recipe.tags || [];
  const title = recipe.dish_name || "";
  const text = [...tags, title].join(" ");
  if (/早餐/.test(text)) return ["早餐", "家常菜"];
  if (/凉拌|凉菜/.test(text)) return ["凉菜", "家常菜"];
  if (/汤|煲|粥/.test(title) || tags.some((tag) => /汤|煲|粥/.test(tag))) return ["汤", "家常菜"];
  if (/面|粉|饭|饼|馍|主食|饺|包子|馒头|油条|年糕|凉皮/.test(title)) return ["主食", "家常菜"];
  return ["主菜", "家常菜"];
}
function methods(recipe) {
  const text = [...(recipe.tags || []), ...(recipe.steps || []).flatMap((step) => [step.action, step.detail])].join(" ");
  const result = methodRules.filter(([, rule]) => rule.test(text)).map(([name]) => name);
  return result.length ? result.slice(0, 4) : ["家常做法"];
}
function difficulty(recipe, steps) {
  const text = steps.map((step) => `${step.action} ${step.cue || ""}`).join(" ");
  if (/(?:复炸|油温.{0,16}(?:150|180|190|200|210|冒泡)|(?:150|180|190|200|210)度.{0,16}油温|发酵|揉面|擀面|拉面|炒糖色|熬糖|打发|起酥|脱骨|去骨)/.test(text)) return "困难";
  return steps.length >= 7 || methods(recipe).length >= 3 ? "中等" : "简单";
}
function flavorTags(recipe) {
  const text = [...(recipe.tags || []), recipe.description || ""].join(" ");
  const flavors = [["酸辣", /酸辣/], ["香辣", /香辣|辣/], ["咸甜", /咸甜|蜜汁/], ["酸甜", /酸甜|糖醋/], ["鲜香", /鲜香|海鲜/], ["麻辣", /麻辣/]].filter(([, rule]) => rule.test(text)).map(([name]) => name);
  return flavors.length ? flavors : ["家常风味"];
}
function toIngredient(item, index) {
  const canonical = canonicalName(item.name);
  const optional = /可选|按喜好|点缀|不吃.*可|可不放/.test(item.note || "");
  const isMain = index === 0 || (!seasoningWords.test(canonical) && mainIngredientWords.test(canonical));
  return { name: item.name, canonicalName: canonical, aliases: canonical !== item.name ? [item.name] : [], quantity: null, unit: item.amount || "适量", role: isMain ? "主料" : seasoningWords.test(canonical) ? "调味料" : "辅料", required: !optional, ...(item.note ? { prep: item.note } : {}) };
}
function toRecipe(recipe) {
  const title = compactTitle(recipe.dish_name);
  const tags = recipe.tags || [];
  const steps = (recipe.steps || []).map((step, index) => ({ order: index + 1, action: step.detail || step.action, ...(step.action && step.detail ? { cue: step.action } : {}), ...(step.tip ? { tips: [step.tip] } : {}) }));
  return {
    id: `cunlv-${recipe.video_bvid}`,
    title,
    aliases: [...new Set([recipe.dish_name, ...tags].filter((item) => item && item !== title))],
    summary: recipe.description || `${title}的村驴视频文字整理。`,
    source: { platform: "bilibili", bvid: recipe.video_bvid, url: recipe.video_url, creator: "村驴", label: "@B站村驴", derivedFrom: "Ryder-MHumble/Cunlv-Skill（MIT）及 eleven71/cunlv-menu 整理数据", license: "原始教程版权归村驴所有；仅作非商业个人学习参考" },
    tags: { meal: mealTags(recipe), flavor: flavorTags(recipe), methods: methods(recipe), difficulty: difficulty(recipe, steps), estimatedMinutes: null, spicyLevel: /辣/.test(tags.join(" ")) ? 1 : 0 },
    ingredients: (recipe.ingredients || []).map(toIngredient),
    steps,
    notes: [...new Set(recipe.tips || [])],
    quality: { status: "creator_attributed", requiredIngredients: (recipe.ingredients || []).filter((item, index) => toIngredient(item, index).required).map((item) => canonicalName(item.name)), ingredientConfidence: 0.9, quantityConfidence: 0.9, stepConfidence: 0.9, reviewNote: "由村驴原视频的结构化文字整理导入，保留原视频链接；未逐条人工复核。" },
  };
}
const imported = sourceRecipes.filter((recipe) => recipe.is_recipe && !recipe.is_ad && recipe.video_bvid && recipe.video_url && recipe.ingredients?.length && recipe.steps?.length).map(toRecipe);
const library = { version: 1, updatedAt: new Date().toISOString(), source: "村驴视频教程的结构化整理数据；每条保留原视频链接与署名。", recipes: imported };
writeFileSync(outputFile, `${JSON.stringify(library, null, 2)}\n`, "utf8");
console.log(`已导入 ${imported.length} 道村驴菜谱至 ${outputFile.pathname}`);
