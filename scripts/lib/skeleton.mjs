// The loading skeleton: what a visitor sees while a page's stylesheet is still on its way (slow phone networks), instead of a white screen.
//
// How it works, and why it cannot get stuck (see "Loading skeleton" in CLAUDE.md):
//  - The page's stylesheet link is the first thing in <body>, right after the skeleton markup (not in <head>). A stylesheet in the body
//    only holds back the content after it, so the browser can paint the skeleton while the stylesheet downloads. Browsers that do not
//    paint early simply behave as before (nothing until the stylesheet arrives); no unstyled content is ever shown.
//  - The skeleton's own CSS is inline (small), so it needs nothing from the network. It is shown only under html.js (set by the first
//    inline script), so a visitor without JavaScript never sees it.
//  - It fades in only after 150 ms (a page that loads faster never shows it) and fades out a moment after the stylesheet has loaded or failed,
//    when the document is parsed, when the window has loaded, or when a page comes back from the back-forward cache, whichever happens first.
//    A watchdog also looks every 5 seconds whether the stylesheet is already applied, and gives up after 90 seconds. Then the element is removed.
//    It has pointer-events: none, so even in the worst case it never blocks a click.
//  - A visitor who clicks a link inside the site (the referrer is this site and the tab already has history: a link opened in a new tab has none, and gets the skeleton) gets the stylesheet written into <head> instead, exactly as before the
//    skeleton existed: the browser then keeps showing the old page until the new one is ready (and the page-change fade still runs), and the
//    skeleton is never shown. The skeleton is for arriving cold, where the alternative is a blank white page.
//  - Only transform and opacity are animated (one shimmer band for the whole screen); reduced motion gets a still skeleton.
// Everything here is plain text (no text inside the skeleton, aria-hidden), so it adds nothing for search engines or screen readers.

const CSS = `
/* loading skeleton: shown only under html.js while the stylesheet is on its way */
.sk{display:none}
.sk{--sk-bg:#fff;--sk-bar:#e3e8f1;--sk-line:#dde4ef;--sk-glint:rgba(255,255,255,.75);--sk-glint-hero:rgba(255,255,255,.08)}
html.dark .sk{--sk-bg:#070b14;--sk-bar:#18233d;--sk-line:#1d2845;--sk-glint:rgba(150,180,255,.1);--sk-glint-hero:rgba(150,180,255,.07)}
html.js .sk{display:flex;flex-direction:column;position:fixed;inset:0;z-index:999;overflow:hidden;pointer-events:none;background:var(--sk-bg);opacity:0;visibility:hidden;transition:opacity .35s ease,visibility 0s linear .35s}
html.js.sk-on .sk{opacity:1;visibility:visible;transition:opacity .3s ease}
html.sk-shown body{animation:none}
.sk-top{position:relative;overflow:hidden;flex:none;border-bottom:1px solid var(--sk-line)}
.sk-head{display:flex;align-items:center;justify-content:space-between;height:4.2rem;padding-inline:2.5%}
.sk-logo{display:block;width:9.5rem;height:2.1rem;border-radius:.5rem;background:var(--sk-bar)}
.sk-acts{display:flex;gap:.7rem}
.sk-acts i{display:block;width:2.3rem;height:2.3rem;border-radius:50%;background:var(--sk-bar)}
.sk-nav{display:none}
.sk-hero{position:relative;overflow:hidden;flex:1;display:flex;align-items:center;background:linear-gradient(160deg,#0b1220 0%,#17223f 55%,#0b1220 100%)}
.sk-in{display:flex;flex-direction:column;align-items:center;gap:.9rem;width:100%;max-width:90rem;margin-inline:auto;padding:clamp(2rem,5vw,4.25rem) clamp(1rem,3.2vw,3.5rem)}
.sk-in>span,.sk-chips i{display:block;border-radius:.6rem;background:rgba(255,255,255,.14)}
.sk-pill{width:9rem;height:2rem;border-radius:999px!important}
.sk-t1,.sk-t2{height:clamp(2rem,4.6vw,3.6rem)}
.sk-t1{width:min(46rem,88%)}
.sk-t2{width:min(30rem,62%)}
.sk-sub{width:min(36rem,74%);height:1.2rem;margin-top:.4rem}
.sk-sub2{width:min(26rem,54%);height:1.2rem}
.sk-in>.sk-chips{display:flex;gap:.6rem;margin-top:.8rem;background:none}
.sk-chips i{width:6.5rem;height:2.4rem;border-radius:999px}
.sk-left .sk-hero{align-items:flex-end}
.sk-left .sk-in{align-items:flex-start}
@media (min-width:700px){.sk-head{height:4.75rem}}
@media (min-width:1280px){.sk-nav{display:flex;justify-content:center;align-items:center;gap:1.4rem;height:5rem}.sk-nav i{display:block;width:6rem;height:1.5rem;border-radius:.4rem;background:var(--sk-bar)}}
html.js.sk-on .sk-top::after,html.js.sk-on .sk-hero::after{content:"";position:absolute;inset:0;background:linear-gradient(100deg,transparent 30%,var(--sk-glint) 50%,transparent 70%);transform:translateX(-100%);animation:sk-sweep 1.7s ease-in-out infinite}
html.js.sk-on .sk-hero::after{background:linear-gradient(100deg,transparent 30%,var(--sk-glint-hero) 50%,transparent 70%)}
@keyframes sk-sweep{to{transform:translateX(100%)}}
@media (prefers-reduced-motion:reduce){html.js .sk{transition:none}html.js.sk-on .sk{transition:none}html.js.sk-on .sk-top::after,html.js.sk-on .sk-hero::after{animation:none;display:none}}
@media print{.sk{display:none!important}}
`;

// Collapse the stylesheet to one line (it sits in the <head> of every page).
export const skeletonCss = CSS.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((l) => l.trim()).filter(Boolean).join('');

// Plain ES5. One inline script, hashed into the page's Content-Security-Policy by the builder like the theme script before it.
// `href` is the stylesheet's address (with its version); it is written into <head> only for visitors who arrive from a page of this site.
export const skeletonScript = (href) => `(function(){try{var d=document,h=d.documentElement,t=0,done=0,n=0,inside=false;try{inside=!!d.referrer&&d.referrer.indexOf(location.origin+'/')===0&&history.length>1}catch(e){}if(inside)d.write('<link rel="stylesheet" href='+JSON.stringify(${JSON.stringify(href)})+'>');function leave(){if(done)return;done=1;clearTimeout(t);h.classList.remove('sk-on');setTimeout(function(){var s=d.querySelector('.sk');if(s&&s.parentNode)s.parentNode.removeChild(s)},700)}function sheet(e){var x=e.target;if(x&&x.tagName==='LINK'&&x.rel==='stylesheet')setTimeout(leave,150)}function watch(){setTimeout(function(){if(done)return;var on=false;try{on=getComputedStyle(d.body).marginTop==='0px'}catch(e){}if(on||d.readyState==='complete'||++n>17)leave();else watch()},5000)}if(!inside)t=setTimeout(function(){if(!done)h.classList.add('sk-on','sk-shown')},150);d.addEventListener('load',sheet,true);d.addEventListener('error',sheet,true);d.addEventListener('DOMContentLoaded',leave);addEventListener('load',leave);addEventListener('pageshow',function(e){if(e.persisted)leave()});watch()}catch(e){}})();`;

// aria-hidden, no text at all. The shapes follow the real first screen: header (logo, three buttons; the menu row on wide screens) and the dark hero
// (text centred on every page, except an article's hero, which sits bottom-left: `left`).
export const skeletonHtml = (left = false) => `<div class="sk${left ? ' sk-left' : ''}" aria-hidden="true"><div class="sk-top"><div class="sk-head"><span class="sk-logo"></span><span class="sk-acts"><i></i><i></i><i></i></span></div><div class="sk-nav"><i></i><i></i><i></i><i></i><i></i><i></i><i></i></div></div><div class="sk-hero"><div class="sk-in"><span class="sk-pill"></span><span class="sk-t1"></span><span class="sk-t2"></span><span class="sk-sub"></span><span class="sk-sub2"></span><span class="sk-chips"><i></i><i></i></span></div></div></div>`;
