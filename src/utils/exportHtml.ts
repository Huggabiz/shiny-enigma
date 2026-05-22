import { saveAs } from 'file-saver';
import type { Project } from '../types';

export async function exportStandaloneHtml(project: Project): Promise<void> {
  const cssLinks = Array.from(document.querySelectorAll('link[rel="stylesheet"]')) as HTMLLinkElement[];
  const scriptTags = Array.from(document.querySelectorAll('script[src]')) as HTMLScriptElement[];

  const cssBlocks: string[] = [];
  for (const link of cssLinks) {
    try {
      const resp = await fetch(link.href);
      if (resp.ok) cssBlocks.push(await resp.text());
    } catch { /* skip */ }
  }

  const jsBlocks: string[] = [];
  for (const script of scriptTags) {
    try {
      const resp = await fetch(script.src);
      if (resp.ok) {
        let code = await resp.text();
        // Rewrite relative asset paths so they resolve from the
        // standalone HTML (which has no base href). CSS @import and
        // url() references inside JS-injected stylesheets typically
        // use absolute paths in Vite prod builds, so this is a
        // safety net rather than the primary fix.
        code = code.replace(/\/shiny-enigma\//g, './');
        jsBlocks.push(code);
      }
    } catch { /* skip */ }
  }

  const projectJson = JSON.stringify(project);

  // The Vite build uses type="module" scripts. When inlined, modules
  // work in modern browsers without a server as long as there are no
  // bare-specifier imports (the bundled output has none).
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${escapeHtml(project.name)} — Range Planner Viewer</title>
<style>
${cssBlocks.join('\n')}
</style>
</head>
<body>
<div id="root"></div>
<script>
window.__VIEWER_MODE__ = true;
window.__EMBEDDED_PROJECT__ = ${projectJson};
</script>
${jsBlocks.map((code) => `<script type="module">\n${code}\n</script>`).join('\n')}
</body>
</html>`;

  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  saveAs(blob, `${project.name.replace(/\s+/g, '_')}_viewer.html`);
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
