export type TelegramFormattedText = {
  text: string;
  parseMode: "HTML";
};

export function formatTelegramMarkdown(markdown: string): TelegramFormattedText {
  return {
    text: markdownToTelegramHtml(markdown),
    parseMode: "HTML",
  };
}

function markdownToTelegramHtml(markdown: string): string {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const output: string[] = [];
  let codeFence: string[] | null = null;

  for (const line of lines) {
    const fence = line.match(/^```/);
    if (fence) {
      if (codeFence) {
        output.push(`<pre><code>${escapeHtml(codeFence.join("\n"))}</code></pre>`);
        codeFence = null;
      } else {
        codeFence = [];
      }
      continue;
    }

    if (codeFence) {
      codeFence.push(line);
      continue;
    }

    output.push(formatMarkdownLine(line));
  }

  if (codeFence) {
    output.push(`<pre><code>${escapeHtml(codeFence.join("\n"))}</code></pre>`);
  }

  return output.join("\n");
}

function formatMarkdownLine(line: string): string {
  const heading = line.match(/^(#{1,6})\s+(.+)$/);
  if (heading) return `<b>${formatInlineMarkdown(heading[2])}</b>`;

  const task = line.match(/^(\s*)[-*]\s+\[([ xX])\]\s+(.+)$/);
  if (task) {
    const marker = task[2].toLowerCase() === "x" ? "☑" : "☐";
    return `${escapeHtml(task[1])}${marker} ${formatInlineMarkdown(task[3])}`;
  }

  const bullet = line.match(/^(\s*)[-*]\s+(.+)$/);
  if (bullet) return `${escapeHtml(bullet[1])}• ${formatInlineMarkdown(bullet[2])}`;

  return formatInlineMarkdown(line);
}

function formatInlineMarkdown(text: string): string {
  let out = "";
  let index = 0;

  while (index < text.length) {
    const code = consumeDelimited(text, index, "`", "`");
    if (code) {
      out += `<code>${escapeHtml(code.content)}</code>`;
      index = code.nextIndex;
      continue;
    }

    const link = consumeMarkdownLink(text, index);
    if (link) {
      out += `<a href="${escapeAttribute(link.url)}">${escapeHtml(link.label)}</a>`;
      index = link.nextIndex;
      continue;
    }

    const bold = consumeDelimited(text, index, "**", "**");
    if (bold) {
      out += `<b>${formatInlineMarkdown(bold.content)}</b>`;
      index = bold.nextIndex;
      continue;
    }

    const strikethrough = consumeDelimited(text, index, "~~", "~~");
    if (strikethrough) {
      out += `<s>${formatInlineMarkdown(strikethrough.content)}</s>`;
      index = strikethrough.nextIndex;
      continue;
    }

    const italic = consumeDelimited(text, index, "*", "*");
    if (italic) {
      out += `<i>${formatInlineMarkdown(italic.content)}</i>`;
      index = italic.nextIndex;
      continue;
    }

    out += escapeHtml(text[index]);
    index += 1;
  }

  return out;
}

function consumeDelimited(
  text: string,
  index: number,
  open: string,
  close: string,
): { content: string; nextIndex: number } | null {
  if (!text.startsWith(open, index)) return null;
  const contentStart = index + open.length;
  const contentEnd = text.indexOf(close, contentStart);
  if (contentEnd === -1) return null;
  return {
    content: text.slice(contentStart, contentEnd),
    nextIndex: contentEnd + close.length,
  };
}

function consumeMarkdownLink(
  text: string,
  index: number,
): { label: string; url: string; nextIndex: number } | null {
  if (text[index] !== "[") return null;
  const labelEnd = text.indexOf("](", index + 1);
  if (labelEnd === -1) return null;
  const urlStart = labelEnd + 2;
  const urlEnd = text.indexOf(")", urlStart);
  if (urlEnd === -1) return null;

  const url = text.slice(urlStart, urlEnd).trim();
  if (!isSafeTelegramLink(url)) return null;

  return {
    label: text.slice(index + 1, labelEnd),
    url,
    nextIndex: urlEnd + 1,
  };
}

function isSafeTelegramLink(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:" || parsed.protocol === "tg:";
  } catch {
    return false;
  }
}

function escapeHtml(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function escapeAttribute(text: string): string {
  return escapeHtml(text).replaceAll('"', "&quot;");
}
