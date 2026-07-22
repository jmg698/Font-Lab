# Making a Font Lab demo with Screen Studio — a beginner's guide

> You don't need to be a video editor. Screen Studio's whole pitch is *record clean,
> get polished automatically.* This guide teaches the tool from zero, then hands you a
> shot‑by‑shot storyboard tuned to the one thing that makes Font Lab hard to film: it's
> **keyboard‑driven** and its **changes are subtle** (fonts, not fireworks). Get those
> two things right and the demo sells itself.

Screen Studio is macOS‑only. Font Lab's live panel also runs happily on a Mac, so the
natural setup is: run Font Lab locally, record it with Screen Studio, narrate after.

---

## Part 0 — The 60‑second mental model

Traditional screen recording gives you a raw, jittery capture that you then spend an
afternoon editing. Screen Studio flips that: you record a clean take, and it applies the
"expensive‑looking" polish for you.

Four things it does automatically, so you don't have to:

| It does this | So your raw take can be |
|---|---|
| **Auto‑zoom** — pushes in where your cursor acts, with smooth eased transitions | filmed at normal distance; it finds the focus |
| **Cursor smoothing** — turns shaky mouse paths into a clean glide, hides the cursor when idle | a little imprecise; it cleans the motion |
| **Backgrounds + framing** — wallpaper, padding, rounded corners, a soft shadow | captured on a plain screen; it makes it look designed |
| **Audio cleanup** — normalizes voice volume, removes background hiss | recorded on a normal mic |

Everything is **on‑device** — nothing uploads — so recording an unreleased product is fine.

**The one reframe for beginners:** your job during recording is *clean execution*, not
*perfect framing*. Move deliberately, pause between beats, don't narrate yet. You'll add
zooms, captions, and voice in the editor — which is where the actual "directing" happens.

---

## Part 1 — Plan the demo before you touch Record

The #1 beginner mistake is hitting record with no story. A demo is not "here's every
feature" — it's **one clear arc**. For Font Lab the arc is already written for you, and
it's the thing nothing else does: **the choosing moment.**

> Problem → Invoke → **Choose (the hero)** → Ship → Payoff.

Write your beats on a sticky note before recording. Here's the whole story in five lines:

1. **Problem** — this AI‑built site looks like every other one (Inter/Geist).
2. **Invoke** — "use Font Lab to pick fonts." It asks what you're going for.
3. **Choose** — flip real font directions on your *real* page, before/after, mix, compare. ← spend your time here
4. **Ship** — the agent writes the real `next/font` + Tailwind code, reversibly.
5. **Payoff** — the site now has a point of view. *The taste stayed human.*

Keep the whole thing **60–90 seconds.** A README hero video or a launch clip lives or
dies on the first 10 seconds and the choosing moment; everything else is connective tissue.

**Decide the aspect ratio up front — it changes how you record:**

| Where it's going | Ratio | Note |
|---|---|---|
| README / website hero / YouTube | 16:9 | the default; most room for the panel + page |
| Twitter/X, LinkedIn feed | 1:1 or 16:9 | square stops the scroll |
| Reels / TikTok / Shorts | 9:16 | you'll crop tight — plan for one thing on screen at a time |

---

## Part 2 — One‑time setup

**Install & permissions.** Download Screen Studio (screen.studio — paid app, free trial;
check the site for current pricing). On first launch macOS will ask you to grant
**Screen Recording**, **Microphone**, and **Camera** permissions in *System Settings →
Privacy & Security*. Do it now so you're not fighting a permission dialog mid‑take.

**Set your recording quality.** Record on the Mac's native retina display if you can —
Screen Studio captures at retina resolution, which is what keeps the zoomed‑in text crisp
instead of mushy. That sharpness matters more for Font Lab than almost any other app,
because the whole point is *how the type looks.*

**Stage the environment (Font Lab specifics):**

- **A real‑looking site, not lorem ipsum.** Font Lab's magic is "your real content." Point
  it at a page with actual headlines, body copy, and a bit of UI — a hero, a dense text
  section, a form. (The fixture even ships `/`, `/dense`, `/form` routes for exactly this.)
- **Clean the screen.** Hide desktop icons, silence notifications (turn on Do Not Disturb),
  close unrelated tabs, and empty the browser of bookmarks bars and extension clutter.
- **Bump the browser zoom** to ~110–125% so the panel and the type read well before Screen
  Studio even zooms. Big, legible starting state = less work later.
- **Pre‑warm Font Lab.** Have the dev server and the panel already running and connected
  (the panel shows *ENDPOINT READY* / *AGENT LISTENING*) so you're not filming a spinner.
  Do a dry run of your key sequence once — flip, before/after, mix, pick — so your hands
  know the path.
- **Prep a clean terminal** if you're showing the install/agent step: large font, minimal
  prompt, cleared scrollback.

---

## Part 3 — Recording the take

**Pick the recording mode** from Screen Studio's picker: whole display, a single window,
or a selected area. For Font Lab, **single window** (your browser) usually frames best —
it lets Screen Studio put a nice background *around* your page. Select your **mic** in the
same picker; skip the **webcam** for a product demo unless you specifically want a talking‑
head corner (it can pull focus from the type).

**Start/stop:** Screen Studio records via a global shortcut you can set (and trigger even
when the app's in the background). Press **⌘ + /** in the editor any time to see the full,
authoritative shortcut list for your version — don't memorize mine, check that panel.

Now the four habits that make a Font Lab take usable:

1. **Turn ON "show keyboard shortcuts."** This is the single most important setting for
   Font Lab. The app can display the keys you press as on‑screen badges — so when you tap
   `←` `→` `B` `space`, the viewer *sees* those keys. Font Lab is driven by the keyboard,
   so without this the page just changes "by magic" and viewers can't follow. With it, your
   demo doubles as a tutorial.
2. **Record silent; narrate later.** Don't talk while you drive. You'll do a cleaner take
   and write tighter narration afterward. (Capture‑first‑narrate‑after is the pro default.)
3. **Move deliberately, and *pause on the beat*.** After each meaningful change — a flip, a
   before/after, the Pick — stop moving for a full second. Those pauses are where you'll
   later place a zoom and let it breathe. Fast, continuous motion gives the editor nothing
   to work with.
4. **Do the hero twice.** Record the choosing sequence, pause, and do it again slightly
   slower. Takes are cheap; you'll keep the better one.

> Because you're capturing keystrokes and pausing on beats, a 75‑second demo might take a
> 3–4 minute raw recording. That's normal — you'll trim it down to the good parts.

---

## Part 4 — Editing: where a raw take becomes a demo

Open the recording in Screen Studio's editor. Here's what to actually do, in order.

### 1. Trim the dead air
Cut the start/end fumbling and any long pauses that aren't doing dramatic work. Timeline
trimming is drag‑the‑edges simple. Ruthlessness here is what makes it feel snappy.

### 2. Zooms — the part beginners get wrong for Font Lab
Auto‑zoom follows **clicks**. Font Lab is driven by the **keyboard**, so auto‑zoom will
mostly sit still during your most important moments. **You'll add those zooms manually** —
and that's a feature, not a chore, because you get to point the camera exactly at the type.

Where to place manual zooms:

- **Into a headline** as you flip directions, so the viewer sees the *letterforms* change,
  not just a vague reflow.
- **On the panel** when you introduce it (the direction list, the role rows), then **pull
  back** to show the whole page reacting.
- **On the before/after** moment — tight on one heading while you toggle `B`.
- **On the drawn checkmark** at Pick, and **on the code/diff** when the agent ships.

Rule of thumb from every demo pro: **one or two well‑placed zooms per beat, never a dozen.**
Too much zooming makes people seasick and buries the thing you're selling.

### 3. Cursor
Leave smoothing on. If your pointer ever hunts around, nudge the cursor **size up** a touch
so it's easy to track at speed — you can change size in post. Screen Studio auto‑hides the
cursor when it's idle, which is perfect during the pauses where the page is changing on its
own.

### 4. Background, padding, corners
Pick a **restrained** background. Font Lab is a *typography* tool with an opinionated,
warm‑dark panel (its "Galley" look — near‑black ground, one acid‑yellow accent, serif‑and‑
mono type). Let that be the visual star. A loud gradient behind it fights the product.
A soft neutral or a subtle brand color, generous padding, gentle rounded corners, one soft
shadow — done. If your demo's whole thesis is "stop looking generic," your demo frame
shouldn't look generic either.

### 5. Speed ramps
Any stretch that's mechanically slow — the dev server booting, the agent typing a long
answer, the code being written — **speed up 2–4×.** Keep the *choosing* at real time (or
even slow it slightly); speed up the plumbing around it.

### 6. Captions / annotations
Turn on auto‑captions if you narrate — they lift watch time and many people view muted.
Add a few short **text annotations**, and write them about the *benefit, not the button*:

- Over the flip: **"Real fonts. Your real page."**
- Naming a pairing as it appears: **"Fraunces / Figtree"** (say what they're seeing).
- Over the before/after: **"Before → after, instantly."**
- Over Pick: **"You pick — it ships the code."**

Don't caption what's already obvious on screen ("clicking the button"). If the viewer can
see it, the words are wasted.

---

## Part 5 — The ready‑to‑record storyboard

A concrete ~75‑second cut. Times are targets, not law. "SS" = the Screen Studio move to
apply in the editor.

| # | On screen | Narration (record after) | SS move |
|---|---|---|---|
| 1 · 0:00–0:08 | The AI‑built site as‑is: generic Inter/Geist look | "Every AI‑built site ends up looking the same — because the agent never stops to let you choose." | Wide, slow push‑in on the page |
| 2 · 0:08–0:18 | Agent chat / terminal: *"use Font Lab to pick fonts."* It asks the brief questions | "Font Lab starts by asking what you're going for." | Zoom on the chat; speed‑up any long typing |
| 3 · 0:18–0:24 | The panel appears on the real site (the Galley look) | "Then it hands you a small, curated set — on your actual page." | Zoom to the panel, then pull back to the page |
| 4 · 0:24–0:40 | **Hero.** Tap `←` `→` to flip directions; headings + body change live | "Flip through real directions and watch your own content change." | Keystroke badges ON; manual zoom into a headline; **real time** |
| 5 · 0:40–0:48 | Hold **`B`** — before/after snaps against current fonts | "Hold B to see before and after, instantly." | Tight zoom on one heading; let the toggle breathe |
| 6 · 0:48–0:56 | **`[` `]`** to swap one role; **`space`** to snap between two finalists | "Mix a heading from one, a body from another — tap space to compare finalists." | Keystroke badges; medium zoom |
| 7 · 0:56–1:02 | Hit **Pick** → the drawn checkmark | "You make the call." | Hold on the checkmark; small confident zoom |
| 8 · 1:02–1:14 | Back to the agent: it writes `next/font` + Tailwind; show the diff | "Your agent ships the exact code for your stack. Reversibly." | Zoom on the diff; speed‑up the writing |
| 9 · 1:14–1:22 | The finished site — distinctive now. Optional before/after wipe | "The taste stayed human." | Push out to full page; end card |

**Optional 10‑second bonus:** double‑click a headline in the panel and retype the words —
they save straight to source. It shows Font Lab edits *copy*, not just fonts. Only include
it if it doesn't bloat past ~90s.

---

## Part 6 — Export and where it goes

Export from the top‑right. Choose format, size, and a compression preset for the destination:

- **README / web hero:** MP4 (H.264) for broad support, or **WebM** if your host allows it —
  it compresses smaller and loads faster, which is nice on a landing page. Consider a muted,
  autoplaying loop.
- **A short GIF** of *just the flip* (scenes 4–5) is a killer README asset — small, silent,
  instantly legible. Export a trimmed version at a modest width to keep the file reasonable.
- **Social:** re‑export a **9:16** or **1:1** crop centered on the choosing moment. Don't
  reuse the 16:9 — recut so one thing fills the frame.

Sanity‑check the export at 100%: is the zoomed type crisp? Do the keystroke badges read?
Are captions in sync? Those three are what a Font Lab viewer actually judges.

---

## Part 7 — Beginner mistakes to avoid

- **Recording before you know the story.** Write the five beats first (Part 1).
- **Narrating live.** Record silent, voice after — every time.
- **Trusting auto‑zoom for keyboard actions.** It follows clicks; your flips are keys. Zoom
  those manually.
- **Forgetting the keystroke overlay.** For a keyboard‑driven tool this is the difference
  between "a tutorial" and "fonts changing for no visible reason."
- **Over‑zooming.** One or two per beat. Motion sickness kills demos.
- **A loud background.** You're selling restraint and taste; the frame should model it.
- **Lorem ipsum.** Real content is the entire pitch — use a real page.
- **Too long.** Cut to 60–90s. The choosing moment earns the runtime; nothing else does.
- **Gating the video** behind a form. Let people watch; put the ask at the end.

---

## Appendix — the two keyboards, side by side

Because you're filming a keyboard‑driven app, it helps to have both cheat‑sheets in view.

**Font Lab panel (what you press *in the demo*):**

| Key | Does |
|---|---|
| `←` `→` | flip to the previous/next direction |
| `↑` `↓` | focus a role (display / body / mono) |
| `[` `]` | swap just the focused role — a mixed pick |
| `B` | before/after (tap to toggle, hold to peek and spring back) |
| `space` | snap back to the last direction you viewed — compare two finalists |
| `S` | save a hand‑mix as its own direction |
| `X` | inspect (hover the page to identify type; on by default) · `⇧X` maps every role at once |
| `J` | jump to the focused role on the page |
| double‑click text | retype the words in place — saves to source, reversibly |
| `Enter` / **Pick** | write the selection (the agent ships it) |

**Screen Studio (what you press *to make the video*):**

| Action | How |
|---|---|
| See every shortcut for your version | **⌘ + /** in the editor (authoritative — start here) |
| Start/stop recording | a global shortcut you set in *Settings → Shortcuts* |
| Show pressed keys on screen | enable the keyboard‑shortcut display (do this for Font Lab) |
| Add a zoom | select a region on the timeline and add a manual zoom |
| Trim / speed up | drag clip edges; apply a speed ramp to a selection |

---

### Sources

Grounded against Screen Studio's own docs plus current (2026) reviews and best‑practice guides:

- [Screen Studio — Create Product Demo Videos](https://screen.studio/create/product-demo-videos)
- [Screen Studio — Keyboard shortcuts guide](https://screen.studio/guide/screen-studio-shortcuts)
- [15 Screen Studio Features (Scribe, 2026)](https://scribehow.com/page/15_Screen_Studio_Features_That_Make_It_the_Go-To_Screen_Recorder_for_Mac_in_2026__sY5n7tz3Ti-VpPmC__okKw)
- [Screen Studio Review — 90 days tested (Scribe, 2026)](https://scribehow.com/page/Screen_Studio_Review_2026_I_Tested_the_Auto-Zoom_Mac_Recorder_for_90_Days__Heres_the_Truth__0R7wu5TiSvqYAK3TzdygdQ)
- [10 Best Product Demo Video Makers & Production Tools (HowdyGo, 2026)](https://www.howdygo.com/blog/product-demo-video-production)
- [Screen Studio complete tutorial (The Organized Notebook)](https://theorganizednotebook.com/blogs/blog/screen-studio-complete-tutorial-guide)
</content>
</invoke>
