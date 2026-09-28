# Posting to the journal from the road

Site: **https://matt-mccrea.github.io/china-cycle-adventure/**

## Send a post

Email the journal inbox from one of the **approved addresses** (Kieran's, plus the riders on the trusted list). Anything from any other address is ignored. Gmail is blocked in China, so send from your usual non-Gmail address or iCloud. The Gmail addresses on the list only work with a VPN or roaming eSIM.

| Part of the email | Becomes |
|---|---|
| Subject | Post title |
| Body | Post text (blank line = new paragraph) |
| Photos attached | Photos (resized automatically; location data is stripped from the published copy) |
| A line like `@ 25.7589, 110.1211` | Exact pin on the map |
| A line like `@ stop 7` or `@ Longji` | Files the post under that stop's card (whatever day you send it) |
| A line like `@ Leigong Shan` (any place name) | Names the place and pins it there, even without coordinates |

No signal? Press send anyway. Mail keeps it in the Outbox and sends it the next time you have a connection.

It appears on the site about **10–20 minutes** after the email arrives. A "New from the road" popup shows it to anyone who opens the site.

## Location, in order of preference

1. **Typed coordinates:** open the **Compass** app. Your latitude and longitude are at the bottom, and it works with no signal. Type them as `@ 26.0415, 108.6394`.
2. **A shared Apple Maps pin:** paste the link into the email.
3. **Photo location:** used automatically if the photo has it (Settings → Privacy → Location Services → Camera: "While Using").
4. **Nothing:** the post goes under that day's stop, with no pin.

Pins joined up in date order draw **our actual route** on the map (the dotted blue line).

## Choosing the stop

By default a post goes under the stop where we sleep that night (a post sent while riding on 13 October goes under Dali Dong village). To choose, add a line with `@` and the stop number or name. It also works at the end of the subject ("Drum towers @ stop 6"):

| # | Stop | Night of |
|---|---|---|
| 1 | Guiyang 贵阳 | 10 Oct |
| 2 | Baiyan Village 白岩村 | 11 Oct |
| 3 | Leli 乐里镇 | 12 Oct |
| 4 | Dali Dong Village 大利侗寨 | 13 Oct |
| 5 | Congjiang 从江 | 14 Oct |
| 6 | Zhaoxing 肇兴侗寨 | 15 Oct |
| 7 | Longji Terraces 龙脊梯田 | 16 Oct |
| 8 | Daxu 大圩古镇 | 17 Oct |
| 9 | Yangshuo 阳朔 (Jiuxian) | 18 Oct |

A stop tag only chooses the card. Coordinates (or a photo's location) still place the exact pin.

**Anywhere else:** `@` plus any place name (`@ Leigong Shan`, `@ Xijiang`, `@ 雷公山`) looks the place up on OpenStreetMap, preferring matches near the route, pins the post there and names it on the map in blue. Away from the route, well-known places anywhere in the world work too (`@ Beijing`, `@ Forbidden City`, `@ Dublin`). Small villages OpenStreetMap doesn't know (Huanggang, for one) keep the name but get no pin, so add coordinates for those. Zoom out (− or the globe button) for the world view, which shows posts from anywhere. Posts with coordinates or a photo location get their place name looked up automatically. A number that isn't a stop (`@ stop 14`) is ignored and the post is filed by date.

## Fix a mistake

- Subject `HIDE Lunch in Huanggang` hides the post with that exact title.
- Subject `SHOW Lunch in Huanggang` brings it back.

## Before you go

- **Camera format:** Settings → Camera → Formats → **Most Compatible** (JPEG; every browser can show it).
- **Roaming eSIM** (Airalo, Holafly, …): data exits outside China, so things usually work without a VPN.
- **Test:** send one post before flying, and one from Guiyang on the first evening.

## Be careful what you post

The site is public. Avoid photographing police, checkpoints or security facilities, and ask before posting people's faces.

---

## Setting up the inbox (one-off, for whoever runs the site)

The site reads a dedicated email inbox over IMAP from a GitHub Action (`.github/workflows/site.yml`). Repository settings → Secrets and variables → Actions:

| Name | Kind | Value |
|---|---|---|
| `JOURNAL_SENDERS` | secret | comma-separated approved sender addresses (already set) |
| `JOURNAL_IMAP_USER` | secret | the journal inbox address, e.g. a new Gmail account |
| `JOURNAL_IMAP_PASS` | secret | a Gmail **app password** for it (Google account → Security → 2-Step Verification → App passwords) |
| `JOURNAL_IMAP_HOST` | secret, optional | IMAP server if not Gmail |
| `JOURNAL_IMAP_MAILBOX` | variable, optional | folder/label to read instead of `INBOX` |
| `JOURNAL_CHAIN` | variable | `off` stops the inbox checks. Delete it (or set `on`) once the inbox secrets are in, then run the workflow once from the Actions tab to start the ~10-minute check loop. |

Keep email addresses out of the repo: it's public. They belong only in the secrets.
