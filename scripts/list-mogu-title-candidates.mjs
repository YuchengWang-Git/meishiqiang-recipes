const curatorMid = "2343092";
const allowedAuthors = [
  { name: "小高姐的魔法调料", titlePattern: /小高姐/ },
  { name: "隋卞一做", titlePattern: /隋卞/ },
];

const endpoint = new URL("https://api.bilibili.com/x/polymer/web-dynamic/v1/opus/feed/space");
endpoint.searchParams.set("host_mid", curatorMid);
endpoint.searchParams.set("features", "itemOpusStyle");

let offset = "";
const seen = new Set();
const matches = [];

for (let page = 1; page <= 80; page += 1) {
  const url = new URL(endpoint);
  if (offset) url.searchParams.set("offset", offset);
  const response = await fetch(url, { headers: { "user-agent": "recipe-library-audit/1.0" } });
  if (!response.ok) throw new Error(`读取第 ${page} 页失败：HTTP ${response.status}`);
  const payload = await response.json();
  if (payload.code !== 0) throw new Error(`读取第 ${page} 页失败：${payload.message || payload.code}`);

  const items = payload.data?.items || [];
  for (const item of items) {
    const title = String(item.content || "").replace(/\s+/g, " ").trim();
    const author = allowedAuthors.find((candidate) => candidate.titlePattern.test(title));
    if (!author || seen.has(item.opus_id)) continue;
    seen.add(item.opus_id);
    matches.push({ author: author.name, opusId: item.opus_id, title, url: `https://www.bilibili.com/opus/${item.opus_id}` });
  }

  offset = payload.data?.offset || "";
  if (!payload.data?.has_more || !offset || !items.length) break;
}

const grouped = new Map();
for (const match of matches) {
  const rows = grouped.get(match.author) || [];
  rows.push(match);
  grouped.set(match.author, rows);
}
for (const author of allowedAuthors.map(({ name }) => name)) {
  const rows = grouped.get(author) || [];
  console.log(`\n${author}：${rows.length} 条明确标题候选`);
  for (const row of rows) console.log(`${row.opusId}\t${row.title}\t${row.url}`);
}
