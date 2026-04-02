// ═══════════════════════════════════════════════════════════
// SCAN Paper Parser — Extract full text from arXiv HTML
// ═══════════════════════════════════════════════════════════
//
// Fetches https://arxiv.org/html/{id} and extracts structured
// sections with their headings and paragraph text.
//
// arXiv HTML uses LaTeXML classes:
//   .ltx_section, .ltx_subsection — sections
//   .ltx_title — section headings
//   .ltx_p, .ltx_para — paragraphs
//   .ltx_abstract — abstract block
//   .ltx_bibliography — references
//
// Falls back to abstract-only if HTML version unavailable.
// ═══════════════════════════════════════════════════════════

import https from 'https';

function fetchURL(url) {
  return new Promise((resolve, reject) => {
    const doFetch = (u, redirects = 0) => {
      if (redirects > 5) return reject(new Error('Too many redirects'));
      https.get(u, { headers: { 'User-Agent': 'SCAN/1.0 (research-tool)' } }, (res) => {
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

// Strip HTML tags, decode entities, normalize whitespace
function stripHTML(html) {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/?(?:span|em|strong|b|i|a|sub|sup|code|mark)[^>]*>/gi, '') // Keep inline text
    .replace(/<cite[^>]*>.*?<\/cite>/gs, '') // Remove citations inline
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

// Extract text from ltx_p and ltx_para blocks within a section
function extractParagraphs(sectionHTML) {
  const paragraphs = [];

  // Match <div class="ltx_para"> or <p class="ltx_p"> blocks
  // But also handle text that's just directly in the section
  const paraRegex = /<(?:div|p)[^>]*class="[^"]*ltx_para?[^"]*"[^>]*>([\s\S]*?)<\/(?:div|p)>/gi;
  let match;

  while ((match = paraRegex.exec(sectionHTML)) !== null) {
    const text = stripHTML(match[1]).trim();
    if (text.length > 20) { // Skip tiny fragments
      paragraphs.push(text);
    }
  }

  // If no ltx_para found, try extracting all text
  if (paragraphs.length === 0) {
    const text = stripHTML(sectionHTML).trim();
    if (text.length > 20) {
      paragraphs.push(text);
    }
  }

  return paragraphs;
}

// Parse the full arXiv HTML into structured sections
function parseArxivHTML(html) {
  const sections = [];

  // 1. Extract abstract
  const abstractMatch = html.match(/<div[^>]*class="[^"]*ltx_abstract[^"]*"[^>]*>([\s\S]*?)<\/div>\s*(?=<(?:section|div|nav))/i);
  if (abstractMatch) {
    const text = stripHTML(abstractMatch[1]).replace(/^Abstract\s*/i, '').trim();
    if (text) {
      sections.push({ id: 'abstract', title: 'Abstract', paragraphs: splitIntoParagraphs(text) });
    }
  }

  // 2. Extract main sections — match <section id="S1" class="ltx_section">
  const sectionRegex = /<section[^>]*id="(S\d+(?:\.SS\d+)?)"[^>]*class="[^"]*ltx_(?:sub)?section[^"]*"[^>]*>([\s\S]*?)(?=<section[^>]*class="[^"]*ltx_(?:sub)?section|<section[^>]*id="bib"|<\/article>)/gi;

  let sMatch;
  while ((sMatch = sectionRegex.exec(html)) !== null) {
    const sectionId = sMatch[1];
    const sectionContent = sMatch[2];

    // Extract heading
    const headingMatch = sectionContent.match(/<h[2-6][^>]*class="[^"]*ltx_title[^"]*"[^>]*>([\s\S]*?)<\/h[2-6]>/i);
    let title = headingMatch ? stripHTML(headingMatch[1]).trim() : `Section ${sectionId}`;
    // Clean up numbering like "1 Introduction" → keep as-is
    title = title.replace(/\s+/g, ' ').trim();

    // Extract paragraphs
    const paragraphs = extractParagraphs(sectionContent);

    if (paragraphs.length > 0) {
      sections.push({
        id: sectionId,
        title,
        paragraphs,
        isSubsection: sectionId.includes('.SS')
      });
    }
  }

  // 3. If section regex didn't catch properly, try a simpler approach
  if (sections.length <= 1) {
    // Fallback: extract all ltx_para divs from the main content
    const mainMatch = html.match(/<article[^>]*>([\s\S]*?)<\/article>/i);
    if (mainMatch) {
      const allParas = extractParagraphs(mainMatch[1]);
      if (allParas.length > 0 && (sections.length === 0 || allParas.length > sections[0].paragraphs.length)) {
        // Group every ~4 paragraphs into rough sections
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
  // Split on double newlines or single newlines that look like paragraph breaks
  return text.split(/\n\n+/)
    .map(p => p.replace(/\n/g, ' ').trim())
    .filter(p => p.length > 10);
}

export async function fetchFullPaper(paperId) {
  const arxivId = paperId.replace(/v\d+$/, ''); // Strip version for HTML URL

  try {
    console.log(`  → Fetching full text: arxiv.org/html/${paperId}`);
    const html = await fetchURL(`https://arxiv.org/html/${paperId}`);

    const sections = parseArxivHTML(html);

    if (sections.length > 0) {
      const totalChars = sections.reduce((sum, s) => sum + s.paragraphs.join(' ').length, 0);
      console.log(`    ✓ Extracted ${sections.length} sections, ~${Math.round(totalChars / 1000)}k chars`);
      return { sections, source: 'html', totalChars };
    }

    throw new Error('No sections extracted');
  } catch (err) {
    console.log(`    ✗ HTML not available (${err.message}), trying v-suffixed...`);

    // Try without version suffix
    try {
      const html = await fetchURL(`https://arxiv.org/html/${arxivId}`);
      const sections = parseArxivHTML(html);
      if (sections.length > 0) {
        const totalChars = sections.reduce((sum, s) => sum + s.paragraphs.join(' ').length, 0);
        console.log(`    ✓ Extracted ${sections.length} sections, ~${Math.round(totalChars / 1000)}k chars`);
        return { sections, source: 'html', totalChars };
      }
    } catch (e) {
      // Fall through
    }

    console.log(`    ✗ Full text unavailable, using abstract only`);
    return null; // Caller will fall back to abstract
  }
}
