import { useEffect, useId, useRef, useState, type FocusEvent, type KeyboardEvent } from 'react';

type AutocompleteInputProps = {
  /** Valore corrente del campo (testo libero, esattamente come con un <datalist>). */
  value: string;
  onChange: (value: string) => void;
  /** Suggerimenti mostrati nell'elenco a comparsa. */
  options: string[];
  placeholder?: string;
  required?: boolean;
  ariaLabel?: string;
};

/**
 * Sostituto dell'accoppiata <input list> + <datalist>.
 *
 * Il popup nativo dei datalist in Chromium/Electron non può essere scorso
 * con la rotella del mouse né con il trackpad (limite noto del motore
 * Chromium) e su iOS i datalist vengono ignorati del tutto. Questo
 * componente renderizza l'elenco dei suggerimenti come una normale lista
 * DOM con overflow scorrevole (rotella, trackpad, scrollbar e tastiere),
 * navigabile anche con le frecce e selezionabile con Invio.
 */
export function AutocompleteInput({ value, onChange, options, placeholder, required, ariaLabel }: AutocompleteInputProps) {
  const listboxId = `autocomplete-listbox-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const [isOpen, setIsOpen] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const query = value.trim().toLowerCase();
  const filteredOptions = query
    ? options.filter((option) => option.toLowerCase().includes(query))
    : options;
  const showDropdown = isOpen && filteredOptions.length > 0;
  const activeOptionId =
    highlightIndex >= 0 && highlightIndex < filteredOptions.length ? `${listboxId}-option-${highlightIndex}` : undefined;

  // Aprendo l'elenco o modificando il testo si azzera l'evidenziazione da tastiera
  useEffect(() => {
    setHighlightIndex(-1);
  }, [value, isOpen]);

  // Mantiene in vista l'opzione evidenziata con le frecce
  useEffect(() => {
    if (!showDropdown || !activeOptionId) return;
    document.getElementById(activeOptionId)?.scrollIntoView({ block: 'nearest' });
  }, [highlightIndex, showDropdown, activeOptionId]);

  // Chiude l'elenco quando il focus esce dal componente
  const handleBlur = (event: FocusEvent<HTMLInputElement>) => {
    const nextTarget = event.relatedTarget as Node | null;
    if (nextTarget && containerRef.current && containerRef.current.contains(nextTarget)) return;
    setIsOpen(false);
  };

  const selectOption = (option: string) => {
    onChange(option);
    setIsOpen(false);
    inputRef.current?.focus();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (!showDropdown) {
      if (event.key === 'ArrowDown' && options.length > 0) {
        setIsOpen(true);
      }
      return;
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setHighlightIndex((index) => (filteredOptions.length > 0 ? (index + 1) % filteredOptions.length : -1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setHighlightIndex((index) => (index <= 0 ? filteredOptions.length - 1 : index - 1));
    } else if (event.key === 'Enter' && highlightIndex >= 0 && highlightIndex < filteredOptions.length) {
      // Se è evidenziata un'opzione la seleziona invece di inviare il modulo
      event.preventDefault();
      selectOption(filteredOptions[highlightIndex]);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      setIsOpen(false);
    }
  };

  return (
    <div className="autocomplete" ref={containerRef}>
      <input
        ref={inputRef}
        type="text"
        className="autocomplete-input"
        value={value}
        placeholder={placeholder}
        required={required}
        aria-label={ariaLabel}
        role="combobox"
        aria-expanded={showDropdown}
        aria-controls={listboxId}
        aria-activedescendant={activeOptionId}
        autoComplete="off"
        spellCheck={false}
        onChange={(event) => onChange(event.target.value)}
        onFocus={() => setIsOpen(true)}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
      />
      {showDropdown ? (
        <ul className="autocomplete-list" id={listboxId} role="listbox" aria-label={ariaLabel || 'Suggerimenti'}>
          {filteredOptions.map((option, index) => (
            <li
              key={option}
              id={`${listboxId}-option-${index}`}
              role="option"
              aria-selected={index === highlightIndex}
              className={`autocomplete-option${index === highlightIndex ? ' is-active' : ''}`}
              onMouseDown={(event) => {
                // preventDefault: seleziona senza togliere il focus al campo
                event.preventDefault();
                selectOption(option);
              }}
              onMouseEnter={() => setHighlightIndex(index)}
            >
              {option}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
