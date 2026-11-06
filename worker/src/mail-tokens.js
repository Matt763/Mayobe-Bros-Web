// Design tokens for every Mayobe Bros email (worker/src/mail-templates.js), the WCAG contrast function and the list
// of colour pairs the lint test checks (scripts/tests/email-templates.test.mjs). Hex colours only: no rgba, no
// gradients. The light palette must stand on its own, because Gmail on Android ignores @media and inverts colours
// by itself; the dark palette is used only by clients that honour prefers-color-scheme (Apple Mail, some others).

export const LIGHT = {
  page: '#f4f1ea',       // warm paper around the card
  card: '#fffffe',
  heading: '#0f1c2e',    // navy, Georgia headings
  body: '#374151',
  muted: '#4b5563',
  gold: '#7a5c00',       // eyebrow labels and small gold text (dark gold, readable on the card)
  link: '#1d4f91',       // always underlined
  button: '#0f1c2e',
  buttonText: '#ffffff',
  quote: '#f8f5ee',      // quoted comment / message block
  rule: '#e4ddcc',       // 1 px hairlines on the card (decorative)
  header: '#0f1c2e',
  wordmark: '#ffffff',
  hairline: '#c9a000',   // the gold accent line under the header (decorative)
  tile: '#ffffff',       // white tile behind the logo mark on the navy header
  footer: '#0b1520',
  footerText: '#c3cbd8',
  footerLink: '#e6c35c', // underlined
  footerRule: '#243246', // hairline inside the footer (decorative)
};

// Only the parts that change in dark mode. Header, footer and the logo tile are already dark-safe.
export const DARK = {
  page: '#0c121b',
  card: '#172131',
  heading: '#e8ebf0',
  body: '#e8ebf0',
  muted: '#a9b3c2',
  gold: '#e0b84a',
  link: '#8fb8ff',
  button: '#e0b84a',
  buttonText: '#0f1c2e',
  quote: '#1e2a3c',
  rule: '#2c3a4f',
};

export const FONT_SERIF = "Georgia,'Times New Roman',Times,serif";
export const FONT_SANS = "-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
export const SPACE = { xs: 8, s: 16, m: 24, l: 32, xl: 48 };

// Every hex colour a template may use.
export const TOKEN_HEX = new Set([...Object.values(LIGHT), ...Object.values(DARK)].map((c) => c.toLowerCase()));

// WCAG 2.x contrast ratio from relative luminance.
function luminance(hex) {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export function contrast(fgHex, bgHex) {
  const a = luminance(fgHex), b = luminance(bgHex);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

// [foreground, background, minimum ratio, label]. 4.5 for normal text; 3 only for large text (24 px+ or 14 px bold+).
// Every text colour is held to 4.5 here even where 3 would do, except where noted.
export const PAIRS = [
  [LIGHT.heading, LIGHT.card, 4.5, 'light heading on card'],
  [LIGHT.body, LIGHT.card, 4.5, 'light body on card'],
  [LIGHT.muted, LIGHT.card, 4.5, 'light muted on card'],
  [LIGHT.gold, LIGHT.card, 4.5, 'light gold eyebrow on card'],
  [LIGHT.link, LIGHT.card, 4.5, 'light link on card'],
  [LIGHT.buttonText, LIGHT.button, 4.5, 'light button text on button'],
  [LIGHT.body, LIGHT.quote, 4.5, 'light body on quote block'],
  [LIGHT.muted, LIGHT.quote, 4.5, 'light muted on quote block'],
  [LIGHT.link, LIGHT.quote, 4.5, 'light link on quote block'],
  [LIGHT.wordmark, LIGHT.header, 4.5, 'header wordmark on navy'],
  [LIGHT.footerText, LIGHT.footer, 4.5, 'footer text on footer'],
  [LIGHT.footerLink, LIGHT.footer, 4.5, 'footer link on footer'],
  [LIGHT.wordmark, LIGHT.footer, 4.5, 'footer wordmark on footer'],
  [DARK.heading, DARK.card, 4.5, 'dark heading on card'],
  [DARK.body, DARK.card, 4.5, 'dark body on card'],
  [DARK.muted, DARK.card, 4.5, 'dark muted on card'],
  [DARK.gold, DARK.card, 4.5, 'dark gold eyebrow on card'],
  [DARK.link, DARK.card, 4.5, 'dark link on card'],
  [DARK.buttonText, DARK.button, 4.5, 'dark button text on button'],
  [DARK.body, DARK.quote, 4.5, 'dark body on quote block'],
  [DARK.muted, DARK.quote, 4.5, 'dark muted on quote block'],
  [DARK.link, DARK.quote, 4.5, 'dark link on quote block'],
];

// Colours that carry no text, so no text-contrast rule applies. Listed so a reviewer can see they were left out on purpose.
export const DECORATIVE = [
  [LIGHT.hairline, LIGHT.header, 'gold accent line under the navy header'],
  [LIGHT.rule, LIGHT.card, '1 px hairline rules between card sections'],
  [LIGHT.tile, LIGHT.header, 'white tile behind the logo mark (the mark itself is the content)'],
  [LIGHT.footerRule, LIGHT.footer, 'hairline inside the footer'],
  [LIGHT.page, LIGHT.card, 'page colour around the card'],
  [LIGHT.gold, LIGHT.quote, 'gold left rule on the quote block'],
  [DARK.rule, DARK.card, 'dark-mode hairline rules'],
  [DARK.gold, DARK.quote, 'dark-mode gold left rule on the quote block'],
  [DARK.page, DARK.card, 'dark-mode page colour around the card'],
];
