// ═══════════════════════════════════════════════════════════
// BASAIRA_ Paper Parser — Extract full text from arXiv HTML
// ═══════════════════════════════════════════════════════════
//
// Fetches https://arxiv.org/html/{id} and extracts structured
// sections with their headings and paragraph content.
//
// Preserves:
//   • Math — <math alttext="LaTeX"> → ⟨scan-math⟩ placeholders
//     rendered client-side by KaTeX
//   • Figures — <img src="relative"> → absolute arXiv URLs
//   • Figure captions
//
// arXiv HTML uses LaTeXML classes:
//   .ltx_section, .ltx_subsection — sections
//   .ltx_title — section headings
//   .ltx_p, .ltx_para — paragraphs
//   .ltx_Math — inline/display math
//   .ltx_figure — figures with images
//   .ltx_abstract — abstract block
//   .ltx_bibliography — references
//
// ═══════════════════════════════════════════════════════════

import https from 'https';

function fetchURL(url) {
  return new Promise((resolve, reject) => {
    const doFetch = (u, redirects = 0) => {
      if (redirects > 5) return reject(new Error('Too many redirects'));
      https.get(u, { headers: { 'User-Agent': 'BASAIRA/1.0 (research-tool)' } }, (res) => {
        if (res.statusCode === 301 || res.statusCode === 302) {
          return doFetch(res.headers.location, redirects + 1);
        }
        if (res.statusCode !== 200) {
          return reject(new Error(`HTTP ${res.statusCode}`));
        }
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => resolve(data));
        res.on('error', reject);
      }).on('error', reject);
    };
    doFetch(url);
  });
}

// ─── RICH TEXT CONVERSION ───
// Instead of stripping all HTML, convert math and images to
// renderable placeholders, then strip remaining tags.

function convertRichContent(html, paperId) {
  let result = html;

  // 1. Convert <math> to scan-math placeholders
  //    Display math (block equations):  <scan-math display="block" latex="..."/>
  //    Inline math:                     <scan-math latex="..."/>
  result = result.replace(/<math[^>]*alttext="([^"]*)"[^>]*display="block"[^>]*>[\s\S]*?<\/math>/gi,
    (_, latex) => `<scan-math display="block" latex="${encodeLatex(latex)}"></scan-math>`
  );
  result = result.replace(/<math[^>]*display="block"[^>]*alttext="([^"]*)"[^>]*>[\s\S]*?<\/math>/gi,
    (_, latex) => `<scan-math display="block" latex="${encodeLatex(latex)}"></scan-math>`
  );
  // Inline math (no display="block")
  result = result.replace(/<math[^>]*alttext="([^"]*)"[^>]*>[\s\S]*?<\/math>/gi,
    (_, latex) => `<scan-math latex="${encodeLatex(latex)}"></scan-math>`
  );

  // 2. Convert <img> to absolute URLs
  if (paperId) {
    result = result.replace(/<img\s+([^>]*)src="([^"]*)"([^>]*)>/gi, (match, pre, src, post) => {
      // Skip data URIs and already-absolute URLs
      if (src.startsWith('data:') || src.startsWith('http')) return match;
      const absUrl = `https://arxiv.org/html/${src}`;
      return `<img ${pre}src="${absUrl}"${post}>`;
    });
  }

  // 3. Preserve <figure> blocks — extract img + caption as rich content
  result = result.replace(/<figure[^>]*>([\s\S]*?)<\/figure>/gi, (_, inner) => {
    const imgMatch = inner.match(/<img[^>]*src="([^"]*)"[^>]*>/i);
    const captionMatch = inner.match(/<figcaption[^>]*>([\s\S]*?)<\/figcaption>/i);
    let out = '';
    if (imgMatch) {
      out += `<scan-figure src="${imgMatch[1]}">`;
    }
    if (captionMatch) {
      out += `<scan-caption>${stripToText(captionMatch[1])}</scan-caption>`;
    }
    if (imgMatch) {
      out += `</scan-figure>`;
    }
    return out;
  });

  return result;
}

// Encode LaTeX for safe attribute storage
function encodeLatex(latex) {
  return latex
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/"/g, '&quot;');
}

// Strip to plain text (for captions and headings)
function stripToText(html) {
  return html
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Convert section content HTML to rich text with math/figure placeholders
function convertParagraph(html, paperId) {
  let result = convertRichContent(html, paperId);

  // Strip remaining HTML tags (but preserve our scan-* elements)
  result = result
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<cite[^>]*>.*?<\/cite>/gs, '') // Remove inline citations
    .replace(/<\/?(?:span|em|strong|b|i|a|sub|sup|code|mark|div|p|td|tr|th|table|thead|tbody)[^>]*>/gi, '') // Strip layout tags
    .replace(/<(?!scan-|\/scan-)[^>]+>/g, ' ') // Strip any remaining non-scan tags
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+/g, ' ')
    .trim();

  return result;
}

// Extract paragraphs from section HTML, preserving math/figures
function extractParagraphs(sectionHTML, paperId) {
  const paragraphs = [];

  // Match paragraphs
  const paraRegex = /<(?:div|p)[^>]*class="[^"]*ltx_para?[^"]*"[^>]*>([\s\S]*?)<\/(?:div|p)>/gi;
  let match;

  while ((match = paraRegex.exec(sectionHTML)) !== null) {
    const text = convertParagraph(match[1], paperId);
    if (text.length > 15) {
      paragraphs.push(text);
    }
  }

  // Also extract figure blocks (they're siblings to paragraphs, not inside them)
  const figRegex = /<figure[^>]*>([\s\S]*?)<\/figure>/gi;
  while ((match = figRegex.exec(sectionHTML)) !== null) {
    const figHTML = match[0];
    const converted = convertRichContent(figHTML, paperId);
    // Extract the scan-figure we created
    if (converted.includes('scan-figure')) {
      paragraphs.push(converted.replace(/<(?!scan-|\/scan-)[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
    }
  }

  if (paragraphs.length === 0) {
    const text = convertParagraph(sectionHTML, paperId);
    if (text.length > 15) {
      paragraphs.push(text);
    }
  }

  return paragraphs;
}

// Parse the full arXiv HTML into structured sections
function parseArxivHTML(html, paperId) {
  const sections = [];

  // 1. Extract abstract
  const abstractMatch = html.match(/<div[^>]*class="[^"]*ltx_abstract[^"]*"[^>]*>([\s\S]*?)<\/div>\s*(?=<(?:section|div|nav))/i);
  if (abstractMatch) {
    const text = convertParagraph(abstractMatch[1], paperId).replace(/^Abstract\s*/i, '').trim();
    if (text) {
      sections.push({ id: 'abstract', title: 'Abstract', paragraphs: splitIntoParagraphs(text) });
    }
  }

  // 2. Extract main sections
  const sectionRegex = /<section[^>]*id="(S\d+(?:\.SS\d+)?)"[^>]*class="[^"]*ltx_(?:sub)?section[^"]*"[^>]*>([\s\S]*?)(?=<section[^>]*class="[^"]*ltx_(?:sub)?section|<section[^>]*id="bib"|<\/article>)/gi;

  let sMatch;
  while ((sMatch = sectionRegex.exec(html)) !== null) {
    const sectionId = sMatch[1];
    const sectionContent = sMatch[2];

    // Extract heading (strip to plain text for headings)
    const headingMatch = sectionContent.match(/<h[2-6][^>]*class="[^"]*ltx_title[^"]*"[^>]*>([\s\S]*?)<\/h[2-6]>/i);
    let title = headingMatch ? stripToText(headingMatch[1]).trim() : `Section ${sectionId}`;
    title = title.replace(/\s+/g, ' ').trim();

    const paragraphs = extractParagraphs(sectionContent, paperId);

    if (paragraphs.length > 0) {
      sections.push({
        id: sectionId,
        title,
        paragraphs,
        isSubsection: sectionId.includes('.SS')
      });
    }
  }

  // 3. Extract all figures from the full HTML (they often sit between/after sections)
  const figRegex = /<figure[^>]*id="([^"]*)"[^>]*>([\s\S]*?)<\/figure>/gi;
  const figures = [];
  let fMatch;
  while ((fMatch = figRegex.exec(html)) !== null) {
    const figId = fMatch[1];
    const figContent = fMatch[2];
    const imgMatch = figContent.match(/<img[^>]*src="([^"]*)"[^>]*>/i);
    const captionMatch = figContent.match(/<figcaption[^>]*>([\s\S]*?)<\/figcaption>/i);

    if (imgMatch) {
      let src = imgMatch[1];
      if (!src.startsWith('http') && !src.startsWith('data:')) {
        src = `https://arxiv.org/html/${src}`;
      }
      const caption = captionMatch ? stripToText(captionMatch[1]) : '';
      figures.push(`<scan-figure src="${src}"><scan-caption>${caption}</scan-caption></scan-figure>`);
    }
  }

  if (figures.length > 0) {
    sections.push({
      id: 'figures',
      title: 'Figures',
      paragraphs: figures,
    });
  }

  // 4. Fallback for papers with non-standard section structure
  if (sections.length <= 1) {
    const mainMatch = html.match(/<article[^>]*>([\s\S]*?)<\/article>/i);
    if (mainMatch) {
      const allParas = extractParagraphs(mainMatch[1], paperId);
      if (allParas.length > 0 && (sections.length === 0 || allParas.length > sections[0].paragraphs.length)) {
        const grouped = [];
        for (let i = 0; i < allParas.length; i += 4) {
          grouped.push({
            id: `block-${i}`,
            title: i === 0 ? 'Paper Content' : `Continued`,
            paragraphs: allParas.slice(i, i + 4)
          });
        }
        return grouped;
      }
    }
  }

  return sections;
}

function splitIntoParagraphs(text) {
  return text.split(/\n\n+/)
    .map(p => p.replace(/\n/g, ' ').trim())
    .filter(p => p.length > 10);
}

export async function fetchFullPaper(paperId) {
  const arxivId = paperId.replace(/v\d+$/, '');

  try {
    console.log(`  → Fetching full text: arxiv.org/html/${paperId}`);
    const html = await fetchURL(`https://arxiv.org/html/${paperId}`);

    const sections = parseArxivHTML(html, paperId);

    if (sections.length > 0) {
      const totalChars = sections.reduce((sum, s) => sum + s.paragraphs.join(' ').length, 0);
      console.log(`    ✓ Extracted ${sections.length} sections, ~${Math.round(totalChars / 1000)}k chars`);
      return { sections, source: 'html', totalChars };
    }

    throw new Error('No sections extracted');
  } catch (err) {
    console.log(`    ✗ HTML not available (${err.message}), trying without version...`);

    try {
      const html = await fetchURL(`https://arxiv.org/html/${arxivId}`);
      const sections = parseArxivHTML(html, paperId);
      if (sections.length > 0) {
        const totalChars = sections.reduce((sum, s) => sum + s.paragraphs.join(' ').length, 0);
        console.log(`    ✓ Extracted ${sections.length} sections, ~${Math.round(totalChars / 1000)}k chars`);
        return { sections, source: 'html', totalChars };
      }
    } catch (e) {
      // Fall through
    }

    console.log(`    ✗ Full text unavailable, using abstract only`);
    return null;
  }
}
