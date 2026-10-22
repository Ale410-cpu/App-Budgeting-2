/**
 * Deduzione automatica della categoria di budget.
 *
 * Modulo separato (senza dipendenze) perche' venga usato sia dall'import
 * intelligente (`smartFileParser`) sia dal riconoscimento scontrini
 * (`receiptParser`), che non deve trascinare con se' pdf.js.
 */

export type CategoryKind = 'expense' | 'income';

/**
 * Deduce automaticamente la categoria in base al merchant o descrizione
 */
export function inferCategory(merchant: string, fallbackKind: CategoryKind = 'expense'): string {
  const text = merchant.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '');

  if (/stipendio|emolumenti|pensione|bonifico.*entr|rimborso|accredito.*stip|cedola|dividendo|compenso/i.test(text)) {
    return 'Entrate';
  }

  if (/coop|esselunga|conad|carrefour|lidl|eurospin|aldi|pam|despar|tigros|bennet|iper|penny|md|crai|supermerc|alimentar|market|grocery|ortofrutta|macelleria|panificio/i.test(text)) {
    return 'Supermercato / Spesa';
  }

  if (/bar|cafe|caffe|ristoran|pizz|mcdonald|burger king|starbucks|trattoria|sushi|osteria|deliveroo|just eat|glovo|uber eats|gelater|pub|birrer|bakery|poke/i.test(text)) {
    return 'Ristoranti & Bar';
  }

  if (/eni|q8|ip\s|esso|tamoil|carburante|benzina|distributore|autostrad|telepass|trenitalia|italo|ryanair|easyjet|atm\s|atac|taxi|uber|parking|parcheggio|pedaggio/i.test(text)) {
    return 'Trasporti';
  }

  if (/enel|a2a|hera|edison|acea|iren|sorgenia|fastweb|tim\s|vodafone|iliad|windtre|tiscali|plenitude|luce|gas|acqua|rifiuti|tari/i.test(text)) {
    return 'Utenze & Bollette';
  }

  if (/amazon|zalando|shein|zara|h&m|ikea|leroy merlin|decathlon|mediaworld|unieuro|apple|ebay|vinted|asos|mango|tezenis|calzedonia|douglas|sephora/i.test(text)) {
    return 'Shopping';
  }

  if (/farmacia|parafarmacia|dottor|medico|dentist|clinica|ospedale|ticket|synlab|ottica|fisioterap|palestra|piscina|fitness/i.test(text)) {
    return 'Salute & Benessere';
  }

  if (/affitto|mutuo|condominio|brico|idraulico|elettricista/i.test(text)) {
    return 'Casa';
  }

  if (/netflix|spotify|youtube|prime video|disney|dazn|apple\.com\/bill|icloud|chatgpt|openai|google|playstation|xbox|nintendo/i.test(text)) {
    return 'Abbonamenti';
  }

  return fallbackKind === 'income' ? 'Entrate' : 'Altro';
}
