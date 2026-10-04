/** ISO 3166-1 alpha-2 codes for common country names (deterministic offline mapping for ISO-coded country columns). */
const MAP: Record<string, string> = {
  afghanistan: 'AF', albania: 'AL', algeria: 'DZ', argentina: 'AR', australia: 'AU', austria: 'AT', bangladesh: 'BD', belgium: 'BE', brazil: 'BR', bulgaria: 'BG', canada: 'CA', chile: 'CL', china: 'CN', colombia: 'CO', croatia: 'HR', cyprus: 'CY',
  'czech republic': 'CZ', czechia: 'CZ', denmark: 'DK', egypt: 'EG', estonia: 'EE', finland: 'FI', france: 'FR', germany: 'DE', greece: 'GR', 'hong kong': 'HK', hungary: 'HU', iceland: 'IS', india: 'IN', indonesia: 'ID', ireland: 'IE', israel: 'IL', italy: 'IT',
  japan: 'JP', kenya: 'KE', latvia: 'LV', lithuania: 'LT', luxembourg: 'LU', malaysia: 'MY', malta: 'MT', mexico: 'MX', morocco: 'MA', netherlands: 'NL', 'the netherlands': 'NL', holland: 'NL', 'new zealand': 'NZ', nigeria: 'NG', norway: 'NO', pakistan: 'PK',
  peru: 'PE', philippines: 'PH', poland: 'PL', portugal: 'PT', romania: 'RO', russia: 'RU', 'saudi arabia': 'SA', serbia: 'RS', singapore: 'SG', slovakia: 'SK', slovenia: 'SI', 'south africa': 'ZA', 'south korea': 'KR', korea: 'KR', spain: 'ES', 'sri lanka': 'LK',
  sweden: 'SE', switzerland: 'CH', taiwan: 'TW', thailand: 'TH', turkey: 'TR', 'turkiye': 'TR', ukraine: 'UA', 'united arab emirates': 'AE', uae: 'AE', 'united kingdom': 'GB', uk: 'GB', 'great britain': 'GB', britain: 'GB', england: 'GB', 'united states': 'US', usa: 'US', 'united states of america': 'US', vietnam: 'VN'
};
export function countryNameToIso2(name: string): string | null { return MAP[String(name || '').trim().toLowerCase().replace(/\s+/g, ' ')] ?? null; }
