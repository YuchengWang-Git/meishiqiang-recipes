const normalize = (value) => String(value || "").replace(/\s+/g, "");
const pantryTerms = new Set([
  "水", "清水", "热水", "油", "食用油", "植物油", "菜籽油", "花生油", "猪油", "香油",
  "盐", "食盐", "糖", "白糖", "酱油", "生抽", "老抽", "醋", "料酒", "淀粉",
  "葱", "姜", "生姜", "蒜", "大蒜", "辣椒", "干辣椒", "花椒", "八角", "桂皮", "香叶", "鸡精", "味精",
].map(normalize));
const titleIngredientChecks = [
  ["大排", /大排/, /大排|通脊|梅花肉|猪排/], ["大骨", /大骨|棒骨|骨头/, /大骨|棒骨|骨头/], ["螺蛳", /螺蛳/, /螺蛳/],
  ["甲鱼", /甲鱼/, /甲鱼/], ["鳜鱼", /鳜鱼/, /鳜鱼|桂鱼/], ["鲫鱼", /鲫鱼/, /鲫鱼/], ["鲈鱼", /鲈鱼/, /鲈鱼/],
  ["虾", /虾/, /虾/], ["蟹", /蟹/, /蟹/], ["花甲", /花甲/, /花甲/], ["肥肠", /肥肠/, /肥肠/],
  ["羊", /羊/, /羊/], ["牛", /牛/, /牛/], ["猪", /猪/, /猪/], ["鸡", /鸡(?!蛋)/, /鸡/], ["鸭", /鸭/, /鸭/], ["鱼", /鱼(?!香)/, /鱼/],
  ["茄子", /茄子/, /茄子/], ["番茄", /番茄/, /番茄|西红柿/], ["豆腐", /豆腐/, /豆腐/],
];
const actionPattern = /(?:切|洗|焯|煮|炖|焖|炒|煎|炸|蒸|烤|拌|腌|泡|下入|加入|放入|倒入|加热|收汁|捞出|撇|调味|抓拌|翻炒|打入|搅拌)/;
const nonProcedurePattern = /(?:炖出来|烧出来|煮出来|口感|好吃|鲜嫩|软糯|色泽|按照我这样|这道菜|成品)/;

function ingredientTerms(ingredient) {
  return [ingredient.name, ingredient.canonicalName, ...(ingredient.aliases || [])].filter(Boolean).map(normalize);
}

export function normalizedTitle(recipe) {
  return normalize(recipe.title).replace(/[（）()【】\[\]·、，,。！？!?.\-—]/g, "");
}

export function admissionFailures(recipe, { duplicate = false } = {}) {
  if (recipe.source?.creator !== "美食强") return [];
  const ingredients = recipe.ingredients || [];
  const ingredientText = ingredients.flatMap(ingredientTerms).join(" ");
  const stepText = (recipe.steps || []).map((step) => step.action || "").join(" ");
  const failures = [];
  const mainIngredients = ingredients.filter((ingredient) => ingredient.role === "主料" && !ingredientTerms(ingredient).every((term) => pantryTerms.has(term)));

  if (!mainIngredients.length) failures.push("没有可识别的主料");
  const missingTitleIngredients = titleIngredientChecks
    .filter(([, titlePattern, ingredientPattern]) => titlePattern.test(recipe.title || "") && !ingredientPattern.test(ingredientText))
    .map(([name]) => name);
  if (missingTitleIngredients.length) failures.push(`菜名主体未列入材料：${missingTitleIngredients.join("、")}`);
  const unmentionedMain = mainIngredients.filter((ingredient) => !ingredientTerms(ingredient).some((term) => term.length > 1 && stepText.includes(term)));
  if (unmentionedMain.length) failures.push(`主料未在步骤中出现：${unmentionedMain.map((item) => item.canonicalName || item.name).join("、")}`);

  const steps = recipe.steps || [];
  const firstStep = steps[0]?.action || "";
  if (!firstStep || !actionPattern.test(firstStep) || nonProcedurePattern.test(firstStep)) failures.push("首步不是可执行操作");
  if (steps.filter((step) => actionPattern.test(step.action || "")).length < 2) failures.push("可执行烹饪操作不足两步");
  if (duplicate) failures.push("同一创作者存在同名版本，尚未完成版本归并");
  return failures;
}

export function reviewRoute(failures) {
  if (failures.some((failure) => /没有可识别的主料|菜名主体未列入材料|可执行烹饪操作不足/.test(failure))) {
    return { severity: "A", label: "必须重建", action: "依据原视频重新整理主料、配料和完整步骤后再提交。" };
  }
  if (failures.some((failure) => /主料未在步骤中出现/.test(failure))) {
    return { severity: "B", label: "定点复核", action: "回看主料出现的片段；补齐、修正或删除不被步骤证实的主料。" };
  }
  return { severity: "C", label: "快速校验", action: "确认原视频后删除口播开场，或选定同名菜的一个主版本并归并其余版本。" };
}
