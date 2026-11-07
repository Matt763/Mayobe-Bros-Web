// Design tokens for every Mayobe Bros email (worker/src/mail-templates.js), the WCAG contrast function and the list
// of colour pairs the lint test checks (scripts/tests/email-templates.test.mjs). Hex colours only: no rgba, no
// gradients. The light palette must stand on its own, because Gmail on Android ignores @media and inverts colours
// by itself; the dark palette is used only by clients that honour prefers-color-scheme (Apple Mail, some others).
//
// The colours are the site's own (css/style.css :root and :root.dark); the test 'email tokens follow css/style.css'
// fails when the two drift apart. Checked 2026-11-07: every text pair below is at least 8.37:1.

export const LIGHT = {
  page: '#f3f6fb',       // the site's cool grey section colour (--bg-alt) around the card
  card: '#fffffe',       // white; one step off #ffffff so some clients do not invert it
  border: '#dde4ef',     // 1 px card border (--line-soft)
  heading: '#0b1220',    // --text
  body: '#1b2434',       // --text-2
  muted: '#364154',      // --text-3
  kicker: '#1e3a9e',     // blue uppercase labels above headings (the site's .kicker)
  link: '#1e3a9e',       // always underlined (--link)
  button: '#1e3a9e',     // royal blue pill (--btn-bg)
  buttonText: '#ffffff',
  quote: '#f3f6fb',      // quoted comment / message block
  quoteRule: '#1e3a9e',  // 4 px rule on the left of the quote block (decorative)
  rule: '#dde4ef',       // 1 px hairlines on the card (decorative)
  header: '#ffffff',     // white header row behind the colour wordmark, like the site header
  logoAlt: '#1e3a9e',    // the logo's alt text when pictures are blocked
  barGreen: '#3f9b4d',   // 4 px bar under the header: the green of "Mayobe" ...
  barBlue: '#1e3a9e',    // ... and the blue of "Bros" (decorative)
  imageBg: '#e9eef7',    // picture slots, so a blocked picture keeps a tinted box (--surface-2)
  imageAlt: '#364154',   // alt text inside a picture slot
  footer: '#060a14',     // the site's near-black footer
  footerText: '#d3dcee',
  footerLink: '#ffffff', // underlined
  footerRule: '#1f2d4d', // hairline inside the footer (decorative)
  wordmark: '#ffffff',   // "Mayobe" in the footer name
  footerAccent: '#a8c8ff', // "Bros" in the footer name, like the light-blue "Bros" in the site's hero title
};

// Only the parts that change in dark mode (the site's :root.dark). Footer and the green/blue bar are already dark-safe.
export const DARK = {
  page: '#070b14',
  card: '#101a2e',
  border: '#1f2d4d',
  heading: '#f8fafc',
  body: '#e6ecf6',
  muted: '#c5cfe2',
  kicker: '#a8c8ff',
  link: '#a8c8ff',
  button: '#8ab6ff',
  buttonText: '#04112b',
  quote: '#182545',
  quoteRule: '#8ab6ff',
  rule: '#1f2d4d',
  header: '#101a2e',
  logoAlt: '#a8c8ff',
  imageBg: '#182545',
  imageAlt: '#c5cfe2',
};

// The site's system stack (css/style.css body) without ui-sans-serif/system-ui, which some mail clients mishandle.
export const FONT_SANS = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,'Noto Sans',sans-serif";
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
// Every text colour is held to 4.5 here even where 3 would do.
export const PAIRS = [
  [LIGHT.heading, LIGHT.card, 4.5, 'light heading on card'],
  [LIGHT.body, LIGHT.card, 4.5, 'light body on card'],
  [LIGHT.muted, LIGHT.card, 4.5, 'light muted on card'],
  [LIGHT.kicker, LIGHT.card, 4.5, 'light kicker on card'],
  [LIGHT.link, LIGHT.card, 4.5, 'light link on card'],
  [LIGHT.buttonText, LIGHT.button, 4.5, 'light button text on button'],
  [LIGHT.logoAlt, LIGHT.header, 4.5, 'light logo alt on header'],
  [LIGHT.imageAlt, LIGHT.imageBg, 4.5, 'light image alt on image slot'],
  [LIGHT.heading, LIGHT.quote, 4.5, 'light heading on quote block (owner commands)'],
  [LIGHT.body, LIGHT.quote, 4.5, 'light body on quote block'],
  [LIGHT.muted, LIGHT.quote, 4.5, 'light muted on quote block'],
  [LIGHT.link, LIGHT.quote, 4.5, 'light link on quote block'],
  [LIGHT.footerText, LIGHT.footer, 4.5, 'footer text on footer'],
  [LIGHT.footerLink, LIGHT.footer, 4.5, 'footer link on footer'],
  [LIGHT.wordmark, LIGHT.footer, 4.5, 'footer wordmark on footer'],
  [LIGHT.footerAccent, LIGHT.footer, 4.5, 'footer wordmark accent on footer'],
  [DARK.heading, DARK.card, 4.5, 'dark heading on card'],
  [DARK.body, DARK.card, 4.5, 'dark body on card'],
  [DARK.muted, DARK.card, 4.5, 'dark muted on card'],
  [DARK.kicker, DARK.card, 4.5, 'dark kicker on card'],
  [DARK.link, DARK.card, 4.5, 'dark link on card'],
  [DARK.buttonText, DARK.button, 4.5, 'dark button text on button'],
  [DARK.logoAlt, DARK.header, 4.5, 'dark logo alt on header'],
  [DARK.imageAlt, DARK.imageBg, 4.5, 'dark image alt on image slot'],
  [DARK.heading, DARK.quote, 4.5, 'dark heading on quote block (owner commands)'],
  [DARK.body, DARK.quote, 4.5, 'dark body on quote block'],
  [DARK.muted, DARK.quote, 4.5, 'dark muted on quote block'],
  [DARK.link, DARK.quote, 4.5, 'dark link on quote block'],
];

// Colours that carry no text, so no text-contrast rule applies. Listed so a reviewer can see they were left out on purpose.
export const DECORATIVE = [
  [LIGHT.border, LIGHT.page, '1 px card border on the page colour'],
  [LIGHT.page, LIGHT.card, 'page colour around the card'],
  [LIGHT.rule, LIGHT.card, '1 px hairline rules between card sections'],
  [LIGHT.barGreen, LIGHT.header, 'green half of the 4 px bar under the header'],
  [LIGHT.barBlue, LIGHT.header, 'blue half of the 4 px bar under the header'],
  [LIGHT.quoteRule, LIGHT.quote, '4 px blue rule on the left of the quote block'],
  [LIGHT.imageBg, LIGHT.card, 'tinted picture slot (shows only while a picture is blocked or loading)'],
  [LIGHT.footerRule, LIGHT.footer, 'hairline inside the footer'],
  [DARK.border, DARK.page, 'dark-mode card border'],
  [DARK.page, DARK.card, 'dark-mode page colour around the card'],
  [DARK.rule, DARK.card, 'dark-mode hairline rules'],
  [DARK.quoteRule, DARK.quote, 'dark-mode rule on the left of the quote block'],
  [DARK.imageBg, DARK.card, 'dark-mode picture slot'],
  [LIGHT.barBlue, DARK.header, 'blue half of the bar on the dark header (the green half and the logo plate carry the brand)'],
];
