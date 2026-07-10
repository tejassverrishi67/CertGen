export interface PersonData {
  index: number;
  name: string;
  designations: string[];
  fields: { [normalizedKey: string]: string };
}

export interface ParsedBatch {
  globalFields: { [normalizedKey: string]: string };
  people: PersonData[];
  rawKeys: { [normalizedKey: string]: string }; // Maps normalized key back to original key for fallback
}

/**
 * Normalizes a key (e.g. from template or input) for comparison:
 * Lowercase, remove spaces and non-alphanumeric chars.
 */
export function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Parses the raw text block into a structured format.
 */
export function parseDataBlock(text: string): ParsedBatch {
  const lines = text.split(/\r?\n/);
  const rawSections: { [key: string]: string[] } = {};
  const originalKeys: { [normalized: string]: string } = {};
  let currentKey: string | null = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const colonIndex = trimmed.indexOf(':');
    let isNewKey = false;
    let key = '';
    let val = '';

    // Check if the line defines a new key (must look like a reasonable key)
    if (colonIndex > 0) {
      const potentialKey = trimmed.substring(0, colonIndex).trim();
      const potentialVal = trimmed.substring(colonIndex + 1).trim();
      
      // Basic validation for a key (alphanumeric, spaces, dashes, underscores)
      if (/^[A-Za-z0-9\s_-]+$/.test(potentialKey)) {
        isNewKey = true;
        key = potentialKey;
        val = potentialVal;
      }
    }

    if (isNewKey) {
      currentKey = normalizeKey(key);
      originalKeys[currentKey] = key;
      rawSections[currentKey] = [];
      if (val) {
        rawSections[currentKey].push(val);
      }
    } else {
      if (currentKey) {
        rawSections[currentKey].push(trimmed);
      }
    }
  }

  // 1. Process Names to discover all people indices
  const peopleMap = new Map<number, PersonData>();
  let nameKey = Object.keys(rawSections).find(k => k.includes('name'));
  
  if (nameKey && rawSections[nameKey]) {
    // Name is usually a single comma-separated line, or multiple lines. We'll join and split.
    const nameStr = rawSections[nameKey].join(',');
    const parts = nameStr.split(',').map(p => p.trim()).filter(Boolean);
    
    for (const part of parts) {
      const match = part.match(/^(.*?)([0-9]+)$/);
      if (match) {
        const name = match[1].trim();
        const idx = parseInt(match[2], 10);
        peopleMap.set(idx, {
          index: idx,
          name,
          designations: [],
          fields: {}
        });
      }
    }
  }

  const peopleIndices = Array.from(peopleMap.keys()).sort((a, b) => a - b);
  const globalFields: { [key: string]: string } = {};

  // Helper to determine if a key is global or per-person
  const globalKeyNames = ['doi', 'papertitle', 'title'];
  const isGlobalKey = (k: string) => globalKeyNames.some(g => k.includes(g));

  // 2. Process all other sections
  for (const [normKey, lines] of Object.entries(rawSections)) {
    if (normKey === nameKey) continue; // already processed

    if (isGlobalKey(normKey)) {
      globalFields[normKey] = lines.join('\n').trim();
      continue;
    }

    // Check if values have suffixes
    const items: string[] = [];
    let hasSuffix = false;
    const testSuffix = /(?:^|\s|\w)([0-9]+)(?:-([0-9]+))?$/;

    // If single line, maybe comma separated (like custom field "A1, B2")
    if (lines.length === 1) {
      const parts = lines[0].split(',').map(p => p.trim()).filter(Boolean);
      if (parts.some(p => testSuffix.test(p))) {
        items.push(...parts);
        hasSuffix = true;
      } else {
        items.push(lines[0]);
      }
    } else {
      items.push(...lines);
      hasSuffix = items.some(item => testSuffix.test(item.trim()));
    }

    if (!hasSuffix) {
      // Global field
      globalFields[normKey] = lines.join('\n').trim();
      continue;
    }

    // Process per-person suffixes
    for (const item of items) {
      const trimmed = item.trim();
      if (!trimmed) continue;
      
      const match = trimmed.match(/^(.*?)([0-9]+)(?:-([0-9]+))?$/);
      if (match) {
        const content = match[1].trim();
        const startIdx = parseInt(match[2], 10);
        const endIdx = match[3] ? parseInt(match[3], 10) : startIdx;
        
        for (let i = startIdx; i <= endIdx; i++) {
          const person = peopleMap.get(i);
          if (person) {
            if (normKey.includes('designation') || normKey.includes('college') || normKey.includes('dept')) {
              person.designations.push(content);
            } else {
              if (!person.fields[normKey]) {
                person.fields[normKey] = content;
              } else {
                person.fields[normKey] += `\n${content}`;
              }
            }
          }
        }
      } else {
        // Fallback for items without suffix in a mixed list
        for (const idx of peopleIndices) {
          const person = peopleMap.get(idx);
          if (person) {
            if (normKey.includes('designation') || normKey.includes('college') || normKey.includes('dept')) {
              person.designations.push(trimmed);
            } else {
              if (!person.fields[normKey]) {
                person.fields[normKey] = trimmed;
              } else {
                person.fields[normKey] += `\n${trimmed}`;
              }
            }
          }
        }
      }
    }
  }

  return {
    globalFields,
    people: Array.from(peopleMap.values()).sort((a, b) => a.index - b.index),
    rawKeys: originalKeys,
  };
}
