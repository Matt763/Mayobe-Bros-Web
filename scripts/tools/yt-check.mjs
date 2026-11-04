#!/usr/bin/env node
// Checks that a YouTube video exists and may be embedded, and prints its real title and channel, so a post only embeds a video that
// matches what its caption says.   node scripts/tools/yt-check.mjs https://youtu.be/VIDEOID [more urls]
// 200 = exists and can be embedded. 401/403 = embedding is switched off or it is private: do not use it. 404 = no such video.
for (const url of process.argv.slice(2)) {
  try {
    const r = await fetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(url)}`, { signal: AbortSignal.timeout(20000) });
    if (!r.ok) { console.log(`${r.status}  NOT USABLE  ${url}`); continue; }
    const j = await r.json();
    console.log(`200  OK  ${url}\n     title:   ${j.title}\n     channel: ${j.author_name}`);
  } catch (e) { console.log(`ERR  ${url}  ${e.message}`); }
}
