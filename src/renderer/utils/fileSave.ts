/**
 * Salvataggio dei file generati dall'app (export JSON, Excel, template).
 *
 * Su macOS (Electron) e sul web il download avviene con l'elemento `<a>` e un
 * `blob:` URL. Su iOS non esiste il download "classico" del browser: il file
 * viene passato al bridge nativo, che apre il picker di sistema (Files,
 * iCloud Drive, ...) e lascia scegliere all'utente dove salvarlo.
 */

export interface SaveFileResult {
  success: boolean;
  message?: string;
  error?: string;
}

/** Converte un Blob in base64 (formato atteso dal bridge nativo). */
function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Impossibile leggere il contenuto del file'));
    reader.onload = () => {
      const result = String(reader.result || '');
      const commaIndex = result.indexOf(',');
      resolve(commaIndex >= 0 ? result.slice(commaIndex + 1) : result);
    };
    reader.readAsDataURL(blob);
  });
}

/**
 * Salva un file. Ritorna `true` se il salvataggio e' andato a buon fine.
 * Non solleva errori: il fallimento viene gestito dal chiamante.
 */
export async function saveGeneratedFile(fileName: string, blob: Blob): Promise<SaveFileResult> {
  const bridge = window.budgetApp as any;

  // iOS (e futuri bridge nativi): il file passa dal picker di sistema.
  if (bridge && typeof bridge.saveFile === 'function') {
    try {
      const content = await blobToBase64(blob);
      const result = await bridge.saveFile({ fileName, content, mimeType: blob.type });
      if (result?.success) {
        return { success: true, message: result.message };
      }
      if (result?.canceled) {
        return { success: false, message: 'Salvataggio annullato.' };
      }
      return { success: false, error: result?.error || 'Salvataggio non riuscito.' };
    } catch (error: any) {
      return { success: false, error: error?.message || 'Salvataggio non riuscito.' };
    }
  }

  // Desktop / web: download tradizionale.
  try {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    return { success: true };
  } catch (error: any) {
    return { success: false, error: error?.message || 'Salvataggio non riuscito.' };
  }
}
