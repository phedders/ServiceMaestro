# External presentations

Status: **experimental public iframe embed**. **Menu → Experimental → Presentations** saves public
PowerPoint, Canva and Google Slides links per user and displays them inside the control interface.

## What works

- Paste a **normal Canva design link** or its embed code. Canva links are converted to
  `/view?embed`.
- Paste a **Google Slides** presentation link. It is converted to the public `/embed` view and the
  open button uses `/present`.
- Paste a **PowerPoint/SharePoint “Embed this Presentation” iframe code**. The iframe `src` is
  extracted and used for the embedded view.
- Paste any other public HTTPS iframe-compatible link.
- Each presentation can be shown in a fullscreen panel or opened in a new browser window.
- Presentations are stored per user in `user_preferences`; no server-side fetching or credentials
  are used.

## Keyboard control

Service Maestro cannot inject keys into a cross-origin iframe, and it cannot start a provider’s
slideshow programmatically. The physical USB clicker still works because it is a keyboard:

1. Start the provider’s presentation mode inside the frame or open it in a new window.
2. Click inside the presentation, or press **Focus presentation**.
3. Use the clicker’s PageUp/PageDown/arrow keys; they are delivered directly to the provider.

For a reliable external presentation workflow, launch the provider’s **present** URL in a new
window, sign in there if required, and let the clicker operate that focused window.

## SharePoint and private links

Private SharePoint/OneDrive sharing links normally require tenant sign-in. They may also send
`X-Frame-Options: SAMEORIGIN` or a CSP `frame-ancestors` policy that prevents embedding on an
external site. A normal SharePoint sharing link will often render a sign-in page or stay blank.

Use **Open in new window** for those links. For embedding, generate the official PowerPoint
**Embed this Presentation** iframe code from a file that is publicly viewable.

The Oakhall SharePoint link tested during development requires Microsoft sign-in and was not
anonymously viewable in a browser; it must be opened in a signed-in window rather than embedded.

## Limitations

- No provider is guaranteed to allow embedding; the browser cannot report an iframe policy failure.
- Starting a PowerPoint/Canva slideshow still requires a click in the provider’s own UI.
- Third-party cookie restrictions can prevent a private presentation from loading in an iframe even
  when the user is signed in in another tab.
- Nested cross-origin frames cannot be resized or navigated by Service Maestro.
