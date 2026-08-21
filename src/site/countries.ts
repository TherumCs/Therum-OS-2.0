// Shared country picker. A <select> — never a maxlength=2 text input — because
// browser autofill drops the full name ("United States", 13 chars) into a coded
// field, which fails every `country.length === 2` gate and dead-ends checkout
// with no way to fix it. This was the live checkout-blocking bug; it existed on
// three surfaces (checkout, the on-card buy box, the account address book), so
// the fix lives in ONE place used by all three.
//
// Full ISO-3166-1 alpha-2 list so no shopper is blocked at the country field;
// whether an order can actually ship is decided later by the shipping quote,
// not by truncating this list. United States is first, so it stays preselected.

export const COUNTRIES: [string, string][] = [
  ['US', 'United States'], ['CA', 'Canada'], ['GB', 'United Kingdom'], ['AU', 'Australia'],
  ['IE', 'Ireland'], ['NZ', 'New Zealand'],
  ['AF', 'Afghanistan'], ['AX', 'Åland Islands'], ['AL', 'Albania'], ['DZ', 'Algeria'],
  ['AS', 'American Samoa'], ['AD', 'Andorra'], ['AO', 'Angola'], ['AI', 'Anguilla'],
  ['AG', 'Antigua and Barbuda'], ['AR', 'Argentina'], ['AM', 'Armenia'], ['AW', 'Aruba'],
  ['AT', 'Austria'], ['AZ', 'Azerbaijan'], ['BS', 'Bahamas'], ['BH', 'Bahrain'],
  ['BD', 'Bangladesh'], ['BB', 'Barbados'], ['BY', 'Belarus'], ['BE', 'Belgium'],
  ['BZ', 'Belize'], ['BJ', 'Benin'], ['BM', 'Bermuda'], ['BT', 'Bhutan'],
  ['BO', 'Bolivia'], ['BA', 'Bosnia and Herzegovina'], ['BW', 'Botswana'], ['BR', 'Brazil'],
  ['BN', 'Brunei'], ['BG', 'Bulgaria'], ['BF', 'Burkina Faso'], ['BI', 'Burundi'],
  ['KH', 'Cambodia'], ['CM', 'Cameroon'], ['CV', 'Cape Verde'], ['KY', 'Cayman Islands'],
  ['CF', 'Central African Republic'], ['TD', 'Chad'], ['CL', 'Chile'], ['CN', 'China'],
  ['CO', 'Colombia'], ['KM', 'Comoros'], ['CG', 'Congo'], ['CD', 'Congo (DRC)'],
  ['CR', 'Costa Rica'], ['CI', "Côte d'Ivoire"], ['HR', 'Croatia'], ['CU', 'Cuba'],
  ['CW', 'Curaçao'], ['CY', 'Cyprus'], ['CZ', 'Czechia'], ['DK', 'Denmark'],
  ['DJ', 'Djibouti'], ['DM', 'Dominica'], ['DO', 'Dominican Republic'], ['EC', 'Ecuador'],
  ['EG', 'Egypt'], ['SV', 'El Salvador'], ['GQ', 'Equatorial Guinea'], ['ER', 'Eritrea'],
  ['EE', 'Estonia'], ['SZ', 'Eswatini'], ['ET', 'Ethiopia'], ['FO', 'Faroe Islands'],
  ['FJ', 'Fiji'], ['FI', 'Finland'], ['FR', 'France'], ['GF', 'French Guiana'],
  ['PF', 'French Polynesia'], ['GA', 'Gabon'], ['GM', 'Gambia'], ['GE', 'Georgia'],
  ['DE', 'Germany'], ['GH', 'Ghana'], ['GI', 'Gibraltar'], ['GR', 'Greece'],
  ['GL', 'Greenland'], ['GD', 'Grenada'], ['GP', 'Guadeloupe'], ['GU', 'Guam'],
  ['GT', 'Guatemala'], ['GG', 'Guernsey'], ['GN', 'Guinea'], ['GW', 'Guinea-Bissau'],
  ['GY', 'Guyana'], ['HT', 'Haiti'], ['HN', 'Honduras'], ['HK', 'Hong Kong'],
  ['HU', 'Hungary'], ['IS', 'Iceland'], ['IN', 'India'], ['ID', 'Indonesia'],
  ['IR', 'Iran'], ['IQ', 'Iraq'], ['IM', 'Isle of Man'], ['IL', 'Israel'],
  ['IT', 'Italy'], ['JM', 'Jamaica'], ['JP', 'Japan'], ['JE', 'Jersey'],
  ['JO', 'Jordan'], ['KZ', 'Kazakhstan'], ['KE', 'Kenya'], ['KI', 'Kiribati'],
  ['KW', 'Kuwait'], ['KG', 'Kyrgyzstan'], ['LA', 'Laos'], ['LV', 'Latvia'],
  ['LB', 'Lebanon'], ['LS', 'Lesotho'], ['LR', 'Liberia'], ['LY', 'Libya'],
  ['LI', 'Liechtenstein'], ['LT', 'Lithuania'], ['LU', 'Luxembourg'], ['MO', 'Macao'],
  ['MG', 'Madagascar'], ['MW', 'Malawi'], ['MY', 'Malaysia'], ['MV', 'Maldives'],
  ['ML', 'Mali'], ['MT', 'Malta'], ['MH', 'Marshall Islands'], ['MQ', 'Martinique'],
  ['MR', 'Mauritania'], ['MU', 'Mauritius'], ['MX', 'Mexico'], ['FM', 'Micronesia'],
  ['MD', 'Moldova'], ['MC', 'Monaco'], ['MN', 'Mongolia'], ['ME', 'Montenegro'],
  ['MS', 'Montserrat'], ['MA', 'Morocco'], ['MZ', 'Mozambique'], ['MM', 'Myanmar'],
  ['NA', 'Namibia'], ['NR', 'Nauru'], ['NP', 'Nepal'], ['NL', 'Netherlands'],
  ['NC', 'New Caledonia'], ['NI', 'Nicaragua'], ['NE', 'Niger'], ['NG', 'Nigeria'],
  ['MK', 'North Macedonia'], ['NO', 'Norway'], ['OM', 'Oman'], ['PK', 'Pakistan'],
  ['PW', 'Palau'], ['PS', 'Palestine'], ['PA', 'Panama'], ['PG', 'Papua New Guinea'],
  ['PY', 'Paraguay'], ['PE', 'Peru'], ['PH', 'Philippines'], ['PL', 'Poland'],
  ['PT', 'Portugal'], ['PR', 'Puerto Rico'], ['QA', 'Qatar'], ['RE', 'Réunion'],
  ['RO', 'Romania'], ['RU', 'Russia'], ['RW', 'Rwanda'], ['WS', 'Samoa'],
  ['SM', 'San Marino'], ['SA', 'Saudi Arabia'], ['SN', 'Senegal'], ['RS', 'Serbia'],
  ['SC', 'Seychelles'], ['SL', 'Sierra Leone'], ['SG', 'Singapore'], ['SX', 'Sint Maarten'],
  ['SK', 'Slovakia'], ['SI', 'Slovenia'], ['SB', 'Solomon Islands'], ['SO', 'Somalia'],
  ['ZA', 'South Africa'], ['KR', 'South Korea'], ['SS', 'South Sudan'], ['ES', 'Spain'],
  ['LK', 'Sri Lanka'], ['KN', 'Saint Kitts and Nevis'], ['LC', 'Saint Lucia'],
  ['VC', 'Saint Vincent and the Grenadines'], ['SD', 'Sudan'], ['SR', 'Suriname'],
  ['SE', 'Sweden'], ['CH', 'Switzerland'], ['SY', 'Syria'], ['TW', 'Taiwan'],
  ['TJ', 'Tajikistan'], ['TZ', 'Tanzania'], ['TH', 'Thailand'], ['TL', 'Timor-Leste'],
  ['TG', 'Togo'], ['TO', 'Tonga'], ['TT', 'Trinidad and Tobago'], ['TN', 'Tunisia'],
  ['TR', 'Turkey'], ['TM', 'Turkmenistan'], ['TC', 'Turks and Caicos Islands'], ['TV', 'Tuvalu'],
  ['UG', 'Uganda'], ['UA', 'Ukraine'], ['AE', 'United Arab Emirates'], ['UY', 'Uruguay'],
  ['UZ', 'Uzbekistan'], ['VU', 'Vanuatu'], ['VA', 'Vatican City'], ['VE', 'Venezuela'],
  ['VN', 'Vietnam'], ['VG', 'British Virgin Islands'], ['VI', 'U.S. Virgin Islands'],
  ['YE', 'Yemen'], ['ZM', 'Zambia'], ['ZW', 'Zimbabwe'],
];

const OPTIONS = COUNTRIES.map(([code, name], i) => `<option value="${code}"${i === 0 ? ' selected' : ''}>${name}</option>`).join('');

/** A country <select> with the given attributes string (id/class/data-hooks). US preselected. */
export function countrySelect(attrs: string): string {
  return `<select ${attrs}>${OPTIONS}</select>`;
}
