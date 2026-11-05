import * as path from 'path';
import * as vscode from 'vscode';
import type { ProposedFilePatchDto } from '../gateway/lyraClient';

export const LYRA_PATCH_SCHEME = 'lyra-patch';

export class PatchPreviewProvider implements vscode.TextDocumentContentProvider {
  public static readonly instance = new PatchPreviewProvider();

  private readonly emitter = new vscode.EventEmitter<vscode.Uri>();
  private readonly virtualDocs = new Map<string, string>();
  public readonly onDidChange = this.emitter.event;

  public registerSnapshot(key: string, content: string): vscode.Uri {
    this.virtualDocs.set(key, content);
    const uri = vscode.Uri.parse(`${LYRA_PATCH_SCHEME}://preview/${encodeURIComponent(key)}`);
    this.emitter.fire(uri);
    return uri;
  }

  public provideTextDocumentContent(uri: vscode.Uri): string {
    const key = decodeURIComponent(uri.path.replace(/^\//, ''));
    return this.virtualDocs.get(key) ?? '';
  }

  public static async openNativeDiffPreview(
    workspaceRoot: string,
    patch: ProposedFilePatchDto
  ): Promise<void> {
    const stamp = Date.now();
    const leftUri = patch.isNewFile
      ? PatchPreviewProvider.instance.registerSnapshot(
          `orig-${stamp}-${patch.filePath}`,
          ''
        )
      : vscode.Uri.file(path.join(workspaceRoot, patch.filePath));

    const rightUri = PatchPreviewProvider.instance.registerSnapshot(
      `next-${stamp}-${patch.filePath}`,
      patch.updatedContent
    );

    await vscode.commands.executeCommand(
      'vscode.diff',
      leftUri,
      rightUri,
      `Lyra Fast Patch: ${patch.filePath}`
    );
  }

  public static async applyPatchBundle(
    workspaceRoot: string,
    edits: ProposedFilePatchDto[]
  ): Promise<{ appliedCount: number }> {
    const workspaceEdit = new vscode.WorkspaceEdit();
    const targetUris: vscode.Uri[] = [];

    for (const item of edits) {
      const targetUri = vscode.Uri.file(path.join(workspaceRoot, item.filePath));
      targetUris.push(targetUri);

      if (item.isNewFile) {
        workspaceEdit.createFile(targetUri, { overwrite: true });
        workspaceEdit.insert(targetUri, new vscode.Position(0, 0), item.updatedContent);
      } else {
        const doc = await vscode.workspace.openTextDocument(targetUri);
        const lastLine = Math.max(0, doc.lineCount - 1);
        const fullRange = new vscode.Range(
          new vscode.Position(0, 0),
          doc.lineAt(lastLine).range.end
        );
        workspaceEdit.replace(targetUri, fullRange, item.updatedContent);
      }
    }

    const ok = await vscode.workspace.applyEdit(workspaceEdit);
    if (!ok) {
      throw new Error('VS Code declined applying the WorkspaceEdit.');
    }

    for (const uri of targetUris) {
      try {
        const doc = await vscode.workspace.openTextDocument(uri);
        if (doc.isDirty) {
          await doc.save();
        }
      } catch {
        // Ignore if file save is managed externally
      }
    }

    return { appliedCount: edits.length };
  }
}
