# Home hero video

Plain notes on why the home hero video is built the way it is (written 2026-11-22). The owner's rule: it must play on weak phones and poor networks, look as good as the source, and never show raw HTML while loading.

## Files
`node scripts/tools/make-hero-video.mjs /path/to/source.mp4` writes `assets/video/home/mayobebros-{240,360,480,720,1080}.{webm,mp4}` and the still pictures `assets/img/hero*.webp`. It needs `ffmpeg` and `cwebp`. The source stays outside the repository.

| Size | WebM (VP9) | MP4 (H.264) | Used for |
| --- | --- | --- | --- |
| 240 (12.5 fps) | 73 KB | 171 KB | 2G, very slow lines, the weakest phones |
| 360 | 253 KB | 421 KB | 3G, Save-Data |
| 480 | 461 KB | 830 KB | small screens on a fair line |
| 720 | 1.0 MB | 2.2 MB | most screens |
| 1080 | 2.0 MB | 5.6 MB | large screens on a fast line |

## Why
- Muted, looping, `playsinline`: the only combination every browser lets start by itself (web.dev, "Replace animated GIFs with video").
- MP4 `+faststart` puts the index first, so playback starts before the file has arrived. WebM is about half the size; Apple's browsers get MP4 (hardware decoding).
- The first frame is a picture (the same frame as the video), so the page paints at once and nothing jumps when the video fades in; the picture is also the fallback (no script, reduced motion, a refused autoplay).
- The player watches itself (stalls, dropped frames, no start in 10 s) and steps down one size; if the smallest cannot play, it stops. It pauses when off screen or in a hidden tab, and has a pause button (WCAG 2.2.2).

## Sources
- web.dev: https://web.dev/articles/replace-gifs-with-videos
- MDN, Multimedia: video: https://developer.mozilla.org/en-US/docs/Learn_web_development/Extensions/Performance/video
- Pexels licence (free for commercial use, credit not required): https://help.pexels.com/hc/en-us/articles/360042295174-What-is-the-license-of-the-photos-and-videos-on-Pexels
