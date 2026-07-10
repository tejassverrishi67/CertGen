import { NextResponse } from 'next/server';
import { parseDataBlock, normalizeKey } from '@/lib/parser';
import { processDocxTemplate } from '@/lib/docx-analyzer';
import { convertDocxToPdf, generateFilename, bundlePdfsToZip } from '@/lib/pdf-generator';

export const maxDuration = 60; // Set Vercel function maxDuration to 60s

export async function POST(req: Request) {
  try {
    const formData = await req.formData();
    
    const templateFile = formData.get('template') as File;
    const dataBlock = formData.get('datablock') as string;
    const gotenbergUrl = formData.get('gotenbergUrl') as string;

    if (!templateFile || !dataBlock || !gotenbergUrl) {
      return NextResponse.json({ error: 'Missing required fields: template, datablock, or gotenbergUrl' }, { status: 400 });
    }

    const templateBuffer = await templateFile.arrayBuffer();
    const parsedData = parseDataBlock(dataBlock);

    if (parsedData.people.length === 0) {
      return NextResponse.json({ error: 'No people found in the datablock' }, { status: 400 });
    }

    const doiValue = parsedData.globalFields['doi'] || '000';
    const pdfs: { filename: string; buffer: ArrayBuffer }[] = [];

    for (const person of parsedData.people) {
      const replacerFn = (placeholderRaw: string) => {
        const norm = normalizeKey(placeholderRaw);
        
        if (norm.includes('name')) {
          return person.name;
        }
        
        if (norm.includes('designation') || norm.includes('college') || norm.includes('dept')) {
          return person.designations.join('\n');
        }

        if (parsedData.globalFields[norm]) {
          return parsedData.globalFields[norm];
        }

        if (person.fields[norm]) {
          return person.fields[norm];
        }

        // If not mapped, return null so it remains as literal `{field}` text
        return null;
      };

      // 1. Process DOCX
      const filledDocxBuffer = await processDocxTemplate(templateBuffer, replacerFn);

      // 2. Convert to PDF
      const tempFilename = `temp-${person.index}.docx`;
      const pdfBuffer = await convertDocxToPdf(filledDocxBuffer, gotenbergUrl, tempFilename);

      // 3. Store for zip
      const finalFilename = generateFilename(doiValue, person.name, person.index);
      pdfs.push({ filename: finalFilename, buffer: pdfBuffer });
    }

    // 4. Zip all PDFs
    const zipBuffer = await bundlePdfsToZip(pdfs);

    // Return as downloadable ZIP
    return new NextResponse(zipBuffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': 'attachment; filename="certificates.zip"',
      },
    });
  } catch (error: any) {
    console.error('Generation Error:', error);
    return NextResponse.json({ error: error.message || 'An error occurred during generation' }, { status: 500 });
  }
}
