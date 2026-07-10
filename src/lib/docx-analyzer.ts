import JSZip from 'jszip';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import { normalizeKey } from './parser';

/**
 * Merges split runs in a paragraph that contain parts of a `{placeholder}`.
 * Word often splits `{Name}` into `<w:r><w:t>{</w:t></w:r>`, `<w:r><w:t>Name</w:t></w:r>`, `<w:r><w:t>}</w:t></w:r>`.
 * This cleanly merges them into the first run so regex replacement works.
 */
function cleanParagraph(paragraphNode: Element) {
  const tNodes = Array.from(paragraphNode.getElementsByTagName('w:t'));
  if (tNodes.length === 0) return;

  let fullText = '';
  const charMapping: { tNode: Element; offset: number }[] = [];

  for (const tNode of tNodes) {
    const text = tNode.textContent || '';
    for (let i = 0; i < text.length; i++) {
      charMapping.push({ tNode, offset: i });
    }
    fullText += text;
  }

  const regex = /\{[^{}]+\}/g;
  let match;
  const replacements: { start: number; end: number; placeholder: string }[] = [];
  while ((match = regex.exec(fullText)) !== null) {
    replacements.push({
      start: match.index,
      end: match.index + match[0].length,
      placeholder: match[0],
    });
  }

  for (let i = replacements.length - 1; i >= 0; i--) {
    const { start, end, placeholder } = replacements[i];

    const startMap = charMapping[start];
    const endMap = charMapping[end - 1];

    if (!startMap || !endMap) continue;

    const startNode = startMap.tNode;
    const endNode = endMap.tNode;

    if (startNode === endNode) {
      continue;
    }

    const startNodeText = startNode.textContent || '';
    const textBefore = startNodeText.substring(0, startMap.offset);

    const endNodeText = endNode.textContent || '';
    const textAfter = endNodeText.substring(endMap.offset + 1);

    startNode.textContent = textBefore + placeholder;
    endNode.textContent = textAfter;

    const startIdxInList = tNodes.indexOf(startNode);
    const endIdxInList = tNodes.indexOf(endNode);
    for (let j = startIdxInList + 1; j < endIdxInList; j++) {
      tNodes[j].textContent = '';
    }
  }
}

/**
 * Safely replaces text in a w:t node, handling multiline replacements by splitting them
 * and creating appropriate w:br elements so they render correctly in the PDF/Word file.
 */
function replaceTextInRun(tNode: Element, placeholder: string, replacement: string) {
  const parentRun = tNode.parentNode;
  if (!parentRun) return;

  const text = tNode.textContent || '';
  if (!text.includes(placeholder)) return;

  const parts = text.split(placeholder);
  const replacementLines = replacement.split('\n');

  const ownerDoc = tNode.ownerDocument;
  const fragment = ownerDoc.createDocumentFragment();

  parts.forEach((part, partIdx) => {
    if (partIdx > 0) {
      replacementLines.forEach((line, lineIdx) => {
        if (lineIdx > 0) {
          const br = ownerDoc.createElementNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'w:br');
          fragment.appendChild(br);
        }
        const t = ownerDoc.createElementNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'w:t');
        if (line.startsWith(' ') || line.endsWith(' ')) {
          t.setAttribute('xml:space', 'preserve');
        }
        t.textContent = line;
        fragment.appendChild(t);
      });
    }

    if (part) {
      const t = ownerDoc.createElementNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'w:t');
      if (part.startsWith(' ') || part.endsWith(' ')) {
        t.setAttribute('xml:space', 'preserve');
      }
      t.textContent = part;
      fragment.appendChild(t);
    }
  });

  parentRun.insertBefore(fragment, tNode);
  parentRun.removeChild(tNode);
}

/**
 * Searches the XML document for placeholders and replaces them using the provided mapping.
 */
function replaceAllPlaceholders(doc: Document, replacerFn: (placeholderRaw: string) => string | null) {
  const paragraphs = Array.from(doc.getElementsByTagName('w:p'));
  paragraphs.forEach(cleanParagraph);

  let hasReplacements = true;
  let iterations = 0;
  const maxIterations = 10;

  while (hasReplacements && iterations < maxIterations) {
    hasReplacements = false;
    const tNodes = Array.from(doc.getElementsByTagName('w:t'));

    for (const tNode of tNodes) {
      if (!tNode.parentNode) continue;
      const text = tNode.textContent || '';
      
      const regex = /\{([^{}]+)\}/g;
      let match = regex.exec(text);
      if (match) {
        const fullPlaceholder = match[0];
        const innerName = match[1];
        
        const mappedValue = replacerFn(innerName);
        if (mappedValue !== null && mappedValue !== undefined) {
          replaceTextInRun(tNode, fullPlaceholder, mappedValue);
          hasReplacements = true;
          break; // restart query for nodes to prevent stale DOM errors
        }
      }
    }
    iterations++;
  }
}

/**
 * Main function to take a docx buffer, substitute values, and return a new docx buffer.
 */
export async function processDocxTemplate(
  templateBuffer: ArrayBuffer,
  replacerFn: (placeholderRaw: string) => string | null
): Promise<ArrayBuffer> {
  const zip = await JSZip.loadAsync(templateBuffer);
  
  // Find all XML files that might contain placeholders (document, headers, footers)
  const xmlFilesToProcess = Object.keys(zip.files).filter(name => 
    name.startsWith('word/document') || name.startsWith('word/header') || name.startsWith('word/footer')
  );

  for (const filename of xmlFilesToProcess) {
    const content = await zip.file(filename)?.async('string');
    if (!content) continue;

    const parser = new DOMParser();
    const doc = parser.parseFromString(content, 'application/xml');
    
    replaceAllPlaceholders(doc, replacerFn);

    const serializer = new XMLSerializer();
    const newContent = serializer.serializeToString(doc);
    zip.file(filename, newContent);
  }

  return await zip.generateAsync({ type: 'arraybuffer', compression: 'DEFLATE' });
}
