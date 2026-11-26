# Saine Wave

Save the songs from YouTube singing streams, loop them, and play them as playlists — with lyrics, romaji and English shown on the video.

Saine Wave is a free browser extension for Microsoft Edge (and Chrome). It works with any YouTube stream or video. It's named after and made with love for **Ginjo Saine (銀城サイネ) of VSPO!**, whose 3D live is featured on the welcome screen.

> Fan-made and unofficial. Not affiliated with or endorsed by VSPO! or its operator, Ginjo Saine or YouTube.

## Calling fan artists 🎨

The current icon is a placeholder. I'm looking for a fan artist who'd like to draw a Saine icon for Saine Wave, **as a free contribution**. Saine Wave is a free, non-commercial fan project, so I can't pay for artwork, but in return:

- **You'll be credited** by name, with a link to your profile (X, Pixiv, etc.), in the README and in the extension's Settings
- Your art becomes the default icon everyone sees in their browser toolbar

What I'm looking for:

- A square image, 512×512 or larger, that still reads well when tiny (it's shown at 16×16 in the toolbar)
- Original fan art only (no stream screenshots or official art), following VSPO!'s fan art guidelines

If you're interested, [open an issue](../../issues) and say hi!

## Features

- **Save songs from any stream.** Press *New song*, mark the start and end while the video plays, and give it a name.
- **Views go to the streamer.** Saine Wave always plays the original stream on YouTube, so every listen still counts as a view for the streamer.
- **Loop or play through.** Repeat one song, repeat everything, or play once — like a normal music player.
- **Playlists.** Mix songs from different streams. Saine Wave opens each stream at the right moment. Add a song, a whole stream, or a selection of songs to a playlist, and drag to reorder. You can also play or shuffle all your songs without a playlist.
- **Lyrics on the video.** Search [LRCLIB](https://lrclib.net) for a song's lyrics in a click, or paste your own (plain text, LRC or SRT). The sample Saine songs come with lyrics ready.
- **Romaji and English.** Pick what goes on the big line and the small line under it: the original lyrics, romaji or English. Romaji is made on your computer; English uses the browser's built-in translator (Edge 148 or newer).
- **Tap to sync.** For lyrics without timings, tap Space at the start of each line while the song plays.
- **Sync between computers.** Songs and playlists are saved to your browser account, so they show up on every computer where you're signed in.
- **Sharing.** Send a link that opens and loops a song, or share a whole playlist. LRCLIB lyrics and your tap-sync timings come along. Export and import backups as a file.
- **Safe editing.** Song times are locked until you press *Edit times*, and most changes can be undone.

## Install

Saine Wave isn't in the extension stores yet, so you install it by hand. It takes about a minute.

1. On this page, click the green **Code** button, then **Download ZIP**.
2. Extract the ZIP somewhere you'll keep it (for example `Documents\SaineWave`). Don't delete the folder afterwards — the browser runs the extension from it.
3. Open `edge://extensions` (or `chrome://extensions` in Chrome).
4. Turn on **Developer mode**.
5. Click **Load unpacked** and choose the extracted folder (the one that contains `manifest.json`).
6. Open any YouTube video and click the Saine Wave icon in the toolbar, or press `\`.

Edge may show a notice about developer-mode extensions when it starts. That's normal for extensions installed this way.

### Using it on more than one computer

Install it the same way on each computer and sign in to the same browser account with sync turned on. Your songs and playlists follow you. Lyrics, backgrounds and settings are kept per computer.

### Updating

Download the new ZIP, replace the files in your Saine Wave folder, then click **Reload** on Saine Wave at `edge://extensions` and refresh your YouTube tabs. Your songs are not affected.

## Keyboard shortcuts

| Key | Action |
| --- | --- |
| `\` | Show or hide the panel |
| `[` | Mark the start of a new song |
| `]` | Mark the end and save it |
| `Space` | While tap-syncing lyrics: mark the next line |
| `Backspace` | While tap-syncing: undo the last tap |
| `Enter` / `Esc` | While tap-syncing: finish / cancel |

## Privacy

Saine Wave has no server and collects nothing. See [PRIVACY.md](PRIVACY.md).

## Credits

- Featured stream: [【#銀城サイネ3D】おまたせ...！見ててくだサイネ。](https://www.youtube.com/watch?v=GVjhhSSSbLs) — Ginjo Saine, VSPO!. Saine Wave only links to and plays the original video on YouTube; it doesn't copy or re-upload any of it.
- Lyrics: [LRCLIB](https://lrclib.net), a free, community-made lyrics database.
- Japanese word splitting for romaji: [kuromoji.js](https://github.com/takuyaa/kuromoji.js) (Apache License 2.0) with the mecab-ipadic dictionary — see `KUROMOJI-LICENSE.txt` and `KUROMOJI-NOTICE.md`.
- Icons: [Material Symbols](https://fonts.google.com/icons) (Apache License 2.0).
- Balloon in the app icon: [Microsoft Fluent Emoji](https://github.com/microsoft/fluentui-emoji) (MIT License) — see `FLUENT-EMOJI-LICENSE.txt`.
- Theme colors are inspired by Ginjo Saine's outfit.

## License

Saine Wave's own code is released under the [MIT License](LICENSE). The bundled kuromoji.js and its dictionary, and the Fluent Emoji balloon, keep their own licenses, listed above.
