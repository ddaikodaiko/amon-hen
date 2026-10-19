// Maritime Identification Digits (ITU) → flag. Covers the registries seen in the Baltic and
// the open registries common in the shadow fleet; anything else shows as "unknown".
const MID: Record<number, string> = {
  201: "Albania", 202: "Andorra", 203: "Austria", 204: "Portugal (Azores)", 205: "Belgium",
  206: "Belarus", 207: "Bulgaria", 208: "Vatican", 209: "Cyprus", 210: "Cyprus", 211: "Germany",
  212: "Cyprus", 213: "Georgia", 214: "Moldova", 215: "Malta", 216: "Armenia", 218: "Germany",
  219: "Denmark", 220: "Denmark", 224: "Spain", 225: "Spain", 226: "France", 227: "France",
  228: "France", 229: "Malta", 230: "Finland", 231: "Faroe Islands", 232: "United Kingdom",
  233: "United Kingdom", 234: "United Kingdom", 235: "United Kingdom", 236: "Gibraltar",
  237: "Greece", 238: "Croatia", 239: "Greece", 240: "Greece", 241: "Greece", 242: "Morocco",
  243: "Hungary", 244: "Netherlands", 245: "Netherlands", 246: "Netherlands", 247: "Italy",
  248: "Malta", 249: "Malta", 250: "Ireland", 251: "Iceland", 252: "Liechtenstein",
  253: "Luxembourg", 254: "Monaco", 255: "Portugal (Madeira)", 256: "Malta", 257: "Norway",
  258: "Norway", 259: "Norway", 261: "Poland", 262: "Montenegro", 263: "Portugal", 264: "Romania",
  265: "Sweden", 266: "Sweden", 267: "Slovakia", 268: "San Marino", 269: "Switzerland",
  270: "Czechia", 271: "Türkiye", 272: "Ukraine", 273: "Russia", 274: "North Macedonia",
  275: "Latvia", 276: "Estonia", 277: "Lithuania", 278: "Slovenia", 279: "Serbia",
  303: "United States", 304: "Antigua and Barbuda", 305: "Antigua and Barbuda", 306: "Curaçao",
  308: "Bahamas", 309: "Bahamas", 310: "Bermuda", 311: "Bahamas", 312: "Belize", 314: "Barbados",
  316: "Canada", 319: "Cayman Islands", 325: "Jamaica", 338: "United States", 339: "Jamaica",
  341: "Saint Kitts and Nevis", 345: "Mexico", 351: "Panama", 352: "Panama", 353: "Panama",
  354: "Panama", 355: "Panama", 356: "Panama", 357: "Panama", 366: "United States",
  367: "United States", 368: "United States", 369: "United States", 370: "Panama", 371: "Panama",
  372: "Panama", 373: "Panama", 374: "Panama", 375: "Saint Vincent and the Grenadines",
  376: "Saint Vincent and the Grenadines", 377: "Saint Vincent and the Grenadines",
  378: "British Virgin Islands", 412: "China", 413: "China", 414: "China", 416: "Taiwan",
  419: "India", 422: "Iran", 431: "Japan", 432: "Japan", 440: "South Korea", 441: "South Korea",
  445: "North Korea", 447: "Kuwait", 457: "Mongolia", 470: "United Arab Emirates",
  471: "United Arab Emirates", 477: "Hong Kong", 503: "Australia", 511: "Palau", 512: "New Zealand",
  518: "Cook Islands", 529: "Kiribati", 533: "Malaysia", 538: "Marshall Islands",
  548: "Philippines", 563: "Singapore", 564: "Singapore", 565: "Singapore", 566: "Singapore",
  567: "Thailand", 572: "Tuvalu", 574: "Vietnam", 576: "Vanuatu", 577: "Vanuatu",
  601: "South Africa", 610: "Benin", 613: "Cameroon", 620: "Comoros", 621: "Djibouti",
  622: "Egypt", 626: "Gabon", 627: "Ghana", 629: "Gambia", 630: "Guinea-Bissau",
  631: "Equatorial Guinea", 636: "Liberia", 637: "Liberia", 642: "Libya", 645: "Mauritius",
  657: "Nigeria", 663: "Senegal", 667: "Sierra Leone", 668: "São Tomé and Príncipe", 671: "Togo",
  674: "Tanzania", 677: "Tanzania", 701: "Argentina", 710: "Brazil", 725: "Chile",
  730: "Colombia", 735: "Ecuador", 760: "Peru", 770: "Uruguay", 775: "Venezuela",
};

/** First three digits of a ship MMSI. */
export function midOf(mmsi: number): number {
  return Math.floor(mmsi / 1_000_000);
}

export function flagOf(mmsi: number): string | null {
  return MID[midOf(mmsi)] ?? null;
}
