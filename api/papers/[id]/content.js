import { supabase } from '../../_lib/supabase.js';
import https from 'https';

export const config = { maxDuration: 25 };

function fetchURL(url) {
  return new Promise((resolve, reject) => {
    const doFetch = (u, redirects = 0) => {
      if (redirects > 5) return reject(new Error('Too many redirects'));
      https.get(u, { headers: { 'User-Agent': 'BASIRA/1.0' } }, (res) => {
        if (res.statusCode === 301 || res.statusCode === 302) return doFetch(res.headers.location, redirects + 1);
        if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => resolve(data));
        res.on('error', reject);
      }).on('error', reject);
    };
    doFetch(url);
  });
}

// Import parser functions inline (serverless-friendly)
function encodeLatex(latex) {
  return latex.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/"/g, '&quot;');
}

function stripToText(html) {
  return html.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
}

function convertRichContent(html, paperId) {
  let result = html;
  result = result.replace(/<math[^>]*alttext="([^"]*)"[^>]*display="block"[^>]*>[\s\S]*?<\/math>/gi, (_, latex) => `<scan-math display="block" latex="${encodeLatex(latex)}"></scan-math>`);
  result = result.replace(/<math[^>]*display="block"[^>]*alttext="([^"]*)"[^>]*>[\s\S]*?<\/math>/gi, (_, latex) => `<scan-math display="block" latex="${encodeLatex(latex)}"></scan-math>`);
  result = result.replace(/<math[^>]*alttext="([^"]*)"[^>]*>[\s\S]*?<\/math>/gi, (_, latex) => `<scan-math latex="${encodeLatex(latex)}"></scan-math>`);
  if (paperId) {
    result = result.replace(/<img\s+([^>]*)src="([^"]*)"([^>]*)>/gi, (match, pre, src, post) => {
      if (src.startsWith('data:') || src.startsWith('http')) return match;
      return `<img ${pre}src="https://arxiv.org/html/${src}"${post}>`;
    });
  }
  return result;
}

function convertParagraph(html, paperId) {
  let result = convertRichContent(html, paperId);
  result = result.replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n\n').replace(/<cite[^>]*>.*?<\/cite>/gs, '').replace(/<\/?(?:span|em|strong|b|i|a|sub|sup|code|mark|div|p|td|tr|th|table|thead|tbody)[^>]*>/gi, '').replace(/<(?!scan-|\/scan-)[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&nbsp;/g, ' ').replace(/\n{3,}/g, '\n\n').replace(/[ \t]+/g, ' ').trim();
  return result;
}

function extractParagraphs(sectionHTML, paperId) {
  const paragraphs = [];
  const paraRegex = /<(?:div|p)[^>]*class="[^"]*ltx_para?[^"]*"[^>]*>([\s\S]*?)<\/(?:div|p)>/gi;
  let match;
  while ((match = paraRegex.exec(sectionHTML)) !== null) {
    const text = convertParagraph(match[1], paperId);
    if (text.length > 15) paragraphs.push(text);
  }
  const figRegex = /<figure[^>]*>([\s\S]*?)<\/figure>/gi;
  while ((match = figRegex.exec(sectionHTML)) !== null) {
    const converted = convertRichContent(match[0], paperId);
    if (converted.includes('scan-figure')) paragraphs.push(converted.replace(/<(?!scan-|\/scan-)[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
  }
  if (paragraphs.length === 0) {
    const text = convertParagraph(sectionHTML, paperId);
    if (text.length > 15) paragraphs.push(text);
  }
  return paragraphs;
}

function parseArxivHTML(html, paperId) {
  const sections = [];
  const abstractMatch = html.match(/<div[^>]*class="[^"]*ltx_abstract[^"]*"[^>]*>([\s\S]*?)<\/div>\s*(?=<(?:section|div|nav))/i);
  if (abstractMatch) {
    const text = convertParagraph(abstractMatch[1], paperId).replace(/^Abstract\s*/i, '').trim();
    if (text) sections.push({ id: 'abstract', title: 'Abstract', paragraphs: text.split(/\n\n+/).map(p => p.replace(/\n/g, ' ').trim()).filter(p => p.length > 10) });
  }
  const sectionRegex = /<section[^>]*id="(S\d+(?:\.SS\d+)?)"[^>]*class="[^"]*ltx_(?:sub)?section[^"]*"[^>]*>([\s\S]*?)(?=<section[^>]*class="[^"]*ltx_(?:sub)?section|<section[^>]*id="bib"|<\/article>)/gi;
  let sMatch;
  while ((sMatch = sectionRegex.exec(html)) !== null) {
    const sectionId = sMatch[1];
    const headingMatch = sMatch[2].match(/<h[2-6][^>]*class="[^"]*ltx_title[^"]*"[^>]*>([\s\S]*?)<\/h[2-6]>/i);
    const title = headingMatch ? stripToText(headingMatch[1]).trim().replace(/\s+/g, ' ') : `Section ${sectionId}`;
    const paragraphs = extractParagraphs(sMatch[2], paperId);
    if (paragraphs.length > 0) sections.push({ id: sectionId, title, paragraphs, isSubsection: sectionId.includes('.SS') });
  }
  // Extract figures from full article
  const figRegex = /<figure[^>]*id="([^"]*)"[^>]*>([\s\S]*?)<\/figure>/gi;
  const figures = [];
  let fMatch;
  while ((fMatch = figRegex.exec(html)) !== null) {
    const imgMatch = fMatch[2].match(/<img[^>]*src="([^"]*)"[^>]*>/i);
    const captionMatch = fMatch[2].match(/<figcaption[^>]*>([\s\S]*?)<\/figcaption>/i);
    if (imgMatch) {
      let src = imgMatch[1];
      if (!src.startsWith('http') && !src.startsWith('data:')) src = `https://arxiv.org/html/${src}`;
      const caption = captionMatch ? stripToText(captionMatch[1]) : '';
      figures.push(`<scan-figure src="${src}"><scan-caption>${caption}</scan-caption></scan-figure>`);
    }
  }
  if (figures.length > 0) sections.push({ id: 'figures', title: 'Figures', paragraphs: figures });
  return sections;
}

export default async function handler(req, res) {
  const paperId = req.query.id;
  if (!paperId) return res.status(400).json({ error: 'Missing paper ID' });

  try {
    // Check Supabase cache first
    const { data: cached } = await supabase.from('paper_content').select('*').eq('paper_id', paperId).single();
    
    // Get paper metadata
    const { data: paper } = await supabase.from('papers').select('*').eq('id', paperId).single();
    if (!paper) return res.status(404).json({ error: 'Paper not found' });

    const base = {
      id: paper.id, title: paper.title, authors: paper.authors, published: paper.published,
      categories: paper.categories, domains: paper.domains, tags: paper.tags,
      pdfUrl: paper.pdf_url, arxivUrl: paper.arxiv_url, isOverlap: paper.is_overlap,
      fullAbstract: paper.abstract,
    };

    if (cached && cached.sections && cached.sections.length > 0) {
      const sections = cached.sections.map(s => ({ id: s.id, title: s.title, content: s.paragraphs ? s.paragraphs.join('\n\n') : s.content || '', isSubsection: s.isSubsection || false }));
      return res.json({ ...base, sections, source: cached.source });
    }

    // Fetch from arXiv HTML
    let sections = null;
    let source = 'abstract';
    try {
      const html = await fetchURL(`https://arxiv.org/html/${paperId}`);
      const parsed = parseArxivHTML(html, paperId);
      if (parsed.length > 0) {
        sections = parsed.map(s => ({ id: s.id, title: s.title, content: s.paragraphs.join('\n\n'), isSubsection: s.isSubsection || false }));
        source = 'html';
        // Cache in Supabase
        await supabase.from('paper_content').upsert({ paper_id: paperId, sections: parsed, source, total_chars: sections.reduce((s, sec) => s + sec.content.length, 0) });
      }
    } catch (e) {
      // Try without version
      try {
        const arxivId = paperId.replace(/v\d+$/, '');
        const html = await fetchURL(`https://arxiv.org/html/${arxivId}`);
        const parsed = parseArxivHTML(html, paperId);
        if (parsed.length > 0) {
          sections = parsed.map(s => ({ id: s.id, title: s.title, content: s.paragraphs.join('\n\n'), isSubsection: s.isSubsection || false }));
          source = 'html';
          await supabase.from('paper_content').upsert({ paper_id: paperId, sections: parsed, source, total_chars: sections.reduce((s, sec) => s + sec.content.length, 0) });
        }
      } catch (e2) { /* fall through */ }
    }

    if (!sections) {
      sections = [{ id: 'abstract', title: 'Abstract', content: paper.abstract, isSubsection: false }];
    }

    res.json({ ...base, sections, source });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
