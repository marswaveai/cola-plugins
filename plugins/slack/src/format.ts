/**
 * Convert standard Markdown to Slack mrkdwn.
 *
 * mrkdwn differences from Markdown: bold is `*text*`, italic `_text_`,
 * strikethrough `~text~`, links `<url|label>`, and there is no heading
 * syntax (headings become bold lines). `&`, `<`, `>` are control characters
 * and must be escaped in regular text.
 */
export function formatSlackMrkdwn(markdown: string): string {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const output: string[] = [];
  let codeFence: string[] | null = null;

  for (const line of lines) {
    if (line.match(/^```/)) {
      if (codeFence) {
        output.push("```\n" + escapeMrkdwn(codeFence.join("\n")) + "\n```");
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
    output.push("```\n" + escapeMrkdwn(codeFence.join("\n")) + "\n```");
  }

  return output.join("\n");
}

function formatMarkdownLine(line: string): string {
  const heading = line.match(/^(#{1,6})\s+(.+)$/);
  if (heading) return `*${formatInlineMarkdown(heading[2])}*`;

  const task = line.match(/^(\s*)[-*]\s+\[([ xX])\]\s+(.+)$/);
  if (task) {
    const marker = task[2].toLowerCase() === "x" ? "☑" : "☐";
    return `${task[1]}${marker} ${formatInlineMarkdown(task[3])}`;
  }

  const bullet = line.match(/^(\s*)[-*]\s+(.+)$/);
  if (bullet) return `${bullet[1]}• ${formatInlineMarkdown(bullet[2])}`;

  const quote = line.match(/^>\s?(.*)$/);
  if (quote) return `> ${formatInlineMarkdown(quote[1])}`;

  return formatInlineMarkdown(line);
}

function formatInlineMarkdown(text: string): string {
  let out = "";
  let index = 0;

  while (index < text.length) {
    const code = consumeDelimited(text, index, "`", "`");
    if (code) {
      out += `\`${escapeMrkdwn(code.content)}\``;
      index = code.nextIndex;
      continue;
    }

    const link = consumeMarkdownLink(text, index);
    if (link) {
      out += `<${escapeMrkdwn(link.url)}|${escapeMrkdwn(link.label)}>`;
      index = link.nextIndex;
      continue;
    }

    const boldItalic = consumeDelimited(text, index, "***", "***");
    if (boldItalic) {
      out += `*_${formatInlineMarkdown(boldItalic.content)}_*`;
      index = boldItalic.nextIndex;
      continue;
    }

    const bold = consumeDelimited(text, index, "**", "**");
    if (bold) {
      out += `*${formatInlineMarkdown(bold.content)}*`;
      index = bold.nextIndex;
      continue;
    }

    const strikethrough = consumeDelimited(text, index, "~~", "~~");
    if (strikethrough) {
      out += `~${formatInlineMarkdown(strikethrough.content)}~`;
      index = strikethrough.nextIndex;
      continue;
    }

    const italic = consumeDelimited(text, index, "*", "*");
    if (italic) {
      out += `_${formatInlineMarkdown(italic.content)}_`;
      index = italic.nextIndex;
      continue;
    }

    out += escapeMrkdwn(text[index]);
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
  if (contentEnd === -1 || contentEnd === contentStart) return null;
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
  let urlEnd = urlStart;
  let depth = 0;
  let destination = "";
  for (; urlEnd < text.length; urlEnd++) {
    const character = text[urlEnd];
    // Escaped parentheses are URL characters, not Markdown delimiters. An
    // escaped backslash must be consumed too so it cannot escape the next ')'.
    if (character === "\\" && /[\\()]/.test(text[urlEnd + 1] ?? "")) {
      destination += text[++urlEnd];
      continue;
    }
    if (character === "(") depth++;
    else if (character === ")") {
      if (depth === 0) break;
      depth--;
    }
    destination += character;
  }
  if (urlEnd === text.length) return null;

  const url = destination.trim();
  if (!isSafeSlackLink(url)) return null;

  return {
    label: text.slice(index + 1, labelEnd),
    url,
    nextIndex: urlEnd + 1,
  };
}

function isSafeSlackLink(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function escapeMrkdwn(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}
