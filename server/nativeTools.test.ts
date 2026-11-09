import { afterAll, describe, expect, it } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createNativeTools } from './nativeTools';

describe('native project tools', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lyra-native-tools-'));
  afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

  it('keeps file operations within the project and excludes secret files', async () => {
    fs.mkdirSync(path.join(root, 'src'), { recursive: true });
    fs.writeFileSync(path.join(root, 'src', 'index.ts'), 'export const greeting = "hello";');
    fs.writeFileSync(path.join(root, '.env'), 'TOKEN=never-readable');
    const tools = createNativeTools(root);
    const read = tools.find((item) => item.name === 'read_file')!;
    const result = JSON.stringify(await read.invoke({ path: 'src/index.ts' }));
    expect(result).toContain('greeting');
    await expect(read.invoke({ path: '.env' })).rejects.toThrow('private');
    await expect(read.invoke({ path: '../outside-secret.txt' })).rejects.toThrow('outside');
    expect(fs.existsSync(path.resolve(root, '../outside-secret.txt'))).toBe(false);
  });

  it('redacts file contents and shell commands from activity events', async () => {
    const calls: Array<{ name: string; input: unknown; status: string }> = [];
    const tools = createNativeTools(root, { onToolEvent: (event) => { calls.push(event); } });
    const write = tools.find((item) => item.name === 'write_file')!;
    await write.invoke({ path: 'src/new.ts', content: 'const apiKey = "private";' });
    const serialized = JSON.stringify(calls);
    expect(serialized).not.toContain('private');
    expect(serialized).not.toContain('const apiKey');
  });

  it('performs surgical search and replace edits with edit_file', async () => {
    const tools = createNativeTools(root);
    const edit = tools.find((item) => item.name === 'edit_file')!;
    const read = tools.find((item) => item.name === 'read_file')!;
    await edit.invoke({ path: 'src/index.ts', target: '"hello"', replacement: '"world"' });
    const content = await read.invoke({ path: 'src/index.ts' });
    expect(content).toContain('"world"');
  });

  it('tolerates indentation differences and supports clean line deletion in edit_file', async () => {
    fs.writeFileSync(
      path.join(root, 'src', 'sample.ts'),
      'import { unused } from "dep";\n\nexport function test() {\n    const a = 1;\n    return a;\n}\n'
    );
    const tools = createNativeTools(root);
    const edit = tools.find((item) => item.name === 'edit_file')!;
    const read = tools.find((item) => item.name === 'read_file')!;

    // Test deleting an unused import with whitespace differences
    await edit.invoke({
      path: 'src/sample.ts',
      target: 'import { unused } from "dep";\n',
      replacement: '',
    });
    let content = await read.invoke({ path: 'src/sample.ts' });
    expect(content).not.toContain('unused');

    // Test replacing indented code with unindented target
    await edit.invoke({
      path: 'src/sample.ts',
      target: 'const a = 1;\nreturn a;',
      replacement: '    return 42;',
    });
    content = await read.invoke({ path: 'src/sample.ts' });
    expect(content).toContain('return 42;');
  });
});
