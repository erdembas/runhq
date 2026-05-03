export function parseUnifiedDiff(raw: string): { original: string; modified: string } {
  const originalLines: string[] = [];
  const modifiedLines: string[] = [];
  let inHunk = false;
  for (const line of raw.split('\n')) {
    if (!inHunk) {
      if (line.startsWith('@@')) inHunk = true;
      continue;
    }
    if (line.startsWith('@@')) continue;
    if (line.startsWith('\\ ')) continue;
    if (line.startsWith('-')) {
      originalLines.push(line.slice(1));
    } else if (line.startsWith('+')) {
      modifiedLines.push(line.slice(1));
    } else {
      const content = line.startsWith(' ') ? line.slice(1) : line;
      originalLines.push(content);
      modifiedLines.push(content);
    }
  }
  return { original: originalLines.join('\n'), modified: modifiedLines.join('\n') };
}
