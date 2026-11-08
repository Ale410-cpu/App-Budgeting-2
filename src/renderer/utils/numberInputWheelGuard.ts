/**
 * Wheel guard per i campi numerici (importi, limiti, quote...).
 *
 * In Chromium (Electron), Firefox e Safari, scorrere con la rotella del mouse
 * o il trackpad sopra un `<input type="number">` ne modifica il valore
 * (comportamento "spin"). Nell'app questo cambiava l'importo appena inserito
 * non appena l'utente scorreva la pagina con il puntatore sul campo.
 *
 * L'handler intercetta l'evento `wheel` in fase di cattura su `document` e:
 *  - blocca l'azione predefinita (`preventDefault`) quando il puntatore si
 *    trova sopra un input numerico, così il valore non può più cambiare;
 *  - rimuove il focus dal campo come rete di sicurezza, per coprire anche i
 *    motori che gestiscono lo "spin" tramite listener interni.
 *
 * Effetto collaterale positivo: nei browser che eseguono lo spin anche senza
 * focus (es. Safari) si ripristina il normale scorrimento della pagina.
 */
export function preventWheelSpinOnNumberInputs(root: Document = document): () => void {
  const handleWheel = (event: WheelEvent) => {
    const target = event.target as HTMLElement | null;
    if (!target || typeof target.closest !== 'function') return;
    const input = target.closest('input[type="number"]') as HTMLInputElement | null;
    if (!input) return;

    event.preventDefault();

    // Rete di sicurezza: senza focus nessun motore può più modificare il valore.
    if (root.activeElement === input) input.blur();
  };

  root.addEventListener('wheel', handleWheel, { capture: true, passive: false });

  return () => root.removeEventListener('wheel', handleWheel, true);
}
