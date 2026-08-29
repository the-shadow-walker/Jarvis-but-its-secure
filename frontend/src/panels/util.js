// The one thing more than one panel needs: the URL that serves a project file
// as-is (the Renderer embeds it, the Run panel links its artifacts).
export const rawUrl = (slug, p) =>
  `/api/projects/${slug}/raw/${p.split('/').map(encodeURIComponent).join('/')}`
