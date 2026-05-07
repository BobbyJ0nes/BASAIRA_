// POST /api/export — generate Obsidian-flavoured Markdown for selected papers.
// Body: { paperIds: string[] }
// Returns: { files: [{ filename, content }, ...] } — client downloads in-browser.
// Frontmatter + body shape mirrors src/server/routes.js POST /api/export.
import { supabase } from './_lib/supabase.js';

export const config = { maxDuration: 25 };

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { paperIds } = req.body || {};
  if (!Array.isArray(paperIds) || paperIds.length === 0) {
    return res.status(400).json({ error: 'paperIds array required' });
  }

  try {
    const { data: papers, error } = await supabase
      .from('papers')
      .select('*')
      .in('id', paperIds);

    if (error) throw error;

    const files = (papers || []).map(p => {
      // Snake → camel: pull arxiv_url / pdf_url into the markdown.
      const arxivUrl = p.arxiv_url || '';
      const pdfUrl = p.pdf_url || '';
      const authors = p.authors || [];
      const tags = p.tags || [];
      const domains = p.domains || [];
      const categories = p.categories || [];

      const frontmatter = [
        '---',
        `title: "${(p.title || '').replace(/"/g, '\\"')}"`,
        `authors: [${authors.map(a => `"${a}"`).join(', ')}]`,
        `published: ${p.published || ''}`,
        `domains: [${domains.join(', ')}]`,
        `tags: [${tags.join(', ')}]`,
        `arxiv: ${arxivUrl}`,
        `pdf: ${pdfUrl}`,
        `source: BASAIRA_`,
        '---',
      ].join('\n');

      const body = [
        `# ${p.title || ''}`,
        '',
        `**Authors:** ${authors.join(', ')}`,
        `**Published:** ${p.published || ''}`,
        `**Categories:** ${categories.join(', ')}`,
        `**Domains:** ${domains.join(', ')}`,
        '',
        `## Abstract`,
        '',
        p.abstract || '',
        '',
        `## Links`,
        `- [arXiv](${arxivUrl})`,
        `- [PDF](${pdfUrl})`,
        '',
        `## Tags`,
        tags.map(t => `#${t.replace(/\s+/g, '-')}`).join(' '),
        '',
        `## Notes`,
        '',
        '<!-- Add your notes here -->',
        '',
      ].join('\n');

      return {
        filename: `${(p.id || 'paper').replace(/[/.]/g, '-')}.md`,
        content: frontmatter + '\n\n' + body,
      };
    });

    res.json({ files });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
