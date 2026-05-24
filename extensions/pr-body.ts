export interface ArtifactTexts {
  proposal?: string;
  spec?: string;
  specs?: Record<string, string>;
  design?: string;
  tasks?: string;
  proposalMd?: string;
  specMd?: string;
  tasksMd?: string;
  verdictReasoning?: string;
  linkedIssueNumber?: number;
}

export interface PrBodyInput { slug?: string; links?: { issueNumber?: number; branch?: string; baseBranch?: string; prUrl?: string }; artifacts: ArtifactTexts }

export interface BuiltBody { title: string; body: string }

function normalize(text: string | undefined): string {
  return (text ?? "").replace(/\r\n/g, "\n").trim();
}

function proposalOf(input: ArtifactTexts): string { return input.proposalMd ?? input.proposal ?? ""; }
function specOf(input: ArtifactTexts): string { return input.specMd ?? input.spec ?? ""; }
function tasksOf(input: ArtifactTexts): string { return input.tasksMd ?? input.tasks ?? ""; }
function placeholder(value: string, fallback = "<!-- vacío -->"): string { return normalize(value) || fallback; }

export function extractFirstParagraph(markdown: string | undefined): string {
  const text = normalize(markdown);
  if (text === "") return "";
  const withoutTitle = text.replace(/^#\s+.*(?:\n+|$)/, "");
  for (const block of withoutTitle.split(/\n{2,}/)) {
    const cleaned = block.trim();
    if (cleaned !== "" && !cleaned.startsWith("#")) return cleaned;
  }
  return "";
}

export function extractTitle(markdown: string | undefined, fallback = "run"): string {
  const text = normalize(markdown);
  const line = text.split("\n").map((l) => l.trim()).find((l) => l && !l.startsWith("#"));
  return (line || fallback).slice(0, 250);
}

export function extractSectionByHeading(markdown: string | undefined, heading: string): string {
  const text = normalize(markdown);
  if (text === "") return "";
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`^##\\s+${escaped}\\s*$`, "im");
  const match = re.exec(text);
  if (!match) return "";
  const start = match.index + match[0].length;
  const rest = text.slice(start);
  const next = /^##\s+/m.exec(rest);
  return rest.slice(0, next ? next.index : undefined).trim();
}

export function extractTasksTable(tasks: string | undefined): string {
  const text = normalize(tasks);
  if (text === "") return "";
  const taskMatches = [...text.matchAll(/^(?:##\s+\[[ xX]\]\s+|###\s+)(T\d+[^\n]*)/gm)];
  if (taskMatches.length === 0) return "";
  const rows = ["| Task | Files | Evidence |", "| --- | --- | --- |"];
  for (const match of taskMatches) {
    const title = match[1].trim();
    const start = match.index ?? 0;
    const next = text.slice(start + match[0].length).search(/^#{2,3}\s+/m);
    const block = next === -1 ? text.slice(start) : text.slice(start, start + match[0].length + next);
    if (!/^\s*-\s+files:\s*$/m.test(block)) continue;
    const files = [...block.matchAll(/^\s+-\s+`([^`]+)`/gm)].map((m) => m[1]);
    const evidence = (/^\s*-\s+evidence:\s*(.+)$/m.exec(block)?.[1] ?? "").trim();
    if (files.length === 0) continue;
    rows.push(`| ${title} | ${files.join("<br>")} | ${evidence || "—"} |`);
  }
  return rows.length > 2 ? rows.join("\n") : "";
}

export function extractAcceptanceCriteria(spec: string | undefined): string {
  const text = normalize(spec);
  if (text === "") return "";
  const out: string[] = [];
  const reqBlocks = text.split(/(?=^###\s+REQ:)/m).filter((b) => /^###\s+REQ:/m.test(b));
  const blocks = reqBlocks.length ? reqBlocks : [text];
  for (const block of blocks) {
    const match = /Acceptance criteria:\s*\n([\s\S]*?)(?=\n#{2,3}\s+|\n\S(?![^\n]*\n\s*-)|$)/i.exec(block);
    if (match?.[1]) {
      const bullets = match[1].split("\n").map((l) => l.trim()).filter((l) => /^[-*]\s+/.test(l));
      out.push(...bullets);
    }
  }
  return out.join("\n");
}

function issueSections(input: ArtifactTexts): string[] {
  const proposal = proposalOf(input);
  const spec = specOf(input);
  const sections: string[] = [];
  const contexto = extractFirstParagraph(proposal);
  if (contexto) sections.push("## Contexto", contexto);
  const alcance = extractSectionByHeading(proposal, "Alcance");
  if (alcance) sections.push("## Alcance", alcance);
  const criteria = extractAcceptanceCriteria(spec);
  if (criteria) sections.push("## Criterios de aceptación", criteria);
  return sections;
}

export function buildPrBody(inputOrWrapped: ArtifactTexts | PrBodyInput, linksArg: { issueNumber?: number; branch?: string; baseBranch?: string } = {}): BuiltBody {
  const wrapped = "artifacts" in inputOrWrapped ? inputOrWrapped as PrBodyInput : null;
  const input = wrapped?.artifacts ?? inputOrWrapped as ArtifactTexts;
  const links = { ...linksArg, ...(wrapped?.links ?? {}) };
  const issueNumber = input.linkedIssueNumber ?? links.issueNumber;
  const linkedIssue = issueNumber ? `Closes #${issueNumber}` : "Closes #\n<!-- Reemplazá # por el número de issue si existe. -->";
  const specText = input.specs ? Object.entries(input.specs).map(([domain, spec]) => `### ${domain}\n\n${spec}`).join("\n\n") : specOf(input);
  const body = [
    "## 🔗 Linked Issue",
    linkedIssue,
    "",
    "## SDD artifacts",
    `- Slug: ${wrapped?.slug ?? "n/a"}`,
    `- Branch: ${links.branch ?? "n/a"}`,
    `- Base branch: ${links.baseBranch ?? "n/a"}`,
    "- Artifacts: proposal.md, spec.md/specs/*/spec.md, design.md, tasks.md, veredicto.md",
    "",
    "## Requirements",
    placeholder(extractAcceptanceCriteria(specText)),
    "",
    "## 📝 Summary",
    placeholder(extractFirstParagraph(proposalOf(input))),
    "",
    "## 📂 Changes",
    placeholder(extractTasksTable(tasksOf(input))),
    "",
    "## 🧪 Test evidence",
    placeholder(input.verdictReasoning ?? ""),
    "",
    "## Risks",
    placeholder(extractSectionByHeading(proposalOf(input), "Riesgos") || extractSectionByHeading(input.design, "Riesgos")),
    "",
    "## Verdict",
    placeholder(input.verdictReasoning ?? "Sin veredicto registrado."),
    "",
    "## ✅ Checklist",
    "- [ ] Revisé el diff local",
    "- [ ] Corrí los tests relevantes",
    "- [ ] Actualicé artefactos SDD si correspondía",
  ].join("\n");
  return { title: extractTitle(proposalOf(input)), body };
}

export function buildIssueBody(input: ArtifactTexts): BuiltBody {
  const body = issueSections(input).join("\n\n");
  return { title: extractTitle(proposalOf(input)), body };
}
