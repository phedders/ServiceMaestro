# Drop zone for real sample files

Put sample inputs here so the importers, asset viewers and Bible adapters can be written against the real formats. **Contents of this directory are git-ignored** (only this README is tracked).

```
samples/
├── openlp/               OpenLyrics XML
├── chordpro/             bulk ChordPro downloads
├── songselect-chordpro/  SongSelect ChordPro download
├── songselect-text/      SongSelect lyrics text
├── songselect-score/     SongSelect vocal score PDF
├── songselect-tabs/      SongSelect lead-sheet PDF (not guitar tablature)
├── songselect-pdf/       other SongSelect PDFs
├── songs-text/           plain-text lyrics and notes
├── bible/                SQLite + JSON translations
├── scores/               additional score samples
├── tabs/                 guitar-tab samples
└── setlists/             existing playlist export (optional)
```

See [docs/04-sample-files.md](../docs/04-sample-files.md) for the full checklist, including what to note about ChordPro directives, score keys and Bible schemas.

**Correction:** WordPro was mentioned earlier by mistake — ChordPro is the intended format. No WordPro files are needed.

Do not commit copyrighted lyric, score, tab or Bible files to git — keeping them here, ignored, is intentional. **Never put SongSelect passwords or API keys in this folder**; credentials will be entered through an encrypted connection flow.
