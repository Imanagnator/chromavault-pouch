import { describe, it, expect } from 'vitest';
import { generateFilledPouch } from '../services/ccaGenerator';

describe('Pouch Generator & Packaging', () => {
  it('rejects empty pouch names or empty file arrays', async () => {
    await expect(
      generateFilledPouch('', [], null, () => {})
    ).rejects.toThrow(/Pouch configuration invalid/);
  });

  it('packs unencrypted files in embedded mode (double-click ready, no reselect needed)', async () => {
    const file1 = new File(['Hello World file 1 contents'], 'doc1.txt', { type: 'text/plain' });
    const file2 = new File(['{"status": "ok", "value": 42}'], 'data.json', { type: 'application/json' });

    const progressLogs: string[] = [];
    const blob = await generateFilledPouch(
      'Embedded_Pouch',
      [file1, file2],
      null,
      (p) => {
        if (p.status) progressLogs.push(p.status);
      },
      { embed: true }
    );

    expect(blob).toBeInstanceOf(Blob);
    const htmlText = await blob.text();

    // Verify embedded chunk script tag exists
    expect(htmlText).toContain('data-pouch-chunk="0"');
    expect(htmlText).toContain('loadEmbedded');
    expect(htmlText).not.toContain('<script type="text/plain" style="display:none">');

    // Extract chunk and decode to verify internal footer & spine
    const match = htmlText.match(/<script type="application\/octet-stream" data-pouch-chunk="0">([\s\S]*?)<\/script>/);
    expect(match).not.toBeNull();
    const base64Chunk = match![1].trim();
    const binaryStr = atob(base64Chunk);
    const u8 = new Uint8Array(binaryStr.length);
    for (let i = 0; i < binaryStr.length; i++) {
      u8[i] = binaryStr.charCodeAt(i);
    }

    // Verify CCAP magic in footer
    const footerView = new DataView(u8.buffer, u8.byteLength - 24, 24);
    const headerLen = footerView.getBigUint64(0, true);
    const spineLen = footerView.getUint32(8, true);
    const magic = footerView.getUint32(12, true);

    expect(magic).toBe(0x43434150); // 'CCAP'
    expect(headerLen).toBe(0n); // In embedded mode, payload starts at byte 0 of virtual blob
    expect(spineLen).toBeGreaterThan(0);
  });

  it('packs in append mode when embed: false is specified', async () => {
    const file1 = new File(['Append mode test file'], 'append.txt', { type: 'text/plain' });

    const blob = await generateFilledPouch(
      'Append_Pouch',
      [file1],
      null,
      () => {},
      { embed: false }
    );

    const arrayBuffer = await blob.arrayBuffer();
    const footerView = new DataView(arrayBuffer, arrayBuffer.byteLength - 24, 24);

    const headerLen = footerView.getBigUint64(0, true);
    const spineLen = footerView.getUint32(8, true);
    const magic = footerView.getUint32(12, true);

    expect(magic).toBe(0x43434150); // 'CCAP'
    expect(headerLen).toBeGreaterThan(0n); // Appended after HTML + padding
    expect(spineLen).toBeGreaterThan(0);
  });

  it('packs encrypted files with master key encryption in embedded mode', async () => {
    const file1 = new File(['Secret confidential text'], 'secret.txt', { type: 'text/plain' });

    const blob = await generateFilledPouch(
      'Encrypted_Vault',
      [file1],
      'P@ssword123!',
      () => {},
      { embed: true }
    );

    const htmlText = await blob.text();
    expect(htmlText).toContain('data-pouch-chunk="0"');
    expect(htmlText).toContain('encryption: true');
    expect(htmlText).toContain('aria-label="Encrypted"');
  });

  it('embeds PDF worker with binary Uint8Array byte restoration to prevent font tofu corruption', async () => {
    const file1 = new File(['Sample text'], 'sample.txt', { type: 'text/plain' });

    const blob = await generateFilledPouch(
      'Pdf_Worker_Check',
      [file1],
      null,
      () => {},
      { embed: true }
    );

    const htmlText = await blob.text();
    // Ensure the binary Uint8Array restoration is present in the embedded worker script
    expect(htmlText).toContain('const workerBin = atob(');
    expect(htmlText).toContain('const workerBytes = new Uint8Array(workerBin.length);');
    expect(htmlText).toContain('workerBytes[i] = workerBin.charCodeAt(i);');
    expect(htmlText).toContain('const workerBlob = new Blob([workerBytes], { type: \'text/javascript\' });');

    // Ensure corrupted pattern is not present
    expect(htmlText).not.toContain('const workerBlob = new Blob([workerScript]');
  });
});

