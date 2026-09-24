/** CLI responses can include reasoning around the commit prompt's explicit output tags. */
export function extractCommitMessage(raw: string): string {
  const text = raw.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  const tagged = [...text.matchAll(/<commit>([\s\S]*?)<\/commit>/gi)].at(-1)?.[1];
  // An unfinished contract must not become a commit message.
  if (tagged === undefined && /<commit>|<think>/i.test(text)) return '';
  return (tagged ?? text)
    .trim()
    .replace(/^```[^\n]*\n/, '')
    .replace(/\n```$/, '')
    .trim();
}
