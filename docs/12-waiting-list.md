# Waiting list

Items deliberately parked while other implementation continues.

| Item | Status | What is needed |
| --- | --- | --- |
| **ChurchSuite planning sync** | Designed, not implemented | Working ChurchSuite credentials. The supplied identifier/secret returned `400 unauthorized_client` for client credentials; need an API-enabled user secret or an authorization-code OAuth App with redirect/consent. See [10-churchsuite-sync.md](10-churchsuite-sync.md). |
| **SongSelect provider** | Designed, not implemented | CCLI retired the partner API and is not accepting new partners. Need existing partner credentials or confirmation that an assisted flow is permitted; otherwise manual import is the supported path. See [06-songselect-and-scores.md](06-songselect-and-scores.md). |
| **Real guitar-tab samples** | Waiting | The current `songselect-tabs` sample is a lead sheet, not tablature. Need text/ASCII, PDF or image tab examples to validate the tab viewer. |
| **Git-backed shared data** | Design ready | Three separate repositories; Bibles optional + Git LFS; standard SSH or HTTP(S)+token URIs. Need remote URIs/branches and auto-sync/conflict decisions. See [11-git-data-sync.md](11-git-data-sync.md). |
| **Immutable song versions/arrangements** | Not started | Final shape of arrangements/versions and migration from the single lyrics field. |
| **Dynamic text themes** | Not started | Theme module set, token editor scope, and CSS policy. |
| **Dashboard palette + Yjs co-editing** | Not started | Which widgets each role may add, and whether simultaneous editing is required at launch. |

## Notes

- The ChurchSuite secret shared in chat should be rotated. It was never written to the repository.
- Real copyrighted samples and `library/` bind-mount data are git-ignored.
- Items move off this list only when sample data/credentials or a decision is available.
