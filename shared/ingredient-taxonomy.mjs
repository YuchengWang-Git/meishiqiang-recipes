const aliasGroups = {
  "芹菜": ["香芹", "芹菜苗"],
  "蒜": ["大蒜", "蒜头"],
  "番茄": ["西红柿"],
};
const aliasToCanonical = new Map(Object.entries(aliasGroups).flatMap(([canonical, aliases]) => [canonical, ...aliases].map((alias) => [alias, canonical])));
// These used to be normalized too broadly.  If a prior run already replaced a
// concrete form with a pantry umbrella term, recover its display name from the
// stored alias while continuing to use the canonical name for matching.
const legacySpecificVariants = new Set(["盐", "糖", "淀粉", "葱", "姜", "胡椒粉"]);
const toolPattern = /(?:电磁炉|灶台|调理机|果汁机|搅拌机|空气炸锅|电饭煲|微波炉|烤箱|蒸箱|厨师机|打蛋器|厨房秤|温度计|秒表|计时器|手套|容器|玻璃杯|塑料杯|密封罐|砧板|漏勺|滤网|模具|锡纸|油纸|保鲜膜|筷子|锅铲|炒锅|汤锅|平底锅)/;
const normalize = (value) => String(value || "").trim().replace(/\s+/g, "");

export function isToolIngredient(value) {
  return toolPattern.test(normalize(value));
}

export function ingredientAlternatives(value) {
  const text = normalize(value)
    .replace(/[=＝].*$/, "")
    .replace(/[（(][^）)]*[）)]/g, "")
    .replace(/(?:大约|约)\s*$/g, "")
    .trim();
  return [...new Set(text.split(/\s*(?:\/|／|或)\s*/).map((item) => normalize(item)).filter(Boolean))];
}

export function canonicalIngredientName(value) {
  const first = ingredientAlternatives(value)[0] || "";
  return aliasToCanonical.get(first) || first;
}

export function normalizeIngredient(ingredient) {
  const rawName = ingredient.name || ingredient.canonicalName || "";
  const rawCanonicalName = ingredient.canonicalName || rawName;
  const alternatives = ingredientAlternatives(rawCanonicalName);
  const canonicalName = canonicalIngredientName(rawCanonicalName);
  const aliases = [...new Set([...(ingredient.aliases || []), ...alternatives.filter((item) => canonicalIngredientName(item) === canonicalName && item !== canonicalName)])];
  const alternativeNames = [...new Set([...(ingredient.alternatives || []), ...alternatives.map(canonicalIngredientName).filter((item) => item && item !== canonicalName)])];
  const displayName = legacySpecificVariants.has(canonicalName) && normalize(rawName) === canonicalName && aliases.length
    ? aliases[0]
    : canonicalName || rawName;
  return {
    ...ingredient,
    name: displayName,
    canonicalName: canonicalName || ingredient.canonicalName || ingredient.name,
    aliases,
    ...(alternativeNames.length ? { alternatives: alternativeNames } : {}),
  };
}

function ingredientPriority(ingredient) {
  return (typeof ingredient.quantity === "number" ? 4 : 0) + (ingredient.prep ? 2 : 0) + (ingredient.required ? 1 : 0);
}

export function mergeNormalizedIngredients(ingredients) {
  const merged = new Map();
  for (const source of ingredients) {
    if (isToolIngredient(source.name) || isToolIngredient(source.canonicalName)) continue;
    const ingredient = normalizeIngredient(source);
    if (!ingredient.canonicalName) continue;
    const previous = merged.get(ingredient.canonicalName);
    if (!previous) {
      merged.set(ingredient.canonicalName, ingredient);
      continue;
    }
    const preferred = ingredientPriority(ingredient) > ingredientPriority(previous) ? ingredient : previous;
    const secondary = preferred === ingredient ? previous : ingredient;
    merged.set(ingredient.canonicalName, {
      ...preferred,
      aliases: [...new Set([...(preferred.aliases || []), ...(secondary.aliases || [])])],
      alternatives: [...new Set([...(preferred.alternatives || []), ...(secondary.alternatives || [])])],
      required: Boolean(preferred.required || secondary.required),
    });
  }
  return [...merged.values()].map((ingredient) => {
    if (!ingredient.alternatives?.length) {
      const { alternatives, ...rest } = ingredient;
      return rest;
    }
    return ingredient;
  });
}

export function ingredientTerms(ingredient) {
  return [ingredient.name, ingredient.canonicalName, ...(ingredient.aliases || []), ...(ingredient.alternatives || [])]
    .filter(Boolean).map((item) => normalize(item));
}
